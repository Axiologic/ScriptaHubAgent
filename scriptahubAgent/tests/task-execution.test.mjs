import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { DashboardStore } from '../dashboard-store.mjs';
import { TaskExecution, requireExecutor, executionTools } from '../task-execution.mjs';
import { sealRecord } from '../record-integrity.mjs';

process.env.SCRIPTA_RECORD_KEY = 'test-task-execution-key-0123456789abcdef0123456789';
const agent = 'agent:test/worker';
const other = 'agent:test/other';
const user = name => ({ id: `user:${name}`, email: `${name}@example.test`, displayName: name });
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'scripta-execution-'));
  const store = new DashboardStore(root), service = new TaskExecution(store, root);
  t.after(async () => { store.close(); await fs.rm(root, { recursive: true, force: true }); });
  store.remember(user('owner')); store.remember(user('collaborator'));
  const submit = async (kind = 'manuscript', owner = 'owner', bookId) => {
    const id = crypto.randomUUID(), bytes = Buffer.from('%PDF-1.7\nsource manuscript\n'), filename = crypto.randomUUID() + '.pdf';
    const metadata = { kind, values: { instructions: 'Process this manuscript' }, ...(bookId ? { targetBookId: bookId } : {}) };
    const record = sealRecord({ id, owner: user(owner).id, contact: { email: user(owner).email }, metadata,
      files: [{ originalName: 'source.pdf', name: filename, sha256: crypto.createHash('sha256').update(bytes).digest('hex') }],
      createdAt: new Date().toISOString(), state: 'received', task: null });
    const directory = path.join(root, 'inbox', id); await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(path.join(directory, filename), bytes);
    await fs.writeFile(path.join(directory, 'record.json'), JSON.stringify(record));
    return { receipt: store.submit(record), directory, filename, bytes };
  };
  return { root, store, service, submit };
}

test('executor policy rejects browser admins, delegation, spoofing, wrong tools and unconfigured callers', () => {
  const env = { SCRIPTA_EXECUTOR_AGENT_IDS: agent };
  const valid = tool => ({ invocation: { tool, subject: agent, actor: { kind: 'agent', id: agent }, caller: { kind: 'agent', id: agent } } });
  for (const tool of executionTools) assert.equal(requireExecutor(valid(tool), tool, env), agent);
  for (const change of [
    auth => { auth.user = { roles: ['admin'] }; },
    auth => { auth.invocation.actor = { kind: 'user', id: 'user:admin' }; },
    auth => { auth.invocation.subject = other; },
    auth => { auth.invocation.caller.id = other; },
    auth => { auth.invocation.delegation = { scope: ['*'] }; },
    auth => { auth.invocation.tool = 'scriptahub_config_get'; },
  ]) { const auth = valid('scriptahub_task_claim'); change(auth); assert.throws(() => requireExecutor(auth, 'scriptahub_task_claim', env), /denied/); }
  assert.throws(() => requireExecutor(valid('scriptahub_task_claim'), 'scriptahub_task_claim', {}), /not configured/);
  assert.throws(() => requireExecutor({}, 'scriptahub_task_claim', env), /denied/);
});

test('claims only accepted queued manuscripts, is durable and idempotent, and isolates executions', async t => {
  const { root, store, service, submit } = await fixture(t);
  const first = await submit(); await submit('book-proposal');
  store.access(user('owner'), first.receipt.bookId, user('collaborator').email);
  await submit('manuscript', 'collaborator', first.receipt.bookId); // open proposal, not approved
  const cancelled = await submit(); store.cancel(user('owner'), cancelled.receipt.task.id);
  const claimed = service.claim(agent, { runId: 'run-one' }).task;
  assert.equal(claimed.taskId, first.receipt.task.id);
  assert.equal(claimed.state, 'running'); assert.equal(claimed.values.instructions, 'Process this manuscript');
  assert.equal(claimed.files[0].originalName, 'source.pdf');
  assert.equal(JSON.stringify(claimed).includes(root), false, 'private source paths never leave ScriptaHub');
  assert.equal(service.claim(agent, { runId: 'run-one' }).task.executionId, claimed.executionId);
  assert.equal(service.claim(other, { runId: 'run-two' }).task, null);
  assert.throws(() => service.status(other, { executionId: claimed.executionId }), /not found/);
  assert.throws(() => service.finish(other, { executionId: claimed.executionId, state: 'completed', result: 'published' }), /not found/);
  const reopened = new DashboardStore(root); t.after(() => reopened.close());
  assert.equal(new TaskExecution(reopened, root).claim(agent, { runId: 'run-one' }).task.executionId, claimed.executionId);
});

test('independent processes cannot claim the same task', async t => {
  const { root, submit } = await fixture(t); await submit();
  const script = `import {DashboardStore} from ${JSON.stringify(new URL('../dashboard-store.mjs', import.meta.url).href)};
    import {TaskExecution} from ${JSON.stringify(new URL('../task-execution.mjs', import.meta.url).href)};
    const store=new DashboardStore(process.argv[1]);
    try { console.log(JSON.stringify(new TaskExecution(store,process.argv[1]).claim('agent:test/worker',{runId:process.argv[2]}))); }
    finally { store.close(); }`;
  const results = await Promise.all(['parallel-one','parallel-two'].map(run => promisify(execFile)(process.execPath, ['--input-type=module','-e',script,root,run])));
  assert.equal(results.map(result => JSON.parse(result.stdout)).filter(result => result.task).length, 1);
});

test('documents are hash-bound chunks of the claimed contribution; tampering and links fail', async t => {
  const { service, submit } = await fixture(t); const input = await submit();
  const { executionId } = service.claim(agent, { runId: 'read-one' }).task;
  const chunk = await service.document(agent, { executionId, index: 0, length: 5 });
  assert.equal(Buffer.from(chunk.data, 'base64').toString(), '%PDF-'); assert.equal(chunk.nextOffset, 5); assert.equal(chunk.eof, false);
  const rest = await service.document(agent, { executionId, index: 0, offset: 5 });
  assert.deepEqual(Buffer.concat([Buffer.from(chunk.data,'base64'),Buffer.from(rest.data,'base64')]), input.bytes);
  await assert.rejects(service.document(other, { executionId, index: 0 }), /not found/);
  await assert.rejects(service.document(agent, { executionId, index: 1 }), /not found/);
  await assert.rejects(service.document(agent, { executionId, index: 0, offset: -1 }), /range/);
  await fs.writeFile(path.join(input.directory,input.filename), 'modified');
  await assert.rejects(service.document(agent, { executionId, index: 0 }), /integrity/);
  await fs.unlink(path.join(input.directory,input.filename));
  await fs.symlink(path.join(input.directory,'record.json'), path.join(input.directory,input.filename));
  await assert.rejects(service.document(agent, { executionId, index: 0 }));
  await fs.unlink(path.join(input.directory,input.filename)); await fs.writeFile(path.join(input.directory,input.filename),input.bytes);
  const recordPath = path.join(input.directory,'record.json'); const record = JSON.parse(await fs.readFile(recordPath,'utf8'));
  record.metadata.values.instructions = 'tampered'; await fs.writeFile(recordPath,JSON.stringify(record));
  await assert.rejects(service.document(agent, { executionId, index: 0 }), /changed/);
});

test('stop requests remain cooperative, prevent reads and completion; finishing is idempotent', async t => {
  const { service, store, submit } = await fixture(t); const input = await submit();
  const { executionId } = service.claim(agent, { runId: 'stop-one' }).task;
  assert.throws(() => store.cancel(user('collaborator'), input.receipt.task.id), /owner/);
  store.cancel(user('owner'), input.receipt.task.id);
  assert.equal(service.status(agent,{executionId}).state, 'stop_requested');
  await assert.rejects(service.document(agent,{executionId,index:0}), /not running/);
  assert.throws(() => service.finish(agent,{executionId,state:'completed',result:'published'}), /confirmed publication|pending stop/);
  const final = { executionId, state:'cancelled', result:'Stopped before publication' };
  assert.equal(service.finish(agent,final).state, 'cancelled');
  assert.equal(service.finish(agent,final).state, 'cancelled');
  assert.throws(() => service.finish(agent,{...final,result:'different'}), /another result/);
  assert.equal(service.claim(agent,{runId:'stop-one'}).task.state, 'cancelled');
});

test('only real terminal states are recorded and failures retain useful result details', async t => {
  const { service, submit } = await fixture(t); await submit();
  const { executionId } = service.claim(agent, { runId: 'finish-one' }).task;
  assert.throws(() => service.finish(agent,{executionId,state:'prepared-not-pushed'}), /Invalid execution result/);
  assert.throws(() => service.finish(agent,{executionId,state:'failed'}), /Invalid execution result/);
  assert.throws(() => service.finish(agent,{executionId,state:'completed',result:''}), /Invalid execution result/);
  const result = service.finish(agent,{executionId,state:'failed',error:'Push rejected',result:'Validated package retained'});
  assert.equal(result.state,'failed'); assert.equal(result.taskError,'Push rejected');
  await assert.rejects(service.document(agent,{executionId,index:0}), /not running/);
  assert.throws(() => service.finish(agent,{executionId,state:'completed',result:'published'}), /another result/);
  await submit(); const next = service.claim(agent,{runId:'finish-two'}).task;
  assert.throws(() => service.finish(agent,{executionId:next.executionId,state:'completed',result:'Published commit 123'}), /Only ScriptaHub/);
});

test('claims always deliver ten-minute summaries regardless of task or stored configuration', async t => {
  const {service,store,submit}=await fixture(t);
  const input=await submit();
  const change=store.db.prepare('SELECT change_id FROM tasks WHERE id=?').get(input.receipt.task.id);
  const row=store.db.prepare('SELECT payload FROM changes WHERE id=?').get(change.change_id),payload=JSON.parse(row.payload);
  payload.metadata.values.summaryReadingMinutes=99;
  store.db.prepare('UPDATE changes SET payload=? WHERE id=?').run(JSON.stringify(payload),change.change_id);
  const config={schemaVersion:1,syncIntervalSeconds:60,repositories:['https://example.org/collection.json']};
  const claimed=service.claimConfigured(agent,{runId:'summary-default',summaryReadingMinutes:88},config);
  assert.equal(claimed.processingSettings.summaryReadingMinutes,10);
  assert.equal(claimed.task.values.summaryReadingMinutes,99);
  assert.equal(claimed.task.summaryReadingMinutes,undefined);
  await submit();
  const configured=service.claimConfigured(agent,{runId:'summary-configured'},{...config,summaryReadingMinutes:12});
  assert.equal(configured.processingSettings.summaryReadingMinutes,10);
});
