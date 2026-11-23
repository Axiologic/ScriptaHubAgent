import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {hash} from '../shared/batch-io.mjs';

const skills = new URL('../../', import.meta.url);
const runTool = 'scriptahub-tasks/scripts/run.mjs';

for (const multilingual of [false, true]) test(multilingual
  ? 'native projections use separate shared editorial evidence for each manuscript language'
  : 'both native jobs admit projections from a single resumable analysis file', {skip: process.platform !== 'linux'}, async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'scripta-editorial-'));
  t.after(() => fs.rm(root, {recursive: true, force: true}));
  const directory = 'tasks/book-one';
  const source = directory + '/sources/book.html';
  const html = '<html lang="en"><head><title>A coastal town</title></head><body><header><h1>A coastal town</h1></header><main data-reader-content><h2>Setting out</h2><p>A sailor searches for a lost ship through storms and difficult terrain.</p><h2>The discovery</h2><p>The captain is his sister and her identity changes the voyage.</p></main><footer><h1>Other titles</h1><p>Other titles from our publisher are available for teachers readers libraries and clubs.</p></footer></body></html>';
  await fs.mkdir(path.join(root, path.dirname(source)), {recursive: true});
  await fs.writeFile(path.join(root, source), html);
  const invoke = (script, args, input, error) => {
    const result = spawnSync(process.execPath, [fileURLToPath(new URL(script, skills)), ...args], {
      cwd: root, encoding: 'utf8', input: input === undefined ? undefined : JSON.stringify(input)
    });
    if (error) {
      assert.equal(result.status, 1);
      assert.match(result.stderr.trim(), error);
      return;
    }
    assert.equal(result.status, 0, result.stderr || result.stdout);
    return JSON.parse(result.stdout);
  };
  const context = {executionId: 'execution-one', runId: 'run-one', taskId: 'book-one', bookId: 'book-one', editorialSource: {path: source, sha256: hash(html), language: 'en'}};
  const editorial = {};
  if (multilingual) {
    const romanian = '<html lang="ro"><body><main data-reader-content><h2>Plecarea</h2><p>O corabie părăsește portul înainte de furtună și urmărește luminile de pe coastă pentru a regăsi drumul spre far.</p></main></body></html>';
    const romanianPath = directory + '/sources/carte.html';
    await fs.writeFile(path.join(root, romanianPath), romanian);
    context.manuscriptEditions = {
      en: {...context.editorialSource, referencePdf:directory+'/sources/book.pdf', referencePdfSha256:hash('English PDF')},
      ro: {path:romanianPath, sha256:hash(romanian), language:'ro', referencePdf:directory+'/sources/carte.pdf', referencePdfSha256:hash('Romanian PDF')}
    };
  }
  const handoff = (step, extra) => {
    if (!multilingual) return invoke(runTool, ['handoff'], {directory, step, context: {...context, ...extra}});
    if (extra?.sharedEditorialAnalysis) editorial.sharedEditorialAnalysis = extra.sharedEditorialAnalysis;
    if (extra?.editorialResults) editorial.editorialResults = {...editorial.editorialResults, ...extra.editorialResults};
    return invoke(runTool, ['handoff'], {directory, step, context: {...context, manuscriptEditorial:{en:editorial}}});
  };
  handoff('prepare-manuscript');

  const jobs = {
    'marketing-summary': ['marketing-summary/scripts/marketingsummary.mjs', ['--shared-editorial']],
    'short-description': ['short-description/scripts/shortdescription.mjs', ['--shared-editorial']]
  };
  const job = (role, language = 'en') => directory + '/editorial-jobs' + (multilingual ? '/' + language : '') + '/shared/' + role;
  for (const language of multilingual ? ['en','ro'] : ['en']) {
    const editionSource = multilingual ? context.manuscriptEditions[language].path : source;
    for (const [role, [script, options]] of Object.entries(jobs)) {
      const output = directory + '/editorial/' + (multilingual ? language + '/' : '') + role + '.html';
      invoke(script, ['prepare', editionSource, '--job-dir', job(role, language), '--output', output, ...options]);
    }
  }
  const shared = (action, extra, error) => invoke(runTool, ['shared-editorial'], {
    directory, executionId: context.executionId, action, ...(multilingual && {language:'en'}), ...extra
  }, error);
  const initial = shared('status');
  assert.equal(initial.missing.length, 2);
  for (const [index, batch] of initial.missing.entries()) {
    const contract = shared('contract', {batch});
    const {chapterId, segment, units} = JSON.parse(await fs.readFile(path.join(root, contract.batchPath)));
    assert.doesNotMatch(JSON.stringify(units), /Other titles/);
    const cite = [units.at(-1).id];
    const analysis = {
      batch, chapterId, segment, modeSignals: ['fiction'],
      safeHooks: [{type: 'premise', statement: 'A sailor undertakes a search.', sourceUnitIds: cite}],
      themes: [{type: 'setting', statement: 'A voyage tests the crew.', sourceUnitIds: cite}],
      protectedRevelations: index ? [{type: 'identity', statement: 'The captain is his sister.', sourceUnitIds: cite, guardTerms: ['captain is his sister']}] : [],
      audit: {chapterCovered: true, revelationsSeparated: true, factsPreserved: true, notes: ''}
    };
    const submission = {batch, batchSha256: contract.batchSha256, analysis};
    shared('submit', {...submission, analysis: {...analysis, themes: [{...analysis.themes[0], sourceUnitIds: ['u999999']}]}}, /expected one of/);
    const accepted = shared('submit', submission);
    assert.equal(accepted.status, 'accepted');
    assert.deepEqual(shared('submit', submission), accepted);
    shared('submit', {...submission, analysis: {...analysis, modeSignals: ['nonfiction']}}, /exact accepted analysis digest/);
    assert.equal(shared('contract', {batch}).accepted, true);
    assert.deepEqual(shared('status').missing, initial.missing.slice(index + 1));
  }
  const {status, evidence} = shared('status');
  assert.equal(status, 'complete');
  if (multilingual) {
    assert.match(evidence.path, /editorial\/en\/shared-analysis\.json$/);
    assert.equal(shared('status', {language:'ro'}).evidence, null);
    const [romanianBatch] = shared('status', {language:'ro'}).missing;
    const romanian = shared('contract', {language:'ro', batch:romanianBatch});
    assert.equal(romanian.accepted, false);
    assert.match(romanian.batchPath, /editorial-jobs\/ro\/shared\//);
  }
  assert.equal(hash(await fs.readFile(path.join(root, evidence.path))), evidence.sha256);
  shared('project', {batch: initial.missing[0], role: 'marketing-summary'}, /evidence in the handoff/);
  handoff('shared-editorial-analysis', {sharedEditorialAnalysis: evidence});
  for (const [role, [script]] of Object.entries(jobs)) {
    for (const batch of initial.missing) {
      const {batchSha256, candidate} = shared('project', {batch, role});
      assert.equal(invoke(script, ['submit-batch', job(role), '--batch', batch, '--batch-sha256', batchSha256], candidate).status, 'accepted');
    }
  }
  const marketing = shared('project', {batch: initial.missing[1], role: 'marketing-summary'}).candidate;
  const description = shared('project', {batch: initial.missing[1], role: 'short-description'}).candidate;
  assert.deepEqual(marketing.protectedRevelations, description.protectedRevelations);

  const admitted = shared('status').projections;
  for (const [role, {sha256, pendingBatches}] of Object.entries(admitted)) {
    assert.deepEqual(pendingBatches, []);
    handoff(role, {editorialResults: {[role]: {projectionSha256: sha256}}});
  }
  assert.equal(shared('verify').status, 'passed');

  const batch = initial.missing[0], role = 'short-description';
  const {analysis, batchSha256, acceptedSha256} = shared('contract', {batch});
  analysis.themes[0].statement = 'Weather and terrain shape the search.';
  const correction = {batch, batchSha256, analysis, reason: 'The previous theme introduced an unsupported crew.'};
  shared('submit', {...correction, replaceSha256: '0'.repeat(64)}, /exact accepted analysis digest/);
  shared('submit', {...correction, replaceSha256: acceptedSha256, reason: ''}, /concrete editorial finding/);
  const changed = shared('submit', {...correction, replaceSha256: acceptedSha256});
  assert.deepEqual(shared('submit', {...correction, replaceSha256: acceptedSha256}), changed);
  const waiting = shared('status');
  assert.equal(waiting.needsHandoff, true);
  assert.deepEqual(waiting.evidence, changed.evidence);
  shared('project', {batch, role}, /evidence in the handoff/);
  handoff(role, {sharedEditorialAnalysis: changed.evidence});
  const after = shared('status').projections;
  assert.deepEqual(after[role].pendingBatches, [batch]);
  assert.deepEqual(after['marketing-summary'], {...admitted['marketing-summary'], needsValidation: false});
  shared('verify', {}, /Revalidate the affected editorial outputs before routing: short-description$/);
  const projected = shared('project', {batch, role});
  assert.equal(projected.candidate.themes[0].statement, analysis.themes[0].statement);
  const [shortScript] = jobs[role];
  assert.equal(invoke(shortScript, ['submit-batch', job(role), '--batch', batch, '--batch-sha256', projected.batchSha256, '--replace-sha256', projected.replaceSha256], projected.candidate).status, 'accepted');
  shared('verify', {}, /Revalidate the affected editorial outputs before routing: short-description$/);
  handoff(role, {editorialResults: {[role]: {projectionSha256: after[role].sha256}}});
  assert.equal(shared('verify').status, 'passed');

  const current = shared('contract', {batch});
  const newRevelation = {type: 'outcome', statement: 'The ship is lost.', guardTerms: ['the ship is lost'], sourceUnitIds: analysis.themes[0].sourceUnitIds};
  const revised = shared('submit', {batch, batchSha256, replaceSha256: current.acceptedSha256, reason: 'The outcome was missing from the protection list.',
    analysis: {...current.analysis, protectedRevelations: [newRevelation]}});
  handoff(role, {sharedEditorialAnalysis: revised.evidence});
  const both = shared('status').projections;
  assert.deepEqual(both['marketing-summary'].pendingBatches, [batch]);
  assert.deepEqual(both[role].pendingBatches, [batch]);

  const sharedFile = path.join(root, evidence.path);
  const sharedBytes = await fs.readFile(sharedFile);
  await fs.appendFile(sharedFile, '\n');
  shared('project', {batch: initial.missing[0], role: 'short-description'}, /evidence in the handoff/);
  await fs.writeFile(sharedFile, sharedBytes);
  await fs.appendFile(path.join(root, source), '\n');
  shared('status', {}, /Pinned editorial source changed/);
});
