import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ProcessingStore, requireNoActiveProcessing } from '../processing-store.mjs';

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(),'processing-store-'));
  const db = new DatabaseSync(path.join(root,'state.sqlite'));
  db.exec(`PRAGMA foreign_keys=ON; CREATE TABLE task_executions(id TEXT PRIMARY KEY);
    CREATE TABLE task_publications(execution_id TEXT PRIMARY KEY); INSERT INTO task_executions VALUES('exec');`);
  const store = { db, transaction(fn) { db.exec('BEGIN IMMEDIATE'); try { const value=fn(); db.exec('COMMIT'); return value; } catch (error) { db.exec('ROLLBACK'); throw error; } } };
  const service = { store, execution(executor,id) {
    if (executor !== 'agent:test/worker' || id !== 'exec') throw Object.assign(new Error('Execution not found'),{status:404});
    return {state:'running'};
  } };
  t.after(async () => { db.close(); await fs.rm(root,{recursive:true,force:true}); });
  return {root,db,store,jobs:new ProcessingStore(service)};
}
const owner='agent:test/worker';
const request={executionId:'exec',jobId:'one',virtualCwd:'/workspace/run',skill:'pdf2html'};

test('admission is immutable, exclusive, owned and cancelled jobs remain tombstones',async t=>{
  const {jobs,db}=await fixture(t);
  assert.equal(jobs.prepare(owner,request,'runtime',100).state,'uploading');
  assert.equal(jobs.prepare(owner,request,'runtime',100).state,'uploading');
  assert.throws(()=>jobs.prepare(owner,{...request,skill:'doc2pdf'},'runtime',100),{status:409});
  assert.throws(()=>jobs.prepare(owner,{...request,jobId:'two'},'runtime',100),{status:409});
  assert.throws(()=>jobs.row('agent:test/other','exec','one'),{status:404});
  db.prepare("UPDATE task_processing_jobs SET state='cancelled' WHERE job_id='one'").run();
  assert.equal(jobs.row(owner,'exec','one').state,'cancelled');
  assert.equal(jobs.start(owner,'exec','one').state,'cancelled');
  assert.equal(db.prepare('SELECT reserved_bytes FROM task_processing_jobs').get().reserved_bytes,100);
  assert.throws(()=>jobs.prepare(owner,{...request,jobId:'two',virtualCwd:'/workspace/other'},'runtime',100),{status:409});
  assert.equal(jobs.prepare(owner,{...request,jobId:'two'},'runtime',100).state,'uploading');
});

test('publication registration permanently excludes processing and active states block publication',async t=>{
  const {jobs,db,store}=await fixture(t);
  jobs.prepare(owner,request,'runtime',0);
  for (const state of ['uploading','starting','running','stopping']) {
    db.prepare('UPDATE task_processing_jobs SET state=?').run(state);
    assert.throws(()=>store.transaction(()=>requireNoActiveProcessing(store,'exec')),{status:409});
  }
  db.prepare("UPDATE task_processing_jobs SET state='cancelled'").run();
  store.transaction(()=>requireNoActiveProcessing(store,'exec'));
  db.prepare("INSERT INTO task_publications VALUES('exec')").run();
  assert.throws(()=>jobs.prepare(owner,{...request,jobId:'two'},'runtime',0),{status:409});
});

test('starting is durable and consumes the single running slot',async t=>{
  const {jobs}=await fixture(t);
  jobs.prepare(owner,request,'runtime',0);
  assert.equal(jobs.start(owner,'exec','one').state,'starting');
  assert.equal(jobs.start(owner,'exec','one').state,'starting');
});


test('independent SQLite processes cannot admit processing and publication together',async t=>{
  const {root,db}=await fixture(t);db.exec('PRAGMA journal_mode=WAL');
  const module=new URL('../processing-store.mjs',import.meta.url).href;
  const script=`import {DatabaseSync} from 'node:sqlite';import {ProcessingStore,requireNoActiveProcessing} from ${JSON.stringify(module)};
    const db=new DatabaseSync(process.argv[1]);db.exec('PRAGMA busy_timeout=5000');
    const store={db,transaction(fn){db.exec('BEGIN IMMEDIATE');try{const v=fn();db.exec('COMMIT');return v;}catch(e){db.exec('ROLLBACK');throw e;}}};
    const service={store,execution(){return {state:'running'};}};const jobs=new ProcessingStore(service);
    try {if(process.argv[2]==='job')jobs.prepare('agent:test/worker',{executionId:'exec',jobId:'race',virtualCwd:'/workspace/run'},'runtime',0);
      else store.transaction(()=>{requireNoActiveProcessing(store,'exec');db.prepare("INSERT INTO task_publications VALUES('exec')").run();});
      process.stdout.write('admitted');}catch(e){if(e.status!==409)throw e;process.stdout.write('conflict');}finally{db.close();}`;
  const run=promisify(execFile),file=path.join(root,'state.sqlite');
  const output=await Promise.all(['job','publication'].map(mode=>run(process.execPath,['--input-type=module','-e',script,file,mode])));
  assert.deepEqual(output.map(x=>x.stdout).sort(),['admitted','conflict']);
  const jobs=db.prepare("SELECT COUNT(*) AS n FROM task_processing_jobs WHERE state='uploading'").get().n;
  const publications=db.prepare('SELECT COUNT(*) AS n FROM task_publications').get().n;
  assert.equal(jobs+publications,1);
});
