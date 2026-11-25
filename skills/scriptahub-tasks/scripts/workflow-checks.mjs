import { validateCatalogueKeywords } from './catalogue-keywords.mjs';
import {withExecutionLock} from './anchored-files.mjs';
import {guardRemoteBackups} from './remote-skill.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { constants } from 'node:fs';
import { execFile } from 'node:child_process';
import { isDeepStrictEqual, promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import {artworkFields, artworkPath, artworkRequirement} from './publication-artwork.mjs';
const execute = promisify(execFile);
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
export async function insideRun(value, { directory = false } = {}) {
  const root = await fs.realpath(process.cwd());
  if (typeof value !== 'string' || !value || path.isAbsolute(value)) throw new Error('Use a path relative to this run');
  const target = path.resolve(root,value);
  if (!target.startsWith(root + path.sep)) throw new Error('Path leaves this run');
  let current = root;
  for (const part of path.relative(root,target).split(path.sep)) {
    current = path.join(current,part);
    if ((await fs.lstat(current)).isSymbolicLink()) throw new Error('Run paths must not contain symlinks');
  }
  const stat = await fs.stat(target);
  if (directory ? !stat.isDirectory() : !stat.isFile()) throw new Error('Unexpected artifact type');
  return target;
}
async function jsonArtifact(value, limit = 16*1024*1024) {
  const filename = await insideRun(value);
  if ((await fs.stat(filename)).size > limit) throw new Error('JSON artifact is too large');
  return JSON.parse(await fs.readFile(filename,'utf8'));
}

export async function verifySourceAudit(directory, source, reference, pdf) {
  const report = reference?.path;
  const auditDirectory = directory + '/validation/source-layout/' + source.language + '/';
  if (typeof report !== 'string' || !report.startsWith(auditDirectory) || !report.endsWith('/report.json')
      || !/^[a-f0-9]{64}$/.test(reference.sha256 ?? '')) {
    throw Error('Missing source audit for ' + source.language);
  }
  const filename = await insideRun(report);
  const audit = await jsonArtifact(report);
  if (hash(await fs.readFile(filename)) !== reference.sha256
      || !['passed', 'passed_with_warnings'].includes(audit.status) || audit.autoCorrect !== false
      || !Array.isArray(audit.findings) || audit.findings.some(finding => finding.severity === 'error')) {
    throw Error('Source audit has not passed for ' + source.language);
  }
  const html = await insideRun(source.path);
  const matchesHtml = item => item?.file === html && item.sha256 === source.sha256;
  if (!pdf) {
    if (audit.scope !== 'edition_layout_regression' || audit.errorFindings !== 0 || audit.existingFindings !== 0
        || audit.approvedChanges !== 0 || audit.baseline?.sha256 !== source.sha256 || !matchesHtml(audit.candidate)
        || !Array.isArray(audit.inputs) || !audit.inputs.some(matchesHtml)) throw Error('Source layout audit does not match ' + source.language);
    const baseline = path.relative(process.cwd(), audit.baseline.file);
    if (!baseline.startsWith(directory + '/sources/') || audit.baseline.file === html
        || hash(await fs.readFile(await insideRun(baseline))) !== source.sha256) {
      throw Error('Source layout baseline changed for ' + source.language);
    }
    return { inputs: audit.inputs, original: html, baseline: audit.baseline.file };
  }
  const jobPath = path.posix.join(path.posix.dirname(report), 'job.json');
  const nativeJob = await jsonArtifact(jobPath);
  const referencePdf = await insideRun(pdf);
  const referenceSha256 = hash(await fs.readFile(referencePdf));
  if (hash(await fs.readFile(await insideRun(jobPath))) !== reference.jobSha256
      || audit.scope !== 'layout_and_structure' || audit.corrections?.length || !isDeepStrictEqual(nativeJob.result, audit)
      || audit.documents?.length !== 1 || audit.documents[0].file !== html || !Array.isArray(nativeJob.inputs)
      || !nativeJob.inputs.some(matchesHtml) || !nativeJob.inputs.some(item => item.file === referencePdf && item.sha256 === referenceSha256)) {
    throw Error('Source audit does not match the HTML and PDF for ' + source.language);
  }
  return { inputs: nativeJob.inputs, original: html, pdf: referencePdf, jobPath };
}

async function verifyStagedSource(root, names, reader, evidence, language) {
  if (!names.has(reader)) throw Error('Missing staged reader for ' + language);
  const candidate = path.join(root, reader);
  for (const {file, sha256} of evidence.inputs) {
    if ([evidence.pdf, evidence.baseline, '/opt/scriptahub/runtime/reader/reader.css'].includes(file)) continue;
    const relative = path.relative(path.dirname(evidence.original), file);
    const staged = file === evidence.original ? candidate : path.resolve(path.dirname(candidate), relative);
    const name = path.relative(root, staged).split(path.sep).join('/');
    if (relative.startsWith('..') || !names.has(name) || hash(await fs.readFile(staged)) !== sha256) {
      throw Error('Staged reader or its resources changed for ' + language + '; audit this edition in the package');
    }
  }
}
export async function atomicJson(relative, value) {
  return atomicFile(relative, Buffer.from(JSON.stringify(value,null,2)+'\n'));
}
export async function atomicFile(relative, bytes) {
  const root = await fs.realpath(process.cwd());
  const parts = relative.split('/'); let current = root;
  for (const part of parts.slice(0,-1)) {
    current = path.join(current,part); await fs.mkdir(current,{mode:0o700}).catch(e=>{if(e.code!=='EEXIST')throw e;});
    if (!(await fs.lstat(current)).isDirectory()) throw new Error('Output parent is not a real directory');
  }
  const target = path.join(root,relative), temp = target+'.'+crypto.randomUUID()+'.tmp';
  try { await fs.writeFile(temp,bytes,{flag:'wx',mode:0o600});await fs.rename(temp,target); }
  finally {await fs.rm(temp,{force:true});}
  return {path:relative,sha256:hash(bytes)};
}
function itemArtifact(directory = '.',name) {
  if (directory !== '.' && !/^tasks\/[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(directory)) throw new Error('Invalid task directory');
  return (directory === '.' ? '' : directory + '/') + 'run-state/' + name;
}
function manuscriptEditions(context, directory) {
  const editions = context.manuscriptEditions;
  if (editions === undefined) return [];
  const entries = Object.entries(editions ?? {});
  const primary = editions?.[context.editorialSource?.language];
  const sourcesDirectory = directory + '/sources/';
  const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
  const sourcePath = value => typeof value === 'string' && value.startsWith(sourcesDirectory)
    && !/[\\\0]/.test(value) && value.split('/').every(part => part && part !== '.' && part !== '..');
  if (entries.length < 2 || !primary ||
      ['path', 'sha256'].some(key => primary[key] !== context.editorialSource[key]) ||
      entries.some(([language, edition]) => {
        try {
          return new Intl.Locale(language).baseName !== language || edition?.language !== language
            || !sourcePath(edition.path) || !sourcePath(edition.referencePdf)
            || !digest(edition.sha256) || !digest(edition.referencePdfSha256);
        } catch { return true; }
      }) ||
      new Set(entries.map(([, edition]) => edition.path)).size !== entries.length ||
      new Set(entries.map(([, edition]) => edition.referencePdf)).size !== entries.length) {
    throw Error('Invalid pinned manuscript editions');
  }
  return entries;
}

const editorialPath = (directory, language, digest) => `${directory}/run-state/editorial/${language}/${digest}.json`;
const isEditorialReference = entry => entry && (Object.hasOwn(entry, 'path') || Object.hasOwn(entry, 'sha256'));

export async function readManuscriptEditorial(context, directory, language, read = async filename => fs.readFile(await insideRun(filename))) {
  if (!Object.hasOwn(context.manuscriptEditions ?? {}, language) || !/^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/.test(language)) {
    throw Error('Editorial evidence requires a pinned manuscript language');
  }
  const entry = context.manuscriptEditorial?.[language];
  if (!isEditorialReference(entry)) return entry;
  if (!/^[a-f0-9]{64}$/.test(entry.sha256 ?? '') || entry.path !== editorialPath(directory, language, entry.sha256)) {
    throw Error('Invalid editorial evidence reference for ' + language);
  }
  const bytes = await read(entry.path);
  if (hash(bytes) !== entry.sha256) throw Error('Editorial evidence changed for ' + language);
  const evidence = JSON.parse(bytes);
  if (evidence.executionId !== context.executionId || evidence.language !== language
    || evidence.sourceSha256 !== context.manuscriptEditions[language].sha256) {
    throw Error('Editorial evidence belongs to a different execution or source: ' + language);
  }
  return evidence.editorial;
}

export async function writeHandoff(input) {
  const steps = ['claim-edit','apply-edit','prepare-edit-package','validate-edit','submit-edit','resume-book','prepare-manuscript','comprehensive-summary','relevant-keywords','shared-editorial-analysis','marketing-summary','short-description','process-content','translate-resources','review-correct','export-book-pdf','validate-final','publish-result','book-result'];
  if (!steps.includes(input.step) || !input.context || typeof input.context !== 'object' || Array.isArray(input.context)) throw new Error('Provide the step and a context object');
  for (const key of ['executionId','runId','taskId','bookId']) if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(input.context[key] || '')) throw new Error('Invalid handoff identity: '+key);
  const handoffPath = itemArtifact(input.directory,'handoff.json');
  let old = null;
  try { old = await jsonArtifact(handoffPath, Infinity); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  for (const key of ['executionId','runId','taskId','bookId']) if (old && old.context[key] !== input.context[key]) throw new Error('Handoff belongs to another execution');
  if (old?.context.editorialSource) {
    const pinned = old.context.editorialSource;
    const proposed = input.context.editorialSource;
    if (proposed && ['path','sha256','language'].some(key => proposed[key] !== pinned[key])) throw new Error('Editorial source is pinned; do not replace or regenerate the book');
    input = {...input, context:{...input.context, editorialSource:pinned}};
  }
  if (old?.context.manuscriptEditions && input.context.manuscriptEditions !== undefined
      && !isDeepStrictEqual(old.context.manuscriptEditions, input.context.manuscriptEditions)) {
    throw Error('Manuscript editions are pinned; do not replace their sources');
  }
  if (old) {
    const context = {...old.context, ...input.context};
    if (old.context.editorialResults || input.context.editorialResults) {
      context.editorialResults = {...old.context.editorialResults, ...input.context.editorialResults};
    }
    input = {...input, context};
  }
  const directory = input.directory ?? '.';
  manuscriptEditions(input.context, directory);
  const rejectSecrets = value => {
    if (!value || typeof value !== 'object') return;
    for (const [key,child] of Object.entries(value)) {
      if (/^(token|accessToken|password|secret|secretKey|authorization|cookie|credential)$/i.test(key)) throw new Error('Secrets must not enter a handoff');
      rejectSecrets(child);
    }
  };
  rejectSecrets(input.context);
  const updates = input.context.manuscriptEditorial;
  const previous = old?.context.manuscriptEditorial;
  const writes = [];
  if (updates || previous) {
    const references = Object.create(null);
    for (const language of new Set([...Object.keys(previous ?? {}), ...Object.keys(updates ?? {})])) {
      const source = input.context.manuscriptEditions?.[language];
      if (!source || !Object.hasOwn(input.context.manuscriptEditions, language)) throw Error('Editorial evidence requires a pinned manuscript language');
      const prior = previous?.[language];
      const update = updates?.[language];
      if (isEditorialReference(update) && !isDeepStrictEqual(update, prior)) throw Error('Use the current editorial evidence reference for ' + language);
      if (isEditorialReference(prior) && (!update || isEditorialReference(update))) {
        references[language] = prior;
        continue;
      }
      const saved = prior && await readManuscriptEditorial(old.context, directory, language);
      const editorial = {...saved, ...update, editorialResults: {...saved?.editorialResults, ...update?.editorialResults}};
      const bytes = Buffer.from(JSON.stringify({executionId: input.context.executionId, language, sourceSha256: source.sha256, editorial}, null, 2) + '\n');
      const sha256 = hash(bytes);
      const path = editorialPath(directory, language, sha256);
      references[language] = {path, sha256};
      writes.push({path, bytes});
    }
    input = {...input, context: {...input.context, manuscriptEditorial: references}};
  }
  for (const {path, bytes} of writes) await atomicFile(path, bytes);
  return atomicJson(handoffPath,{step:input.step,context:input.context,updatedAt:new Date().toISOString()});
}
export async function preflight(receipt) {
  if (!receipt || receipt.ok !== true || typeof receipt.runtimeId !== 'string' || typeof receipt.platform !== 'string' || !receipt.sourceDigests || !Array.isArray(receipt.checks) || !receipt.checks.length || receipt.checks.some(check => check.status !== 'passed') || !Number.isFinite(Date.parse(receipt.checkedAt))) throw new Error('ScriptaHub runtime preflight failed');
  await atomicJson('run-state/preflight.json',receipt);
  return receipt;
}
export async function verifyPackage(input,{hook=async()=>{}}={}) {
  return withExecutionLock(process.cwd(),input.executionId,async base=>{
  await guardRemoteBackups(base,input.executionId);
  await hook('guarded');
  const root=await insideRun(input.packageRoot,{directory:true});
  const inventoryPath=await insideRun(input.inventory);
  if ((await fs.stat(inventoryPath)).size > 16*1024*1024) throw new Error('JSON artifact is too large');
  const inventoryBytes=await fs.readFile(inventoryPath);
  const inventory=JSON.parse(inventoryBytes);
  if(inventory.executionId!==input.executionId || !Array.isArray(inventory.files) || !inventory.files.length)throw new Error('Inventory belongs to another execution or has no files');
  const names=new Set();let bytes=0;
  for(const entry of inventory.files){
    if(typeof entry.path!=='string'||/[\\\0]/.test(entry.path)||entry.path.startsWith('/')||entry.path.split('/').some(p=>!p||p==='.'||p==='..'||p.toLowerCase()==='.git')||names.has(entry.path))throw new Error('Unsafe or duplicate inventory path');
    names.add(entry.path);
    const file=await insideRun(path.relative(process.cwd(),path.join(root,entry.path)));
    const value=await fs.readFile(file);
    if(value.length!==entry.size||hash(value)!==entry.sha256)throw new Error('Inventory differs from package: '+entry.path);
    bytes+=value.length;
  }
  const runGit=async args=>(await execute('git',['-c','core.hooksPath=/dev/null','-c','credential.helper=',...args],{cwd:root,timeout:30000,maxBuffer:8*1024*1024,env:{PATH:process.env.PATH,HOME:os.homedir(),GIT_TERMINAL_PROMPT:'0',GIT_ALLOW_PROTOCOL:'https',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null'}})).stdout.trim();
  if(inventory.baseCommit!==null && !/^[a-f0-9]{40}$/.test(inventory.baseCommit || ''))throw new Error('Invalid base commit');
  if(inventory.baseCommit){
    const checkout=await fs.lstat(path.join(root,'.git')).catch(error=>{if(error.code!=='ENOENT')throw error;return null;});
    if(checkout && await runGit(['rev-parse','HEAD'])!==inventory.baseCommit)throw new Error('Package checkout baseline changed');
  }
  // Remote reads remain credential-free and restricted to the actual configured catalogue.
  const catalogue=new URL(input.catalogue);
  if(catalogue.protocol!=='https:'||catalogue.username||catalogue.password||catalogue.port||catalogue.search||catalogue.hash)throw new Error('Invalid catalogue destination');
  const match=catalogue.hostname==='github.com' ? /^\/([\w.-]+)\/([\w.-]+)\/blob\/(.+)$/.exec(catalogue.pathname)
    : catalogue.hostname==='raw.githubusercontent.com' ? /^\/([\w.-]+)\/([\w.-]+)\/(.+)$/.exec(catalogue.pathname) : null;
  if(!match||!input.branch||!match[3].startsWith(input.branch+'/')||!/^refs\/heads\/[A-Za-z0-9][A-Za-z0-9._/-]*$/.test('refs/heads/'+input.branch))throw new Error('Catalogue/branch mismatch');
  const collectionPath=match[3].slice(input.branch.length+1);
  if(path.posix.basename(collectionPath)!=='collection.json'||!names.has(collectionPath))throw new Error('Inventory must contain the catalogue update');
  const collection=JSON.parse(await fs.readFile(path.join(root,collectionPath),'utf8'));
  if(![1,2].includes(collection.schemaVersion)||!Array.isArray(collection.books)||collection.bookCount!==collection.books.length||new Set(collection.books.map(b=>b.id)).size!==collection.books.length||!collection.books.some(b=>b.id===input.bookId))throw new Error('Catalogue structure or task identity is invalid');
  validateCatalogueKeywords(collection);
  const checksAudit = input.audit || input.audits || input.finalize;
  let task;
  if (checksAudit || input.checkReadingRoutes) {
    task = (await jsonArtifact(itemArtifact(input.directory, 'claimed.json'))).task;
    if (task?.executionId !== input.executionId || task?.bookId !== input.bookId) throw Error('Package verification belongs to another task');
  }
  const editing = task?.type === 'scriptahub.edit';
  const readers = input.finalize || input.checkReadingRoutes
    ? await editionReaders(root, collectionPath, collection, input.bookId, names,
      !editing, !editing, editing ? undefined : artworkRequirement(task), input.requirePdf === true)
    : null;
  const remote=`https://github.com/${match[1]}/${match[2]}.git`;
  const refs=await runGit(['ls-remote',remote]);
  const head=refs.split('\n').find(line=>line.split('\t')[1]==='refs/heads/'+input.branch)?.split('\t')[0]||null;
  if(!head&&(refs||inventory.baseCommit))throw new Error('The selected destination branch is missing');
  // Keep the validated baseline pinned. ScriptaHub checks whether the current
  // remote tip can accept the package when it actually publishes.
  const report={ok:true,executionId:input.executionId,bookId:input.bookId,fileCount:names.size,bytes,baseCommit:inventory.baseCommit,checkedAt:new Date().toISOString(),
    inventory:{path:input.inventory,sha256:hash(inventoryBytes)},readingRoutesChecked:input.checkReadingRoutes === true,pdfRequired:input.requirePdf === true};
  if (checksAudit) {
    const generated = ['scriptahub.book-proposal', 'scriptahub.fork'].includes(task.type);
    const scope = generated ? 'html_layout_integrity' : editing ? 'edition_layout_regression' : 'layout_and_structure';
    const entries = input.audits ?? (input.audit ? [{report: input.audit}] : []);
    if (input.audit && input.audits || !Array.isArray(entries) || !entries.length) throw Error('Provide the independent native audit reports');
    let directEditions = new Map();
    if (readers && task.type === 'scriptahub.manuscript') {
      const {context} = await jsonArtifact(itemArtifact(input.directory, 'handoff.json'), Infinity);
      if (context.executionId !== task.executionId || context.bookId !== task.bookId) {
        throw Error('Manuscript handoff belongs to another task');
      }
      directEditions = new Map(manuscriptEditions(context, input.directory ?? '.'));
      const directReaders = [...directEditions.keys()].map(language => readers.get(language));
      if (directReaders.some(name => !name) || new Set(directReaders).size !== directReaders.length) {
        throw Error('Publication must contain a distinct reader for every pinned manuscript edition');
      }
    }
    const plan = input.finalize && (editing || generated) ? (await jsonArtifact(input.editionPlan)).editions : null;
    if (input.finalize && (editing || generated) && (!Array.isArray(plan) || !plan.length)) throw Error('Missing edition validation plan');
    if (plan && new Set(plan.map(item => item.language)).size !== plan.length) throw Error('The edit plan repeats an affected language');
    const expected = readers && generated ? [...readers.keys()]
      : directEditions.size ? [...directEditions.keys()] : plan?.map(item => item.language);
    if (expected && plan && (plan.length !== expected.length || plan.some(item => !expected.includes(item.language)))) throw Error('Edition plan must cover every required edition');
    if (plan && editing && (task.requests ?? []).some(request => request.language && !expected.includes(request.language))) {
      throw Error('Edition plan omits a language from the approved requests');
    }
    if (expected?.length && (entries.length !== expected.length || new Set(entries.map(item => item.language)).size !== entries.length
      || entries.some(item => !expected.includes(item.language)))) throw Error('Independent audits must cover every required edition');
    const candidates = new Set(), reports = [];
    let sourceContext;
    if (input.finalize && !editing) {
      try { sourceContext = (await jsonArtifact(itemArtifact(input.directory, 'handoff.json'), Infinity)).context; }
      catch (error) { if (error.code !== 'ENOENT' || !generated) throw error; }
    }
    if (sourceContext && (sourceContext.executionId !== task.executionId || sourceContext.bookId !== task.bookId)) {
      throw Error('Source audits belong to another task');
    }
    let warningFindings = 0, existingFindings = 0, withWarnings = false;
    for (const entry of entries) {
      const reportPath = await insideRun(entry.report);
      const audit = await jsonArtifact(entry.report);
      if (!['passed','passed_with_warnings'].includes(audit.status) || !Array.isArray(audit.findings)
        || audit.findings.some(finding => finding.severity === 'error')) throw Error('Independent book audit has not passed');
      withWarnings ||= audit.status === 'passed_with_warnings';
      warningFindings += audit.findings.length;
      const language = entry.language ?? input.sourceLanguage;
      const previous = sourceContext?.sourceAudits?.[language];
      if (previous?.path === entry.report) {
        const direct = directEditions.get(language);
        const source = direct ?? sourceContext.editorialSource;
        if (source?.language !== language || hash(await fs.readFile(await insideRun(source.path))) !== source.sha256) {
          throw Error('Original audited HTML changed for ' + language);
        }
        const pdf = generated ? null : direct?.referencePdf ?? sourceContext.referencePdf;
        if (!generated && !pdf) throw Error('Missing pinned PDF for ' + language);
        if (direct && hash(await fs.readFile(await insideRun(pdf))) !== direct.referencePdfSha256) {
          throw Error('Pinned manuscript PDF changed for ' + language);
        }
        const evidence = await verifySourceAudit(input.directory, source, previous, pdf);
        const reader = readers.get(language);
        await verifyStagedSource(root, names, reader, evidence, language);
        if (generated) {
          const edition = plan.find(item => item.language === language);
          const baseline = await insideRun(edition.baselineHtml);
          const changes = await insideRun(edition.changesPath);
          if (edition.baselineHtml !== source.path || edition.baselineSha256 !== source.sha256
              || hash(await fs.readFile(baseline)) !== source.sha256
              || !isDeepStrictEqual(await jsonArtifact(edition.changesPath), [])
              || hash(await fs.readFile(changes)) !== edition.changesSha256
              || await insideRun(edition.candidateHtml) !== path.join(root, reader)) {
            throw Error('Edition plan differs from the audited source for ' + language);
          }
        }
        reports.push({language, path: entry.report, sha256: previous.sha256});
        continue;
      }
      if (generated || editing) {
        if (audit.scope !== 'edition_layout_regression' || audit.autoCorrect !== false || audit.errorFindings !== 0) throw Error('Independent HTML audit has not passed');
        if (generated && audit.existingFindings !== 0) throw Error('Generated HTML must pass all integrity checks; baseline defects cannot be accepted as warnings');
        if (!Number.isSafeInteger(audit.existingFindings) || audit.existingFindings < 0) throw Error('HTML audit finding counts are invalid');
        existingFindings += audit.existingFindings;
        const name = await auditedFile(root, names, audit.candidate);
        if (candidates.has(name) || (readers && readers.get(entry.language) !== name)) throw Error('HTML audit must identify the current reader for this language');
        candidates.add(name);
        if (plan) {
          const edition = plan.find(item => item.language === entry.language);
          const baseline = await insideRun(edition.baselineHtml), changes = await insideRun(edition.changesPath), candidate = await insideRun(edition.candidateHtml);
          if (generated && !isDeepStrictEqual(await jsonArtifact(edition.changesPath), [])) throw Error('Generated HTML must be audited with an empty change plan');
          if (audit.baseline?.file !== baseline || audit.baseline.sha256 !== edition.baselineSha256
            || hash(await fs.readFile(baseline)) !== edition.baselineSha256
            || !audit.inputs?.some(file => file.file === changes && file.sha256 === edition.changesSha256)
            || hash(await fs.readFile(changes)) !== edition.changesSha256 || candidate !== path.join(root, name)) {
            throw Error('Audit does not match the pinned baseline and change plan for ' + entry.language);
          }
        }
      } else {
        if (audit.scope !== scope || !Array.isArray(audit.documents) || !audit.documents.length || audit.corrections?.length
          || (input.finalize && audit.autoCorrect !== false)) throw Error('The manuscript requires a read-only source-based audit');
        const nativeJob = await jsonArtifact(path.join(path.dirname(entry.report), 'job.json'));
        if (!isDeepStrictEqual(nativeJob.result, audit)) throw Error('Manuscript audit differs from its native job');
        const audited = [];
        for (const document of audit.documents) {
          const recorded = nativeJob.inputs?.find(file => file.file === document.file);
          audited.push(await auditedFile(root, names, recorded));
        }
        if (readers) {
          const edition = directEditions.get(entry.language);
          const language = edition?.language ?? input.sourceLanguage;
          if (!readers.get(language) || !audited.includes(readers.get(language))) throw Error('Manuscript audit does not cover the published source edition: ' + language);
          const source = await insideRun(edition?.referencePdf ?? input.referencePdf);
          const sourceSha256 = hash(await fs.readFile(source));
          if (edition && (sourceSha256 !== edition.referencePdfSha256
            || hash(await fs.readFile(await insideRun(edition.path))) !== edition.sha256)) {
            throw Error('Pinned manuscript source changed for ' + language);
          }
          if (!nativeJob.inputs?.some(file => file.file === source && file.sha256 === sourceSha256)) throw Error('Manuscript audit does not match the verified PDF reference');
        }
      }
      reports.push({...(entry.language && {language: entry.language}), path: entry.report, sha256: hash(await fs.readFile(reportPath))});
    }
    report.audit = {scope, ...(generated && {nativeScope:'edition_layout_regression'}), autoCorrect:false,
      status: withWarnings ? 'passed_with_warnings' : 'passed', errorFindings:0, warningFindings,
      ...((editing || generated) && {existingFindings})};
    if (input.finalize) {
      if (typeof task.runId !== 'string' || !task.runId) throw Error('Missing claimed run identity');
      const validationRoot = path.posix.join(input.directory || '.', 'validation');
      const approved = await atomicJson(validationRoot + '/verified-inventory.json', {...inventory, publicationPermitted: true});
      const validation = await atomicJson(validationRoot + '/final-report.json', {
        executionId: input.executionId, runId: task.runId, bookId: input.bookId, publicationPermitted: true,
        audit: report.audit, reports, inventorySha256: approved.sha256,
        destination: {catalogue: input.catalogue, branch: input.branch, baseCommit: inventory.baseCommit},
        ...(input.requirePdf === true && {requirePdf:true}),
        ...(input.translationOutcome && {translationOutcome: input.translationOutcome})
      });
      report.approval = {inventory: approved.path, validation: validation.path};
    }
  }
  await atomicJson(itemArtifact(input.directory,'package-check.json'),report);
  return report;
  });
}

async function auditedFile(root, names, entry) {
  const name = typeof entry?.file === 'string' && path.relative(root, entry.file).split(path.sep).join('/');
  if (!names.has(name)) throw Error('Audit documents are outside the verified package');
  if (hash(await fs.readFile(path.join(root, name))) !== entry.sha256) throw Error('HTML changed after its independent audit');
  return name;
}

export async function editionReaders(root, collectionPath, collection, bookId, names, requireAll, checkReadingRoutes = false, artwork, requirePdf = false) {
  const book = collection.books.find(entry => entry.id === bookId);
  const prefix = path.posix.dirname(collectionPath);
  const resource = value => typeof value === 'string' ? path.posix.join(prefix, value) : null;
  let metadata = book, resources, checksums;
  if (collection.schemaVersion === 2) {
    const filename = resource(book.path);
    if (!names.has(filename)) throw Error('Missing current book metadata in the verified package');
    const document = JSON.parse(await fs.readFile(path.join(root, filename), 'utf8'));
    metadata = document.metadata;
    resources = document.resources;
    checksums = document.resourceChecksums;
  }
  const resolve = value => resource(resources ? resources[value] : value);
  const readers = new Map();
  const editions = Object.entries(metadata?.editions || {});
  const landingRoutes = new Set(editions.map(([, edition]) => edition?.book));
  for (const [language, edition] of editions) {
    if (!requireAll && !edition?.fullContent) continue;
    const full = resolve(edition?.fullContent);
    if (requirePdf) {
      const filename = resources ? resources[edition.pdf] : edition.pdf;
      const pdf = resolve(edition.pdf);
      if (!filename?.endsWith('/' + language + '/book.pdf') || !names.has(pdf)) throw Error('Missing download PDF for ' + language);
      const bytes = await fs.readFile(path.join(root,pdf));
      if (bytes.subarray(0,5).toString() !== '%PDF-' || (resources && checksums?.[filename] !== hash(bytes))) {
        throw Error('Invalid download PDF for ' + language);
      }
    }
    if (checkReadingRoutes) {
      const short = resolve(edition?.shortContent);
      const landing = resource(edition?.book);
      if (!landing || landingRoutes.has(edition.fullContent) || landingRoutes.has(edition.shortContent) || full === short
        || full === landing || short === landing || (resources && [full, short].includes(resolve(edition.book)))) {
        throw Error('View Book, Read Online and Read in 10 Min need distinct routes for ' + language);
      }
      if ((!resources && !names.has(landing)) || !names.has(short)) throw Error('Missing landing page or comprehensive summary for ' + language);
      const summary = await fs.readFile(path.join(root, short), 'utf8');
      if (!/<meta\b(?=[^>]*\bname\s*=\s*["']summary-generator["'])(?=[^>]*\bcontent\s*=\s*["']comprehensivesummary-skill["'])[^>]*>/i.test(summary)) {
        throw Error('Read in 10 Min must open the comprehensive summary for ' + language);
      }
      if (!Array.isArray(metadata.aboutBook?.[language]) || !metadata.aboutBook[language].some(text => typeof text === 'string' && text.trim())) {
        throw Error('Missing About Book presentation for ' + language);
      }
    }
    if (artwork) {
      for (const [role, field] of Object.entries(artworkFields)) {
        const reference = metadata[field]?.[language];
        if (reference === undefined && !artwork.required) continue;
        const file = resolve(reference);
        const filename = resources ? resources[reference] : reference;
        if (!artworkPath(reference) || !artworkPath(filename) || !names.has(file)
            || (!resources && !filename.startsWith(book.directory + '/'))) {
          throw Error('Missing or invalid ' + role + ' mapping for ' + language);
        }
        const image = await fs.readFile(path.join(root, file));
        const digest = hash(image);
        if (!image.length || (resources && checksums?.[filename] !== digest)
            || (artwork.sourceHash && artwork.sourceHash !== digest)) {
          throw Error('Invalid ' + role + ' bytes or checksum for ' + language);
        }
      }
    }
    readers.set(language, full);
  }
  if (!readers.size || [...readers.values()].some(name => !names.has(name))) throw Error('Published editions must identify the verified full HTML readers');
  return readers;
}

export async function requirePreflight(now = Date.now()) {
  let report;
  try { report = await jsonArtifact('run-state/preflight.json'); }
  catch { throw new Error('Run preflight successfully before claiming a manuscript'); }
  const age = now - Date.parse(report.checkedAt);
  if (report.ok !== true || !Number.isFinite(age) || age < 0 || age > 15 * 60 * 1000
      || typeof report.runtimeId !== 'string' || typeof report.platform !== 'string' || !report.sourceDigests || !Array.isArray(report.checks) || report.checks.length < 1 || report.checks.some(check => check.status !== 'passed')) {
    throw new Error('Run preflight successfully before claiming a manuscript');
  }
}
