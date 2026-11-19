import fs from 'node:fs/promises';
import path from 'node:path';
import {isDeepStrictEqual} from 'node:util';
import {withExecutionLock} from './anchored-files.mjs';
import {guardRemoteBackups} from './remote-skill.mjs';
import {atomicJson, insideRun} from './workflow-checks.mjs';
import {hash, schemaErrors} from '../shared/batch-io.mjs';
import {projectAnalysis, sharedAnalysisSchema} from '../shared/editorial-analysis.mjs';

const roles = ['marketing-summary', 'short-description'];
const read = async file => fs.readFile(await insideRun(file));
const json = async file => JSON.parse(await read(file));
const batchName = /^batch-[0-9]{4}\.json$/;
const optional = error => {
  if (error.code !== 'ENOENT') throw error;
  return null;
};

export async function sharedEditorial({executionId, directory, action, batch, batchSha256, analysis, role, replaceSha256, reason}) {
  if (!/^tasks\/[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(directory ?? '') || !['status', 'verify', 'contract', 'submit', 'project'].includes(action)) {
    throw Error('Provide a task directory and a shared editorial action');
  }
  return withExecutionLock(process.cwd(), executionId, async root => {
    await guardRemoteBackups(root, executionId);
    const {context} = await json(directory + '/run-state/handoff.json');
    if (context.executionId !== executionId || !context.editorialSource?.path) throw Error('Missing matching pinned editorial source');
    const source = path.relative(process.cwd(), path.resolve(context.editorialSource.path));
    const sourceSha256 = context.editorialSource.sha256;
    if (!source.startsWith(directory + '/') || hash(await read(source)) !== sourceSha256) throw Error('Pinned editorial source changed');

    const jobs = roles.map(name => directory + '/editorial-jobs/shared/' + name);
    const metadata = await Promise.all(jobs.map(job => json(job + '/job.json')));
    const names = metadata[0].batchNames;
    if (!Array.isArray(names) || !names.length || !names.every(name => batchName.test(name)) || new Set(names).size !== names.length
        || metadata.some(job => path.resolve(job.source) !== path.resolve(source) || job.sourceSha256 !== sourceSha256
          || job.language !== metadata[0].language || !isDeepStrictEqual(job.batchNames, names))) {
      throw Error('Editorial jobs must share the pinned source and batch layout');
    }

    const file = directory + '/editorial/shared-analysis.json';
    const bytes = await read(file).catch(optional);
    const saved = bytes ? JSON.parse(bytes) : {version: 1, executionId, sourceSha256, batches: {}};
    if (saved.version !== 1 || saved.executionId !== executionId || saved.sourceSha256 !== sourceSha256
        || !saved.batches || typeof saved.batches !== 'object' || Array.isArray(saved.batches)
        || Object.keys(saved.batches).some(name => !names.includes(name))) {
      throw Error('Shared analysis belongs to another source or execution');
    }
    const evidence = bytes ? {path: file, sha256: hash(bytes)} : null;
    const pinnedEvidence = context.sharedEditorialAnalysis;
    const needsHandoff = Boolean(pinnedEvidence && !isDeepStrictEqual(evidence, pinnedEvidence));
    if (needsHandoff && (pinnedEvidence.path !== file || pinnedEvidence.sha256 !== saved.correction?.previousEvidenceSha256)) {
      throw Error('Shared analysis differs from the evidence in the handoff');
    }

    async function loadBatch(name) {
      const paths = jobs.map(job => job + '/batches/' + name);
      const files = await Promise.all(paths.map(read));
      const [marketing, short] = files.map(value => JSON.parse(value));
      if (marketing.batch !== name || marketing.batch !== short.batch || marketing.chapterId !== short.chapterId
          || marketing.segment !== short.segment || marketing.language !== short.language || !isDeepStrictEqual(marketing.units, short.units)) {
        throw Error('Editorial jobs disagree on source units for ' + name);
      }
      const digests = files.map(hash);
      const schema = sharedAnalysisSchema(marketing);
      const existing = saved.batches[name];
      if (Object.hasOwn(saved.batches, name) && (!existing || !isDeepStrictEqual(existing.digests, digests) || analysisErrors(existing.analysis, schema).length)) {
        throw Error('Saved shared analysis no longer matches ' + name);
      }
      return {path: paths[0], digests, schema, existing};
    }

    if (action === 'status' || action === 'verify') {
      const missing = [];
      const analyses = [];
      for (const name of names) {
        const {existing} = await loadBatch(name);
        if (existing) analyses.push(existing.analysis);
        else missing.push(name);
      }
      if (missing.length) {
        if (action === 'verify') throw Error('Complete the missing shared analyses before routing');
        return {status: 'analysis_required', missing, evidence};
      }
      const projections = {};
      for (const [index, name] of roles.entries()) {
        const candidates = analyses.map(analysis => projectAnalysis(analysis, name));
        const pendingBatches = [];
        for (const candidate of candidates) {
          const current = await nativeBatch(jobs[index], candidate);
          if (!current?.matches) pendingBatches.push(candidate.batch);
        }
        const sha256 = hash(JSON.stringify(candidates));
        projections[name] = {sha256, pendingBatches, needsValidation: context.editorialResults?.[name]?.projectionSha256 !== sha256};
      }
      if (action === 'verify') {
        if (!pinnedEvidence || needsHandoff) throw Error('Save the current shared analysis evidence before routing');
        const affected = roles.filter(name => projections[name].pendingBatches.length || projections[name].needsValidation);
        if (affected.length) throw Error('Revalidate the affected editorial outputs before routing: ' + affected.join(', '));
        return {status: 'passed', evidence, projections};
      }
      return {status: 'complete', missing, evidence, needsHandoff, projections};
    }
    if (!names.includes(batch)) throw Error('Batch does not belong to this shared analysis');
    const current = await loadBatch(batch);
    const digest = current.digests[0];
    const acceptedSha256 = current.existing ? hash(JSON.stringify(current.existing.analysis)) : null;
    if (action === 'contract') return {
      batch, batchPath: current.path, batchSha256: digest, schema: current.schema,
      accepted: Boolean(current.existing),
      ...(current.existing && {acceptedSha256, analysis: current.existing.analysis})
    };
    if (action === 'project') {
      const index = roles.indexOf(role);
      if (index === -1 || !current.existing) throw Error('Project an accepted batch for marketing-summary or short-description');
      if (!isDeepStrictEqual(evidence, context.sharedEditorialAnalysis) || Object.keys(saved.batches).length !== names.length) {
        throw Error('The complete shared analysis must match the evidence in the handoff');
      }
      const candidate = projectAnalysis(current.existing.analysis, role);
      const native = await nativeBatch(jobs[index], candidate);
      return {batch, batchSha256: current.digests[index], candidate, ...(native && !native.matches && {replaceSha256: native.sha256})};
    }
    if (batchSha256 !== digest) throw Error('Shared batch digest changed; request the contract again');
    const errors = analysisErrors(analysis, current.schema);
    if (errors.length) throw Error(errors.join('\n'));
    if (current.existing && isDeepStrictEqual(current.existing.analysis, analysis)) return {status: 'accepted', evidence};
    if (needsHandoff) throw Error('Save the corrected shared analysis evidence in the handoff first');
    if (current.existing || replaceSha256 !== undefined) {
      if (!current.existing || replaceSha256 !== acceptedSha256) throw Error('Provide the exact accepted analysis digest to correct ' + batch);
      if (typeof reason !== 'string' || !reason.trim() || reason.length > 1000) throw Error('Provide the concrete editorial finding for this correction');
      saved.correction = {batch, previousEvidenceSha256: evidence.sha256, previousAnalysisSha256: acceptedSha256, reason};
    }
    saved.batches[batch] = {digests: current.digests, analysis};
    return {status: 'accepted', evidence: await atomicJson(file, saved)};
  });
}

async function nativeBatch(job, candidate) {
  const bytes = await read(job + '/analyses/' + candidate.batch).catch(optional);
  if (!bytes) return null;
  let matches = false;
  try { matches = isDeepStrictEqual(JSON.parse(bytes), candidate); } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
  }
  return {sha256: hash(bytes), matches};
}

function analysisErrors(value, schema) {
  const errors = schemaErrors(value, schema);
  if (errors.length) return errors;
  for (const item of value.protectedRevelations) {
    if (item.guardTerms.some(term => (term.match(/(?<![\p{L}\p{N}_])[\p{L}\p{N}]+(?:[’'\-][\p{L}\p{N}]+)*(?![\p{L}\p{N}_])/gu) ?? []).length < 3)) {
      errors.push('Protected revelations need guard phrases of at least three words');
    }
  }
  for (const name of ['safeHooks', 'themes', 'protectedRevelations']) {
    if (value[name].length > 999) errors.push(name + ' exceeds the native ID range');
  }
  return errors;
}
