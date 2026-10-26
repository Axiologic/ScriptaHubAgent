import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { once } from 'node:events';
import { DashboardStore } from '../dashboard-store.mjs';
import { createSiteServer } from '../server.mjs';

process.env.SCRIPTA_RECORD_KEY = 'test-dashboard-key-0123456789abcdef0123456789';
const user = name => ({ id: `user:${name}`, email: `${name}@example.test`, displayName: name,
  installationAdministratorId: 'user:system' });
const record = (owner, bookId, kind = 'edit') => ({ id: crypto.randomUUID(), owner: owner.id, createdAt: new Date().toISOString(),
  metadata: { kind, ...(bookId ? { bookId } : {}), values: { title: 'A real book', instructions: 'Improve the examples' } }, files: [] });

test('change authors and history resolve current account names without displaying internal IDs', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'scripta-dashboard-names-'));
  const store = new DashboardStore(directory);
  t.after(async () => { store.close(); await fs.rm(directory, { recursive: true, force: true }); });
  const alice = { ...user('alice'), displayName: 'Alice Writer' };
  const bob = { ...user('bob'), displayName: '' };
  store.remember(alice); store.remember(bob);
  const creation = store.submit(record(alice, undefined, 'book-proposal'));
  store.access(alice, creation.bookId, bob.email);
  const proposal = record(bob, creation.bookId); store.submit(proposal);
  let overview = store.overview(alice);
  assert.equal(overview.changes.find(change => change.id === creation.submissionId).author_name, 'Alice Writer');
  assert.equal(overview.changes.find(change => change.id === proposal.id).author_name, bob.email);
  assert.equal(overview.events.find(event => event.actor === alice.id).actor_name, 'Alice Writer');
  assert.equal(overview.events.find(event => event.actor === bob.id).actor_name, bob.email);
  store.remember({ ...bob, displayName: 'Bob Editor' });
  overview = store.overview(alice);
  assert.equal(overview.changes.find(change => change.id === proposal.id).author_name, 'Bob Editor');
  assert.equal(overview.events.find(event => event.actor === bob.id).actor_name, 'Bob Editor');
  assert.equal(overview.changes.find(change => change.id === proposal.id).author, bob.id, 'permissions still use the stable ID');
  store.remember({ ...bob, displayName: '   ' });
  assert.equal(store.overview(alice).events.find(event => event.actor === bob.id).actor_name, bob.email);
});

test('import ownership, transactional approval, conflicts, access, cancellation and restart', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'scripta-dashboard-'));
  let store = new DashboardStore(directory);
  t.after(async () => { store.close(); await fs.rm(directory, { recursive: true, force: true }); });
  const alice = user('alice'), bob = user('bob'), system = user('system');
  store.remember(alice, [{ id: 'bk-imported', title: { en: 'Imported book' } }]);
  assert.equal(store.book('bk-imported').owner, system.id, 'first visitor does not acquire imports');
  assert.equal(store.overview(alice).books.length, 0);
  store.remember(system); store.remember(bob);
  assert.throws(() => store.remember({ ...alice, installationAdministratorId: null }, [{ id: 'bk-missing', title: 'Unassigned' }]), /administrator identity is unavailable/);
  const proposal = record(bob, 'bk-imported');
  assert.equal(store.submit(proposal).task, null);
  assert.equal(store.overview(system).changes[0].state, 'open');
  store.db.exec("CREATE TEMP TRIGGER fail_task BEFORE INSERT ON tasks BEGIN SELECT RAISE(ABORT, 'test interrupted write'); END");
  assert.throws(() => store.decide(system, proposal.id, 'accept'), /test interrupted write/);
  assert.equal(store.book('bk-imported').revision, 0);
  assert.equal(store.db.prepare('SELECT state FROM changes WHERE id=?').get(proposal.id).state, 'open');
  store.db.exec('DROP TRIGGER fail_task');
  assert.throws(() => store.decide(bob, proposal.id, 'accept'), /Only the book owner/);
  const accepted = store.decide(system, proposal.id, 'accept');
  assert.equal(accepted.task.state, 'queued');
  const queuedEvent = store.overview(system).events.find(event => event.action === 'task.queued' && event.change_id === proposal.id);
  assert.equal(queuedEvent.actor, system.id, 'the approver queues the task, not the proposal author');
  assert.deepEqual(store.decide(system, proposal.id, 'accept'), accepted);
  assert.equal(store.db.prepare('SELECT count(*) AS n FROM tasks').get().n, 1);
  assert.throws(() => store.cancel(bob, accepted.task.id), /Only the book owner/);
  store.cancel(system, accepted.task.id);
  assert.equal(store.overview(system).tasks[0].state, 'cancelled');
  const stale = record(bob, 'bk-imported'); store.submit(stale);
  store.submit(record(system, 'bk-imported'));
  assert.throws(() => store.decide(system, stale.id, 'accept'), /book has changed/);
  assert.equal(store.db.prepare('SELECT state FROM changes WHERE id=?').get(stale.id).state, 'open');
  store.decide(system, stale.id, 'reject', 'Needs updating');
  assert.equal(store.receipt(store.db.prepare('SELECT * FROM changes WHERE id=?').get(stale.id)).task, null);
  const creation = store.submit(record(alice, undefined, 'book-proposal'));
  assert.equal(store.book(creation.bookId).owner, alice.id);
  assert.throws(() => store.submit(record(bob, creation.bookId)), /Book access required/);
  assert.throws(() => store.submit(record(bob, creation.bookId, 'fork')), /Book access required/);
  assert.throws(() => store.submit(record(bob, 'bk-missing', 'fork')), /Book not found/);
  store.access(alice, creation.bookId, bob.email);
  const grant = store.overview(alice).events.find(event => event.action === 'access.granted');
  assert.equal(grant.actor, alice.id);
  assert.equal(grant.subject_user, bob.id);
  assert.equal(grant.subject_name, 'bob');
  store.access(alice, creation.bookId, bob.email);
  assert.equal(store.overview(alice).events.filter(event => event.action === 'access.granted').length, 1, 'repeated grants do not invent new changes');
  assert.equal(store.submit(record(bob, creation.bookId)).state, 'open');
  assert.ok(store.overview(bob).books.some(book => book.id === creation.bookId));
  assert.throws(() => store.access(bob, creation.bookId, system.email), /Only the book owner/);
  store.access(alice, creation.bookId, bob.email, true);
  assert.equal(store.overview(alice).events.find(event => event.action === 'access.removed').subject_user, bob.id);
  assert.throws(() => store.submit(record(bob, creation.bookId)), /Book access required/);
  const fork = store.submit(record(bob, 'bk-imported', 'fork'));
  assert.equal(store.book(fork.bookId).source_id, 'bk-imported');
  assert.equal(store.book(fork.bookId).owner, bob.id);
  store.close(); store = new DashboardStore(directory);
  assert.equal(store.book('bk-imported').owner, system.id);
  assert.equal(store.db.prepare('SELECT state FROM tasks WHERE id=?').get(accepted.task.id).state, 'cancelled');
  store.remember(alice, [{ id: 'bk-imported', title: 'Changed source title' }]);
  assert.equal(store.book('bk-imported').owner, system.id);
});

test('adding access recipients preserves existing activity without inventing historical identities', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'scripta-dashboard-schema-'));
  let store = new DashboardStore(directory);
  t.after(async () => { store.close(); await fs.rm(directory, { recursive: true, force: true }); });
  const alice = user('alice'); store.remember(alice);
  const creation = store.submit(record(alice, undefined, 'book-proposal'));
  store.event(alice.id, 'access.granted', creation.bookId);
  store.db.exec('ALTER TABLE events DROP COLUMN subject_user');
  store.close(); store = new DashboardStore(directory);
  const event = store.overview(alice).events.find(item => item.action === 'access.granted');
  assert.equal(event.subject_user, null);
  assert.equal(event.subject_name, null);
  assert.equal(event.actor_name, 'alice');
  assert.equal(store.book(creation.bookId).revision, 1);
});

test('HTTP dashboard connects existing forms to owner and collaborator workflows without leaking private files', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'scripta-dashboard-http-'));
  const site = path.join(directory, 'site'); await fs.mkdir(site);
  await fs.writeFile(path.join(site, 'index.html'), 'catalogue');
  const server = createSiteServer(site, { dataDir: directory,
    verifyUser: async req => req.headers['x-test-user'] ? user(req.headers['x-test-user']) : null });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await fs.rm(directory, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`;
  async function request(actor, endpoint, body) {
    const response = await fetch(base + endpoint, { headers: { ...(actor ? { 'x-test-user': actor } : {}), 'Content-Type': 'application/json' },
      ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}) });
    return { status: response.status, value: await response.json().catch(() => null) };
  }
  async function submit(actor, kind, targetBookId, submissionId = crypto.randomUUID()) {
    const form = new FormData(); form.set('metadata', JSON.stringify({ submissionId, kind, ...(targetBookId ? { targetBookId } : {}),
      agreementVersion: '2026-09-10', agreementAccepted: true, values: { titles: 'HTTP book', instructions: 'Add a worked example' } }));
    form.append('documents', new Blob(['%PDF-1.7\nexample']), 'example.pdf');
    const response = await fetch(base + '/api/submissions', { method: 'POST', headers: { 'x-test-user': actor }, body: form });
    return { status: response.status, value: await response.json() };
  }
  assert.equal((await request(null, '/api/dashboard')).status, 401);
  const creation = await submit('alice', 'manuscript'); assert.equal(creation.status, 202);
  const bookId = creation.value.bookId;
  await request('bob', '/api/session');
  assert.equal((await request('alice', '/api/dashboard/access', { bookId, email: user('bob').email })).status, 200);
  const proposal = await submit('bob', 'edit', bookId); assert.equal(proposal.value.task, null);
  const owner = await request('alice', '/api/dashboard'); assert.equal(owner.value.changes.length, 2);
  assert.equal((await request('charlie', '/api/dashboard')).value.books.length, 0);
  const filePath = `/api/dashboard/files/${proposal.value.submissionId}/0`;
  assert.equal((await request('charlie', filePath)).status, 404);
  const document = await fetch(base + filePath, { headers: { 'x-test-user': 'alice' } });
  assert.equal(await document.text(), '%PDF-1.7\nexample');
  assert.equal((await request('bob', '/api/dashboard/review', { changeId: proposal.value.submissionId, decision: 'accept' })).status, 403);
  const review = await request('alice', '/api/dashboard/review', { changeId: proposal.value.submissionId, decision: 'accept' });
  assert.equal(review.value.task.state, 'queued');
  const repeated = await request('alice', '/api/dashboard/review', { changeId: proposal.value.submissionId, decision: 'accept' });
  assert.equal(repeated.value.task.id, review.value.task.id);
  assert.equal((await request('alice', '/api/dashboard/cancel', { taskId: review.value.task.id })).status, 200);
  const state = (await request('bob', '/api/dashboard')).value;
  assert.equal(state.tasks.find(task => task.id === review.value.task.id).state, 'cancelled');
});
