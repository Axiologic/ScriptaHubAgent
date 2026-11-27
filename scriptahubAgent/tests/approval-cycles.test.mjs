import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { DashboardStore } from '../dashboard-store.mjs';
import { TaskExecution } from '../task-execution.mjs';
import { advanceCycles, creditOperation } from '../cycle-worker.mjs';

const author = {id:'user:author',email:'author@example.test'};
const admin = {id:'user:admin',email:'admin@example.test',roles:['admin'],installationAdministratorId:'user:admin'};
const executor = 'agent:test/processor';

test('credit operations use ScriptaHub references, reasons and reward expiration', () => {
  const row = { id: 'request', owner: author.id, kind: 'book-proposal', attempt: 2 };
  const debit = { userId: 'author', operation: 'debit', referenceId: 'scriptahub:book-proposal:request:2', amount: 8, reason: 'AI book generation' };
  assert.deepEqual(creditOperation(row, 'debit', 8), debit);
  assert.deepEqual(creditOperation(row, 'refund', 8), { ...debit, operation: 'refund' });
  const award = { ...row, kind: 'edit', expires_at: '2099-01-01T00:00:00Z' };
  assert.deepEqual(creditOperation(award, 'reward', 2), {
    userId: 'author', operation: 'grant', referenceId: 'scriptahub:reward:request',
    amount: 2, reason: 'Approved corrections', expiresAt: award.expires_at,
  });
  assert.deepEqual(creditOperation(award, 'expiry'), {
    userId: 'author', operation: 'inspect-expiry', referenceId: 'scriptahub:reward:request',
  });
});
const record = (kind,owner,values,bookId) => {
  const id = crypto.randomUUID();
  return {id,owner:owner.id,createdAt:new Date().toISOString(),files:[],metadata:{kind,values,bookId,submissionId:id}};
};

async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(),'scripta-approval-'));
  let store;
  const open = () => {
    store?.close();
    store = new DashboardStore(dir,{manageApprovals:true});
    return {store,executorApi:new TaskExecution(store,dir)};
  };
  t.after(async()=>{store?.close(); await fs.rm(dir,{recursive:true,force:true});});
  const first = open();
  first.store.remember(admin,[{id:'bk-source',title:'Original book'}]);
  first.store.remember(author);
  return {...first,open,dir};
}

test('animation suggestions are charged once before review and refunded on rejection',async t=>{
  const {store,dir} = await fixture(t);
  const policy = {animationCost:5};
  const oldKey = process.env.SCRIPTA_RECORD_KEY;
  process.env.SCRIPTA_RECORD_KEY = 'a-test-record-key-for-animation-suggestions';
  t.after(()=>{
    if (oldKey === undefined) delete process.env.SCRIPTA_RECORD_KEY;
    else process.env.SCRIPTA_RECORD_KEY = oldKey;
  });
  const {saveSubmission} = await import('../submissions.mjs');
  const intake = async confirmedCost => {
    const submission = record('animation',author,{feedback:'Use a map'},'bk-source');
    const form = new FormData();
    form.set('metadata',JSON.stringify({...submission.metadata,confirmedCost,agreementAccepted:true,agreementVersion:'2026-09-10'}));
    const request = new Request('http://localhost/upload',{method:'POST',body:form});
    return saveSubmission({body:Buffer.from(await request.arrayBuffer()),contentType:request.headers.get('content-type'),
      user:author,dataDir:dir,store,policy});
  };
  await assert.rejects(intake(4),error=>error.status===409 && /cost has changed/.test(error.message));
  const suggestion = await intake(5);
  assert.equal((await intake(5)).submissionId,suggestion.submissionId);
  assert.equal(suggestion.cycle.phase,'funding');
  assert.equal(suggestion.cycle.cost,5);
  assert.throws(()=>store.decide(admin,suggestion.submissionId,'accept'),/payment must be confirmed/);
  const operations=[];
  const tick = () => advanceCycles(store,{
    apply:async (row,operation,amount)=>{
      operations.push(creditOperation(row,operation,amount));
      return operations.length === 1 ? {insufficient:true,missing:2} : {};
    },
    send:async ()=>({providerMessageId:'sent'}),report:message=>assert.fail(message)
  });
  await tick();
  assert.equal(store.cycles.read(suggestion.submissionId).phase,'retryable');
  assert.equal(store.cycles.read(suggestion.submissionId).missing,2);
  store.transaction(()=>store.cycles.retry(author,suggestion.submissionId,1));
  await tick();
  assert.equal(store.cycles.read(suggestion.submissionId).phase,'review');
  store.decide(admin,suggestion.submissionId,'reject');
  await tick();
  await tick();
  assert.equal(store.cycles.read(suggestion.submissionId).phase,'rejected');
  assert.deepEqual(operations.map(({operation,amount})=>[operation,amount]),[['debit',5],['debit',5],['refund',5]]);
  assert.equal(operations[1].referenceId,operations[2].referenceId);
});

test('new books queue immediately without an initial approval; duplicate submissions and retries stay blocked',async t=>{
  const {store,executorApi} = await fixture(t);
  const submit = () => store.submit(record('book-proposal',author,{description:'Study of tides'}),{bookReward:10});
  const first=submit();
  assert.deepEqual(submit(),first);
  assert.equal(first.cycle.phase,'active');
  assert.equal(first.task.state,'queued');
  assert.throws(()=>store.decide(admin,first.submissionId,'accept','',undefined,1),/processed and validated/);
  const {task}=executorApi.claim(executor,{runId:'first',taskType:'add-book'});
  executorApi.finish(executor,{executionId:task.executionId,state:'failed',error:'Generation interrupted'});
  const retry=attempt=>store.transaction(()=>store.cycles.retry(author,first.submissionId,attempt));
  assert.throws(()=>retry(1),/once the previous attempt/);
  const mail=[];
  const options={apply:()=>assert.fail('A failed book cannot earn a reward'),send:async notice=>{mail.push(notice);return {providerMessageId:'mail'};}};
  await advanceCycles(store,options);
  assert.throws(()=>retry(1),/once the previous attempt/);
  await advanceCycles(store,options);
  assert.equal(mail.length,1);
  const second=retry(1);
  assert.deepEqual(retry(1),second);
  assert.equal(second.phase,'active');
  assert.notEqual(second.taskId,first.task.id);
  assert.equal(executorApi.claim(executor,{runId:'second',taskType:'add-book'}).task.taskId,second.taskId);
  assert.equal(executorApi.status(executor,{executionId:task.executionId}).state,'failed');
});

test('a paid edition waits for debit, survives a lost confirmation and blocks retry until the refund',async t=>{
  const f = await fixture(t);
  let {store,executorApi} = f;
  const edit = store.submit(record('edit',author,{feedback:'Fix the caption'},'bk-source'));
  store.decide(admin,edit.submissionId,'accept');
  const first = store.submitEdition(admin,'bk-source',crypto.randomUUID(),8);
  assert.deepEqual(store.submitEdition(admin,'bk-source',crypto.randomUUID(),8),first);
  assert.equal(executorApi.claim(executor,{runId:'unpaid',taskType:'edit'}).task,null);
  let balance = 10;
  const mutations = new Set();
  let loseDebit = true, loseRefund = true;
  const notices = [];
  const options = {report:()=>{},send:async notice=>{notices.push(notice);return {providerMessageId:'email'};},
    apply:async (row,operation,amount)=>{
      const ref = [row.id,row.attempt,operation].join(':');
      if (!mutations.has(ref)) {
        mutations.add(ref);
        balance += operation === 'debit' ? -amount : amount;
      }
      if (operation === 'debit' && loseDebit) { loseDebit=false; throw Error('Connection interrupted'); }
      if (operation === 'refund' && loseRefund) { loseRefund=false; throw Error('Connection interrupted'); }
      return {};
    }};
  await advanceCycles(store,options);
  assert.equal(balance,2);
  assert.equal(store.cycles.read(first.id).phase,'funding');
  ({store,executorApi} = f.open());
  await advanceCycles(store,options);
  assert.equal(balance,2);
  const {task} = executorApi.claim(executor,{runId:'paid',taskType:'edit'});
  executorApi.finish(executor,{executionId:task.executionId,state:'failed',error:'Conversion failed'});
  await advanceCycles(store,options);
  await advanceCycles(store,options);
  assert.equal(balance,10);
  assert.equal(store.cycles.read(first.id).phase,'restoring');
  assert.throws(()=>store.transaction(()=>store.cycles.retry(admin,first.id,1)),/once the previous attempt/);
  ({store,executorApi} = f.open());
  await advanceCycles(store,options);
  const retry = store.transaction(()=>store.cycles.retry(admin,first.id,1));
  assert.notEqual(retry.taskId,first.taskId);
  assert.deepEqual(store.editionRequests(retry.taskId),store.editionRequests(first.taskId));
  assert.equal(notices.filter(notice=>notice.subject.endsWith('Request restored')).length,1);
  await advanceCycles(store,options);
  assert.equal(balance,2);
  assert.equal(executorApi.claim(executor,{runId:'paid-retry',taskType:'edit'}).task.taskId,retry.taskId);
});

test('an automatically cancelled paid edition refunds once, queues notification and blocks retry until restoration', async t => {
  const {store,executorApi}=await fixture(t);
  const request=store.submitEdition(admin,'bk-source',crypto.randomUUID(),8);
  const operations=new Set(),notices=[];
  let balance=10,refundUnavailable=true,mailUnavailable=true;
  const options={report:()=>{},apply:async(row,operation,amount)=>{
    if(operation==='refund' && refundUnavailable) throw Error('Refund unavailable');
    const key=`${row.id}:${row.attempt}:${operation}`;
    if(!operations.has(key)) {operations.add(key);balance+=operation==='debit'?-amount:amount;}
    return {};
  },send:async notice=>{
    if(mailUnavailable) throw Error('Email unavailable');
    notices.push(notice);return {providerMessageId:'sent'};
  }};
  await advanceCycles(store,options);
  const task=executorApi.claim(executor,{runId:'orphaned-paid-edition',taskType:'edit'}).task;
  store.cancel(admin,task.taskId);
  executorApi.reconcileStops(message=>assert.fail(message));
  assert.equal(executorApi.status(executor,{executionId:task.executionId}).state,'cancelled');
  const retry=()=>store.transaction(()=>store.cycles.retry(admin,request.id,1));
  await advanceCycles(store,options);
  await advanceCycles(store,options);
  assert.equal(balance,2);
  assert.equal(store.cycles.read(request.id).phase,'restoring');
  assert.throws(retry,/once the previous attempt/);
  refundUnavailable=false;
  await advanceCycles(store,options);
  assert.equal(balance,10);
  const restored=store.cycles.read(request.id);
  assert.equal(restored.phase,'retryable');
  assert.ok(store.db.prepare('SELECT 1 FROM cycle_notifications WHERE id=? AND sent_at IS NULL').get(restored.notification_id));
  mailUnavailable=false;
  executorApi.reconcileStops(message=>assert.fail(message));
  await advanceCycles(store,options);
  await advanceCycles(store,options);
  assert.equal(balance,10);
  assert.equal(notices.length,1);
  assert.equal(operations.size,2,'one debit and one refund, without a reward');
  assert.notEqual(retry().taskId,task.taskId);
});

test('a derived book retains its verified source and stays unavailable with insufficient points', async t => {
  const {store,executorApi} = await fixture(t);
  const root = executorApi.dataDir;
  const {saveSubmission} = await import('../submissions.mjs');
  const oldKey = process.env.SCRIPTA_RECORD_KEY;
  process.env.SCRIPTA_RECORD_KEY = 'a-test-record-key-for-fork-source-approval';
  t.after(()=>{if(oldKey===undefined) delete process.env.SCRIPTA_RECORD_KEY; else process.env.SCRIPTA_RECORD_KEY=oldKey;});
  const submissionId = crypto.randomUUID();
  const source = {bookId:'bk-source',edition:'edition-1',language:'en',title:'Original',license:'CC-BY-4.0'};
  const form = new FormData();
  form.set('metadata',JSON.stringify({submissionId,kind:'fork',bookId:'bk-source',language:'en',confirmedCost:5,
    values:{titles:'Adapted',prompt:'Add worked examples',sourceEdition:'edition-1'},
    agreementAccepted:true,agreementVersion:'2026-09-10'}));
  const request = new Request('http://localhost',{method:'POST',body:form});
  const html = '<main data-reader-content><h1>Original</h1></main>';
  const result = await saveSubmission({body:Buffer.from(await request.arrayBuffer()),contentType:request.headers.get('content-type'),
    user:author,dataDir:root,store,policy:{forkCost:5},forkSource:async()=>({bytes:Buffer.from(html),source})});
  assert.notEqual(result.bookId,source.bookId);
  assert.equal(store.book(result.bookId).source_id,source.bookId);
  assert.equal(executorApi.claim(executor,{runId:'before-payment',taskType:'add-book'}).task,null);
  const send = async()=>({providerMessageId:'test'});
  await advanceCycles(store,{apply:async()=>({insufficient:true,missing:3}),send});
  assert.equal(store.cycles.read(result.submissionId).missing,3);
  assert.equal(executorApi.claim(executor,{runId:'no-funds',taskType:'add-book'}).task,null);
  store.transaction(()=>store.cycles.retry(author,result.submissionId,1));
  await advanceCycles(store,{apply:async()=>({balance:0}),send});
  const {task} = executorApi.claim(executor,{runId:'fork-funded',taskType:'add-book'});
  assert.equal(task.type,'scriptahub.fork');
  assert.deepEqual(task.source,source);
  const file = await executorApi.document(executor,{executionId:task.executionId,index:0});
  assert.equal(Buffer.from(file.data,'base64').toString(),html);
});

test('correction rewards require publication and group all included proposals per contributor and edition', async t => {
  const f = await fixture(t);
  let {store,executorApi} = f;
  const other = {id:'user:other',email:'other@example.test'};
  store.remember(other);
  const submit = (who,feedback) => store.submit(record('edit',who,{feedback},'bk-source'),{correctionReward:7});
  const first = submit(author,'Correct the legend');
  const second = submit(author,'Correct the heading');
  const third = submit(other,'Clarify the caption');
  for (const change of [first,second,third]) {
    assert.equal(store.decide(admin,change.submissionId,'accept').cycle.phase,'awaiting_publication');
    assert.equal(store.decide(admin,change.submissionId,'accept').cycle.phase,'awaiting_publication');
  }
  let awarded = 0, loseResponse = true;
  const references = new Set(), amounts = new Map();
  const options = {send:async()=>({providerMessageId:'mail'}),report:()=>{},apply:async(row,operation,amount)=>{
    assert.equal(operation,'reward');
    if (!references.has(row.id)) {
      references.add(row.id); awarded+=amount;
      amounts.set(row.owner,(amounts.get(row.owner)||0)+amount);
    }
    if (loseResponse) { loseResponse=false; throw Error('Lost confirmation'); }
    return {};
  }};
  await advanceCycles(store,options);
  assert.equal(awarded,0,'approval alone never pays');
  const edition = store.submitEdition(admin,'bk-source',crypto.randomUUID(),0,{correctionReward:7,rewardValidityDays:90});
  const late = submit(author,'A later improvement');
  store.decide(admin,late.submissionId,'accept');
  await advanceCycles(store,options);
  const {task} = executorApi.claim(executor,{runId:'publish-edition',taskType:'edit'});
  assert.equal(task.requests.length,3);
  assert.throws(()=>executorApi.finish(executor,{executionId:task.executionId,state:'completed',result:'Unconfirmed'}),/confirmed publication/);
  await advanceCycles(store,options);
  assert.equal(awarded,0,'generation without a confirmed push never pays');
  store.db.prepare('INSERT INTO task_publications(execution_id,manifest,digest,receipt) VALUES(?,?,?,?)')
    .run(task.executionId,'{}','test-digest','{"commit":"confirmed"}');
  const finish = {executionId:task.executionId,state:'completed',result:'Confirmed publication'};
  executorApi.finish(executor,finish,{publication:true});
  executorApi.finish(executor,finish,{publication:true});
  assert.equal(store.db.prepare('SELECT count(*) AS n FROM edition_reward_members').get().n,3);
  assert.equal(store.cycles.read(late.submissionId).phase,'awaiting_publication');
  await advanceCycles(store,options);
  ({store,executorApi} = f.open());
  await advanceCycles(store,options);
  await advanceCycles(store,options);
  assert.equal(awarded,14);
  assert.equal(references.size,2,'one durable reward per contributor, not per proposal');
  assert.equal(amounts.get(author.id),7);
  assert.equal(amounts.get(other.id),7);
  for (const change of [first,second,third]) assert.equal(store.cycles.read(change.submissionId).phase,'completed');
  assert.equal(store.cycles.read(late.submissionId).phase,'awaiting_publication');
  const rewards = store.db.prepare(`SELECT * FROM approval_cycles WHERE change_id IS NULL AND kind='edit'`).all();
  assert.ok(rewards.every(row=>row.reward_validity_days===90 && row.expires_at));
  assert.equal(store.db.prepare(`SELECT count(*) AS n FROM cycle_notifications WHERE subject LIKE '%Points awarded'`).get().n,2);

  store.submitEdition(admin,'bk-source',crypto.randomUUID(),0,{correctionReward:9});
  await advanceCycles(store,options);
  const next = executorApi.claim(executor,{runId:'next-edition-failed',taskType:'edit'}).task;
  assert.equal(next.requests.length,1);
  executorApi.finish(executor,{executionId:next.executionId,state:'failed',error:'Publication rejected'});
  await advanceCycles(store,options);
  await advanceCycles(store,options);
  assert.equal(awarded,14,'failed publication never pays');
  assert.equal(store.cycles.read(late.submissionId).phase,'awaiting_publication');
  const cycle = store.db.prepare('SELECT * FROM approval_cycles WHERE task_id=?').get(next.taskId);
  store.transaction(()=>store.cycles.retry(admin,cycle.id,1));
  await advanceCycles(store,options);
  const retry = executorApi.claim(executor,{runId:'next-edition-retry',taskType:'edit'}).task;
  store.db.prepare('INSERT INTO task_publications(execution_id,manifest,digest,receipt) VALUES(?,?,?,?)')
    .run(retry.executionId,'{}','next-digest','{"commit":"next-confirmed"}');
  executorApi.finish(executor,{executionId:retry.executionId,state:'completed',result:'Second edition published'},{publication:true});
  await advanceCycles(store,options);
  await advanceCycles(store,options);
  assert.equal(amounts.get(author.id),16,'the same contributor can earn another reward in a different edition');
  assert.equal(amounts.get(other.id),7);
  assert.equal(store.book('bk-source').revision,2);
});

test('expiry reminders are durable and sent once at each configured threshold', async t => {
  const {store} = await fixture(t);
  const {checkRewardExpiry} = await import('../cycle-worker.mjs');
  const change = store.submit(record('edit',author,{feedback:'Add a label'},'bk-source'),{correctionReward:7});
  store.decide(admin,change.submissionId,'accept');
  const expiry = new Date('2030-03-01T00:00:00.000Z');
  store.db.prepare("UPDATE approval_cycles SET phase='completed',expires_at=? WHERE id=?").run(expiry.toISOString(),change.submissionId);
  const policy = {firstNoticeDays:30,lastNoticeDays:7};
  const options = {apply:async()=>({remaining:5})};
  for (const days of [29,28,7,6]) {
    await checkRewardExpiry(store,policy,{...options,time:expiry.getTime() - days*86400000});
  }
  const notices = store.db.prepare("SELECT * FROM cycle_notifications WHERE subject LIKE '%expiration reminder%'").all();
  assert.equal(notices.length,2);
  assert.ok(notices.every(item=>item.message.includes('5 contribution points')));
});

test('workspace administrators can review their own books and other owners corrections without duplicate tasks', async t => {
  const {store} = await fixture(t);
  const secondAdmin = {id:'user:editor',email:'editor@example.test',roles:['admin']};
  store.remember(secondAdmin);
  const proposal = store.submit(record('book-proposal',admin,{description:'A book about navigation'}),{bookReward:10});
  assert.equal(proposal.state,'accepted');
  assert.equal(proposal.task.state,'queued');
  assert.equal(store.db.prepare('SELECT count(*) AS n FROM tasks WHERE change_id=?').get(proposal.submissionId).n,1);

  const correction = store.submit(record('edit',author,{feedback:'Correct the map legend'},'bk-source'),{correctionReward:5});
  assert.ok(store.overview(secondAdmin).changes.some(change=>change.id===correction.submissionId));
  assert.throws(()=>store.decide(author,correction.submissionId,'accept'),/Only the book owner/);
  assert.equal(store.decide(secondAdmin,correction.submissionId,'accept').state,'accepted');
  assert.equal(store.cycles.read(correction.submissionId).reviewer,secondAdmin.id);
  assert.equal(store.cycles.read(correction.submissionId).phase,'awaiting_publication');

  const paid = store.submit(record('book-proposal',author,{description:'Paid generation'}),{promptBookCost:8});
  const worker = {apply:async()=>({}),send:async()=>({providerMessageId:'test-mail'})};
  await advanceCycles(store,worker);
  for (const created of [proposal,paid]) store.cancel(secondAdmin,created.task.id);
  await advanceCycles(store,worker);
  await advanceCycles(store,worker);
  assert.equal(store.cycles.read(paid.cycle.id).phase,'retryable');
  assert.throws(()=>store.transaction(()=>store.cycles.retry(secondAdmin,paid.cycle.id,1)),/Request not found/);
  const retry = store.transaction(()=>store.cycles.retry(secondAdmin,proposal.cycle.id,1));
  assert.equal(retry.attempt,2);
  assert.equal(store.book(proposal.bookId).owner,admin.id);
});


test('an approved contributor pays for the requested edition independently of book ownership',async t=>{
  const {store,executorApi}=await fixture(t);
  const correction=store.submit(record('edit',author,{feedback:'An approved contribution'},'bk-source'));
  store.decide(admin,correction.submissionId,'accept');
  const edition=store.submitEdition(author,'bk-source',crypto.randomUUID(),8,{correctionReward:7});
  assert.equal(store.cycles.read(edition.id).owner,author.id);
  assert.equal(store.editionRequests(edition.taskId).length,1,'the edition includes the approved contribution');
  assert.throws(()=>store.submitEdition(admin,'bk-source',crypto.randomUUID(),8),/pending edition/);
  let debited;
  await advanceCycles(store,{apply:async(row,operation,amount)=>{debited={owner:row.owner,operation,amount};return {};},send:async()=>({providerMessageId:'mail'})});
  assert.deepEqual(debited,{owner:author.id,operation:'debit',amount:8});
  assert.equal(executorApi.claim(executor,{runId:'requester-edition',taskType:'edit'}).task.taskId,edition.taskId);
  store.cancel(author,edition.taskId);
  assert.equal(store.db.prepare('SELECT state FROM tasks WHERE id=?').get(edition.taskId).state,'stop_requested');
});


test('other users can correct, request editions and fork a published authored book while its private review files stay protected',async t=>{
  const {store,executorApi}=await fixture(t);
  const proposal=store.submit(record('book-proposal',admin,{description:'A published authored book'}));
  assert.throws(()=>store.validateSubmission(author,{kind:'fork',bookId:proposal.bookId}),/Book access/);
  const task=executorApi.claim(executor,{runId:'publish-authored',taskType:'add-book'}).task;
  store.db.prepare('INSERT INTO task_publications(execution_id,manifest,digest,receipt) VALUES(?,?,?,?)')
    .run(task.executionId,'{}','test-digest','{"commit":"confirmed"}');
  executorApi.finish(executor,{executionId:task.executionId,state:'completed',result:'Published'},{publication:true});
  assert.equal(store.book(proposal.bookId).owner,admin.id);
  assert.equal(store.canRead(store.book(proposal.bookId),author),false,'public reading must not grant access to private proposals and attachments');
  assert.doesNotThrow(()=>store.validateSubmission(author,{kind:'fork',bookId:proposal.bookId}));
  const correction=store.submit(record('edit',author,{feedback:'Correct a factual detail'},proposal.bookId));
  assert.equal(correction.cycle.phase,'review');
  assert.throws(()=>store.submitEdition(author,proposal.bookId,crypto.randomUUID(),8),/approved contribution/);
  store.decide(admin,correction.submissionId,'accept');
  const edition=store.submitEdition(author,proposal.bookId,crypto.randomUUID(),8);
  assert.equal(edition.phase,'funding');
  assert.equal(store.cycles.read(edition.id).owner,author.id);
});


test('a restored unpaid edition cannot lock a public book or race another user’s funded request',async t=>{
  const {store}=await fixture(t);
  const correction=store.submit(record('edit',author,{feedback:'An approved contribution'},'bk-source'));
  store.decide(admin,correction.submissionId,'accept');
  const first=store.submitEdition(author,'bk-source',crypto.randomUUID(),8);
  await advanceCycles(store,{apply:async()=>({insufficient:true,missing:8}),send:async()=>({providerMessageId:'mail'})});
  assert.equal(store.cycles.read(first.id).phase,'retryable');
  const second=store.submitEdition(admin,'bk-source',crypto.randomUUID(),8);
  assert.equal(second.phase,'funding');
  assert.throws(()=>store.transaction(()=>store.cycles.retry(author,first.id,1)),/pending or running/);
  assert.equal(store.cycles.read(first.id).phase,'retryable');
});

test('a standalone edition request stays out of corrections and preserves its instructions on retry',async t=>{
  const fixtureStore=await fixture(t);
  let {store,executorApi}=fixtureStore;
  const first=store.submitEdition(admin,'bk-source',crypto.randomUUID(),8);
  const send=async()=>({providerMessageId:'mail'});
  await advanceCycles(store,{apply:async()=>({insufficient:true,missing:8}),send});
  store.db.prepare("UPDATE changes SET kind='edit' WHERE id=(SELECT change_id FROM tasks WHERE id=?)").run(first.taskId);
  ({store,executorApi}=fixtureStore.open());
  assert.equal(store.overview(admin).editions[0].pendingCount,0);
  assert.equal(store.overview(admin).changes.length,0);

  const correction=store.submit(record('edit',author,{feedback:'Fix the caption'},'bk-source'));
  store.decide(admin,correction.submissionId,'accept');
  const retry=store.transaction(()=>store.cycles.retry(admin,first.id,1));
  await advanceCycles(store,{apply:async()=>({}),send});
  const {task}=executorApi.claim(executor,{runId:'retry-standalone-edition',taskType:'edit'});
  assert.equal(task.taskId,retry.taskId);
  assert.equal(task.requests.length,1);
  assert.equal(task.requests[0].kind,'edit');
  assert.match(task.requests[0].values.feedback,/prepare a complete new edition/);
  executorApi.finish(executor,{executionId:task.executionId,state:'failed',error:'Test failure'});
  await advanceCycles(store,{apply:async()=>({}),send});
  await advanceCycles(store,{apply:async()=>({}),send});
  const next=store.submitEdition(admin,'bk-source',crypto.randomUUID(),8);
  assert.deepEqual(store.editionRequests(next.taskId).map(item=>item.id),[correction.submissionId]);
});

test('a blocked correction closes its paid edition after the refund and leaves other corrections available',async t=>{
  const {store,executorApi}=await fixture(t);
  const blocked=store.submit(record('edit',author,{feedback:'Replace a picture'},'bk-source'));
  const accepted=store.submit(record('edit',author,{feedback:'Fix the caption'},'bk-source'));
  for(const item of [blocked,accepted]) store.decide(admin,item.submissionId,'accept');
  const cycle=store.submitEdition(admin,'bk-source',crypto.randomUUID(),8);
  const operations=[];
  const worker={apply:async (_row,operation)=>{operations.push(operation);return {};},
    send:async()=>({providerMessageId:'mail'})};
  await advanceCycles(store,worker);
  const {task}=executorApi.claim(executor,{runId:'moderation-edition',taskType:'edit'});
  executorApi.prepareModeration=async()=>({finding:{category:'extreme_presentation',changeId:blocked.submissionId}});
  await executorApi.moderateTask(executor,{executionId:task.executionId});
  await advanceCycles(store,worker);
  assert.equal(store.cycles.read(cycle.id).phase,'restoring');
  assert.equal(store.overview(admin).editionCycles.length,1);
  await advanceCycles(store,worker);
  assert.deepEqual(operations,['debit','refund']);
  assert.equal(store.cycles.read(cycle.id).phase,'rejected');
  assert.equal(store.overview(admin).editionCycles.length,0);
  const replacement=store.submitEdition(admin,'bk-source',crypto.randomUUID(),8);
  assert.deepEqual(store.editionRequests(replacement.taskId).map(change=>change.id),[accepted.submissionId]);
});

test('prompt generation charges before claim and a failed attempt refunds before retry', async t => {
  const {store,executorApi}=await fixture(t);
  const created=store.submit(record('book-proposal',author,{description:'A guide to urban gardening'}),{promptBookCost:8,bookReward:10});
  assert.equal(created.cycle.phase,'funding');
  assert.equal(store.cycles.read(created.submissionId).reward,0);
  const args={runId:'prompt-generation',taskType:'add-book'};
  assert.equal(executorApi.claim(executor,args).task,null);
  assert.equal(store.overview(author).books[0].creation.cycle.cost,8);
  let balance=6;
  const operations=[];
  const worker={apply:async (row,operation,amount)=>{
    operations.push({operation,amount,attempt:row.attempt});
    if (operation==='debit' && balance<amount) return {insufficient:true,missing:amount-balance};
    balance+=operation==='refund' ? amount : -amount;
    return {};
  },send:async()=>({providerMessageId:'test-mail'})};
  await advanceCycles(store,worker);
  assert.equal(store.overview(author).books[0].creation.cycle.missing,2);
  assert.equal(executorApi.claim(executor,args).task,null);
  balance+=2;
  const retry=store.transaction(()=>store.cycles.retry(author,created.cycle.id,created.cycle.attempt));
  assert.equal(retry.phase,'funding');
  await advanceCycles(store,worker);
  const {task}=executorApi.claim(executor,args);
  assert.equal(task.taskId,retry.taskId);
  assert.equal(store.overview(author).books[0].creation.state,'running');
  executorApi.finish(executor,{executionId:task.executionId,state:'failed',error:'Generation did not complete'});
  await advanceCycles(store,worker);
  assert.equal(store.overview(author).books[0].creation.error,'Generation did not complete');
  assert.throws(()=>store.transaction(()=>store.cycles.retry(author,retry.id,retry.attempt)),/once the previous attempt/);
  await advanceCycles(store,worker);
  assert.equal(balance,8);
  assert.deepEqual(operations.map(({operation,attempt})=>[operation,attempt]),[['debit',1],['debit',2],['refund',2]]);
});

test('manuscript creation is free and rewards its author only after publication', async t => {
  const {store,executorApi}=await fixture(t);
  const created=store.submit(record('manuscript',author,{readerTypography:'readable'}),{promptBookCost:8,bookReward:10});
  const operations=[];
  const worker={apply:async (row,operation,amount)=>{operations.push([row.kind,operation,amount]);return {};},
    send:async()=>({providerMessageId:'test-mail'})};
  assert.equal(created.cycle.cost,0);
  assert.equal(created.cycle.phase,'active');
  await advanceCycles(store,worker);
  assert.deepEqual(operations,[]);
  const {task}=executorApi.claim(executor,{runId:'manuscript',taskType:'add-book'});
  store.db.prepare('INSERT INTO task_publications(execution_id,manifest,digest,receipt) VALUES(?,?,?,?)')
    .run(task.executionId,'{}','test-digest','{"commit":"confirmed"}');
  executorApi.finish(executor,{executionId:task.executionId,state:'completed',result:'Published'},{publication:true});
  await advanceCycles(store,worker);
  await advanceCycles(store,worker);
  await advanceCycles(store,worker);
  assert.deepEqual(operations,[['manuscript','reward',10]]);
});
