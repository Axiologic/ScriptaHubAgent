import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {DashboardStore} from '../dashboard-store.mjs';
import {TaskExecution} from '../task-execution.mjs';
const executor='agent:test/processor';
async function fixture(t){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'scripta-batches-'));
  const store=new DashboardStore(root),service=new TaskExecution(store,root);
  t.after(async()=>{store.close();await fs.rm(root,{recursive:true,force:true});});
  const add=(kind='manuscript',bookId)=>{
    const record={id:crypto.randomUUID(),owner:'user:owner',createdAt:new Date().toISOString(),metadata:{kind,values:{title:'Book'},...(bookId?{bookId}:{})},files:[]};
    const receipt=store.submit(record);
    if(kind==='edit') return {...receipt,task:{id:store.submitEdition({id:'user:owner'},bookId,crypto.randomUUID()).taskId}};
    return receipt;
  };
  return {root,store,service,add};
}
test('snapshot is fixed, type-filtered, exclusive and durable; later arrivals wait for another batch',async t=>{
  const f=await fixture(t);f.store.remember({id:'user:owner',email:'owner@example.test',installationAdministratorId:'user:owner'},[{id:'catalogue-edit',title:'Published book'}]);
  const one=f.add(),two=f.add(),edit=f.add('edit','catalogue-edit');
  const initial=f.service.snapshot(executor,{batchId:'batch-a',taskType:'manuscript'});
  assert.deepEqual(new Set(initial.taskIds),new Set([one.task.id,two.task.id]));
  const later=f.add();
  assert.deepEqual(f.service.snapshot(executor,{batchId:'batch-a',taskType:'manuscript'}),initial);
  const other=f.service.snapshot(executor,{batchId:'batch-b',taskType:'manuscript'});
  assert.deepEqual(other.taskIds,[later.task.id]);
  assert.deepEqual(f.service.snapshot(executor,{batchId:'batch-edit',taskType:'edit'}).taskIds,[edit.task.id]);
  assert.equal(f.service.claim(executor,{runId:'outside'}).task,null,'ordinary claims must not steal reserved tasks');
  assert.throws(()=>f.service.claim(executor,{runId:'wrong',batchId:'batch-b',taskType:'manuscript',taskId:one.task.id}),/not reserved/);
  assert.throws(()=>f.service.snapshot('agent:other/processor',{batchId:'batch-a',taskType:'manuscript'}),/identity mismatch/);
  const anotherStore=new DashboardStore(f.root);try{
    const second=new TaskExecution(anotherStore,f.root);
    assert.deepEqual(second.snapshot(executor,{batchId:'batch-a',taskType:'manuscript'}),initial);
    assert.deepEqual(second.snapshot(executor,{batchId:'batch-c',taskType:'manuscript'}).taskIds,[]);
  }finally{anotherStore.close();}
});
test('settlement records failed or cancelled executions; closing releases unstarted work',async t=>{
  const f=await fixture(t);f.add();f.add();
  const snapshot=f.service.snapshot(executor,{batchId:'batch',taskType:'manuscript'});
  const one={task:{id:snapshot.taskIds[0]}},two={task:{id:snapshot.taskIds[1]}};
  const task=f.service.claim(executor,{batchId:'batch',taskId:one.task.id,taskType:'manuscript',runId:'flow-one'}).task;
  assert.throws(()=>f.service.closeBatch(executor,{batchId:'batch'}),/Settle/);
  assert.throws(()=>f.service.settle(executor,{batchId:'batch',taskId:one.task.id,runId:'another-flow'}),/does not belong/);
  assert.throws(()=>f.service.settle(executor,{batchId:'batch',taskId:one.task.id,runId:'flow-one'}),/terminal task result/);
  f.service.finish(executor,{executionId:task.executionId,state:'failed',error:'Robot process failed'});
  const result=f.service.settle(executor,{batchId:'batch',taskId:one.task.id,runId:'flow-one'});
  assert.equal(result.state,'failed');assert.equal(f.service.status(executor,{executionId:task.executionId}).state,'failed');
  f.service.closeBatch(executor,{batchId:'batch'});
  assert.deepEqual(f.service.snapshot(executor,{batchId:'next',taskType:'manuscript'}).taskIds,[two.task.id]);
  const next=f.service.claim(executor,{batchId:'next',taskId:two.task.id,taskType:'manuscript',runId:'flow-two'}).task;
  f.store.cancel({id:'user:owner'},two.task.id);
  f.service.finish(executor,{executionId:next.executionId,state:'cancelled'});
  assert.equal(f.service.settle(executor,{batchId:'next',taskId:two.task.id,runId:'flow-two'}).state,'cancelled');
  assert.equal(f.service.status(executor,{executionId:next.executionId}).state,'cancelled');
});
test('an unresolved publication cannot be failed or released by batch reconciliation',async t=>{
  const f=await fixture(t),one=f.add();f.service.snapshot(executor,{batchId:'batch',taskType:'manuscript'});
  const task=f.service.claim(executor,{batchId:'batch',taskId:one.task.id,runId:'flow'}).task;
  f.store.db.prepare('INSERT INTO task_publications(execution_id,manifest,digest,commit_id) VALUES(?,?,?,?)').run(task.executionId,'{}','digest','a'.repeat(40));
  assert.throws(()=>f.service.finish(executor,{executionId:task.executionId,state:'failed',error:'Publication interrupted'}),/reconciled/);
  assert.throws(()=>f.service.settle(executor,{batchId:'batch',taskId:one.task.id,runId:'flow'}),/terminal task result/);
  assert.equal(f.store.db.prepare('SELECT released FROM task_batch_items WHERE batch_id=?').get('batch').released,0);
  assert.equal(f.service.status(executor,{executionId:task.executionId}).state,'running');
});

test('concurrent processes reserve disjoint snapshots of the same queue',async t=>{
  const f=await fixture(t);const ids=[f.add().task.id,f.add().task.id];
  const {execFile}=await import('node:child_process'),{promisify}=await import('node:util');const exec=promisify(execFile);
  const script=`import {DashboardStore} from ${JSON.stringify(new URL('../dashboard-store.mjs',import.meta.url).href)};
    import {TaskExecution} from ${JSON.stringify(new URL('../task-execution.mjs',import.meta.url).href)};
    const store=new DashboardStore(process.argv[1]);try{console.log(JSON.stringify(new TaskExecution(store,process.argv[1]).snapshot(${JSON.stringify(executor)},{batchId:process.argv[2],taskType:'manuscript'})));}finally{store.close();}`;
  const results=await Promise.all(['batch-one','batch-two'].map(id=>exec(process.execPath,['--input-type=module','-e',script,f.root,id])));
  const batches=results.map(result=>JSON.parse(result.stdout).taskIds);
  assert.equal(batches[0].some(id=>batches[1].includes(id)),false);
  assert.deepEqual(new Set(batches.flat()),new Set(ids));
});

test('the flow helper drains its fixed batch sequentially, preserving claims, evidence and new arrivals',async t=>{
  const {runBatchOperation}=await import('../skills/scriptahub-tasks/scripts/task-batch.mjs');
  const f=await fixture(t),one=f.add(),two=f.add();
  const methods={scriptahub_task_batch_snapshot:'snapshot',scriptahub_task_batch_close:'closeBatch',scriptahub_task_batch_settle:'settle',scriptahub_task_claim:'claim'};
  const call=async(tool,args)=>f.service[methods[tool]](executor,args);
  const run=(op,input={})=>runBatchOperation(call,op,input,{root:f.root});
  const batch=await run('batch-start',{taskType:'manuscript'});
  const later=f.add();
  assert.deepEqual(await run('batch-start',{taskType:'manuscript'}),batch);
  const first=await run('batch-next');
  assert.equal(first.task.taskId,batch.taskIds[0]);
  assert.equal(first.taskDirectory,'tasks/'+first.task.taskId);
  assert.deepEqual(await run('batch-next'),first,'a lost response or repeated selection must recover the same execution');
  assert.throws(()=>f.service.claim(executor,{batchId:batch.batchId,runId:'out-of-order',taskId:batch.taskIds[1]}),/preceding task/);
  await fs.writeFile(path.join(f.root,first.taskDirectory,'evidence.txt'),'original evidence');
  f.service.finish(executor,{executionId:first.task.executionId,state:'failed',error:'Conversion failed'});
  const second=await run('batch-next');
  assert.equal(second.task.taskId,batch.taskIds[1]);
  assert.notEqual(second.task.runId,first.task.runId);
  assert.notEqual(second.taskDirectory,first.taskDirectory);
  assert.equal(await fs.readFile(path.join(f.root,first.taskDirectory,'evidence.txt'),'utf8'),'original evidence');
  f.store.cancel({id:'user:owner'},second.task.taskId);
  f.service.finish(executor,{executionId:second.task.executionId,state:'cancelled'});
  assert.equal((await run('batch-next')).closed,true);
  assert.equal((await run('batch-next')).task,null);
  assert.deepEqual(f.service.snapshot(executor,{batchId:'later-run',taskType:'manuscript'}).taskIds,[later.task.id]);
  assert.equal(new Set([one.task.id,two.task.id]).size,2);
});

test('flow batch setup is retry safe and rejects changed task types and symlinked state',async t=>{
  const {runBatchOperation}=await import('../skills/scriptahub-tasks/scripts/task-batch.mjs');
  const f=await fixture(t);f.add();
  const call=async(tool,args)=>f.service.snapshot(executor,args);
  const start=()=>runBatchOperation(call,'batch-start',{taskType:'manuscript'},{root:f.root});
  const [one,two]=await Promise.all([start(),start()]);assert.equal(one.batchId,two.batchId);
  await assert.rejects(runBatchOperation(call,'batch-start',{taskType:'edit'},{root:f.root}),/identity mismatch/);
  await fs.rename(path.join(f.root,'run-state/task-batch.json'),path.join(f.root,'original.json'));
  await fs.symlink(path.join(f.root,'original.json'),path.join(f.root,'run-state/task-batch.json'));
  await assert.rejects(start());
});

test('book workflows traverse their fixed batch using ordinary graph edges, with no RoboTeam queue extensions',async()=>{
  for (const name of ['add-book','edit-book']) {
    const graph=JSON.parse(await fs.readFile(new URL('../flows/'+name+'.json',import.meta.url),'utf8'));
    assert.equal(graph.entryTaskId,'select-task');
    assert.equal(graph.taskQueueAgent,undefined);assert.equal(graph.taskType,undefined);
    assert.ok(graph.edges.some(edge=>edge.id==='result-to-next'&&edge.targetTaskId==='select-task'));
    assert.ok(graph.edges.some(edge=>edge.id==='batch-to-result'&&edge.targetTaskId==='batch-result'));
    assert.equal(graph.edges.filter(edge=>edge.sourceTaskId==='batch-result').length,0);
    assert.doesNotMatch(JSON.stringify(graph),/queueTask|batch management belongs to RoboTeam/);
    assert.equal(graph.skillExecution,undefined);
  }
});
