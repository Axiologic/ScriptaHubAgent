import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {DatabaseSync} from 'node:sqlite';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {DashboardStore} from '../dashboard-store.mjs';
import {TaskExecution} from '../task-execution.mjs';
import {sealRecord} from '../record-integrity.mjs';
const exec=promisify(execFile),agent='agent:test/editions';
const owner={id:'user:owner',email:'owner@example.test',installationAdministratorId:'user:owner'};
const author={id:'user:author',email:'author@example.test'};
const other={id:'user:other',email:'other@example.test'};
process.env.SCRIPTA_RECORD_KEY='edition-tests-signing-key-0123456789abcdef';
async function fixture(t) {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'scripta-editions-'));
  const store=new DashboardStore(root),service=new TaskExecution(store,root);
  store.remember(owner,[{id:'published-book',title:'Published book'},{id:'another-book',title:'Another book'}]);store.remember(author);store.remember(other);
  t.after(async()=>{store.close();await fs.rm(root,{recursive:true,force:true});});
  const add=async (who=author,{bookId='published-book',file=false,feedback='Approved improvement'}={})=>{
    const bytes=Buffer.from('%PDF-1.7\n'+who.id),id=crypto.randomUUID();
    const record=sealRecord({id,owner:who.id,createdAt:new Date().toISOString(),contact:{email:who.email},
      metadata:{kind:'edit',bookId,language:'en',values:{baseRevision:String(store.book(bookId).revision),annotations:JSON.stringify(['accepted','rejected'].map(key=>({id:key,quote:'Text',start:0,end:4,kind:'Editorial structure',feedback:key==='accepted'?feedback:'SECRET REJECTED TEXT',edition:'edition-1',language:'en'})))}},
      files:file?[{name:crypto.randomUUID()+'.pdf',originalName:who.id+'.pdf',sha256:crypto.createHash('sha256').update(bytes).digest('hex')}]:[]});
    const folder=path.join(root,'inbox',id);await fs.mkdir(folder,{recursive:true});await fs.writeFile(path.join(folder,'record.json'),JSON.stringify(record));
    if(file)await fs.writeFile(path.join(folder,record.files[0].name),bytes);
    store.submit(record);return record;
  };
  const approve=record=>store.decide(owner,record.id,'accept','',{accepted:'accept',rejected:'reject'});
  const edition=(bookId='published-book',submissionId=crypto.randomUUID())=>store.submitEdition(owner,bookId,submissionId);
  return {root,store,service,add,approve,edition};
}
test('approval accumulates requests without tasks; submission snapshots every approved request once',async t=>{
  const f=await fixture(t),one=await f.add(),two=await f.add(other),open=await f.add();
  const rejected=await f.add();f.store.decide(owner,rejected.id,'reject','',{accepted:'reject',rejected:'reject'});
  f.approve(one);f.approve(two);const unrelated=await f.add(author,{bookId:'another-book'});f.approve(unrelated);
  assert.equal(f.store.db.prepare('SELECT count(*) AS n FROM tasks').get().n,0);
  assert.equal(f.store.book('published-book').revision,0);
  assert.equal(f.store.overview(owner).editions.find(e=>e.bookId==='published-book').pendingCount,2);
  assert.throws(()=>f.store.submitEdition(author,'published-book',crypto.randomUUID()),/Only the book owner/);
  const key=crypto.randomUUID(),submitted=f.edition('published-book',key);
  assert.equal(submitted.changeCount,2);assert.deepEqual(f.edition('published-book',key),submitted);
  assert.throws(()=>f.edition(),/already has/);
  assert.deepEqual(f.store.editionRequests(submitted.taskId).map(c=>c.id),[one.id,two.id]);
  f.approve(open);
  assert.equal(f.store.overview(owner).editions.find(e=>e.bookId==='published-book').pendingCount,1);
  assert.deepEqual(f.store.editionRequests(submitted.taskId).map(c=>c.id),[one.id,two.id],'late approvals cannot enter an existing task');
  const task=f.service.claim(agent,{runId:'edition-one',taskType:'edit',taskId:submitted.taskId}).task;
  assert.equal(task.requests.length,2);assert.equal(task.annotations.length,2);
  assert.equal(JSON.stringify(task).includes('SECRET REJECTED TEXT'),false);
  for(const changeId of [one.id,two.id]) assert.equal(f.store.overview(owner).changes.find(c=>c.id===changeId).processing.state,'running');
  // The publisher's durable receipt is the only path to completed; repeated finalization must not bump revision again.
  f.store.db.prepare('INSERT INTO task_publications(execution_id,manifest,digest,receipt) VALUES(?,?,?,?)').run(task.executionId,'{}','test-digest','{"commit":"confirmed"}');
  const finish={executionId:task.executionId,state:'completed',result:'Confirmed publication'};
  f.service.finish(agent,finish,{publication:true});f.service.finish(agent,finish,{publication:true});
  assert.equal(f.store.book('published-book').revision,1);
  const next=f.edition();assert.equal(next.changeCount,1);assert.equal(f.store.editionRequests(next.taskId)[0].id,open.id);
  assert.equal(f.store.db.prepare('SELECT base_revision FROM tasks WHERE id=?').get(next.taskId).base_revision,1);
});
test('edition assembly is atomic, cancellation and failure allow retry without replacing prior executions',async t=>{
  const f=await fixture(t);f.approve(await f.add());f.approve(await f.add(other));
  f.store.db.exec("CREATE TEMP TRIGGER fail_member BEFORE INSERT ON task_changes WHEN NEW.position=1 BEGIN SELECT RAISE(ABORT,'interrupted snapshot');END");
  assert.throws(()=>f.edition(),/interrupted snapshot/);
  assert.equal(f.store.db.prepare('SELECT count(*) AS n FROM tasks').get().n,0);f.store.db.exec('DROP TRIGGER fail_member');
  const cancelled=f.edition();f.store.cancel(owner,cancelled.taskId);
  const running=f.edition(),task=f.service.claim(agent,{runId:'failed-edition',taskType:'edit'}).task;
  assert.equal(task.taskId,running.taskId);f.service.finish(agent,{executionId:task.executionId,state:'failed',error:'Conflicting approved changes'});
  const retry=f.edition();assert.equal(retry.changeCount,2);assert.notEqual(retry.taskId,running.taskId);
  assert.equal(f.service.status(agent,{executionId:task.executionId}).state,'failed');
  assert.equal(f.store.book('published-book').revision,0);
});
test('all documents are delivered with stable global indexes, original signed records and executor isolation',async t=>{
  const f=await fixture(t),one=await f.add(author,{file:true}),two=await f.add(other,{file:true});f.approve(one);f.approve(two);f.edition();
  const task=f.service.claim(agent,{runId:'documents',taskType:'edit'}).task;
  assert.deepEqual(task.files.map(f=>f.index),[0,1]);assert.deepEqual(task.requests.map(r=>r.files[0].index),[0,1]);
  for(let index=0;index<2;index++){
    const result=await f.service.document(agent,{executionId:task.executionId,index});
    assert.equal(crypto.createHash('sha256').update(Buffer.from(result.data,'base64')).digest('hex'),task.files[index].sha256);
  }
  await assert.rejects(f.service.document('agent:test/intruder',{executionId:task.executionId,index:1}),/not found/);
  const filename=path.join(f.root,'inbox',two.id,two.files[0].name);await fs.writeFile(filename,'tampered');
  await assert.rejects(f.service.document(agent,{executionId:task.executionId,index:1}),/integrity check failed/);
});
test('independent processes cannot submit two simultaneous editions of the same book',async t=>{
  const f=await fixture(t);f.approve(await f.add());
  const moduleURL=new URL('../dashboard-store.mjs',import.meta.url).href;
  const run=()=>exec(process.execPath,['--input-type=module','-e',`import {DashboardStore} from ${JSON.stringify(moduleURL)};import crypto from 'node:crypto';const store=new DashboardStore(process.argv[1]);try{console.log(JSON.stringify(store.submitEdition({id:'user:owner'},'published-book',crypto.randomUUID())))}catch(error){console.log(JSON.stringify({status:error.status,error:error.message}))}finally{store.close()}`,f.root]);
  const results=(await Promise.all([run(),run()])).map(r=>JSON.parse(r.stdout));
  assert.equal(results.filter(r=>r.state==='queued').length,1);assert.equal(results.filter(r=>r.status===409).length,1);
  assert.equal(f.store.db.prepare('SELECT count(*) AS n FROM tasks').get().n,1);
});
test('task schema upgrade preserves existing IDs, running executions, reservations and foreign keys',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'scripta-edition-schema-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  let store=new DashboardStore(root),service=new TaskExecution(store,root);
  const receipt=store.submit({id:crypto.randomUUID(),owner:owner.id,createdAt:new Date().toISOString(),metadata:{kind:'manuscript',values:{title:'Book'}},files:[]});
  const batch=service.snapshot(agent,{batchId:'existing-batch',taskType:'manuscript'});
  const task=service.claim(agent,{runId:'existing-run',batchId:batch.batchId,taskId:receipt.task.id}).task;store.close();
  const db=new DatabaseSync(path.join(root,'dashboard.sqlite'));
  db.exec(`PRAGMA foreign_keys=OFF;BEGIN IMMEDIATE;
    CREATE TABLE tasks_old(id TEXT PRIMARY KEY,change_id TEXT NOT NULL UNIQUE REFERENCES changes(id),state TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,result TEXT,error TEXT);
    INSERT INTO tasks_old SELECT id,change_id,state,created_at,updated_at,result,error FROM tasks;
    DROP TABLE tasks;ALTER TABLE tasks_old RENAME TO tasks;COMMIT;`);db.close();
  store=new DashboardStore(root);service=new TaskExecution(store,root);
  try {
    assert.equal(service.claim(agent,{runId:'existing-run',batchId:batch.batchId,taskId:receipt.task.id}).task.executionId,task.executionId);
    assert.equal(service.status(agent,{executionId:task.executionId}).state,'running');
    assert.deepEqual(store.db.prepare('PRAGMA foreign_key_check').all(),[]);
    assert.equal(store.db.prepare('PRAGMA foreign_keys').get().foreign_keys,1);
    assert.equal(store.db.prepare('SELECT released FROM task_batch_items WHERE task_id=?').get(receipt.task.id).released,0);
  }finally{store.close();}
});
