import {ProcessingInputCache,inputCacheBytes} from './processing-input-cache.mjs';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { DashboardStore } from './dashboard-store.mjs';
import { TaskExecution } from './task-execution.mjs';
import { ProcessingStore } from './processing-store.mjs';
import { processingRuntime } from './processing-runtime.mjs';
import { parseProcessingManifest, processingPath, uploadProcessingChunk, verifyProcessingFile } from './processing-files.mjs';
import { sandboxCommand, validateSkillCommand } from './processing-sandbox.mjs';
import { processingSocketPath } from './processing-ipc.mjs';

const MAX_WORKSPACE=4*1024**3, FLOOR=1024**3, MAX_LOG=16*1024**2, MAX_STORED=MAX_WORKSPACE+48*1024**2;
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const fail = (message,status=400) => { throw Object.assign(new Error(message),{status}); };
const time = () => new Date().toISOString();
function processIdentity(pid) {
  try {
    if(process.platform==='linux') {
      const stat=fs.readFileSync(`/proc/${pid}/stat`,'utf8'), start=stat.slice(stat.lastIndexOf(')')+2).split(' ')[19];
      return `${fs.readFileSync('/proc/sys/kernel/random/boot_id','utf8').trim()}:${pid}:${start}`;
    }
    process.kill(pid,0); return `pid:${pid}`;
  } catch(error) {if(error.code==='ENOENT'||error.code==='ESRCH')return null;throw error;}
}
const required = (input,keys,optional=[]) => {
  if (!input || typeof input !== 'object' || Array.isArray(input) || keys.some(key=>!Object.hasOwn(input,key))
    || Object.keys(input).some(key=>!keys.includes(key)&&!optional.includes(key))) fail('Invalid processing request');
};
const terminalStates=new Set(['succeeded','failed','cancelled','interrupted']);
const present = row => ({jobId:row.job_id,state:row.state,runtimeId:row.runtime_id,exitCode:row.exit_code,reason:row.reason,outputReady:terminalStates.has(row.state),resultDigest:row.result_digest,diagnosticsComplete:row.diagnostics_complete===1,cleanupPending:!!row.cleanup_requested&&!row.released_at,artifactsReleased:!!row.released_at});
function inventory(root) {
  const files=[]; let total=0;
  const visit=relative=>{
    for(const item of fs.readdirSync(path.join(root,relative),{withFileTypes:true})) {
      const name=relative ? relative+'/'+item.name : item.name; processingPath(name);
      const filename=path.join(root,name), st=fs.lstatSync(filename);
      if(st.isDirectory()&&!st.isSymbolicLink()) visit(name);
      else if(st.isFile()&&st.nlink===1) {
        total+=st.size;
        if(st.size>512*1024**2 || total>MAX_WORKSPACE || files.length>=10000) throw new Error('Workspace limit exceeded');
        const fd=fs.openSync(filename,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW), h=crypto.createHash('sha256');
        try {const buf=Buffer.alloc(65536);let n,pos=0;while((n=fs.readSync(fd,buf,0,buf.length,pos))) {h.update(buf.subarray(0,n));pos+=n;} if(pos!==st.size)throw new Error('Workspace changed');fs.fsyncSync(fd);}
        finally {fs.closeSync(fd);}
        files.push({path:name,size:st.size,sha256:h.digest('hex')});
      } else throw new Error('Unsupported workspace entry');
    }
  };
  visit(''); files.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0); return {files,total};
}
function usedBytes(root) {
  let total=0; const visit=directory=>{for(const item of fs.readdirSync(directory,{withFileTypes:true})) {
    const filename=path.join(directory,item.name),st=fs.lstatSync(filename);
    if(st.isDirectory()&&!st.isSymbolicLink())visit(filename);
    else if(st.isFile()&&st.nlink===1) total+=st.size;
    else throw new Error('Unsupported workspace entry');
  }}; visit(root); return total;
}
// Measure retained logical sizes without following links. Counting every hardlink
// is conservative; unsupported entries fail startup rather than hiding usage.
function retainedBytes(root,{dev,progress={total:0}}={}) {
  // With dev set, a real same-device directory that cannot be listed (EACCES/EPERM) is repaired once (chmod 0700, never through
  // a link); progress.total keeps the bytes measured so far for callers that cannot complete the measurement.
  const repair=(directory,error)=>{
    if(dev===undefined||error.handled||!['EACCES','EPERM'].includes(error.code))return false;
    const st=fs.lstatSync(directory);if(!st.isDirectory()||st.isSymbolicLink()||st.dev!==dev)return false;
    fs.chmodSync(directory,0o700);return true;
  };
  const visit=directory=>{for(let attempt=0;;attempt++) {
    try {
      for(const item of fs.readdirSync(directory,{withFileTypes:true})) {
        const filename=path.join(directory,item.name),st=fs.lstatSync(filename);
        if(st.isDirectory()&&!st.isSymbolicLink())visit(filename);
        else if(st.isFile()||st.isSymbolicLink()) {
          if(!Number.isSafeInteger(st.size)||st.size<0||!Number.isSafeInteger(progress.total+st.size))throw new Error('Unmeasurable retained storage');
          progress.total+=st.size;
        } else if(st.isFIFO()||st.isSocket()) { /* No file payload to charge. */ }
        else throw new Error('Unmeasurable retained storage');
      }
      return;
    } catch(error) {if(attempt||!repair(directory,error)){if(attempt)error.handled=true;throw error;}}
  }};
  try {const stat=fs.lstatSync(root);if(!stat.isDirectory()||stat.isSymbolicLink())throw new Error('Unmeasurable retained storage');}
  catch(error){if(error.code==='ENOENT')return 0;throw error;}
  visit(root);return progress.total;
}
// A worker may leave read-only directories that would block removal. Only real directories on the root's device are made
// writable; symlinks and other devices are never followed.
function makeWritable(directory,dev) {
  const st=fs.lstatSync(directory);if(!st.isDirectory()||st.isSymbolicLink()||st.dev!==dev)return;
  fs.chmodSync(directory,0o700);
  for(const item of fs.readdirSync(directory,{withFileTypes:true}))if(item.isDirectory())makeWritable(path.join(directory,item.name),dev);
}
function freeBytes(root) { const st=fs.statfsSync(root,{bigint:true}); return Number(st.bavail*st.bsize); }

export class ProcessingService {
  constructor(dataDir,{runtimeRoot='/opt/scriptahub/runtime',launch=sandboxCommand}={}) {
    this.dataDir=dataDir; this.root=path.join(dataDir,'processing'); this.runtimeRoot=runtimeRoot; this.launch=launch;
    fs.mkdirSync(this.root,{recursive:true,mode:0o700}); fs.chmodSync(this.root,0o700);
    const rootStat=fs.lstatSync(this.root);if(!rootStat.isDirectory()||rootStat.isSymbolicLink())fail('Invalid processing storage',503);
    this.rootIdentity={dev:rootStat.dev,ino:rootStat.ino};
    this.store=new DashboardStore(dataDir); this.tasks=new TaskExecution(this.store,dataDir); this.jobs=new ProcessingStore(this.tasks);
    this.children=new Map(); this.logMetadata=new Map(); this.draining=false; this.receipt=null;
    this.available=freeBytes;this.durationMs=2*60*60*1000;
    this.owner=processIdentity(process.pid);
    this.store.db.exec('CREATE TABLE IF NOT EXISTS processing_supervisor (id INTEGER PRIMARY KEY CHECK(id=1), pid INTEGER NOT NULL, identity TEXT NOT NULL)');
    try {this.store.transaction(()=>{
      const old=this.store.db.prepare('SELECT pid,identity FROM processing_supervisor WHERE id=1').get();
      if(old && processIdentity(old.pid)===old.identity) fail('Processing supervisor is already running',503);
      this.store.db.prepare('INSERT OR REPLACE INTO processing_supervisor(id,pid,identity) VALUES(1,?,?)').run(process.pid,this.owner);
    });} catch(error) {this.store.close();throw error;}
    try {this.cache=new ProcessingInputCache(dataDir,this.store.db);this.store.transaction(()=>{
      const rows=this.store.db.prepare('SELECT * FROM task_processing_jobs').all();
      const expected=new Set(rows.map(row=>path.basename(this.directory(row))));
      for(const item of fs.readdirSync(this.root,{withFileTypes:true})) {
        if(expected.has(item.name))continue;
        // A crashed preflight may leave an empty service-owned mount point.
        if(item.name.startsWith('preflight-')&&item.isDirectory()&&!item.isSymbolicLink()
          &&retainedBytes(path.join(this.root,item.name))===0)continue;
        throw new Error('Unattributed retained storage');
      }
      const update=this.store.db.prepare('UPDATE task_processing_jobs SET reserved_bytes=? WHERE execution_id=? AND job_id=?');
      for(const row of rows) {
        if(!Number.isSafeInteger(row.reserved_bytes)||row.reserved_bytes<0)throw new Error('Invalid retained reservation');
        const directory=this.directory(row);
        if(row.released_at) {try {fs.lstatSync(directory);throw new Error('Released storage reappeared');}catch(error){if(error.code!=='ENOENT')throw error;}}
        const actual=this.measureRetained(directory,row.reserved_bytes);
        update.run(Math.max(row.reserved_bytes,actual),row.execution_id,row.job_id);
      }
      this.store.db.prepare("UPDATE task_processing_jobs SET state='interrupted',reason='Supervisor restarted',updated_at=? WHERE state IN ('starting','running','stopping')").run(time());
    });this.recoverReceipts();this.resumeCleanup();} catch(error) {
      try {this.store.db.prepare('DELETE FROM processing_supervisor WHERE id=1 AND pid=? AND identity=?').run(process.pid,this.owner);} finally {this.store.close();}
      console.error('Processing storage reconciliation failed:',error.message);
      fail('Retained processing storage cannot be reconciled',503);
    }
    this.cleanupTimer=setInterval(()=>{try{this.expireUploads();this.resumeCleanup();this.cache.prune();}catch{console.error('Processing cleanup retry failed');}},60000);this.cleanupTimer.unref();
    this.uploadMonitor=setInterval(()=>this.cancelStoppedUploads(),250);this.uploadMonitor.unref();
  }
  // Measures a retained job directory. A directory that stays unreadable after repair must not stop other jobs or startup:
  // the job is charged at least its stored reservation and what was measured, and flagged in the log.
  measureRetained(directory,reserved) {
    const progress={total:0};
    try {return retainedBytes(directory,{dev:this.rootIdentity.dev,progress});}
    catch(error) {if(!['EACCES','EPERM'].includes(error.code))throw error;console.error('Retained job storage needs attention');return Math.max(reserved,progress.total);}
  }
  directory(row) {return path.join(this.root,'job-'+hash(row.execution_id+'\0'+row.job_id));}
  async preflight() {
    const runtime=await processingRuntime(this.runtimeRoot);
    if(this.receipt?.runtimeId===runtime.runtimeId && Date.now()-Date.parse(this.receipt.checkedAt)<15*60*1000) return this.receipt;
    if(this.draining)fail('Processing supervisor is draining',503);
    if(!this.preflightPromise) {
      if(this.store.db.prepare("SELECT 1 FROM task_processing_jobs WHERE state IN ('starting','running','stopping')").get()) {
        // A job holds the worker slot, so verifying again is unsafe; the runtime it started on was already verified.
        // The runtime identity was just rechecked; the doctor result is reported with its original time.
        if(this.receipt?.runtimeId===runtime.runtimeId)return {...this.receipt,checkedAt:time(),doctorCheckedAt:this.receipt.doctorCheckedAt??this.receipt.checkedAt,cachedWhileBusy:true};
        fail('Processing capacity unavailable',503);
      }
      const runCheck=(command,args)=>new Promise((resolve,reject)=>{
        const child=spawn(command,args,{detached:true,stdio:['ignore','pipe','pipe'],
          env:{PATH:'/usr/local/bin:/usr/bin:/bin',HOME:'/tmp',TMPDIR:'/tmp',HF_HUB_OFFLINE:'1',TRANSFORMERS_OFFLINE:'1'}});
        this.preflightChild=child;let bytes=0,failed=false;
        const kill=()=>{failed=true;try{process.kill(-child.pid,'SIGKILL');}catch{}};
        for(const stream of [child.stdout,child.stderr])stream.on('data',chunk=>{bytes+=chunk.length;if(bytes>1024*1024)kill();});
        const timer=setTimeout(kill,600000);child.once('error',()=>{failed=true;});
        child.once('close',code=>{clearTimeout(timer);this.preflightChild=null;code===0&&!failed?resolve():reject(new Error('Runtime verification failed'));});
      });
      this.preflightPromise=(async()=>{
        const directory=fs.mkdtempSync(path.join(this.root,'preflight-'));
        try {
          const plan=this.launch({virtualCwd:'/workspace/scriptahub-preflight',taskId:'preflight',jobDirectory:directory,skill:'pdf2html',args:['doctor'],input:''});
          const separator=plan.args.lastIndexOf('--');
          if(separator<0)throw new Error('Invalid sandbox launcher');
          plan.args.splice(separator+1,plan.args.length-separator-1,'/usr/local/bin/node','/opt/scriptahub/runtime/verify-skills.mjs','/opt/scriptahub/runtime');
          await runCheck(plan.command,plan.args);
        } finally {fs.rmSync(directory,{recursive:true,force:true});}
      })().finally(()=>{this.preflightPromise=null;});
    }
    try {await this.preflightPromise;} catch {fail('ScriptaHub processing runtime verification failed',503);}
    if(this.draining)fail('Processing supervisor is draining',503);
    const current=await processingRuntime(this.runtimeRoot);
    if(current.runtimeId!==runtime.runtimeId)fail('ScriptaHub processing runtime changed',503);
    return this.receipt={ok:true,...runtime,checks:[{status:'passed',name:'installed-runtime'}],checkedAt:time()};
  }
  async prepare(executor,input) {
    required(input,['executionId','jobId','virtualCwd','skill','args','input','sourceDigest','manifestSha256','manifestSize']);
    validateSkillCommand(input.skill,input.args,input.input);
    if(!/^[a-f0-9]{64}$/.test(input.sourceDigest||'')||!/^[a-f0-9]{64}$/.test(input.manifestSha256||'')
      ||!Number.isSafeInteger(input.manifestSize)||input.manifestSize<2||input.manifestSize>8*1024**2)fail('Invalid processing manifest');
    const existing=this.store.db.prepare('SELECT * FROM task_processing_jobs WHERE execution_id=? AND job_id=? AND executor_agent_id=?').get(input.executionId,input.jobId,executor);
    if(existing) {
      const row=this.jobs.prepare(executor,input,existing.runtime_id,existing.reserved_bytes);
      if(row.state==='uploading')this.initializeUpload(row);
      return present(row);
    }
    const runtime=await processingRuntime(this.runtimeRoot);
    if(runtime.sourceDigests[input.skill]!==input.sourceDigest) fail('Skill source does not match installed runtime',409);
    if(this.draining)fail('Processing supervisor is draining',503);
    if(this.available(this.root)<FLOOR+input.manifestSize)fail('Processing storage unavailable',503);
    const row=this.jobs.prepare(executor,input,runtime.runtimeId,input.manifestSize);
    if(row.state==='uploading')this.initializeUpload(row);
    return present(row);
  }
  initializeUpload(row) {
    const directory=this.directory(row);
    for(const filename of [directory,path.join(directory,'task')]) {
      try {fs.mkdirSync(filename,{mode:0o700});} catch(error) {if(error.code!=='EEXIST')throw error;}
      const stat=fs.lstatSync(filename);
      if(!stat.isDirectory()||stat.isSymbolicLink())fail('Processing storage unavailable',503);
    }
  }
  manifest(row) {
    const request=JSON.parse(row.request), file=path.join(this.directory(row),'manifest');
    let bytes;try {bytes=fs.readFileSync(file);} catch {fail('Processing manifest is incomplete',409);}
    return parseProcessingManifest(bytes,request.manifestSha256,request.manifestSize);
  }
  upload(executor,input) {
    required(input,['executionId','jobId','kind','offset','data'],['path']);
    const row=this.jobs.row(executor,input.executionId,input.jobId), request=JSON.parse(row.request);
    if(row.state!=='uploading'||this.tasks.execution(executor,input.executionId).state!=='running')fail('Job is not accepting uploads',409);
    if(this.available(this.root)<FLOOR+65536)fail('Processing storage unavailable',503);
    const directory=this.directory(row);
    if(input.kind==='manifest' && input.path===undefined) {
      const nextOffset=uploadProcessingChunk(directory,'manifest',request.manifestSize,input.offset,input.data);
      this.store.db.prepare('UPDATE task_processing_jobs SET updated_at=? WHERE execution_id=? AND job_id=?').run(time(),input.executionId,input.jobId);
      return {nextOffset,...(nextOffset===request.manifestSize?{availableFiles:this.reuseInputs(row)}:{})};
    }
    if(input.kind!=='file'||typeof input.path!=='string')fail('Invalid processing upload');
    const {entries,total}=this.manifest(row), entry=entries.find(value=>value.path===input.path);
    if(!entry)fail('Processing file not found',404);
    this.store.transaction(()=>{
      const current=this.jobs.row(executor,input.executionId,input.jobId);
      if(current.state!=='uploading')fail('Job is not accepting uploads',409);
      const reserved=total+request.manifestSize;
      const other=this.store.db.prepare('SELECT COALESCE(SUM(reserved_bytes),0) AS bytes FROM task_processing_jobs WHERE NOT (execution_id=? AND job_id=?)').get(input.executionId,input.jobId).bytes;
      if(other+reserved+inputCacheBytes(this.store.db)>MAX_STORED || this.available(this.root)<FLOOR+Math.max(0,reserved-current.reserved_bytes))fail('Processing storage unavailable',503);
      this.store.db.prepare('UPDATE task_processing_jobs SET reserved_bytes=? WHERE execution_id=? AND job_id=?').run(reserved,input.executionId,input.jobId);
    });
    const nextOffset=uploadProcessingChunk(path.join(directory,'task'),entry.path,entry.size,input.offset,input.data);
    this.store.db.prepare('UPDATE task_processing_jobs SET updated_at=? WHERE execution_id=? AND job_id=?').run(time(),input.executionId,input.jobId);
    return {nextOffset};
  }
  reuseInputs(row) {
    const {entries,total}=this.manifest(row),request=JSON.parse(row.request),root=path.join(this.directory(row),'task');
    this.store.transaction(()=>{
      const current=this.jobs.row(row.executor_agent_id,row.execution_id,row.job_id);
      if(current.state!=='uploading')fail('Job is not accepting uploads',409);
      const other=this.store.db.prepare('SELECT COALESCE(SUM(reserved_bytes),0) AS bytes FROM task_processing_jobs WHERE NOT (execution_id=? AND job_id=?)').get(row.execution_id,row.job_id).bytes;
      this.cache.prune(Math.max(0,MAX_STORED-other-total-request.manifestSize));
      if(other+total+request.manifestSize+inputCacheBytes(this.store.db)>MAX_STORED || this.available(this.root)<FLOOR+total)fail('Processing storage unavailable',503);
      this.store.db.prepare('UPDATE task_processing_jobs SET reserved_bytes=? WHERE execution_id=? AND job_id=?').run(total+request.manifestSize,row.execution_id,row.job_id);
    });
    const available=[];
    entries.forEach((entry,index)=>{
      try {verifyProcessingFile(root,entry);available.push(index);return;}catch(error){if(error.code!=='ENOENT' && error.status!==409)throw error;}
      if(this.cache.restore(row.executor_agent_id,row.execution_id,root,entry))available.push(index);
    });
    return available;
  }
  async start(executor,input) {
    required(input,['executionId','jobId']);
    let row=this.jobs.row(executor,input.executionId,input.jobId);
    if(row.state!=='uploading')return present(row);
    if(this.draining)fail('Processing supervisor is draining',503);
    if(this.preflightPromise||this.store.db.prepare("SELECT 1 FROM task_processing_jobs WHERE state IN ('starting','running','stopping')").get())fail('Processing capacity unavailable',503);
    const request=JSON.parse(row.request), runtime=await processingRuntime(this.runtimeRoot);
    if(this.preflightPromise)fail('Processing capacity unavailable',503);
    if(this.draining)fail('Processing supervisor is draining',503);
    if(runtime.runtimeId!==row.runtime_id||runtime.sourceDigests[request.skill]!==request.sourceDigest)fail('Processing runtime changed',409);
    const {entries,total}=this.manifest(row), directory=this.directory(row), task=path.join(directory,'task');
    for(const entry of entries) {
      if(entry.size===0) {const target=path.join(task,entry.path);fs.mkdirSync(path.dirname(target),{recursive:true,mode:0o700});try {fs.writeFileSync(target,Buffer.alloc(0),{flag:'wx',mode:0o600});}catch(error){if(error.code!=='EEXIST')throw error;}}
      verifyProcessingFile(task,entry);
    }
    if(this.available(this.root)<FLOOR+MAX_WORKSPACE)fail('Processing storage unavailable',503);
    this.store.transaction(()=>{
      const current=this.jobs.row(executor,input.executionId,input.jobId);
      if(current.state!=='uploading')fail('Processing job changed',409);
      const other=this.store.db.prepare('SELECT COALESCE(SUM(reserved_bytes),0) AS bytes FROM task_processing_jobs WHERE NOT (execution_id=? AND job_id=?)').get(input.executionId,input.jobId).bytes;
      if(other+total+request.manifestSize+inputCacheBytes(this.store.db)>MAX_STORED)fail('Processing storage unavailable',503);
      this.store.db.prepare('UPDATE task_processing_jobs SET reserved_bytes=? WHERE execution_id=? AND job_id=?').run(total+request.manifestSize,input.executionId,input.jobId);
    });
    const execution=this.tasks.execution(executor,input.executionId);
    const plan=this.launch({virtualCwd:request.virtualCwd,taskId:execution.task_id,jobDirectory:task,skill:request.skill,args:request.args,input:request.input});
    row=this.jobs.start(executor,input.executionId,input.jobId);
    if(row.state!=='starting')return present(row);
    try {for(const name of ['stdout','stderr']) fs.writeFileSync(path.join(directory,name),'',{mode:0o600});}
    catch {this.fallbackTerminal(row,'Worker storage unavailable',null,"('starting')");return present(this.jobs.row(executor,input.executionId,input.jobId));}
    let child;
    try {child=spawn(plan.command,plan.args,{stdio:['pipe','pipe','pipe'],detached:true,env:{PATH:'/usr/local/bin:/usr/bin:/bin'}});}
    catch {this.terminal(row,'failed','Worker could not start',null,[]);return present(this.jobs.row(executor,input.executionId,input.jobId));}
    const key=input.executionId+'\0'+input.jobId, record={child,row,logBytes:0,reason:null,closing:false}; this.children.set(key,record);
    for(const name of ['stdout','stderr']) child[name].on('data',bytes=>{
      if(record.logBytes+bytes.length>MAX_LOG){this.stop(record,'Log limit exceeded');return;}
      try {fs.appendFileSync(path.join(directory,name),bytes);record.logBytes+=bytes.length;}catch {this.stop(record,'Log storage failed');}
    });
    child.stdin.on('error',()=>{}); child.stdin.end(request.input);
    child.once('error',()=>this.stop(record,'Worker could not start'));
    child.once('close',(code,signal)=>this.closed(key,record,code,signal));
    record.deadline=setTimeout(()=>this.stop(record,'Time limit exceeded'),this.durationMs);
    record.monitor=setInterval(()=>{
      try {
        const state=this.tasks.execution(executor,input.executionId).state;
        if(state!=='running')return this.stop(record,'Task stop requested',true);
        if(this.diskUsage()>MAX_STORED||this.available(this.root)<FLOOR) return this.stop(record,'Workspace storage limit exceeded');
      } catch {this.stop(record,'Workspace monitor failed');}
    },100);
    try {this.store.db.prepare("UPDATE task_processing_jobs SET state='running',updated_at=? WHERE execution_id=? AND job_id=? AND state='starting'").run(time(),input.executionId,input.jobId);}
    catch {this.stop(record,'Worker state persistence failed');throw Object.assign(new Error('Processing state unavailable'),{status:503});}
    return present(this.jobs.row(executor,input.executionId,input.jobId));
  }
  // Only a running worker's directory is measured strictly; retained terminal jobs use the tolerant startup rules.
  diskUsage() {
    const running=new Set([...this.children.values()].map(record=>path.basename(this.directory(record.row))));
    const reserved=new Map(this.store.db.prepare('SELECT execution_id,job_id,reserved_bytes FROM task_processing_jobs').all().map(row=>[path.basename(this.directory(row)),row.reserved_bytes]));
    let total=0; for(const entry of fs.readdirSync(this.root,{withFileTypes:true})) {
      if(entry.name.startsWith('job-')) {if(!entry.isDirectory()||entry.isSymbolicLink()) throw new Error('Invalid retained workspace');const directory=path.join(this.root,entry.name);total+=running.has(entry.name)?usedBytes(directory):this.measureRetained(directory,reserved.get(entry.name)??0);}
    } this.cache.checkRoot();return total+inputCacheBytes(this.store.db);
  }
  // Frees the worker slot when the normal terminal record cannot be written; the receipt is marked incomplete.
  fallbackTerminal(row,reason,code,states="('starting','running','stopping')",inventory=[]) {
    // Keep any inventory a partial terminal write left; otherwise record the one already computed (or an empty one) so result.json exists and matches the digest.
    let files=inventory;const file=path.join(this.directory(row),'result.json');
    try {files=JSON.parse(fs.readFileSync(file,'utf8'));if(!Array.isArray(files))throw new Error('Invalid result inventory');}
    catch {files=inventory;try {fs.writeFileSync(file,JSON.stringify(files),{mode:0o600,flag:'wx'});} catch { /* Best effort; absence is reported explicitly. */ }}
    const exitCode=Number.isInteger(code)?code:null,digest=this.resultDigest(row,'failed',exitCode,reason,files,true);
    let bytes=row.reserved_bytes;try {bytes=Math.max(bytes,retainedBytes(this.directory(row)));} catch { /* Keep the existing charge. */ }
    this.store.transaction(()=>this.store.db.prepare(`UPDATE task_processing_jobs SET state='failed',reason=?,exit_code=?,reserved_bytes=?,result_digest=?,diagnostics_complete=0,updated_at=?
      WHERE execution_id=? AND job_id=? AND state IN ${states}`).run(reason,exitCode,bytes,digest,time(),row.execution_id,row.job_id));
  }
  stop(record,reason,cancelled=false) {
    if(record.reason)return;
    record.reason=reason;record.cancelled=cancelled;
    try {this.store.db.prepare("UPDATE task_processing_jobs SET state='stopping',reason=?,updated_at=? WHERE execution_id=? AND job_id=? AND state IN ('starting','running')").run(reason,time(),record.row.execution_id,record.row.job_id);} catch {console.error('Processing stop persistence failed');}
    try {process.kill(-record.child.pid,'SIGTERM');} catch {}
    record.killTimer=setTimeout(()=>{try {process.kill(-record.child.pid,'SIGKILL');}catch{}},2000);
  }
  closed(key,record,code,signal) {
    clearTimeout(record.deadline);clearTimeout(record.killTimer);clearInterval(record.monitor);this.children.delete(key);
    const directory=this.directory(record.row);let files=[],reason=record.reason,complete=true;
    // The worker is gone: restore directory permissions it may have removed so the retained tree stays measurable.
    try {makeWritable(directory,this.rootIdentity.dev);} catch {console.error('Retained job permissions could not be normalized');}
    try {files=inventory(path.join(directory,'task')).files;if(this.diskUsage()>MAX_STORED||this.available(this.root)<FLOOR)reason ||= 'Workspace storage limit exceeded';} catch {complete=false;reason ||= 'Output inventory failed';}
    try {if(this.tasks.execution(record.row.executor_agent_id,record.row.execution_id).state!=='running') {record.cancelled=true;reason ||= 'Task stop requested';}} catch {reason ||= 'Task state unavailable';}
    const state=record.cancelled?'cancelled':reason||code!==0||signal?'failed':'succeeded';
    try {this.terminal(record.row,state,reason,code,files,complete);} catch(error) {
      console.error('Processing terminal persistence failed');
      try {this.fallbackTerminal(record.row,reason||'Terminal persistence failed',code,undefined,files);} catch {console.error('Processing terminal fallback failed');}
    }
  }
  terminal(row,state,reason,code,files,complete=true) {
    const directory=this.directory(row);
    for(const name of ['stdout','stderr']) {const fd=fs.openSync(path.join(directory,name),'r');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
    const resultPath=path.join(directory,'result.json'),temp=resultPath+'.tmp';
    const fd=fs.openSync(temp,'w',0o600);try{fs.writeFileSync(fd,JSON.stringify(files));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
    fs.renameSync(temp,resultPath);const dirfd=fs.openSync(directory,'r');try{fs.fsyncSync(dirfd);}finally{fs.closeSync(dirfd);}
    let bytes=0;
    const count=dir=>{for(const item of fs.readdirSync(dir,{withFileTypes:true})){const filename=path.join(dir,item.name),st=fs.lstatSync(filename);if(st.isDirectory()&&!st.isSymbolicLink())count(filename);else if(st.isFile()||st.isSymbolicLink()){if(!Number.isSafeInteger(st.size)||!Number.isSafeInteger(bytes+st.size))throw new Error('Unmeasurable retained storage');bytes+=st.size;}else if(!st.isFIFO()&&!st.isSocket())throw new Error('Unmeasurable retained storage');}};
    count(directory);
    const exitCode=Number.isInteger(code)?code:null;
    const resultDigest=this.resultDigest(row,state,exitCode,reason,files);
    this.store.transaction(()=>this.store.db.prepare('UPDATE task_processing_jobs SET state=?,reason=?,exit_code=?,reserved_bytes=?,result_digest=?,diagnostics_complete=?,updated_at=? WHERE execution_id=? AND job_id=?')
      .run(state,reason,exitCode,bytes,resultDigest,complete?1:0,time(),row.execution_id,row.job_id));
  }
  resultDigest(row,state,exitCode,reason,files,ignoreLogErrors=false) {
    const directory=this.directory(row),logs={};
    for(const name of ['stdout','stderr']) {
      try {const bytes=fs.readFileSync(path.join(directory,name));logs[name]={size:bytes.length,sha256:hash(bytes)};}
      catch(error) {if(error.code!=='ENOENT'&&!ignoreLogErrors)throw error;logs[name]=null;}
    }
    return hash(JSON.stringify({executionId:row.execution_id,jobId:row.job_id,requestDigest:row.digest,
      runtimeId:row.runtime_id,state,exitCode,reason,files,stdout:logs.stdout,stderr:logs.stderr}));
  }
  recoverReceipts() {
    const rows=this.store.db.prepare("SELECT * FROM task_processing_jobs WHERE state IN ('succeeded','failed','cancelled','interrupted') AND result_digest IS NULL").all();
    for(const row of rows) {
      if(row.cleanup_requested)throw new Error('Cleanup intent has no terminal digest');
      const directory=this.directory(row),file=path.join(directory,'result.json');let files=[];
      try {files=JSON.parse(fs.readFileSync(file,'utf8'));if(!Array.isArray(files))throw new Error('Invalid result inventory');}
      catch(error) {
        files=[];
        try {files=inventory(path.join(directory,'task')).files;fs.writeFileSync(file,JSON.stringify(files),{mode:0o600});}
        catch { /* Missing or invalid evidence remains explicitly incomplete. */ }
      }
      const digest=this.resultDigest(row,row.state,row.exit_code,row.reason,files);
      this.store.db.prepare('UPDATE task_processing_jobs SET result_digest=?,diagnostics_complete=0 WHERE execution_id=? AND job_id=? AND result_digest IS NULL')
        .run(digest,row.execution_id,row.job_id);
    }
  }
  cleanup(row) {
    const name=path.basename(this.directory(row));let fd;
    try {
      fd=fs.openSync(this.root,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
      const root=fs.fstatSync(fd),current=fs.lstatSync(this.root);
      if(!root.isDirectory()||!current.isDirectory()||current.isSymbolicLink()||root.dev!==this.rootIdentity.dev||root.ino!==this.rootIdentity.ino
        ||current.dev!==root.dev||current.ino!==root.ino)throw new Error('Processing storage identity changed');
      let target=path.join(this.root,name);
      if(process.platform==='linux') {
        const anchor=`/proc/self/fd/${fd}`,anchored=fs.statSync(anchor);
        if(!anchored.isDirectory()||anchored.dev!==root.dev||anchored.ino!==root.ino)throw new Error('Processing storage anchor changed');
        target=path.join(anchor,name);
      }
      try {const stat=fs.lstatSync(target);if(!stat.isDirectory()||stat.isSymbolicLink())throw new Error('Invalid cleanup target');makeWritable(target,root.dev);fs.rmSync(target,{recursive:true});}
      catch(error) {if(error.code!=='ENOENT')throw error;}
      try {fs.lstatSync(target);throw new Error('Cleanup target remains');} catch(error) {if(error.code!=='ENOENT')throw error;}
      fs.fsyncSync(fd);
      const after=fs.lstatSync(this.root);
      if(!after.isDirectory()||after.isSymbolicLink()||after.dev!==root.dev||after.ino!==root.ino)throw new Error('Processing storage identity changed');
      this.store.transaction(()=>this.store.db.prepare(`UPDATE task_processing_jobs SET released_at=COALESCE(released_at,?),reserved_bytes=0,updated_at=?
        WHERE execution_id=? AND job_id=? AND cleanup_requested=1`).run(time(),time(),row.execution_id,row.job_id));
    } catch {return false;} finally {if(fd!==undefined)try{fs.closeSync(fd);}catch{}}
    return true;
  }
  resumeCleanup() {
    const rows=this.store.db.prepare('SELECT * FROM task_processing_jobs WHERE cleanup_requested=1 AND released_at IS NULL').all();
    for(const row of rows)this.cleanup(row);
  }
  release(executor,input) {
    required(input,['executionId','jobId','resultDigest']);
    if(!/^[a-f0-9]{64}$/.test(input.resultDigest||''))fail('Invalid result digest');
    const row=this.store.transaction(()=>{
      const current=this.jobs.row(executor,input.executionId,input.jobId);
      if(!terminalStates.has(current.state)||this.children.has(input.executionId+'\0'+input.jobId))fail('Processing job is not terminal',409);
      if(current.result_digest!==input.resultDigest)fail('Processing result digest does not match',409);
      if(!current.cleanup_requested && current.state==='succeeded' && current.diagnostics_complete===1 && this.tasks.execution(executor,input.executionId).state==='running') {
        try {
          const files=JSON.parse(fs.readFileSync(path.join(this.directory(current),'result.json'),'utf8'));
          const used=this.store.db.prepare('SELECT COALESCE(SUM(reserved_bytes),0) AS bytes FROM task_processing_jobs').get().bytes;
          const budget=Math.max(0,Math.min(MAX_STORED-used,this.available(this.root)-FLOOR));
          this.cache.retain(executor,input.executionId,path.join(this.directory(current),'task'),files,budget);
        } catch {console.error('Processing input cache unavailable; later jobs will upload their inputs.');}
      }
      if(!current.cleanup_requested)this.store.db.prepare('UPDATE task_processing_jobs SET cleanup_requested=1,updated_at=? WHERE execution_id=? AND job_id=?')
        .run(time(),input.executionId,input.jobId);
      return this.jobs.row(executor,input.executionId,input.jobId);
    });
    if(!row.released_at)this.cleanup(row);
    const current=this.jobs.row(executor,input.executionId,input.jobId);
    return {jobId:current.job_id,state:current.state,resultDigest:current.result_digest,
      cleanupPending:!!current.cleanup_requested&&!current.released_at,artifactsReleased:!!current.released_at};
  }
  cancel(executor,input) {
    required(input,['executionId','jobId']);let row=this.jobs.row(executor,input.executionId,input.jobId);
    if(row.state==='uploading') {
      row=this.store.transaction(()=>{
        const current=this.jobs.row(executor,input.executionId,input.jobId);
        if(current.state!=='uploading')return current;
        const reason='Upload cancelled',digest=this.resultDigest(current,'cancelled',null,reason,[]);
        this.store.db.prepare(`UPDATE task_processing_jobs SET state='cancelled',reason=?,result_digest=?,diagnostics_complete=0,
          cleanup_requested=1,updated_at=? WHERE execution_id=? AND job_id=?`).run(reason,digest,time(),input.executionId,input.jobId);
        return this.jobs.row(executor,input.executionId,input.jobId);
      });
      this.cleanup(row);
    } else {const record=this.children.get(input.executionId+'\0'+input.jobId);if(record)this.stop(record,'Cancelled by executor',true);}
    return present(this.jobs.row(executor,input.executionId,input.jobId));
  }
  result(executor,input) {
    required(input,['executionId','jobId'],['cursor','limit']);const row=this.jobs.row(executor,input.executionId,input.jobId);
    if(row.cleanup_requested)fail('Processing artifacts are no longer available',410);
    if(!present(row).outputReady)fail('Processing result is not ready',409);
    const cursor=input.cursor??0,limit=input.limit??100;
    if(!Number.isSafeInteger(cursor)||cursor<0||!Number.isSafeInteger(limit)||limit<1||limit>100)fail('Invalid result page');
    let files;try {files=JSON.parse(fs.readFileSync(path.join(this.directory(row),'result.json'),'utf8'));if(!Array.isArray(files))throw new Error('Invalid result');} catch(error) {
      if(!this.absentEvidence(row,error))fail('Processing result is unavailable',503);
      const rebuilt=this.rebuildInventory(row);
      if(rebuilt.absent)return {...present(row),absent:true,files:[],nextCursor:null,...(rebuilt.unretrievable?{outputsUnretrievable:true}:{})};
      files=rebuilt.files;
    }
    return {...present(row),files:files.slice(cursor,cursor+limit),nextCursor:cursor+limit<files.length?cursor+limit:null};
  }
  // A missing result.json of an incomplete job is rebuilt from the retained task files and persisted before it is served.
  // The stored result digest may come from an earlier list; clients treat it as the receipt identity and verify every listed file by hash.
  // Transient filesystem errors (including a failed persist) are 503; only a task without regular files, or one that cannot be
  // inventoried deterministically (unsupported entry, limits), is absent, the latter flagged outputsUnretrievable.
  rebuildInventory(row) {
    const directory=this.directory(row);let files;
    try {files=inventory(path.join(directory,'task')).files;}
    catch(error) {
      if(error.code==='ENOENT')return {absent:true};
      if(error.code)fail('Processing result is unavailable',503);
      return {absent:true,unretrievable:true};
    }
    if(!files.length)return {absent:true};
    const file=path.join(directory,'result.json'),temp=file+'.tmp';
    try {
      const fd=fs.openSync(temp,'w',0o600);try {fs.writeFileSync(fd,JSON.stringify(files));fs.fsyncSync(fd);} finally {fs.closeSync(fd);}
      fs.renameSync(temp,file);
    } catch {try {fs.rmSync(temp,{force:true});} catch {} fail('Processing result is unavailable',503);}
    return {files};
  }
  // Missing evidence of an incomplete job is reported as a successful payload (a failed tool call loses its details in transit).
  // It requires ENOENT, an unchanged storage root and an existing job directory, so an unmounted or swapped root is an error.
  absentEvidence(row,error) {
    if(error?.code!=='ENOENT'||row.diagnostics_complete===1)return false;
    try {
      const root=fs.lstatSync(this.root),job=fs.lstatSync(this.directory(row));
      return root.isDirectory()&&!root.isSymbolicLink()&&root.dev===this.rootIdentity.dev&&root.ino===this.rootIdentity.ino&&job.isDirectory()&&!job.isSymbolicLink();
    } catch {return false;}
  }
  read(executor,input) {
    required(input,['executionId','jobId','kind','offset','length'],['path']);const row=this.jobs.row(executor,input.executionId,input.jobId);
    if(row.cleanup_requested)fail('Processing artifacts are no longer available',410);
    if(!present(row).outputReady)fail('Processing result is not ready',409);
    if(!Number.isSafeInteger(input.offset)||input.offset<0||!Number.isSafeInteger(input.length)||input.length<1||input.length>196608)fail('Invalid result range');
    const directory=this.directory(row);let filename,entry;
    if(input.kind==='file'&&typeof input.path==='string') {
      processingPath(input.path);const all=JSON.parse(fs.readFileSync(path.join(directory,'result.json'),'utf8'));entry=all.find(x=>x.path===input.path);if(!entry)fail('Processing file not found',404);
      let parent=path.join(directory,'task');const parts=input.path.split('/');
      for(const part of parts.slice(0,-1)) {parent=path.join(parent,part);const st=fs.lstatSync(parent);if(!st.isDirectory()||st.isSymbolicLink())fail('Result unavailable',503);}
      filename=path.join(parent,parts.at(-1));const fd=fs.openSync(filename,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
      try {const st=fs.fstatSync(fd);if(!st.isFile()||st.nlink!==1||st.size!==entry.size)fail('Result unavailable',503);}finally{fs.closeSync(fd);}
    }
    else if(['stdout','stderr'].includes(input.kind)&&input.path===undefined){
      filename=path.join(directory,input.kind);entry=this.logMetadata.get(filename);
      // Cached metadata is revalidated: a missing log goes through the same absence gate and a changed one is unavailable.
      if(entry) {
        let st;try {st=fs.lstatSync(filename);} catch(error) {this.logMetadata.delete(filename);if(this.absentEvidence(row,error))return {...present(row),absent:true,kind:input.kind};fail('Processing log is unavailable',503);}
        if(!st.isFile()||st.size!==entry.size||st.ino!==entry.ino){this.logMetadata.delete(filename);fail('Processing log is unavailable',503);}
      }
      if(!entry) {try {const bytes=fs.readFileSync(filename);entry={size:bytes.length,sha256:hash(bytes),ino:fs.lstatSync(filename).ino};}catch(error) {if(this.absentEvidence(row,error))return {...present(row),absent:true,kind:input.kind};fail('Processing log is unavailable',503);}this.logMetadata.set(filename,entry);}
    }
    else fail('Invalid result kind');
    if(input.offset>entry.size)fail('Invalid result range');
    const length=Math.min(input.length,entry.size-input.offset),bytes=Buffer.alloc(length);
    if(length){const fd=fs.openSync(filename,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);try{if(fs.readSync(fd,bytes,0,length,input.offset)!==length)fail('Result unavailable',503);}finally{fs.closeSync(fd);}}
    return {data:bytes.toString('base64'),encoding:'base64',size:entry.size,sha256:entry.sha256,offset:input.offset,nextOffset:input.offset+length,eof:input.offset+length===entry.size};
  }
  async dispatch(tool,executor,input) {
    if(tool==='scriptahub_skills_preflight'){required(input,[]);return this.preflight();}
    if(tool==='scriptahub_skill_job_prepare')return this.prepare(executor,input);
    if(tool==='scriptahub_skill_job_upload')return this.upload(executor,input);
    if(tool==='scriptahub_skill_job_start')return this.start(executor,input);
    if(tool==='scriptahub_skill_job_status'){required(input,['executionId','jobId']);return present(this.jobs.row(executor,input.executionId,input.jobId));}
    if(tool==='scriptahub_skill_job_result')return this.result(executor,input);
    if(tool==='scriptahub_skill_job_read')return this.read(executor,input);
    if(tool==='scriptahub_skill_job_cancel')return this.cancel(executor,input);
    if(tool==='scriptahub_skill_job_release')return this.release(executor,input);
    fail('Invalid processing operation');
  }
  cancelStoppedUploads() {
    try {
      const rows=this.store.db.prepare(`SELECT j.* FROM task_processing_jobs j JOIN task_executions e ON e.id=j.execution_id
        JOIN tasks t ON t.id=e.task_id WHERE j.state='uploading' AND t.state<>'running'`).all();
      for(const row of rows) this.cancel(row.executor_agent_id,{executionId:row.execution_id,jobId:row.job_id});
    } catch {console.error('Stopped upload cleanup failed');}
  }
  expireUploads() {
    const cutoff=new Date(Date.now()-24*60*60*1000).toISOString();
    const rows=this.store.db.prepare("SELECT * FROM task_processing_jobs WHERE state='uploading' AND updated_at<?").all(cutoff);
    for(const row of rows) {try {this.cancel(row.executor_agent_id,{executionId:row.execution_id,jobId:row.job_id});}catch {console.error('Stale processing upload cleanup failed');}}
  }
  async listen() {
    const socket=processingSocketPath(this.dataDir),uid=process.getuid?.() ?? 0;
    try {
      const existing=fs.lstatSync(socket);
      if(!existing.isSocket()||existing.isSymbolicLink()||existing.uid!==uid)throw new Error('Invalid processing IPC endpoint');
      fs.unlinkSync(socket);
    } catch(error) {if(error.code!=='ENOENT')throw error;}
    this.connections=new Set();
    this.server=net.createServer(connection=>{this.connections.add(connection);connection.once('close',()=>this.connections.delete(connection));connection.setTimeout(610000,()=>connection.destroy());let buffer='';connection.on('data',bytes=>{buffer+=bytes.toString('utf8');if(Buffer.byteLength(buffer)>131072){connection.destroy();return;}const end=buffer.indexOf('\n');if(end<0)return;connection.pause();
      Promise.resolve().then(()=>{let request;try{request=JSON.parse(buffer.slice(0,end));}catch{fail('Invalid processing request');}const {tool,executor,input}=request;return this.dispatch(tool,executor,input);}).then(value=>connection.end(JSON.stringify(value)),error=>connection.end(JSON.stringify({error:error.status?error.message:'Processing operation failed',status:error.status||503,code:error.status===404?'not_found':error.status===409?'conflict':error.status===400?'invalid':error.status===410?'gone':'unavailable'})));
    });});
    let bound;
    try {
      await new Promise((resolve,reject)=>{
        this.server.once('error',reject);
        try {this.server.listen(socket,()=>{
          try {
            bound=fs.lstatSync(socket);
            if(!bound.isSocket()||bound.isSymbolicLink()||bound.uid!==uid)throw new Error('Invalid processing IPC endpoint');
            fs.chmodSync(socket,0o600);
            const verified=fs.lstatSync(socket);
            if(!verified.isSocket()||verified.isSymbolicLink()||verified.uid!==uid||verified.dev!==bound.dev||verified.ino!==bound.ino||(verified.mode&0o777)!==0o600)throw new Error('Invalid processing IPC endpoint');
            resolve();
          } catch(error) {reject(error);}
        });} catch(error) {reject(error);}
      });
    } catch(error) {
      for(const connection of this.connections)connection.destroy();
      // Node owns the bound pathname and unlinks it when the listener closes.
      await new Promise(resolve=>{try {this.server.close(()=>resolve());} catch {resolve();}});
      throw error;
    }
  }
  async drain() {
    if(this.closedStore)return;
    this.draining=true;clearInterval(this.cleanupTimer);clearInterval(this.uploadMonitor);
    if(this.preflightChild) {try{process.kill(-this.preflightChild.pid,'SIGKILL');}catch{} try{await this.preflightPromise;}catch{}}
    for(const connection of this.connections || [])connection.destroy();
    for(const record of this.children.values())this.stop(record,'Supervisor draining');
    await Promise.all([...this.children.values()].map(record=>new Promise(resolve=>record.child.once('close',resolve))));
    await new Promise(resolve=>this.server?.close(resolve) ?? resolve());
    this.store.db.prepare('DELETE FROM processing_supervisor WHERE id=1 AND pid=? AND identity=?').run(process.pid,this.owner);this.store.close();this.closedStore=true;
  }
}
