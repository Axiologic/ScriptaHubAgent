import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { completeCreateBookPhase } from '../scripts/create-book-completion.mjs';
import { atomicJson, writeHandoff } from '../scripts/workflow-checks.mjs';

test('an unfinished package review records progress without issuing a completion receipt', async t => {
  const previous = process.cwd();
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'book-completion-'));
  process.chdir(root);
  t.after(async () => {
    process.chdir(previous);
    await fs.rm(root, {recursive:true, force:true});
  });
  const directory = 'tasks/one', step = 'publish-result';
  const completionId = 'a02eb494-65fc-490d-be4a-f4795971938f';
  const task = {taskId:'one', executionId:'execution-one', runId:'run-one', bookId:'book-one'};
  await atomicJson(directory + '/run-state/claimed.json', {task});
  await writeHandoff({directory, step:'validate-final', context:{...task, processingMode:'process'}});
  const call = (tool, input) => {
    if (tool === 'scriptahub_task_status') return {...task, state:'running'};
    assert.equal(tool, 'scriptahub_task_moderate');
    assert.deepEqual(input, {executionId:task.executionId, stage:'package', action:'status'});
    return {status:'pending', completedUnits:66};
  };
  await assert.rejects(completeCreateBookPhase({directory, step, completionId}, call), /still unresolved/);
  const base = '.workflow-completion/' + completionId;
  assert.deepEqual(JSON.parse(await fs.readFile(base + '.progress.json')), {step, completionId, completedUnits:66});
  await assert.rejects(fs.stat(base + '.json'), {code:'ENOENT'});
});

test('final edition validation needs a moderation verdict for its exact inventory', async t => {
  const previous = process.cwd();
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'edition-completion-'));
  process.chdir(root);
  t.after(async () => {
    process.chdir(previous);
    await fs.rm(root, {recursive:true, force:true});
  });
  const directory = 'tasks/one', step = 'validate-edit';
  const completionId = 'a02eb494-65fc-490d-be4a-f4795971938f';
  const task = {taskId:'one', executionId:'execution-one', runId:'run-one', bookId:'book-one'};
  await atomicJson(directory + '/run-state/claimed.json', {task});
  await writeHandoff({directory, step, context:{...task, processingMode:'process'}});
  const inventory = await atomicJson(directory + '/validation/verified-inventory.json', {});
  await atomicJson(directory + '/validation/final-report.json', {
    ...task, publicationPermitted:true, audit:{errorFindings:0}, inventorySha256:inventory.sha256
  });
  let status = {status:'pending',completedUnits:3};
  const check = () => completeCreateBookPhase({directory, step, completionId},
    tool => tool === 'scriptahub_task_moderate' ? status : {...task,state:'running'});
  await assert.rejects(check, /matching moderation verdict/);
  status = {status:'passed',inventorySha256:'a'.repeat(64)};
  await assert.rejects(check, /matching moderation verdict/);
  status.inventorySha256 = inventory.sha256;
  assert.equal((await check()).path,'.workflow-completion/'+completionId+'.json');
});

test('multilingual summary requires the accepted output and passing receipt for every source', async t => {
  const previous = process.cwd();
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'book-completion-'));
  process.chdir(root);
  t.after(async () => {
    process.chdir(previous);
    await fs.rm(root, {recursive:true, force:true});
  });
  const step = 'comprehensive-summary', directory = 'tasks/one';
  const completionId = 'a02eb494-65fc-490d-be4a-f4795971938f';
  const task = {taskId:'one', executionId:'execution-one', runId:'run-one', bookId:'book-one'};
  const call = async (tool, input) => tool === 'scriptahub_task_moderate' ? {status:input.file ? 'passed' : 'idle'} : {...task, state:'running'};
  const write = async (file, value) => {
    const name = directory + '/' + file;
    await fs.mkdir(path.dirname(name), {recursive:true});
    await fs.writeFile(name, value);
    return {path:name, sha256:createHash('sha256').update(value).digest('hex')};
  };
  await atomicJson(directory + '/run-state/claimed.json', {task});
  const sources = Object.fromEntries(await Promise.all(['en','ro'].map(async language => [
    language, {...await write('sources/' + language + '.html', language), language,
      referencePdf:directory + '/sources/' + language + '.pdf', referencePdfSha256:'a'.repeat(64)},
  ])));
  const ctx = {...task, processingMode:'process', editorialSource:sources.en, manuscriptEditions:sources, manuscriptEditorial:{}};
  const save = () => writeHandoff({directory, step, context:ctx});
  const check = () => completeCreateBookPhase({directory, step, completionId}, call);
  const addResult = async language => {
    const output = await write('editorial/' + language + '.html', 'summary ' + language);
    const receipt = await atomicJson(directory + '/editorial/' + language + '.json', {status:'passed'});
    ctx.manuscriptEditorial[language] = {editorialResults:{[step]:{
      skill:step, sourcePath:sources[language].path, sourceSha256:sources[language].sha256,
      output:output.path, outputSha256:output.sha256, receipt:receipt.path, receiptSha256:receipt.sha256,
    }}};
  };
  await addResult('en');
  await save();
  await assert.rejects(check, /Missing accepted comprehensive-summary for ro/);
  await assert.rejects(fs.access('.workflow-completion/' + completionId + '.json'), {code:'ENOENT'});
  await addResult('ro');
  await save();
  await check();
  await fs.writeFile(directory + '/editorial/ro.html', 'changed');
  await assert.rejects(check, /changed ro comprehensive-summary output/);

  task.type = 'scriptahub.manuscript';
  await atomicJson(directory + '/run-state/claimed.json', {task});
  const bookDirectory = 'package/books/book-one';
  const routes = {executionId: task.executionId, collectionPath: 'collection.json', editions: {}};
  for (const [language, source] of Object.entries(sources)) {
    const pdf = '%PDF-' + language;
    source.referencePdfSha256 = createHash('sha256').update(pdf).digest('hex');
    await write(bookDirectory + '/' + language + '/book.pdf', pdf);
    await write(bookDirectory + '/' + language + '/full.html', language);
    await write(bookDirectory + '/' + language + '/summary.html', 'summary ' + language);
    await write(bookDirectory + '/' + language + '/cover.svg', '<svg/>');
    routes.editions[language] = {
      fullContent: language + '/full.html', comprehensiveSummary: language + '/summary.html',
      shortDescription: language, aboutBook: [language], cover: language + '/cover.svg',
    };
  }
  const handoffPath = directory + '/run-state/handoff.json';
  // This is a separate fixture handoff with its own pinned PDF digests.
  await atomicJson(handoffPath, {step: 'process-content', context: ctx});
  await atomicJson(directory + '/package/collection.json', {
    schemaVersion: 1, books: [{id: task.bookId, directory: 'books/book-one'}],
  });
  const review = () => completeCreateBookPhase({
    directory, step: 'review-correct', completionId: '61c48feb-c363-4eb5-b280-e9f96aeeb6a7',
  }, call);
  await assert.rejects(review, /Missing staged reading inputs/);
  await atomicJson(directory + '/review/reading-routes-input.json', routes);
  await write(bookDirectory + '/ro/book.pdf', '%PDF-changed');
  await assert.rejects(review, /changed ro staged PDF/);
  assert.equal(JSON.parse(await fs.readFile(handoffPath, 'utf8')).step, 'process-content');
  await write(bookDirectory + '/ro/book.pdf', '%PDF-ro');
  await review();
  const saved = JSON.parse(await fs.readFile(handoffPath, 'utf8'));
  assert.equal(saved.step, 'review-correct');
  assert.equal(saved.context.readingRoutesInput, directory + '/review/reading-routes-input.json');
  await review();

  task.type = 'scriptahub.book-proposal';
  const draft = {...await write('sources/generated.html', '<main>The book</main>'), language:'en'};
  const baseline = await write('sources/layout-baseline.html', '<main>The book</main>');
  await atomicJson(directory + '/run-state/claimed.json', {task});
  const draftContext = {...task, processingMode:'process', editorialSource:draft};
  await atomicJson(handoffPath, {step:'prepare-manuscript', context:draftContext});
  const completeDraft = () => completeCreateBookPhase({
    directory, step: 'prepare-manuscript', completionId: 'ee786c9e-8bc6-40a1-b4a4-3f5a38ea58d0',
  }, call);
  await assert.rejects(completeDraft, /Missing source audit for en/);
  const candidate = {file: await fs.realpath(draft.path), sha256:draft.sha256};
  const report = await atomicJson(directory + '/validation/source-layout/en/report.json', {
    scope:'edition_layout_regression', status:'passed', autoCorrect:false, approvedChanges:0,
    findings:[], errorFindings:0, existingFindings:0,
    baseline:{file:await fs.realpath(baseline.path), sha256:baseline.sha256}, candidate, inputs:[candidate],
  });
  draftContext.sourceAudits = {en:report};
  await atomicJson(handoffPath, {step:'prepare-manuscript', context:draftContext});
  await completeDraft();
  await write('sources/generated.html', '<main>Changed after audit</main>');
  await assert.rejects(completeDraft, /changed en source/);
});
