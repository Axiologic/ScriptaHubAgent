import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { ProcessingService } from '../processing-service.mjs';
import { processingRuntime } from '../processing-runtime.mjs';
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const owner='agent:test/worker';
async function fixture(t,script) {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'processing-service-')),runtime=path.join(root,'runtime'),data=path.join(root,'data');
  await fs.mkdir(runtime); await fs.writeFile(path.join(runtime,'source.json'),JSON.stringify({'pdf2html/SKILL.md':'a'.repeat(64)}));
  await fs.writeFile(path.join(runtime,'installed.json'),JSON.stringify({platform:`${process.platform}-${process.arch}`,skills:['pdf2html']}));
  let launches=0;
  const service=new ProcessingService(data,{runtimeRoot:runtime,launch:({jobDirectory})=>{launches++;return {command:process.execPath,args:['-e',script,jobDirectory]};}});
  const db=service.store.db,now=new Date().toISOString();
  db.prepare('INSERT INTO books(id,owner,title,origin,created_at) VALUES(?,?,?,?,?)').run('book','owner','Book','test',now);
  db.prepare('INSERT INTO changes(id,book_id,author,kind,state,base_revision,payload,created_at) VALUES(?,?,?,?,?,?,?,?)').run('change','book','owner','manuscript','accepted',0,'{}',now);
  db.prepare('INSERT INTO tasks(id,change_id,kind,state,created_at,updated_at) VALUES(?,?,?,?,?,?)').run('task','change','manuscript','running',now,now);
  db.prepare('INSERT INTO task_executions(id,task_id,executor_agent_id,run_id,created_at) VALUES(?,?,?,?,?)').run('execution','task',owner,'run',now);
  t.after(async()=>{await service.drain();try {(await import('node:child_process')).execFileSync('/bin/chmod',['-R','u+rwx',root]);} catch {}await fs.rm(root,{recursive:true,force:true});});
  const receipt=await processingRuntime(runtime),manifest=Buffer.from('[]');
  const request={executionId:'execution',jobId:'job',virtualCwd:'/workspace/run',skill:'pdf2html',args:['doctor'],input:'',sourceDigest:receipt.sourceDigests.pdf2html,manifestSha256:hash(manifest),manifestSize:manifest.length};
  const prepare=async()=>{await service.prepare(owner,request);service.upload(owner,{executionId:'execution',jobId:'job',kind:'manifest',offset:0,data:manifest.toString('base64')});};
  return {root,service,request,prepare,launches:()=>launches};
}
async function terminal(service) {
  for(let i=0;i<100;i++){const result=service.dispatch('scriptahub_skill_job_status',owner,{executionId:'execution',jobId:'job'});const state=(await result).state;if(!['uploading','starting','running','stopping'].includes(state))return state;await new Promise(resolve=>setTimeout(resolve,20));}
  throw new Error('Worker did not stop');
}

test('job runs once, persists complete inventory and serves bounded output',async t=>{
  const f=await fixture(t,"require('fs').writeFileSync(process.argv[1]+'/é.txt','hello'); console.log('done')");
  await f.prepare(); assert.equal((await f.service.start(owner,{executionId:'execution',jobId:'job'})).state,'running');
  await f.service.start(owner,{executionId:'execution',jobId:'job'}); assert.equal(f.launches(),1);
  assert.equal(await terminal(f.service),'succeeded');
  const result=f.service.result(owner,{executionId:'execution',jobId:'job'});assert.deepEqual(result.files,[{path:'é.txt',size:5,sha256:hash('hello')}]);
  const chunk=f.service.read(owner,{executionId:'execution',jobId:'job',kind:'file',path:'é.txt',offset:0,length:3});assert.equal(Buffer.from(chunk.data,'base64').toString(),'hel');assert.equal(chunk.eof,false);
  assert.throws(()=>f.service.result('agent:test/other',{executionId:'execution',jobId:'job'}),{status:404});
});

test('cancellation waits for child closure and preserves cancelled replay',async t=>{
  const f=await fixture(t,'setInterval(()=>{},1000)');await f.prepare();await f.service.start(owner,{executionId:'execution',jobId:'job'});
  assert.equal(f.service.cancel(owner,{executionId:'execution',jobId:'job'}).state,'stopping');
  assert.equal(await terminal(f.service),'cancelled');assert.equal((await f.service.start(owner,{executionId:'execution',jobId:'job'})).state,'cancelled');assert.equal(f.launches(),1);
});

test('cancelled upload stays tombstoned across repeated prepare and start',async t=>{
  const f=await fixture(t,'process.exit(0)');await f.prepare();assert.equal(f.service.cancel(owner,{executionId:'execution',jobId:'job'}).state,'cancelled');
  assert.equal((await f.service.prepare(owner,f.request)).state,'cancelled');assert.equal((await f.service.start(owner,{executionId:'execution',jobId:'job'})).state,'cancelled');assert.equal(f.launches(),0);
});

test('private IPC returns owner status and rejects another executor',async t=>{
  const f=await fixture(t,'process.exit(0)');await f.prepare();await f.service.listen();
  const {processingSocketPath}=await import('../processing-ipc.mjs');const {connect}=await import('node:net');
  const socketPath=processingSocketPath(path.join(f.root,'data'));assert.equal((await fs.stat(socketPath)).mode&0o777,0o600);
  const call=executor=>new Promise((resolve,reject)=>{const socket=connect(socketPath);let output='';socket.once('connect',()=>socket.write(JSON.stringify({tool:'scriptahub_skill_job_status',executor,input:{executionId:'execution',jobId:'job'}})+'\n'));socket.on('data',bytes=>output+=bytes);socket.once('end',()=>resolve(JSON.parse(output)));socket.once('error',reject);});
  const replies=await Promise.all([call(owner),call(owner),call('agent:test/other')]);
  assert.equal(replies[0].state,'uploading');assert.equal(replies[1].state,'uploading');assert.equal(replies[2].status,404);
  assert.throws(()=>new ProcessingService(path.join(f.root,'data')),{status:503});
});

test('IPC preserves unexpected endpoints and accepts an owned stale socket',async t=>{
  const f=await fixture(t,'process.exit(0)'),{processingSocketPath}=await import('../processing-ipc.mjs');
  const socket=processingSocketPath(path.join(f.root,'data'));
  await fs.writeFile(socket,'keep');await assert.rejects(f.service.listen(),/Invalid processing IPC endpoint/);
  assert.equal(await fs.readFile(socket,'utf8'),'keep');await fs.unlink(socket);
  await fs.symlink('missing',socket);await assert.rejects(f.service.listen(),/Invalid processing IPC endpoint/);
  assert.equal((await fs.lstat(socket)).isSymbolicLink(),true);await fs.unlink(socket);
  const {spawn}=await import('node:child_process');
  const child=spawn(process.execPath,['-e',"require('net').createServer().listen(process.argv[1],()=>process.kill(process.pid,'SIGKILL'))",socket]);
  await new Promise(resolve=>child.once('exit',resolve));assert.equal((await fs.lstat(socket)).isSocket(),true);
  await f.service.listen();assert.equal((await fs.lstat(socket)).mode&0o777,0o600);
});

test('IPC setup failure closes the listener and permits a restart',async t=>{
  const f=await fixture(t,'process.exit(0)'),fsSync=(await import('node:fs')).default;
  const {processingSocketPath}=await import('../processing-ipc.mjs'),socket=processingSocketPath(path.join(f.root,'data'));
  const original=fsSync.chmodSync,injected=Object.assign(new Error('injected chmod failure'),{code:'EPERM'});
  fsSync.chmodSync=function(filename,...args){if(filename===socket)throw injected;return original.call(this,filename,...args);};
  try {await assert.rejects(f.service.listen(),error=>error===injected);} finally {fsSync.chmodSync=original;}
  await assert.rejects(fs.lstat(socket),{code:'ENOENT'});assert.equal(f.service.server.listening,false);
  await f.service.drain();
  const reopened=new ProcessingService(path.join(f.root,'data'),{runtimeRoot:path.join(f.root,'runtime')});
  try {await reopened.listen();assert.equal((await fs.lstat(socket)).mode&0o777,0o600);} finally {await reopened.drain();}
});

test('IPC rejects a foreign endpoint and a failed bind without removing the endpoint',async t=>{
  const f=await fixture(t,'process.exit(0)'),fsSync=(await import('node:fs')).default;
  const {processingSocketPath}=await import('../processing-ipc.mjs'),socket=processingSocketPath(path.join(f.root,'data'));
  const {createServer}=await import('node:net'),other=createServer();
  await new Promise((resolve,reject)=>other.once('error',reject).listen(socket,resolve));
  const original=fsSync.lstatSync;
  fsSync.lstatSync=function(filename,...args){const stat=original.call(this,filename,...args);if(filename===socket)return new Proxy(stat,{get(target,key){return key==='uid'?target.uid+1:Reflect.get(target,key);}});return stat;};
  try {await assert.rejects(f.service.listen(),/Invalid processing IPC endpoint/);} finally {fsSync.lstatSync=original;}
  assert.equal((await fs.lstat(socket)).isSocket(),true);
  await new Promise(resolve=>other.close(resolve));
  const listen=(await import('node:net')).Server.prototype.listen,injected=new Error('injected bind failure');
  (await import('node:net')).Server.prototype.listen=function(){throw injected;};
  try {await assert.rejects(f.service.listen(),error=>error===injected);assert.equal(f.service.server.listening,false);}
  finally {(await import('node:net')).Server.prototype.listen=listen;}
});

test('oversize and changed upload retries are rejected without starting a worker',async t=>{
  const f=await fixture(t,'process.exit(0)');await f.prepare();
  assert.throws(()=>f.service.upload(owner,{executionId:'execution',jobId:'job',kind:'manifest',offset:0,data:Buffer.from('[ ]').toString('base64')}));
  await assert.rejects(f.service.prepare(owner,{...f.request,args:['convert']}),{status:409});
  assert.throws(()=>f.service.upload(owner,{executionId:'execution',jobId:'job',kind:'file',path:'../x',offset:0,data:'YQ=='}),{status:404});
  assert.equal(f.launches(),0);
});

test('a stopped task cancels an uploading job without a worker',async t=>{
  const f=await fixture(t,'process.exit(0)');await f.prepare();
  f.service.store.db.prepare("UPDATE tasks SET state='stop_requested' WHERE id='task'").run();
  f.service.cancelStoppedUploads();
  assert.equal((await f.service.dispatch('scriptahub_skill_job_status',owner,{executionId:'execution',jobId:'job'})).state,'cancelled');
  assert.equal((await f.service.start(owner,{executionId:'execution',jobId:'job'})).state,'cancelled');assert.equal(f.launches(),0);
});

test('restart interrupts unfinished start without rerunning it',async t=>{
  const f=await fixture(t,'process.exit(0)');await f.prepare();
  f.service.store.db.prepare("UPDATE task_processing_jobs SET state='starting' WHERE job_id='job'").run();
  await f.service.drain();
  const reopened=new ProcessingService(path.join(f.root,'data'),{runtimeRoot:path.join(f.root,'runtime')});
  try {assert.equal((await reopened.dispatch('scriptahub_skill_job_status',owner,{executionId:'execution',jobId:'job'})).state,'interrupted');
    assert.equal((await reopened.start(owner,{executionId:'execution',jobId:'job'})).state,'interrupted');assert.equal(f.launches(),0);
  } finally {await reopened.drain();}
});

test('log overflow stops worker and cannot report success',async t=>{
  const f=await fixture(t,'process.stdout.write(Buffer.alloc(17*1024*1024));setInterval(()=>{},1000)');await f.prepare();await f.service.start(owner,{executionId:'execution',jobId:'job'});
  assert.equal(await terminal(f.service),'failed');
  const status=await f.service.dispatch('scriptahub_skill_job_status',owner,{executionId:'execution',jobId:'job'});assert.equal(status.reason,'Log limit exceeded');
});

test('low storage refuses start and monitor failure stops an active worker',async t=>{
  const f=await fixture(t,'setInterval(()=>{},1000)');await f.prepare();
  const available=f.service.available;f.service.available=()=>0;
  await assert.rejects(f.service.start(owner,{executionId:'execution',jobId:'job'}),{status:503});assert.equal(f.launches(),0);
  f.service.available=available;await f.service.start(owner,{executionId:'execution',jobId:'job'});
  f.service.available=()=>{throw new Error('injected monitor failure');};
  assert.equal(await terminal(f.service),'failed');
  assert.match((await f.service.dispatch('scriptahub_skill_job_status',owner,{executionId:'execution',jobId:'job'})).reason,/monitor failed/);
});

test('deadline stops a worker and records failure',async t=>{
  const f=await fixture(t,'setInterval(()=>{},1000)');await f.prepare();f.service.durationMs=30;
  await f.service.start(owner,{executionId:'execution',jobId:'job'});assert.equal(await terminal(f.service),'failed');
  assert.equal((await f.service.dispatch('scriptahub_skill_job_status',owner,{executionId:'execution',jobId:'job'})).reason,'Time limit exceeded');
});

test('runtime preflight and heavy jobs do not overlap',async t=>{
  const f=await fixture(t,'setInterval(()=>{},1000)');await f.prepare();
  f.service.preflightPromise=new Promise(()=>{});
  await assert.rejects(f.service.start(owner,{executionId:'execution',jobId:'job'}),{status:503});assert.equal(f.launches(),0);
  f.service.preflightPromise=null;await f.service.start(owner,{executionId:'execution',jobId:'job'});
  await assert.rejects(f.service.preflight(),{status:503});
  f.service.cancel(owner,{executionId:'execution',jobId:'job'});assert.equal(await terminal(f.service),'cancelled');
});

test('admission retry initializes storage after failure before or during directory creation',async t=>{
  const f=await fixture(t,'process.exit(0)'),fsSync=(await import('node:fs')).default;
  const directory=f.service.directory({execution_id:'execution',job_id:'job'}),original=fsSync.mkdirSync;
  try {
    fsSync.mkdirSync=function(filename,...args) {if(filename===directory)throw Object.assign(new Error('injected storage failure'),{code:'ENOSPC'});return original.call(this,filename,...args);};
    await assert.rejects(f.service.prepare(owner,f.request),{code:'ENOSPC'});
  } finally {fsSync.mkdirSync=original;}
  const row=f.service.jobs.row(owner,'execution','job');assert.equal(row.state,'uploading');
  await assert.rejects(f.service.prepare(owner,{...f.request,args:['convert']}),{status:409});
  assert.equal((await f.service.prepare(owner,f.request)).state,'uploading');
  assert.equal((await fs.stat(path.join(directory,'task'))).isDirectory(),true);
  await fs.rm(path.join(directory,'task'),{recursive:true});
  assert.equal((await f.service.prepare(owner,f.request)).state,'uploading');
  assert.equal((await fs.stat(path.join(directory,'task'))).isDirectory(),true);
  f.service.upload(owner,{executionId:'execution',jobId:'job',kind:'manifest',offset:0,data:Buffer.from('[]').toString('base64')});
});

test('restart charges grown workspace and logs before allowing another admission',async t=>{
  const f=await fixture(t,'process.exit(0)');await f.prepare();
  const row=f.service.jobs.row(owner,'execution','job'),directory=f.service.directory(row);
  await fs.writeFile(path.join(directory,'stdout'),'retained log');
  for(let i=0;i<9;i++) {const file=await fs.open(path.join(directory,'task','large-'+i),'w');try{await file.truncate(512*1024*1024);}finally{await file.close();}}
  f.service.store.db.prepare("UPDATE task_processing_jobs SET state='running',reserved_bytes=2 WHERE job_id='job'").run();
  await f.service.drain();
  const reopened=new ProcessingService(path.join(f.root,'data'),{runtimeRoot:path.join(f.root,'runtime')});
  try {
    const recovered=reopened.jobs.row(owner,'execution','job');
    assert.equal(recovered.state,'interrupted');assert.equal(recovered.reserved_bytes,9*512*1024*1024+Buffer.byteLength('retained log')+2);
    await assert.rejects(reopened.prepare(owner,{...f.request,jobId:'later'}),{status:503});assert.equal(f.launches(),0);
  } finally {await reopened.drain();}
});

test('unmeasurable retained storage prevents startup and leaves the supervisor retryable',async t=>{
  const f=await fixture(t,'process.exit(0)');await f.prepare();
  const row=f.service.jobs.row(owner,'execution','job'),directory=f.service.directory(row);
  await f.service.drain();
  const fsSync=(await import('node:fs')).default,original=fsSync.readdirSync;
  try {
    fsSync.readdirSync=function(filename,...args) {if(filename===directory)throw Object.assign(new Error('injected read failure'),{code:'EIO'});return original.call(this,filename,...args);};
    assert.throws(()=>new ProcessingService(path.join(f.root,'data'),{runtimeRoot:path.join(f.root,'runtime')}),{status:503});
  } finally {fsSync.readdirSync=original;}
  const reopened=new ProcessingService(path.join(f.root,'data'),{runtimeRoot:path.join(f.root,'runtime')});
  try {assert.equal(reopened.jobs.row(owner,'execution','job').state,'uploading');}finally{await reopened.drain();}
});

test('unattributed retained bytes fail closed instead of escaping accounting',async t=>{
  const f=await fixture(t,'process.exit(0)');await f.service.drain();
  const orphan=path.join(f.root,'data','processing','orphan');await fs.writeFile(orphan,'retained');
  assert.throws(()=>new ProcessingService(path.join(f.root,'data'),{runtimeRoot:path.join(f.root,'runtime')}),{status:503});
  await fs.unlink(orphan);
  const reopened=new ProcessingService(path.join(f.root,'data'),{runtimeRoot:path.join(f.root,'runtime')});await reopened.drain();
});

test('terminal release requires ownership and digest and leaves a durable tombstone',async t=>{
  const f=await fixture(t,"require('fs').writeFileSync(process.argv[1]+'/out.txt','result');console.log('log')");
  await f.prepare();
  assert.throws(()=>f.service.release(owner,{executionId:'execution',jobId:'job',resultDigest:'a'.repeat(64)}),{status:409});
  await f.service.start(owner,{executionId:'execution',jobId:'job'});assert.equal(await terminal(f.service),'succeeded');
  const status=await f.service.dispatch('scriptahub_skill_job_status',owner,{executionId:'execution',jobId:'job'});
  assert.match(status.resultDigest,/^[a-f0-9]{64}$/);assert.equal(status.diagnosticsComplete,true);
  const directory=f.service.directory(f.service.jobs.row(owner,'execution','job'));
  assert.throws(()=>f.service.release('agent:test/other',{executionId:'execution',jobId:'job',resultDigest:status.resultDigest}),{status:404});
  assert.throws(()=>f.service.release(owner,{executionId:'execution',jobId:'job',resultDigest:'b'.repeat(64)}),{status:409});
  assert.equal((await fs.stat(directory)).isDirectory(),true);
  const args={executionId:'execution',jobId:'job',resultDigest:status.resultDigest};
  assert.deepEqual(f.service.release(owner,args),{jobId:'job',state:'succeeded',resultDigest:status.resultDigest,cleanupPending:false,artifactsReleased:true});
  assert.throws(()=>f.service.result(owner,{executionId:'execution',jobId:'job'}),{status:410});
  assert.throws(()=>f.service.read(owner,{executionId:'execution',jobId:'job',kind:'stdout',offset:0,length:1}),{status:410});
  assert.equal((await f.service.prepare(owner,f.request)).artifactsReleased,true);
  assert.equal((await f.service.start(owner,{executionId:'execution',jobId:'job'})).artifactsReleased,true);
  f.service.store.db.prepare("UPDATE tasks SET state='failed' WHERE id='task'").run();
  assert.equal(f.service.release(owner,args).artifactsReleased,true);
  assert.equal(f.service.jobs.row(owner,'execution','job').reserved_bytes,0);
});

test('partial cleanup persists intent and refuses reads until a retry finishes',async t=>{
  const f=await fixture(t,"require('fs').writeFileSync(process.argv[1]+'/out','value')");await f.prepare();await f.service.start(owner,{executionId:'execution',jobId:'job'});assert.equal(await terminal(f.service),'succeeded');
  const row=f.service.jobs.row(owner,'execution','job'),directory=f.service.directory(row),fsSync=(await import('node:fs')).default,original=fsSync.rmSync;
  const args={executionId:'execution',jobId:'job',resultDigest:row.result_digest};
  try {fsSync.rmSync=function(filename,...options){if(String(filename).endsWith(path.basename(directory))) {original.call(this,path.join(filename,'manifest'),{force:true});throw Object.assign(new Error('injected partial delete'),{code:'EIO'});}return original.call(this,filename,...options);};
    const reply=f.service.release(owner,args);assert.equal(reply.cleanupPending,true);assert.equal(reply.artifactsReleased,false);
  } finally {fsSync.rmSync=original;}
  assert.equal(f.service.jobs.row(owner,'execution','job').reserved_bytes,row.reserved_bytes);
  assert.throws(()=>f.service.result(owner,{executionId:'execution',jobId:'job'}),{status:410});
  assert.throws(()=>f.service.read(owner,{executionId:'execution',jobId:'job',kind:'stdout',offset:0,length:1}),{status:410});
  assert.equal(f.service.release(owner,args).artifactsReleased,true);
});

test('restart finishes cleanup after deletion succeeded but accounting commit failed',async t=>{
  const f=await fixture(t,'process.exit(0)');await f.prepare();await f.service.start(owner,{executionId:'execution',jobId:'job'});assert.equal(await terminal(f.service),'succeeded');
  const row=f.service.jobs.row(owner,'execution','job'),directory=f.service.directory(row),args={executionId:'execution',jobId:'job',resultDigest:row.result_digest};
  const fsSync=(await import('node:fs')).default,original=fsSync.fsyncSync,rootStat=fsSync.statSync(f.service.root);
  try {fsSync.fsyncSync=function(fd){const st=fsSync.fstatSync(fd);if(st.dev===rootStat.dev&&st.ino===rootStat.ino)throw Object.assign(new Error('injected fsync failure'),{code:'EIO'});return original.call(this,fd);};
    assert.equal(f.service.release(owner,args).cleanupPending,true);
  } finally {fsSync.fsyncSync=original;}
  await assert.rejects(fs.stat(directory),{code:'ENOENT'});assert.equal(f.service.jobs.row(owner,'execution','job').reserved_bytes,row.reserved_bytes);
  await f.service.drain();
  const reopened=new ProcessingService(path.join(f.root,'data'),{runtimeRoot:path.join(f.root,'runtime')});
  try {assert.equal(reopened.release(owner,args).artifactsReleased,true);assert.equal(reopened.jobs.row(owner,'execution','job').reserved_bytes,0);
    assert.equal((await reopened.prepare(owner,f.request)).artifactsReleased,true);await assert.rejects(fs.stat(directory),{code:'ENOENT'});
  } finally {await reopened.drain();}
});

test('upload cancellation retains charge on cleanup failure and retries without reads',async t=>{
  const f=await fixture(t,'process.exit(0)');await f.prepare();
  const row=f.service.jobs.row(owner,'execution','job'),directory=f.service.directory(row),fsSync=(await import('node:fs')).default,original=fsSync.rmSync;
  try {fsSync.rmSync=function(filename,...options){if(String(filename).endsWith(path.basename(directory)))throw Object.assign(new Error('injected deletion failure'),{code:'EIO'});return original.call(this,filename,...options);};
    const status=f.service.cancel(owner,{executionId:'execution',jobId:'job'});assert.equal(status.cleanupPending,true);assert.equal(status.diagnosticsComplete,false);
  } finally {fsSync.rmSync=original;}
  const pending=f.service.jobs.row(owner,'execution','job');assert.ok(pending.reserved_bytes>0);
  assert.throws(()=>f.service.result(owner,{executionId:'execution',jobId:'job'}),{status:410});
  f.service.resumeCleanup();assert.equal(f.service.jobs.row(owner,'execution','job').reserved_bytes,0);
  assert.equal((await f.service.prepare(owner,f.request)).artifactsReleased,true);
});

test('released capacity can be reused repeatedly across cumulative admissions',async t=>{
  const f=await fixture(t,'process.exit(0)');let cumulative=0;
  for(let i=0;i<3;i++) {
    const request={...f.request,jobId:'job-'+i},input={executionId:'execution',jobId:request.jobId};
    await f.service.prepare(owner,request);
    f.service.upload(owner,{...input,kind:'manifest',offset:0,data:Buffer.from('[]').toString('base64')});
    await f.service.start(owner,input);
    let status;for(let n=0;n<100;n++){status=await f.service.dispatch('scriptahub_skill_job_status',owner,input);if(status.outputReady)break;await new Promise(resolve=>setTimeout(resolve,20));}
    assert.equal(status.state,'succeeded');
    // Simulate charged retained artifacts larger than a real lightweight fixture.
    const charge=2*1024**3;f.service.store.db.prepare('UPDATE task_processing_jobs SET reserved_bytes=? WHERE execution_id=? AND job_id=?').run(charge,input.executionId,input.jobId);cumulative+=charge;
    assert.equal(f.service.release(owner,{...input,resultDigest:status.resultDigest}).artifactsReleased,true);
    assert.equal(f.service.jobs.row(owner,input.executionId,input.jobId).reserved_bytes,0);
  }
  assert.ok(cumulative>4*1024**3);
});

test('unacknowledged failed output survives restart and remains charged',async t=>{
  const f=await fixture(t,"require('fs').writeFileSync(process.argv[1]+'/failure.txt','diagnostic');process.exitCode=7");
  await f.prepare();await f.service.start(owner,{executionId:'execution',jobId:'job'});assert.equal(await terminal(f.service),'failed');
  const prior=f.service.jobs.row(owner,'execution','job');assert.equal(prior.diagnostics_complete,1);assert.ok(prior.reserved_bytes>0);
  await f.service.drain();const reopened=new ProcessingService(path.join(f.root,'data'),{runtimeRoot:path.join(f.root,'runtime')});
  try {const row=reopened.jobs.row(owner,'execution','job');assert.equal(row.result_digest,prior.result_digest);assert.ok(row.reserved_bytes>=prior.reserved_bytes);
    assert.equal(reopened.result(owner,{executionId:'execution',jobId:'job'}).files[0].path,'failure.txt');
  } finally {await reopened.drain();}
});

test('cleanup cannot target a replaced parent directory',async t=>{
  const f=await fixture(t,'process.exit(0)');await f.prepare();await f.service.start(owner,{executionId:'execution',jobId:'job'});assert.equal(await terminal(f.service),'succeeded');
  const row=f.service.jobs.row(owner,'execution','job'),args={executionId:'execution',jobId:'job',resultDigest:row.result_digest};
  const original=f.service.root,moved=original+'-moved';await fs.rename(original,moved);await fs.mkdir(original);
  try {assert.equal(f.service.release(owner,args).cleanupPending,true);assert.ok((await fs.readdir(moved)).some(name=>name.startsWith('job-')));}
  finally {await fs.rmdir(original);await fs.rename(moved,original);}
  assert.equal(f.service.release(owner,args).artifactsReleased,true);
});

test('released storage cannot be resurrected across restart',async t=>{
  const f=await fixture(t,'process.exit(0)');await f.prepare();await f.service.start(owner,{executionId:'execution',jobId:'job'});assert.equal(await terminal(f.service),'succeeded');
  const row=f.service.jobs.row(owner,'execution','job'),directory=f.service.directory(row);
  assert.equal(f.service.release(owner,{executionId:'execution',jobId:'job',resultDigest:row.result_digest}).artifactsReleased,true);
  await f.service.drain();await fs.mkdir(directory);
  assert.throws(()=>new ProcessingService(path.join(f.root,'data'),{runtimeRoot:path.join(f.root,'runtime')}),{status:503});
  await fs.rmdir(directory);const reopened=new ProcessingService(path.join(f.root,'data'),{runtimeRoot:path.join(f.root,'runtime')});await reopened.drain();
});

test('Linux cleanup fails closed when the fd anchor cannot be verified',{skip:process.platform!=='linux'},async t=>{
  const f=await fixture(t,'process.exit(0)');await f.prepare();await f.service.start(owner,{executionId:'execution',jobId:'job'});assert.equal(await terminal(f.service),'succeeded');
  const row=f.service.jobs.row(owner,'execution','job'),directory=f.service.directory(row),fsSync=(await import('node:fs')).default,original=fsSync.statSync;
  try {fsSync.statSync=function(filename,...options){if(String(filename).startsWith('/proc/self/fd/'))throw Object.assign(new Error('injected missing anchor'),{code:'ENOENT'});return original.call(this,filename,...options);};
    assert.equal(f.service.release(owner,{executionId:'execution',jobId:'job',resultDigest:row.result_digest}).cleanupPending,true);
  } finally {fsSync.statSync=original;}
  assert.equal((await fs.stat(directory)).isDirectory(),true);assert.equal(f.service.jobs.row(owner,'execution','job').reserved_bytes,row.reserved_bytes);
  assert.equal(f.service.release(owner,{executionId:'execution',jobId:'job',resultDigest:row.result_digest}).artifactsReleased,true);
});

test('requested cleanup of a failed job with a FIFO resumes after restart',async t=>{
  const f=await fixture(t,"require('child_process').execFileSync('mkfifo',[process.argv[1]+'/pipe']);process.exitCode=1");
  await f.prepare();await f.service.start(owner,{executionId:'execution',jobId:'job'});assert.equal(await terminal(f.service),'failed');
  const row=f.service.jobs.row(owner,'execution','job');assert.equal(row.diagnostics_complete,0);
  const directory=f.service.directory(row),args={executionId:'execution',jobId:'job',resultDigest:row.result_digest};
  const fsSync=(await import('node:fs')).default,original=fsSync.rmSync;
  try {fsSync.rmSync=function(filename,...options){if(String(filename).endsWith(path.basename(directory)))throw Object.assign(new Error('injected removal failure'),{code:'EIO'});return original.call(this,filename,...options);};
    assert.equal(f.service.release(owner,args).cleanupPending,true);
  } finally {fsSync.rmSync=original;}
  await f.service.drain();const reopened=new ProcessingService(path.join(f.root,'data'),{runtimeRoot:path.join(f.root,'runtime')});
  try {assert.equal(reopened.release(owner,args).artifactsReleased,true);assert.equal(reopened.jobs.row(owner,'execution','job').reserved_bytes,0);}finally{await reopened.drain();}
});

test('concurrent release replays are idempotent and cannot cross executions',async t=>{
  const f=await fixture(t,'process.exit(0)');await f.prepare();await f.service.start(owner,{executionId:'execution',jobId:'job'});assert.equal(await terminal(f.service),'succeeded');
  const db=f.service.store.db,now=new Date().toISOString();
  db.prepare('INSERT INTO changes(id,book_id,author,kind,state,base_revision,payload,created_at) VALUES(?,?,?,?,?,?,?,?)').run('change2','book','owner','manuscript','accepted',0,'{}',now);
  db.prepare('INSERT INTO tasks(id,change_id,kind,state,created_at,updated_at) VALUES(?,?,?,?,?,?)').run('task2','change2','manuscript','running',now,now);
  db.prepare('INSERT INTO task_executions(id,task_id,executor_agent_id,run_id,created_at) VALUES(?,?,?,?,?)').run('execution2','task2',owner,'run2',now);
  const status=await f.service.dispatch('scriptahub_skill_job_status',owner,{executionId:'execution',jobId:'job'});
  const args={executionId:'execution',jobId:'job',resultDigest:status.resultDigest};
  assert.throws(()=>f.service.release(owner,{...args,executionId:'execution2'}),{status:404});
  const replies=await Promise.all(Array.from({length:5},()=>Promise.resolve().then(()=>f.service.release(owner,args))));
  assert.ok(replies.every(reply=>reply.artifactsReleased&&reply.resultDigest===status.resultDigest));
});

test('interrupted jobs with missing logs advertise incomplete diagnostics',async t=>{
  const f=await fixture(t,'process.exit(0)');await f.prepare();
  f.service.store.db.prepare("UPDATE task_processing_jobs SET state='starting' WHERE job_id='job'").run();await f.service.drain();
  const reopened=new ProcessingService(path.join(f.root,'data'),{runtimeRoot:path.join(f.root,'runtime')});
  try {const status=await reopened.dispatch('scriptahub_skill_job_status',owner,{executionId:'execution',jobId:'job'});
    assert.equal(status.state,'interrupted');assert.equal(status.diagnosticsComplete,false);assert.match(status.resultDigest,/^[a-f0-9]{64}$/);
    assert.equal(reopened.read(owner,{executionId:'execution',jobId:'job',kind:'stdout',offset:0,length:1}).absent,true);
    assert.equal(reopened.release(owner,{executionId:'execution',jobId:'job',resultDigest:status.resultDigest}).artifactsReleased,true);
  } finally {await reopened.drain();}
});

test('release does not follow job symlinks into unrelated files',async t=>{
  const f=await fixture(t,"require('fs').symlinkSync(process.argv[1]+'/../../outside',process.argv[1]+'/link');process.exitCode=1");
  const sentinel=path.join(f.root,'data','processing','outside');await fs.writeFile(sentinel,'preserve');
  await f.prepare();await f.service.start(owner,{executionId:'execution',jobId:'job'});assert.equal(await terminal(f.service),'failed');
  const row=f.service.jobs.row(owner,'execution','job');assert.equal(row.diagnostics_complete,0);
  assert.equal(f.service.release(owner,{executionId:'execution',jobId:'job',resultDigest:row.result_digest}).artifactsReleased,true);
  assert.equal(await fs.readFile(sentinel,'utf8'),'preserve');await fs.unlink(sentinel);
});

async function second(f) {
  const db=f.service.store.db,now=new Date().toISOString();
  db.prepare('INSERT INTO changes(id,book_id,author,kind,state,base_revision,payload,created_at) VALUES(?,?,?,?,?,?,?,?)').run('change2','book','owner','manuscript','accepted',0,'{}',now);
  db.prepare('INSERT INTO tasks(id,change_id,kind,state,created_at,updated_at) VALUES(?,?,?,?,?,?)').run('task2','change2','manuscript','running',now,now);
  db.prepare('INSERT INTO task_executions(id,task_id,executor_agent_id,run_id,created_at) VALUES(?,?,?,?,?)').run('execution2','task2',owner,'run2',now);
  const request={...f.request,executionId:'execution2',jobId:'job2'};
  await f.service.prepare(owner,request);f.service.upload(owner,{executionId:'execution2',jobId:'job2',kind:'manifest',offset:0,data:Buffer.from('[]').toString('base64')});
}
const waitFor=async(service,executionId,jobId)=>{for(let i=0;i<200;i++){const s=await service.dispatch('scriptahub_skill_job_status',owner,{executionId,jobId});if(!['uploading','starting','running','stopping'].includes(s.state))return s;await new Promise(resolve=>setTimeout(resolve,20));}throw new Error('Worker did not stop');};
const poisons={
  symlink:"fs.symlinkSync('x',d+'/link')",
  fifo:"require('child_process').execFileSync('/usr/bin/mkfifo',[d+'/fifo'])",
  hardlink:"fs.writeFileSync(d+'/a','x');fs.linkSync(d+'/a',d+'/b')",
};
for(const [kind,poison] of Object.entries(poisons)) test('a retained job with a '+kind+' does not stop later jobs in another execution',async t=>{
  const f=await fixture(t,`const fs=require('fs'),d=process.argv[1],flag=d+'/../../first';if(!fs.existsSync(flag)){fs.writeFileSync(flag,'');${poison};process.exitCode=1}else setTimeout(()=>fs.writeFileSync(d+'/out.txt','ok'),700)`);
  await f.prepare();await f.service.start(owner,{executionId:'execution',jobId:'job'});
  assert.equal((await waitFor(f.service,'execution','job')).state,'failed');
  await second(f);await f.service.start(owner,{executionId:'execution2',jobId:'job2'});
  const result=await waitFor(f.service,'execution2','job2');
  assert.equal(result.state,'succeeded',result.reason);assert.equal(result.diagnosticsComplete,true);
  assert.equal(f.service.diskUsage()>=0,true);
});

test('an active job does not make preflight fail after the receipt cache expires',async t=>{
  const f=await fixture(t,'setInterval(()=>{},1000)');await f.prepare();
  f.service.receipt={ok:true,...await processingRuntime(path.join(f.root,'runtime')),checks:[{status:'passed',name:'installed-runtime'}],checkedAt:new Date(Date.now()-3600000).toISOString()};
  const receipt=f.service.receipt;await f.service.start(owner,{executionId:'execution',jobId:'job'});
  const busy=await f.service.preflight();
  assert.equal(busy.cachedWhileBusy,true);assert.equal(busy.doctorCheckedAt,receipt.checkedAt);assert.equal(busy.runtimeId,receipt.runtimeId);
  assert.ok(Date.now()-Date.parse(busy.checkedAt)<60000);assert.equal(f.service.receipt,receipt);
  const {requirePreflight,preflight:record}=await import('../../skills/scriptahub-tasks/scripts/workflow-checks.mjs'),previous=process.cwd();
  await fs.mkdir(path.join(f.root,'client'));process.chdir(path.join(f.root,'client'));
  try {await record(busy);await requirePreflight();} finally {process.chdir(previous);}
  f.service.receipt={...receipt,runtimeId:'other'};await assert.rejects(f.service.preflight(),{status:503});
  f.service.cancel(owner,{executionId:'execution',jobId:'job'});assert.equal(await terminal(f.service),'cancelled');
});

test('terminal persistence failure still frees the worker slot with an incomplete receipt',async t=>{
  const f=await fixture(t,'process.exit(0)');await f.prepare();
  f.service.terminal=()=>{throw new Error('injected terminal failure');};
  await f.service.start(owner,{executionId:'execution',jobId:'job'});
  assert.equal(await terminal(f.service),'failed');
  const status=await f.service.dispatch('scriptahub_skill_job_status',owner,{executionId:'execution',jobId:'job'});
  assert.equal(status.diagnosticsComplete,false);assert.match(status.resultDigest,/^[a-f0-9]{64}$/);
  assert.equal(f.service.release(owner,{executionId:'execution',jobId:'job',resultDigest:status.resultDigest}).artifactsReleased,true);
});

test('worker storage failure records an incomplete receipt that can be released',async t=>{
  const f=await fixture(t,'process.exit(0)'),fsSync=(await import('node:fs')).default;await f.prepare();
  const original=fsSync.writeFileSync;
  fsSync.writeFileSync=function(filename,...args) {if(String(filename).endsWith('/stdout'))throw Object.assign(new Error('injected'),{code:'ENOSPC'});return original.call(this,filename,...args);};
  let status;try {status=await f.service.start(owner,{executionId:'execution',jobId:'job'});} finally {fsSync.writeFileSync=original;}
  assert.equal(status.state,'failed');assert.equal(status.diagnosticsComplete,false);assert.match(status.resultDigest,/^[a-f0-9]{64}$/);assert.equal(f.launches(),1);
  assert.equal(f.service.release(owner,{executionId:'execution',jobId:'job',resultDigest:status.resultDigest}).artifactsReleased,true);
});

test('a drain that begins while start awaits the runtime spawns no worker',async t=>{
  const f=await fixture(t,'setInterval(()=>{},1000)');await f.prepare();
  const starting=f.service.start(owner,{executionId:'execution',jobId:'job'});f.service.draining=true;
  await assert.rejects(starting,{status:503});assert.equal(f.service.children.size,0);assert.equal(f.launches(),0);
});

test('fallback terminal jobs keep the computed inventory and report absence as a successful payload only for an intact root',async t=>{
  const f=await fixture(t,"require('fs').writeFileSync(process.argv[1]+'/out.txt','data')");await f.prepare();
  f.service.terminal=()=>{throw new Error('injected terminal failure');};
  await f.service.start(owner,{executionId:'execution',jobId:'job'});assert.equal(await terminal(f.service),'failed');
  const status=await f.service.dispatch('scriptahub_skill_job_status',owner,{executionId:'execution',jobId:'job'});
  const row=f.service.jobs.row(owner,'execution','job'),directory=f.service.directory(row);
  const files=[{path:'out.txt',size:4,sha256:hash('data')}];
  assert.deepEqual(f.service.result(owner,{executionId:'execution',jobId:'job'}).files,files);
  assert.equal(f.service.resultDigest(row,'failed',row.exit_code,row.reason,files,true),status.resultDigest);
  const read=kind=>f.service.dispatch('scriptahub_skill_job_read',owner,{executionId:'execution',jobId:'job',kind,offset:0,length:1});
  await fs.rm(path.join(directory,'stderr'));const gone=await read('stderr');assert.equal(gone.absent,true);assert.equal(gone.diagnosticsComplete,false);assert.equal(gone.resultDigest,status.resultDigest);
  await fs.rm(path.join(directory,'result.json'));await fs.rm(path.join(directory,'task/out.txt'));assert.equal(f.service.result(owner,{executionId:'execution',jobId:'job'}).absent,true);
  await fs.writeFile(path.join(directory,'result.json'),'{');assert.throws(()=>f.service.result(owner,{executionId:'execution',jobId:'job'}),{status:503});
  await fs.rm(path.join(directory,'result.json'));await fs.rm(directory,{recursive:true});
  assert.throws(()=>f.service.result(owner,{executionId:'execution',jobId:'job'}),{status:503});
  await assert.rejects(read('stdout'),{status:503});
});

test('absence is an error when the processing root was swapped',async t=>{
  const f=await fixture(t,'process.exit(0)');await f.prepare();
  f.service.terminal=()=>{throw new Error('injected terminal failure');};
  await f.service.start(owner,{executionId:'execution',jobId:'job'});assert.equal(await terminal(f.service),'failed');
  const root=f.service.root,moved=root+'-moved';
  await fs.rename(root,moved);await fs.mkdir(path.join(root,path.basename(f.service.directory({execution_id:'execution',job_id:'job'}))),{recursive:true});
  try {assert.throws(()=>f.service.result(owner,{executionId:'execution',jobId:'job'}),{status:503});
    await assert.rejects(f.service.dispatch('scriptahub_skill_job_read',owner,{executionId:'execution',jobId:'job',kind:'stdout',offset:0,length:1}),{status:503});}
  finally {await fs.rm(root,{recursive:true,force:true});await fs.rename(moved,root);}
});

async function fallbackJob(t) {
  const f=await fixture(t,"require('fs').writeFileSync(process.argv[1]+'/out.txt','data')");await f.prepare();
  f.service.terminal=()=>{throw new Error('injected terminal failure');};
  await f.service.start(owner,{executionId:'execution',jobId:'job'});assert.equal(await terminal(f.service),'failed');
  const directory=f.service.directory(f.service.jobs.row(owner,'execution','job'));
  return {...f,directory,result:()=>f.service.result(owner,{executionId:'execution',jobId:'job'})};
}
test('a missing result.json with real outputs is rebuilt, persisted and served, and its files can be retrieved before release',async t=>{
  const f=await fallbackJob(t);await fs.rm(path.join(f.directory,'result.json'));
  const page=f.result();assert.equal(page.absent,undefined);assert.deepEqual(page.files,[{path:'out.txt',size:4,sha256:hash('data')}]);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(f.directory,'result.json'),'utf8')),page.files);
  assert.equal(Buffer.from(f.service.read(owner,{executionId:'execution',jobId:'job',kind:'file',path:'out.txt',offset:0,length:10}).data,'base64').toString(),'data');
  assert.equal(f.service.release(owner,{executionId:'execution',jobId:'job',resultDigest:page.resultDigest}).artifactsReleased,true);
});

test('a failed persist of the rebuilt inventory is a transient error, not absence',async t=>{
  const f=await fallbackJob(t),fsSync=(await import('node:fs')).default;await fs.rm(path.join(f.directory,'result.json'));
  const original=fsSync.renameSync;
  fsSync.renameSync=function(from,...args) {if(String(from).endsWith('result.json.tmp'))throw Object.assign(new Error('injected'),{code:'ENOSPC'});return original.call(this,from,...args);};
  try {assert.throws(()=>f.result(),{status:503});} finally {fsSync.renameSync=original;}
  await assert.rejects(fs.stat(path.join(f.directory,'result.json')),{code:'ENOENT'});assert.equal(f.service.jobs.row(owner,'execution','job').cleanup_requested,0);
  assert.equal(f.result().files.length,1);
});

test('an uninventoriable task is absent and flagged outputsUnretrievable, while an empty task is plain absence',async t=>{
  const f=await fallbackJob(t);await fs.rm(path.join(f.directory,'result.json'));
  await fs.symlink('out.txt',path.join(f.directory,'task','link'));
  const page=f.result();assert.equal(page.absent,true);assert.equal(page.outputsUnretrievable,true);assert.deepEqual(page.files,[]);
  await fs.rm(path.join(f.directory,'task'),{recursive:true});await fs.mkdir(path.join(f.directory,'task'));
  const empty=f.result();assert.equal(empty.absent,true);assert.equal(empty.outputsUnretrievable,undefined);
});

test('cached log metadata is revalidated: a deleted log is absent and a changed one is unavailable',async t=>{
  const f=await fallbackJob(t);const read=()=>f.service.read(owner,{executionId:'execution',jobId:'job',kind:'stdout',offset:0,length:10});
  assert.equal(read().eof,true);
  await fs.writeFile(path.join(f.directory,'stdout'),'changed');assert.throws(read,{status:503});
  assert.equal(read().size,7);
  await fs.rm(path.join(f.directory,'stdout'));const gone=read();assert.equal(gone.absent,true);assert.equal(gone.resultDigest,f.service.jobs.row(owner,'execution','job').result_digest);
  assert.equal(f.service.release(owner,{executionId:'execution',jobId:'job',resultDigest:gone.resultDigest}).artifactsReleased,true);
});

test('release removes worker directories left read-only without following links',async t=>{
  const {execFileSync}=await import('node:child_process');
  const f=await fixture(t,"const fs=require('fs'),d=process.argv[1];fs.mkdirSync(d+'/ro/inner',{recursive:true});fs.writeFileSync(d+'/ro/inner/f','x');fs.symlinkSync(d+'/../../outside',d+'/ro/link');fs.chmodSync(d+'/ro/inner',0o555);fs.chmodSync(d+'/ro',0o555)");
  await f.prepare();const outside=path.join(f.service.root,'outside');await fs.mkdir(outside);await fs.writeFile(path.join(outside,'keep'),'k');await fs.chmod(outside,0o555);
  await f.service.start(owner,{executionId:'execution',jobId:'job'});await terminal(f.service);
  const row=f.service.jobs.row(owner,'execution','job'),directory=f.service.directory(row);
  try {
    const released=f.service.release(owner,{executionId:'execution',jobId:'job',resultDigest:row.result_digest});
    assert.equal(released.artifactsReleased,true);await assert.rejects(fs.lstat(directory),{code:'ENOENT'});
    assert.equal(f.service.jobs.row(owner,'execution','job').reserved_bytes,0);
    assert.equal(await fs.readFile(path.join(outside,'keep'),'utf8'),'k');assert.equal((await fs.stat(outside)).mode&0o777,0o555);
  } finally {try {execFileSync('/bin/chmod',['-R','u+rwx',f.service.root]);} catch {}}
});

async function lockedJob(t) {
  const f=await fixture(t,"const fs=require('fs'),d=process.argv[1];if(!fs.existsSync(d+'/../../../first')){fs.writeFileSync(d+'/../../../first','');fs.mkdirSync(d+'/locked/inner',{recursive:true});fs.writeFileSync(d+'/locked/inner/f','payload');fs.chmodSync(d+'/locked/inner',0);fs.chmodSync(d+'/locked',0)}else setTimeout(()=>fs.writeFileSync(d+'/out.txt','ok'),600)");
  return f;
}
test('a worker that leaves mode-000 directories does not stop later jobs or startup, and release removes them',async t=>{
  const f=await lockedJob(t);await f.prepare();await f.service.start(owner,{executionId:'execution',jobId:'job'});
  await terminal(f.service);const row=f.service.jobs.row(owner,'execution','job'),directory=f.service.directory(row);
  assert.equal((await fs.stat(path.join(directory,'task/locked'))).mode&0o777,0o700);
  await second(f);await f.service.start(owner,{executionId:'execution2',jobId:'job2'});
  const later=await waitFor(f.service,'execution2','job2');assert.equal(later.state,'succeeded',later.reason);
  await f.service.drain();
  const reopened=new ProcessingService(path.join(f.root,'data'),{runtimeRoot:path.join(f.root,'runtime')});
  try {
    const kept=reopened.jobs.row(owner,'execution','job');assert.ok(kept.reserved_bytes>=7);
    const released=reopened.release(owner,{executionId:'execution',jobId:'job',resultDigest:kept.result_digest});
    assert.equal(released.artifactsReleased,true);await assert.rejects(fs.lstat(directory),{code:'ENOENT'});assert.equal(reopened.jobs.row(owner,'execution','job').reserved_bytes,0);
  } finally {await reopened.drain();}
});

test('an already retained tree with an unreadable directory is repaired or charged without failing startup',async t=>{
  const f=await lockedJob(t);await f.prepare();
  const row=f.service.jobs.row(owner,'execution','job'),directory=f.service.directory(row),locked=path.join(directory,'task/locked');
  await fs.mkdir(path.join(locked,'inner'),{recursive:true});await fs.writeFile(path.join(locked,'inner/f'),'payload');await fs.writeFile(path.join(directory,'stdout'),'12345');
  await fs.chmod(path.join(locked,'inner'),0);await fs.chmod(locked,0);await f.service.drain();
  const reopened=new ProcessingService(path.join(f.root,'data'),{runtimeRoot:path.join(f.root,'runtime')});
  try {
    assert.ok(reopened.jobs.row(owner,'execution','job').reserved_bytes>=12);assert.equal((await fs.stat(locked)).mode&0o777,0o700);
    // If repair is impossible the job is charged at least its reservation and the service keeps running.
    const fsSync=(await import('node:fs')).default,original=fsSync.chmodSync;
    await fs.chmod(locked,0);fsSync.chmodSync=function(filename,...args) {if(String(filename).endsWith('/locked'))throw Object.assign(new Error('injected'),{code:'EPERM'});return original.call(this,filename,...args);};
    try {reopened.store.db.prepare('UPDATE task_processing_jobs SET reserved_bytes=? WHERE job_id=?').run(999,'job');assert.ok(reopened.diskUsage()>=999);} finally {fsSync.chmodSync=original;}
  } finally {await reopened.drain();}
});

test('later jobs reuse verified released outputs and upload only changed inputs, including an interrupted retry',async t=>{
  const f=await fixture(t,"console.log('status checked')"),book=Buffer.from('unchanged book'),draft=Buffer.from('first draft');
  const entries=[{path:'book.html',size:book.length,sha256:hash(book)},{path:'draft.json',size:draft.length,sha256:hash(draft)}];
  const manifest=Buffer.from(JSON.stringify(entries));
  const first={...f.request,manifestSha256:hash(manifest),manifestSize:manifest.length};
  await f.service.prepare(owner,first);
  const initial=f.service.upload(owner,{executionId:'execution',jobId:'job',kind:'manifest',offset:0,data:manifest.toString('base64')});
  assert.deepEqual(initial.availableFiles,[]);
  for(const [index,bytes] of [book,draft].entries())f.service.upload(owner,{executionId:'execution',jobId:'job',kind:'file',path:entries[index].path,offset:0,data:bytes.toString('base64')});
  await f.service.start(owner,{executionId:'execution',jobId:'job'});assert.equal(await terminal(f.service),'succeeded');
  const result=f.service.result(owner,{executionId:'execution',jobId:'job'});
  assert.equal(f.service.release(owner,{executionId:'execution',jobId:'job',resultDigest:result.resultDigest}).artifactsReleased,true);
  const changed=Buffer.from('updated draft'),nextEntries=[entries[0],{path:'draft.json',size:changed.length,sha256:hash(changed)}],nextManifest=Buffer.from(JSON.stringify(nextEntries));
  const second={...first,jobId:'next',manifestSha256:hash(nextManifest),manifestSize:nextManifest.length};
  await f.service.prepare(owner,second);
  const upload=()=>f.service.upload(owner,{executionId:'execution',jobId:'next',kind:'manifest',offset:0,data:nextManifest.toString('base64')});
  assert.deepEqual(upload().availableFiles,[0]);
  assert.deepEqual(upload().availableFiles,[0],'retry keeps the verified restored input');
  f.service.upload(owner,{executionId:'execution',jobId:'next',kind:'file',path:'draft.json',offset:0,data:changed.toString('base64')});
  assert.deepEqual(upload().availableFiles,[0,1],'fully uploaded changed input is also reusable on retry');
  const directory=f.service.directory(f.service.jobs.row(owner,'execution','next'));
  assert.equal(await fs.readFile(path.join(directory,'task/book.html'),'utf8'),'unchanged book');
  assert.equal(await fs.readFile(path.join(directory,'task/draft.json'),'utf8'),'updated draft');
  await assert.rejects(f.service.prepare('agent:other',second),{status:404});
});
