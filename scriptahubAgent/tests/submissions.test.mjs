import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createSiteServer } from '../server.mjs';
import { DashboardStore } from '../dashboard-store.mjs';
import { TaskExecution } from '../task-execution.mjs';

process.env.SCRIPTA_RECORD_KEY = 'test-record-key-0123456789abcdef0123456789';

test('authenticated PDF intake persists one pending task', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'scripta-upload-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const site = path.join(root, 'site');
  await fs.mkdir(site);
  await fs.writeFile(path.join(site, 'index.html'), 'ok');
  await fs.mkdir(path.join(site, 'create'));
  await fs.writeFile(path.join(site, 'create', 'index.html'), 'create form');
  const server = createSiteServer(site, { dataDir: root, verifyUser: async req => req.headers['x-test-user'] ? { id: req.headers['x-test-user'], email: 'alice@example.test', displayName: 'Alice' } : null }).listen(0, '127.0.0.1');
  t.after(() => server.close());
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const id = '9fdfd120-b243-4559-bc4d-41891967f0f6';
  const makeBody = () => {
    const form = new FormData();
    form.set('metadata', JSON.stringify({ submissionId: id, kind: 'manuscript', agreementVersion: '2026-09-10', agreementAccepted: true, values: { titles: 'Test book' }, language: 'en' }));
    form.append('documents', new Blob(['%PDF-1.7\npage'], { type: 'application/pdf' }), 'book.pdf');
    return form;
  };
  const endpoint = `${base}/api/submissions`;
  assert.equal((await fetch(`${base}/create/index.html`)).status, 401);
  assert.equal((await fetch(`${base}/create/index.html`, { headers: { 'x-test-user': 'user:alice' } })).status, 200);
  assert.equal((await fetch(endpoint, { method: 'POST', body: makeBody() })).status, 401);
  const response = await fetch(endpoint, { method: 'POST', body: makeBody(), headers: { 'x-test-user': 'user:alice' } });
  assert.equal(response.status, 202);
  const received = await response.json();
  assert.equal(received.state, 'accepted');
  assert.deepEqual(received.task, { schemaVersion: 1, id, type: 'scriptahub.manuscript', state: 'queued' });
  assert.match(received.bookId, /^bk-[a-f0-9]+$/);
  assert.equal((await fetch(endpoint, { method: 'POST', body: makeBody(), headers: { 'x-test-user': 'user:alice' } })).status, 202);
  assert.equal((await fetch(endpoint, { method: 'POST', body: makeBody(), headers: { 'x-test-user': 'user:bob' } })).status, 409);
  const record = JSON.parse(await fs.readFile(path.join(root, 'inbox', id, 'record.json'), 'utf8'));
  assert.equal(record.files.length, 1);
  assert.equal(record.task, null, 'inbox is immutable provenance, not an execution queue');
  assert.deepEqual(await fs.readdir(path.join(root, 'inbox')), [id]);
  assert.deepEqual(record.contact, { email: 'alice@example.test', displayName: 'Alice' });
  assert.match(record.files[0].sha256, /^[0-9a-f]{64}$/);
  const status = await fetch(`${base}/api/submissions/${id}`, { headers: { 'x-test-user': 'user:alice' } });
  assert.equal(status.status, 200);
  assert.equal((await status.json()).task.id, id);
  assert.equal((await fetch(`${base}/api/submissions/${id}`, { headers: { 'x-test-user': 'user:bob' } })).status, 403);
  const session = await fetch(`${base}/api/session`, { headers: { 'x-test-user': 'user:alice' } });
  assert.equal(session.status, 200);
  assert.equal((await session.json()).user.email, 'alice@example.test');
  const forged = makeBody();
  forged.set('metadata', JSON.stringify({ submissionId: crypto.randomUUID(), kind: 'manuscript', agreementVersion: '2026-09-10', agreementAccepted: true, values: { name: 'Impersonated', titles: 'Test book' }, language: 'en' }));
  assert.equal((await fetch(endpoint, { method: 'POST', body: forged, headers: { 'x-test-user': 'user:alice' } })).status, 400);
});

test('a description without attachments reaches the Add book executor with its instructions', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'scripta-proposal-'));
  const server = createSiteServer(root, { dataDir: root, verifyUser: async () => ({ id: 'user:alice', email: 'alice@example.test' }) }).listen(0, '127.0.0.1');
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await fs.rm(root, { recursive: true, force: true }); });
  await new Promise(resolve => server.once('listening', resolve));
  const endpoint = `http://127.0.0.1:${server.address().port}/api/submissions`;
  const send = (values, withFile = false) => {
    const body = new FormData();
    body.set('metadata', JSON.stringify({ submissionId: crypto.randomUUID(), kind: 'book-proposal', agreementVersion: '2026-09-10', agreementAccepted: true, language: 'ro', values }));
    if (withFile) body.set('documents', new File(['%PDF-1.7\npage'], 'test.pdf'));
    return fetch(endpoint, { method: 'POST', body });
  };
  const values = { titles: 'Grădini de cartier', description: 'O carte despre grădini comunitare.', audience: 'Începători', structure: 'Ghid pas cu pas', coverMode: 'generate', coverStyle: 'Botanic; Minimalist', coverPalette: 'Verde de pădure', coverComposition: 'Titlu mare', coverDescription: 'Frunze și grădini pe acoperișuri, fără oameni.' };
  assert.equal((await send({ description: ' ' })).status, 400);
  assert.equal((await send(values, true)).status, 400);
  const response = await send(values);
  assert.equal(response.status, 202);
  const receipt = await response.json();
  assert.equal(receipt.task.type, 'scriptahub.book-proposal');
  const store = new DashboardStore(root);
  try {
    const service = new TaskExecution(store, root), executor = 'agent:test/processor';
    const {taskIds} = service.snapshot(executor,{taskType:'add-book',batchId:'create-batch'});
    assert.deepEqual(taskIds,[receipt.task.id]);
    const args = {taskType:'add-book',batchId:'create-batch',taskId:receipt.task.id,runId:'generation-run'};
    const {task} = service.claim(executor,args);
    assert.equal(task.type,'scriptahub.book-proposal');
    assert.equal(task.language,'ro');
    assert.deepEqual(task.files,[]);
    assert.deepEqual(task.values,values);
    assert.deepEqual(service.claim(executor,args).task,task);
  } finally { store.close(); }
});
