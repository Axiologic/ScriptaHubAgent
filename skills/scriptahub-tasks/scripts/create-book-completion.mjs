import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { atomicJson, insideRun, preparedPackage, readManuscriptEditorial, verifySourceAudit, writeHandoff } from './workflow-checks.mjs';
import { sharedEditorial } from './shared-editorial.mjs';
import { artworkRequirement } from './publication-artwork.mjs';

const roles = ['comprehensive-summary', 'relevant-keywords', 'marketing-summary', 'short-description'];
const steps = new Set(['resume-book','moderate-submission','prepare-manuscript', ...roles, 'shared-editorial-analysis',
  'process-content','translate-resources','review-correct','export-book-pdf','validate-final','validate-edit','publish-result','book-result']);
const terminal = ['completed', 'failed', 'cancelled'];
const artifactPhases = new Set(['prepare-manuscript', ...roles, 'translate-resources', 'review-correct', 'export-book-pdf']);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
function requireEvidence(condition, message) {
  if (!condition) throw new Error(message);
}

export async function completeCreateBookPhase({directory, step, completionId}, call) {
  requireEvidence(steps.has(step), 'Unknown Create book phase');
  requireEvidence(/^tasks\/[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(directory || '')
    && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(completionId || ''), 'Invalid task directory or phase attempt');
  const outputs = new Map();
  const artifact = async (file, label, digest) => {
    requireEvidence(typeof file === 'string' && file.startsWith(directory + '/') && !/[\\\0]/.test(file)
      && file.split('/').every(part => part && part !== '.' && part !== '..'), 'Missing or out-of-scope ' + label);
    try {
      const bytes = await fs.readFile(await insideRun(file));
      const fingerprint = sha256(bytes);
      requireEvidence(bytes.length && (digest === undefined || fingerprint === digest), 'Invalid or changed ' + label);
      outputs.set(file, {path:file, size:bytes.length, sha256:fingerprint});
      return bytes;
    } catch (error) {
      if (error.code === 'ENOENT') throw new Error('Missing ' + label);
      throw error;
    }
  };
  const json = async (...args) => JSON.parse(await artifact(...args));
  const handoffPath = directory + '/run-state/handoff.json';
  let handoffBytes = await artifact(handoffPath, 'handoff');
  const {step: savedStep, context: ctx} = JSON.parse(handoffBytes);
  const {task} = await json(directory + '/run-state/claimed.json', 'claim');
  requireEvidence(['taskId', 'executionId', 'runId', 'bookId'].every(key => task?.[key] && task[key] === ctx?.[key])
    && directory === 'tasks/' + task.taskId, 'Claim and handoff identify different requests');
  const {executionId, processingMode} = ctx;
  const status = await call('scriptahub_task_status', {executionId});
  requireEvidence(status.executionId === executionId && status.taskId === task.taskId, 'Service status identifies a different request');
  const state = status.state;
  const isTerminal = terminal.includes(state);
  const modeMatches = processingMode === 'process' ? state === 'running' && !status.publicationPending
    : processingMode === 'terminal' ? isTerminal
    : processingMode === 'publication-recovery' ? status.publicationPending === true
    : processingMode === 'cancel' && state === 'stop_requested' && !status.publicationPending;
  const finishing = step === 'publish-result' || step === 'book-result';
  const finalValidation = step === 'validate-final' || step === 'validate-edit';
  let packageModeration;

  const savePackageHandoff = step === 'review-correct' && processingMode === 'process' && task.type === 'scriptahub.manuscript'
    && ['process-content', 'translate-resources'].includes(savedStep);
  if (finishing) {
    if (step === 'publish-result' && processingMode === 'process' && state === 'running' && !status.publicationPending) {
      await saveModerationProgress(await call('scriptahub_task_moderate', {executionId, stage:'package', action:'status'}));
    }
    requireEvidence(isTerminal && (state !== 'completed' || (status.publication?.executionId === executionId
      && status.publication.bookId === task.bookId && /^[a-f0-9]{40}$/.test(status.publication.commit))), 'Publication or cancellation is still unresolved');
    if (processingMode === 'process') requireEvidence(state === 'completed', status.taskError || 'Publication did not complete');
    if (step === 'book-result') requireEvidence(savedStep === 'book-result', 'Save the single-book result in the handoff');
    if (step === 'publish-result' && processingMode !== 'terminal') requireEvidence(savedStep === step, 'Save the confirmed publication or cancellation result');
  } else {
    requireEvidence(modeMatches, 'The saved processing mode does not match the current service state: ' + state);
    if (step === 'resume-book') requireEvidence(savedStep === step, 'Save the service state and processing mode in the handoff');
    else if (processingMode === 'process') {
      if (finalValidation) {
        packageModeration = await call('scriptahub_task_moderate',{executionId,stage:'package',action:'status'});
        await saveModerationProgress(packageModeration);
      }
      if (artifactPhases.has(step)) {
        const moderation = await call('scriptahub_task_moderate',{executionId,stage:'artifact',action:'status'});
        await saveModerationProgress(moderation);
        requireEvidence(moderation.status === 'idle', 'Finish the active artifact review');
      }
      if (step === 'moderate-submission') {
        const result = await call('scriptahub_task_moderate', {executionId, stage: 'submission', action: 'status'});
        await saveModerationProgress(result);
        requireEvidence(result.status === 'passed', 'Submission moderation has not passed');
      } else {
        requireEvidence(savedStep === step || savePackageHandoff, 'Save the completed ' + step + ' handoff');
        await checkArtifacts();
      }
    }
  }
  requireEvidence(handoffBytes.equals(await artifact(handoffPath, 'handoff')), 'Handoff changed during the completion check');
  if (savePackageHandoff) {
    await writeHandoff({directory, step, context: {
      executionId, runId: task.runId, taskId: task.taskId, bookId: task.bookId,
      readingRoutesInput: directory + '/review/reading-routes-input.json',
    }});
    handoffBytes = await artifact(handoffPath, 'package handoff');
  }
  const nextEdgeId = step === 'process-content' ? (processingMode === 'process' && ctx.translationRequest?.explicit
    && ctx.translationRequest.targets.length ? 'editorial-to-translations' : 'editorial-to-package') : undefined;
  return atomicJson(`.workflow-completion/${completionId}.json`, {
    step, completionId, artifact: {path: handoffPath, sha256: sha256(handoffBytes)}, nextEdgeId, outputs:[...outputs.values()],
  });

  async function saveModerationProgress(result) {
    if (!Number.isSafeInteger(result.completedUnits) || result.completedUnits < 1) return;
    await atomicJson(`.workflow-completion/${completionId}.progress.json`, {
      step, completionId, completedUnits:result.completedUnits
    });
  }

  async function requireArtifactReview(file, digest) {
    const result = await call('scriptahub_task_moderate',{executionId,stage:'artifact',action:'status',file,digest});
    requireEvidence(result.status === 'passed', 'Missing artifact moderation for ' + file);
  }

  async function checkArtifacts() {
    if (step === 'validate-edit') {
      await checkFinalApproval();
      return;
    }
    const primary = ctx.editorialSource;
    const direct = ctx.manuscriptEditions;
    requireEvidence(primary?.language && (!direct || Object.hasOwn(direct, primary.language)), 'Missing the pinned editorial source');
    const editions = Object.entries(direct ?? {[primary.language]: primary});
    const languageList = editions.map(([language]) => language);
    for (const [language, source] of editions) {
      requireEvidence(/^[a-f0-9]{64}$/.test(source.sha256), 'Missing source digest for ' + language);
      await artifact(source.path, language + ' source', source.sha256);
      if (task.type === 'scriptahub.manuscript' && step === 'prepare-manuscript') {
        const pdf = await artifact(source.referencePdf ?? ctx.referencePdf, language + ' reference PDF', source.referencePdfSha256);
        requireEvidence(pdf.subarray(0,5).toString() === '%PDF-', 'Invalid reference PDF for ' + language);
      }
      if (step === 'prepare-manuscript') {
        const reference = ctx.sourceAudits?.[language];
        const pdfPath = task.type === 'scriptahub.manuscript' ? source.referencePdf ?? ctx.referencePdf : null;
        const evidence = await verifySourceAudit(directory, source, reference, pdfPath);
        await artifact(reference.path, language + ' source audit', reference.sha256);
        if (evidence.jobPath) await artifact(evidence.jobPath, language + ' source audit job', reference.jobSha256);
        await requireArtifactReview(source.path, source.sha256);
      }
      if (roles.includes(step) || ['shared-editorial-analysis','process-content'].includes(step)) {
        const editorial = direct
          ? await readManuscriptEditorial(ctx, directory, language, file => artifact(file, language + ' editorial evidence'))
          : ctx;
        const required = step === 'process-content' ? roles : roles.includes(step) ? [step] : [];
        for (const role of required) {
          const result = editorial?.editorialResults?.[role];
          requireEvidence(result?.skill === role && result.sourceSha256 === source.sha256 && result.sourcePath === source.path
            && /^[a-f0-9]{64}$/.test(result.outputSha256) && /^[a-f0-9]{64}$/.test(result.receiptSha256), 'Missing accepted ' + role + ' for ' + language);
          await artifact(result.output, language + ' ' + role + ' output', result.outputSha256);
          const receipt = await json(result.receipt, language + ' ' + role + ' validation receipt', result.receiptSha256);
          requireEvidence(role === 'relevant-keywords' ? Number.isInteger(receipt.count) && receipt.count > 0 && receipt.keywords?.length === receipt.count
            : receipt.status === 'passed', 'Validation did not pass for ' + language + ' ' + role);
          if (step === role) await requireArtifactReview(result.output, result.outputSha256);
        }
        if (['shared-editorial-analysis','process-content','marketing-summary','short-description'].includes(step)) {
          const result = await sharedEditorial({executionId, directory, ...(direct && {language}), action: step === 'process-content' ? 'verify' : 'status'});
          requireEvidence(['complete','passed'].includes(result.status) && !result.needsHandoff
            && editorial?.sharedEditorialAnalysis?.sha256 === result.evidence?.sha256, 'Shared editorial analysis is incomplete for ' + language);
          await artifact(result.evidence.path, language + ' shared analysis', result.evidence.sha256);
          const projection = result.projections[step];
          if (projection) requireEvidence(!projection.needsValidation && !projection.pendingBatches.length, 'The ' + step + ' is not validated against the current analysis for ' + language);
        }
      }
    }
    if (step === 'process-content') {
      const destination = ctx.destination;
      requireEvidence(ctx.repositories?.includes(destination?.catalogue) && destination?.branch
        && [1,2].includes(destination.schemaVersion) && (destination.baseCommit !== null || destination.schemaVersion === 2)
        && (destination.baseCommit === null || /^[a-f0-9]{40}$/.test(destination.baseCommit)), 'Missing verified publication destination');
      requireEvidence(typeof ctx.translationRequest?.explicit === 'boolean' && Array.isArray(ctx.translationRequest.targets)
        && (ctx.translationRequest.explicit || !ctx.translationRequest.targets.length), 'Missing or inconsistent translation decision');
      if (ctx.translationRequest.targets.length) await json(directory + '/editorial/translation-inputs.json', 'translation inputs');
    }
    if (step === 'translate-resources') {
      const targets = ctx.translationRequest?.targets || [];
      if (targets.length) {
        const {publishedLanguages, omitted} = ctx.translationOutcome ?? {};
        requireEvidence(Array.isArray(publishedLanguages) && Array.isArray(omitted) && languageList.every(language => publishedLanguages.includes(language))
          && targets.every(language => publishedLanguages.includes(language) !== omitted.some(item => item.language === language && item.reason?.trim())),
        'Missing translation outcomes for requested languages');
        await json(directory + '/translations/manifest.json', 'translation manifest');
      }
    }
    if (step === 'review-correct') {
      const inputs = await json(directory + '/review/reading-routes-input.json', 'staged reading inputs');
      const languages = ctx.publicationLanguages ?? languageList;
      requireEvidence(inputs.executionId === executionId && languages.every(language => inputs.editions?.[language]),
        'Staged readings must cover all included languages');
      const collectionFile = directory + '/package/' + inputs.collectionPath;
      const collection = await json(collectionFile, 'staged catalogue');
      const book = collection.books?.find(entry => entry.id === task.bookId);
      const bookPath = collection.schemaVersion === 1 ? book?.directory : book?.path && path.posix.dirname(book.path);
      requireEvidence(bookPath?.startsWith('books/'), 'Missing staged book in the catalogue');
      const bookDirectory = path.posix.dirname(collectionFile) + '/' + bookPath;
      const artwork = artworkRequirement(task);
      for (const language of languages) {
        const input = inputs.editions[language];
        requireEvidence(input.fullContent !== input.comprehensiveSummary && input.shortDescription?.trim()
          && Array.isArray(input.aboutBook) && input.aboutBook.some(value => value?.trim()), 'Missing staged reading resources for ' + language);
        const files = [input.fullContent, input.comprehensiveSummary];
        if (artwork.required || input.cover !== undefined || input.thumbnail !== undefined) files.push(input.cover, input.thumbnail ?? input.cover);
        for (const file of files) {
          requireEvidence(typeof file === 'string' && file.split('/').every(part => part && part !== '.' && part !== '..'), 'Invalid staged resource for ' + language);
          const name = bookDirectory + '/' + file;
          const bytes = await artifact(name, language + ' staged ' + file);
          if (!artwork.sourceHash && [input.cover,input.thumbnail].includes(file)) await requireArtifactReview(name,sha256(bytes));
        }
        if (task.type === 'scriptahub.manuscript' && Object.hasOwn(direct ?? {}, language)) {
          const source = direct[language];
          const stagedPdf = await artifact(bookDirectory + '/' + language + '/book.pdf', language + ' staged PDF', source.referencePdfSha256);
          requireEvidence(stagedPdf.subarray(0,5).toString() === '%PDF-', 'Invalid staged PDF for ' + language);
        }
      }
    }
    if (step === 'export-book-pdf') {
      const report = await json(directory + '/run-state/package-check.json', 'package verification');
      requireEvidence(report.ok && report.executionId === executionId && report.bookId === task.bookId && report.fileCount > 0
        && report.readingRoutesChecked === true && (task.type !== 'scriptahub.book-proposal' || report.pdfRequired === true)
        && /^[a-f0-9]{64}$/.test(report.inventory?.sha256 || ''),
        'The staged publication package did not pass verification');
      const draft = await json(report.inventory.path, 'draft inventory', report.inventory.sha256);
      if (task.type === 'scriptahub.book-proposal') {
        for (const file of draft.files.filter(entry => entry.path.endsWith('/book.pdf'))) {
          await requireArtifactReview(directory + '/package/' + file.path,file.sha256);
        }
      }
    }
    if (step === 'validate-final') await checkFinalApproval();
  }

  async function checkFinalApproval() {
    const validation = directory + '/validation/final-report.json';
    const inventory = directory + '/validation/verified-inventory.json';
    const report = await json(validation, 'final validation');
    requireEvidence(report.executionId === executionId && report.runId === task.runId && report.bookId === task.bookId
      && report.publicationPermitted === true && report.audit?.errorFindings === 0 && /^[a-f0-9]{64}$/.test(report.inventorySha256),
    'Missing final publication approval');
    const prepared = await preparedPackage(directory,executionId,task.bookId);
    requireEvidence(prepared.approval?.validation === validation && prepared.approval?.inventory === inventory
      && prepared.inventory.sha256 === report.draftInventorySha256, 'Final approval does not match the current prepared package');
    await artifact(prepared.inventory.path, 'draft inventory', report.draftInventorySha256);
    await artifact(inventory, 'approved inventory', report.inventorySha256);
    requireEvidence(packageModeration.status === 'passed' && packageModeration.inventorySha256 === report.inventorySha256,
      'The frozen publication inventory must have a matching moderation verdict');
  }
}
