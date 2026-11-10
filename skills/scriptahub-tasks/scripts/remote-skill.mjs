import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {constants, createReadStream} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {openRoot,openDir,withParent,executionLock,at} from './anchored-files.mjs';

const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const id = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);
const validPath = value => typeof value === 'string' && value && !value.startsWith('/') && !/[\\\0]/.test(value) && value.split('/').every(p => p && p !== '.' && p !== '..');
const excluded = new Set(['.git','.apikeys','credentials','credential','node_modules']);
const protectedPath = name => name.split('/').some(part=>excluded.has(part)||part==='.env'||part.startsWith('.env.')) || name === 'run-state/remote-processing' || name.startsWith('run-state/remote-processing/');
const sourceExcluded = new Set(['node_modules','.cache','.venv','__pycache__','.pytest_cache','target','output','cache','.theatrical-audio','hf-cache','.DS_Store','.idea','.git','.apikeys','audio.config.json']);
const sourceSkip = name => { const part=name.split('/').at(-1); return part === '.env' || part.startsWith('.env.') && part !== '.env.example' || sourceExcluded.has(part) || part.endsWith('.pyc') || part.endsWith('.actual.html') || /\/external\/(?:browser|tools|docling-source)(?:\/|$)/.test('/'+name) || /\/external\/native\/(?:licenses|models|linux-[^/]+|darwin-[^/]+|win32-[^/]+)(?:\/|$)/.test('/'+name) || name.endsWith('.zip') || /theatrical-audio\/(?:models|runtime\/(?:qwen|kokoro|piper))(?:\/|$)/.test(name) || /theatrical-audio\/runtime\/(?:qwen|kokoro|piper)(?:\.resolved\.txt|\.json)$/.test(name); };
async function inventory(root,{source=false,skill='',hook=async()=>{}}={}) {
  const result=[];let bytes=0;
  async function visit(dir,relative='') {
    for(const entry of await fs.readdir(at(dir,'.'),{withFileTypes:true})) {
      const name=relative?relative+'/'+entry.name:entry.name;
      if(source?sourceSkip(skill+'/'+name):protectedPath(name))continue;
      if(!validPath(name))throw new Error('Invalid workspace path');
      if(entry.isDirectory()){await hook('inventory-directory',name);const child=await openDir(dir,entry.name);try{await visit(child,name);}finally{await child.close();}}
      else {const handle=await fs.open(at(dir,entry.name),constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);try{const stat=await handle.stat();if(!stat.isFile()||stat.nlink!==1)throw new Error('Unsupported workspace entry: '+name);bytes+=stat.size;if(stat.size>512*1024*1024||bytes>4*1024*1024*1024||result.length>=10000)throw new Error('Workspace limit exceeded');const h=crypto.createHash('sha256');for await(const chunk of handle.createReadStream({autoClose:false}))h.update(chunk);result.push({path:name,size:stat.size,sha256:h.digest('hex')});}finally{await handle.close();}}
    }
  }
  await visit(root);return result.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
}
async function findSkill(root,skill) {
  const base=await openRoot(path.resolve(root));
  try {
    const entries=await fs.readdir(at(base,'.'),{withFileTypes:true});
    for(const name of [skill,...entries.filter(e=>e.isDirectory()&&/^roboteam-skill-\d+$/.test(e.name)).map(e=>e.name)]) {
      let directory;try {directory=await openDir(base,name);}catch(e){if(e.code==='ENOENT')continue;throw e;}
      try {let text;try{const h=await fs.open(at(directory,'SKILL.md'),constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);try{const st=await h.stat();if(!st.isFile()||st.nlink!==1||st.size>1024*1024)throw new Error('Unsafe skill source');text=await h.readFile('utf8');}finally{await h.close();}}catch(e){if(e.code==='ENOENT'){await directory.close();continue;}throw e;}
        if((/^name:\s*(\S+)\s*$/m.exec(text)?.[1]||(name===skill?skill:''))===skill)return directory;
      }catch(e){await directory.close();throw e;}
      await directory.close();
    }
    throw new Error('Selected skill source is unavailable: '+skill);
  } finally {await base.close();}
}
async function atomic(root,name,value,{exclusive=false}={}) {const temp=name+'.'+crypto.randomUUID()+'.tmp';try{await fs.writeFile(at(root,temp),JSON.stringify(value)+'\n',{flag:'wx',mode:0o600});if(exclusive)await fs.link(at(root,temp),at(root,name));else await fs.rename(at(root,temp),at(root,name));}finally{await fs.rm(at(root,temp),{force:true});}}
async function current(root,name,{allowLinked=false}={}) {try{return await withParent(root,name,async filename=>{const handle=await fs.open(filename,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);try{const st=await handle.stat();if(!st.isFile()||st.size>512*1024*1024||(!allowLinked&&st.nlink!==1))throw new Error('Unsafe local artifact: '+name);const h=crypto.createHash('sha256');for await(const chunk of handle.createReadStream({autoClose:false}))h.update(chunk);return {size:st.size,sha256:h.digest('hex')};}finally{await handle.close();}});}catch(e){if(e.code==='ENOENT')return null;throw e;}}
async function readJson(root,name) {const handle=await fs.open(at(root,name),constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);try{const st=await handle.stat();if(!st.isFile()||st.nlink!==1||st.size>24*1024*1024)throw new Error('Invalid processing journal');return JSON.parse(await handle.readFile('utf8'));}finally{await handle.close();}}
const equal=(a,b)=>a===null&&b===null || !!a&&!!b&&a.size===b.size&&a.sha256===b.sha256;
// Completed jobs retain original inodes. A later write through an editor's old
// descriptor is detected before the next mutation or publication check.
export async function guardRemoteBackups(root,executionId,{ignorePending}={}) {
  const base=typeof root==='string'?await openRoot(root):root,owned=typeof root==='string';let tasks;
  try {try{tasks=await openDir(base,'tasks');}catch(e){if(e.code==='ENOENT')return;throw e;}
    for(const entry of await fs.readdir(at(tasks,'.'),{withFileTypes:true})) {
      if(!entry.isDirectory()||!id(entry.name))continue;let control;
      try {control=await openDir(tasks,entry.name+'/run-state/remote-processing');} catch(e){if(e.code==='ENOENT')continue;throw e;}
      try {
        const entries=await fs.readdir(at(control,'.'),{withFileTypes:true});
        if(entries.some(e=>e.name==='pending.json') && entry.name!==ignorePending) {const pending=await readJson(control,'pending.json');if(pending.command?.executionId===executionId)throw new Error('Pending remote processing requires reconciliation');}
        for(const entry of entries) {if(!entry.isDirectory()||!id(entry.name))continue;const job=await openDir(control,entry.name);try {let ledger;try{ledger=await readJson(job,'retained.json');}catch(e){if(e.code==='ENOENT')continue;throw e;}if(ledger.executionId!==executionId)continue;for(const item of ledger.items)if(item.old&&!equal(await current(job,item.backup),item.old))throw new Error('Retained original changed: '+item.name);}finally{await job.close();}}
      }finally{await control.close();}
    }
  } finally {await tasks?.close();if(owned)await base.close();}
}

// Each move and installation is recoverable from the journal and on-disk names.
// The backup is never deleted; a writer holding the old inode can still reach it.
export async function mergeRemoteOutput({taskRoot,jobDir,journalPath,controlDir,journal,hook=async()=>{}}) {
  const ownedTask=typeof taskRoot==='string',ownedJob=typeof jobDir==='string';
  const task=ownedTask?await openRoot(taskRoot):taskRoot, job=ownedJob?await openRoot(jobDir):jobDir;
  const control=controlDir || await openRoot(path.dirname(journalPath));const journalName=path.basename(journalPath);
  try {
    const save=()=>atomic(control,journalName,journal);
    const before=new Map(journal.files.map(e=>[e.path,e])),after=new Map(journal.output.map(e=>[e.path,e]));
    journal.items ||= [...new Set([...before.keys(),...after.keys()])].sort().filter(name=>!equal(before.get(name)||null,after.get(name)||null)).map(name=>({name,old:before.get(name)||null,next:after.get(name)||null,backup:'backup-'+crypto.randomUUID(),temp:'install-'+crypto.randomUUID(),stage:'new'}));
    await save();
    for(const item of journal.items) {
      const {name,old,next,backup,temp}=item;
      if(item.stage==='done') {if(old&&!equal(await current(job,backup),old))throw new Error('Retained original changed: '+name);if(!equal(await current(task,name),next))throw new Error('Local edit conflicts with remote result: '+name);continue;}
      if(item.stage==='new') {if(!equal(await current(task,name),old))throw new Error('Local edit conflicts with remote result: '+name);item.stage='intent';await save();await hook('intent',item);}
      if(item.stage==='intent') {
        const captured=await current(job,backup);
        if(old&&!captured) await withParent(task,name,async canonical=>{await hook('before-move',item);await fs.rename(canonical,at(job,backup));await hook('moved',item);});
        if(old&&!equal(await current(job,backup),old))throw new Error('Captured original changed: '+name);
        item.stage='captured';await save();await hook('captured',item);
      }
      if(item.stage==='captured') {
        if(old&&!equal(await current(job,backup),old))throw new Error('Retained original changed: '+name);
        await withParent(task,name,async canonical=>{
          if(next) {
            const canonicalState=await current(task,name,{allowLinked:true}),tempState=await current(job,temp,{allowLinked:true});
            if(canonicalState!==null) {
              const a=await fs.lstat(canonical);if(!item.installInode||a.dev!==item.installInode.dev||a.ino!==item.installInode.ino||!equal(canonicalState,next))throw new Error('Local edit conflicts with remote result: '+name);
            } else {
              if(tempState===null)await fs.copyFile(at(job,digest(name)),at(job,temp),constants.COPYFILE_EXCL);else if(!equal(tempState,next))throw new Error('Invalid staged result: '+name);
              const staged=await fs.lstat(at(job,temp));item.installInode={dev:staged.dev,ino:staged.ino};await save();await hook('before-install',item);
              try{await fs.link(at(job,temp),canonical);}catch(e){if(e.code==='EEXIST')throw new Error('Local edit conflicts with remote result: '+name);throw e;}await hook('installed',item);
            }
            await fs.unlink(at(job,temp)).catch(e=>{if(e.code!=='ENOENT')throw e;});await hook('unlinked-temp',item);
          } else if(await current(task,name)!==null)throw new Error('Local edit conflicts with remote deletion: '+name);
        },{create:true});
        item.stage='done';await save();await hook('progress',item);
      }
      if(old&&!equal(await current(job,backup),old))throw new Error('Retained original changed: '+name);
      if(!equal(await current(task,name),next))throw new Error('Local edit conflicts with remote result: '+name);
    }
    await atomic(job,'retained.json',{executionId:journal.command?.executionId,items:journal.items.map(({name,old,backup})=>({name,old,backup}))});
    for(const item of journal.items) {if(item.old&&!equal(await current(job,item.backup),item.old))throw new Error('Retained original changed: '+item.name);if(!equal(await current(task,item.name),item.next))throw new Error('Local edit conflicts with remote result: '+item.name);}
  } finally {if(!controlDir)await control.close();if(ownedTask)await task.close();if(ownedJob)await job.close();}
}
async function download(call,executionId,jobId,kind,name,target,expected) {
  const handle=await fs.open(target,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY,0o600); const hash=crypto.createHash('sha256'); let offset=0, size, sha;
  try { do { const c=await call('scriptahub_skill_job_read',{executionId,jobId,kind,...(name?{path:name}:{}),offset,length:196608});
      if(c.absent===true)throw Object.assign(new Error('Processing evidence is absent'),{absent:true,reply:c});
      if(c.encoding!=='base64'||typeof c.data!=='string'||!Number.isSafeInteger(c.size)||c.size<0||!/^[a-f0-9]{64}$/.test(c.sha256||'')||c.offset!==offset) throw new Error('Invalid result chunk');
      const b=Buffer.from(c.data,'base64'); if(b.toString('base64')!==c.data||b.length>196608||c.nextOffset!==offset+b.length||c.nextOffset>c.size||c.eof!==(c.nextOffset===c.size)||(!b.length&&!c.eof)||size!==undefined&&(size!==c.size||sha!==c.sha256)) throw new Error('Invalid result chunk');
      size=c.size;sha=c.sha256; await handle.writeFile(b);hash.update(b);offset=c.nextOffset;
    } while(offset<size);
    if(hash.digest('hex')!==sha||expected&&!equal({size,sha256:sha},expected)) throw new Error('Result checksum mismatch'); await handle.sync(); return {size,sha256:sha};
  } finally {await handle.close();}
}
async function releaseJournal(call,executionId,journal,journalPath) {
  const release=journal.release;
  if(!release||!/^[a-f0-9]{64}$/.test(release.resultDigest||'')||!Number.isInteger(release.exitCode)||release.exitCode<0||release.exitCode>255||!release.evidence)throw new Error('Invalid pending release journal');
  const result=await call('scriptahub_skill_job_release',{executionId,jobId:journal.jobId,resultDigest:release.resultDigest});
  if(result.jobId!==journal.jobId||result.resultDigest!==release.resultDigest||result.artifactsReleased!==true||result.cleanupPending!==false)throw new Error('Processing artifact release remains pending');
  await fs.rm(journalPath);return release.exitCode;
}
const terminalStates=['succeeded','failed','cancelled','interrupted'];
// Downloads and verifies the inventory, logs and files of a terminal job into the retained job directory.
// An explicit incomplete-diagnostics release tolerates only evidence the service reports as explicitly absent: a successful
// reply with absent:true that carries the job's own digest and diagnosticsComplete=false (failed tool calls lose their
// details in transit, so they can never mean absence). Any other error aborts. Verified local copies are replaced only
// by a verified download and are never removed first.
const absentReply=(reply,status)=>reply?.absent===true&&reply.resultDigest===status.resultDigest&&reply.diagnosticsComplete===false&&reply.state===status.state;
const isAbsent=error=>error?.absent===true;
async function fetchInto(jobDir,name,download) {
  const temp=name+'.'+crypto.randomUUID()+'.tmp';
  try {const result=await download(at(jobDir,temp));await fs.rename(at(jobDir,temp),at(jobDir,name));return result;}
  finally {await fs.rm(at(jobDir,temp),{force:true});}
}
async function retainEvidence(call,executionId,jobId,status,control,{stdout,stderr,incomplete=false}={}) {
  let cursor, output=[], inventoryUnavailable=false, outputsUnretrievable=false, prior=null;
  if(incomplete) {try {const earlier=await openDir(control,jobId);try {prior=await readJson(earlier,'result.json');} finally {await earlier.close();}} catch(e) {if(e.code!=='ENOENT')throw e;}
    if(prior&&prior.resultDigest!==status.resultDigest)prior=null;}
  do {const page=await call('scriptahub_skill_job_result',{executionId,jobId,...(cursor===undefined?{}:{cursor}),limit:100});
    if(page.absent===true) {if(!incomplete||!absentReply(page,status))throw new Error('Invalid result inventory');output=Array.isArray(prior?.files)?prior.files:[];inventoryUnavailable=true;outputsUnretrievable=page.outputsUnretrievable===true;break;}
    if(page.resultDigest!==status.resultDigest||page.diagnosticsComplete!==status.diagnosticsComplete||page.state!==status.state||!Array.isArray(page.files)||page.files.length>100 || page.nextCursor!==null && (!Number.isSafeInteger(page.nextCursor) || page.nextCursor <= (cursor??0)))throw new Error('Invalid result inventory');output.push(...page.files);if(output.length>10000)throw new Error('Result inventory exceeds file limit');cursor=page.nextCursor;} while(cursor!==null);
  if(output.length>10000) throw new Error('Result inventory exceeds file limit');
  let outputBytes=0; const names=new Set();for(const e of output) {if(!validPath(e.path)||protectedPath(e.path)||names.has(e.path)||!Number.isSafeInteger(e.size)||e.size<0||!/^[a-f0-9]{64}$/.test(e.sha256||''))throw new Error('Invalid result inventory');if(e.size>512*1024*1024 || (outputBytes+=e.size)>4*1024*1024*1024)throw new Error('Result inventory exceeds size limit');names.add(e.path);}
  for(const name of names) {const parts=name.split('/');for(let i=1;i<parts.length;i++)if(names.has(parts.slice(0,i).join('/')))throw new Error('Overlapping result paths');}
  const jobDir=await openDir(control,jobId,{create:true});
  try {
  const logs={};for(const kind of ['stdout','stderr']) {const target=at(jobDir,kind);
    try {logs[kind]=await fetchInto(jobDir,kind,temp=>download(call,executionId,jobId,kind,null,temp));} catch(error) {if(!incomplete||!isAbsent(error)||!absentReply(error.reply,status))throw error;logs[kind]=await current(jobDir,kind);continue;}
    if(stream(kind,stdout,stderr))for await(const chunk of createReadStream(target))stream(kind,stdout,stderr).write(chunk);}
  for(const e of output) {if(!equal(await current(jobDir,digest(e.path)),e)) await fetchInto(jobDir,digest(e.path),temp=>download(call,executionId,jobId,'file',e.path,temp,e));}
  const exitCode=status.state==='succeeded'?0:Number.isInteger(status.exitCode)&&status.exitCode>0&&status.exitCode<=255?status.exitCode:1;
  await atomic(jobDir,'result.json',{state:status.state,exitCode:status.exitCode,reason:status.reason??null,resultDigest:status.resultDigest,diagnosticsComplete:status.diagnosticsComplete,files:output,logs,...(inventoryUnavailable?{inventoryUnavailable:true}:{}),...(outputsUnretrievable?{outputsUnretrievable:true}:{})});
  return {jobDir,output,exitCode};
  } catch(error) {await jobDir.close();throw error;}
}
const stream=(kind,stdout,stderr)=>kind==='stdout'?stdout:stderr;
// Deliberately releases a job whose diagnostics are incomplete: the local evidence copy is verified first, then the
// service artifacts are freed with the stored result digest. It never merges output into the task directory.
export async function releaseIncompleteRemote(input,call,{root=process.cwd()}={}) {
  const {executionId,taskDirectory}=input;
  if(!id(executionId)||!/^tasks\/[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(taskDirectory||''))throw new Error('Invalid release-incomplete command');
  root=await fs.realpath(root); const base=await openRoot(root);let taskRoot,control,lock,evidence;
  try {
  lock=await executionLock(base,executionId);
  taskRoot=await openDir(base,taskDirectory);
  try {control=await openDir(taskRoot,'run-state/remote-processing');} catch(e) {if(e.code==='ENOENT')throw new Error('No pending remote job for this task');throw e;}
  const journalPath=at(control,'pending.json');let journal;
  try {journal=await readJson(control,'pending.json');} catch(e) {if(e.code==='ENOENT')throw new Error('No pending remote job for this task');throw e;}
  if(journal.command?.executionId!==executionId||journal.command?.taskDirectory!==taskDirectory||!id(journal.jobId))throw new Error('Pending remote job does not belong to this task');
  if(journal.phase==='release_pending')return await releaseJournal(call,executionId,journal,journalPath);
  if(journal.phase==='merging')throw new Error('Remote output merge is in progress; repeat the original command instead');
  const status=await call('scriptahub_skill_job_status',{executionId,jobId:journal.jobId});
  if(!terminalStates.includes(status.state)||!/^[a-f0-9]{64}$/.test(status.resultDigest||'')||typeof status.diagnosticsComplete!=='boolean')throw new Error('Processing job is not terminal');
  if(status.diagnosticsComplete)throw new Error('Processing diagnostics are complete; repeat the original command to merge and release');
  if(status.artifactsReleased===true) {
    // The service already freed this job (for example a stale interrupted upload): keep a local receipt and clear the journal.
    const exitCode=Number.isInteger(status.exitCode)&&status.exitCode>0&&status.exitCode<=255?status.exitCode:1;
    const jobDir=await openDir(control,journal.jobId,{create:true});
    try {let prior=null;try {prior=await readJson(jobDir,'result.json');} catch(e) {if(e.code!=='ENOENT')throw e;}
      if(prior&&prior.resultDigest!==status.resultDigest)prior=null;
      await atomic(jobDir,'result.json',{...(prior||{files:[],logs:{stdout:null,stderr:null}}),state:status.state,exitCode:status.exitCode,reason:status.reason??null,resultDigest:status.resultDigest,diagnosticsComplete:false,artifactsReleased:true});
    } finally {await jobDir.close();}
    await fs.rm(journalPath);return exitCode;
  }
  evidence=await retainEvidence(call,executionId,journal.jobId,status,control,{incomplete:true});
  journal.phase='release_pending';journal.release={resultDigest:status.resultDigest,exitCode:evidence.exitCode,incomplete:true,evidence:{directory:journal.jobId,receipt:'result.json',stdout:'stdout',stderr:'stderr'}};
  await atomic(control,'pending.json',journal);
  return await releaseJournal(call,executionId,journal,journalPath);
  } finally {await evidence?.jobDir.close();await lock?.close();await control?.close();await taskRoot?.close();await base.close();}
}
export async function runRemoteSkill(input,call,{root=process.cwd(),sourceRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'),stdout=process.stdout,stderr=process.stderr,pollMs=1000,hook=async()=>{}}={}) {
  const {executionId,taskDirectory,skill,args=[],input:stdin=''}=input;
  if(!id(executionId)||!/^tasks\/[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(taskDirectory||'')||!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(skill||'')||!Array.isArray(args)||args.length>256||args.some(a=>typeof a!=='string'||a.includes('\0'))||Buffer.byteLength(JSON.stringify(args))>60000||typeof stdin!=='string'||Buffer.byteLength(stdin)>65536) throw new Error('Invalid remote skill command');
  root=await fs.realpath(root); const base=await openRoot(root);let taskRoot,control,lock,jobDir;
  try {
  lock=await executionLock(base,executionId);
  taskRoot=await openDir(base,taskDirectory);
  control=await openDir(taskRoot,'run-state/remote-processing',{create:true});
  const journalPath=at(control,'pending.json');let journal;
  try {journal=await readJson(control,'pending.json');}catch(e){if(e.code!=='ENOENT')throw e;}
  const command={executionId,taskDirectory,virtualCwd:root,skill,args,input:stdin};const commandHash=digest(JSON.stringify(command));
  if(journal&&journal.commandHash!==commandHash)throw new Error('Reconcile the pending remote job before another command');
  if(journal?.phase==='release_pending')return await releaseJournal(call,executionId,journal,journalPath);
  const claimed=JSON.parse(await withParent(taskRoot,'run-state/claimed.json',async p=>{const h=await fs.open(p,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);try{const st=await h.stat();if(!st.isFile()||st.nlink!==1||st.size>1024*1024)throw new Error('Invalid claimed task');return await h.readFile('utf8');}finally{await h.close();}}));
  if(claimed.task?.executionId!==executionId || claimed.task?.taskId!==taskDirectory.slice(6) || claimed.taskDirectory!==taskDirectory)throw new Error('Task directory does not belong to this execution');
  await guardRemoteBackups(base,executionId,{ignorePending:journal?taskDirectory.slice(6):undefined});
  if(!journal) {
    const skillDir=await findSkill(sourceRoot,skill);let source;try{source=await inventory(skillDir,{source:true,skill});}finally{await skillDir.close();}
    const sourceMap=Object.fromEntries(source.map(e=>[skill+'/'+e.path,e.sha256]));if(!source.length)throw new Error('Selected skill source is empty');
    const files=await inventory(taskRoot,{hook}),manifest=Buffer.from(JSON.stringify(files));if(manifest.length>8*1024*1024)throw new Error('Manifest too large');
    journal={commandHash,command,jobId:crypto.randomUUID(),sourceDigest:digest(JSON.stringify(sourceMap)),files,manifest:manifest.toString('base64'),phase:'uploading'};await atomic(control,'pending.json',journal,{exclusive:true});
  }
  const {jobId,files}=journal, manifest=Buffer.from(journal.manifest,'base64');
  let status=await call('scriptahub_skill_job_prepare',{executionId,jobId,virtualCwd:root,skill,args,input:stdin,sourceDigest:journal.sourceDigest,manifestSha256:digest(manifest),manifestSize:manifest.length});
  if (status.state === 'uploading') {
  async function upload(kind,name,buffer) {for(let offset=0;offset<buffer.length;) {const data=buffer.subarray(offset,offset+65536); const reply=await call('scriptahub_skill_job_upload',{executionId,jobId,kind,...(name?{path:name}:{}),offset,data:data.toString('base64')}); if(reply.nextOffset!==offset+data.length)throw new Error('Invalid upload acknowledgement');offset=reply.nextOffset;}}
  await upload('manifest',null,manifest);
  for(const entry of files) {await hook('before-upload',entry.path);await withParent(taskRoot,entry.path,async filename=>{const handle=await fs.open(filename,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);const hash=crypto.createHash('sha256');try {const stat=await handle.stat();if(!stat.isFile()||stat.nlink!==1||stat.size!==entry.size)throw new Error('Workspace changed during upload: '+entry.path);for(let offset=0;offset<entry.size;) {const data=Buffer.alloc(Math.min(65536,entry.size-offset));const {bytesRead}=await handle.read(data,0,data.length,offset);if(bytesRead!==data.length)throw new Error('Workspace changed during upload: '+entry.path);hash.update(data);const reply=await call('scriptahub_skill_job_upload',{executionId,jobId,kind:'file',path:entry.path,offset,data:data.toString('base64')});if(reply.nextOffset!==offset+bytesRead)throw new Error('Invalid upload acknowledgement');offset+=bytesRead;}if(hash.digest('hex')!==entry.sha256)throw new Error('Workspace changed during upload: '+entry.path);}finally{await handle.close();}});}
  status=await call('scriptahub_skill_job_start',{executionId,jobId});
  }
  while(['uploading','starting','running','stopping'].includes(status.state)) {await new Promise(resolve=>setTimeout(resolve,pollMs));status=await call('scriptahub_skill_job_status',{executionId,jobId});}
  if(!['succeeded','failed','cancelled','interrupted'].includes(status.state)||!/^[a-f0-9]{64}$/.test(status.resultDigest||'')||typeof status.diagnosticsComplete!=='boolean')throw new Error('Invalid terminal processing receipt');
  const evidence=await retainEvidence(call,executionId,jobId,status,control,{stdout,stderr});jobDir=evidence.jobDir;const {output,exitCode}=evidence;
  if(!status.diagnosticsComplete)throw new Error('Processing diagnostics are incomplete; server artifacts remain retained');
  if(status.state==='succeeded') {
    if(status.exitCode!==0)throw new Error('Invalid successful processing exit code');
    journal.output=output;journal.phase='merging';journal.applied ||= [];await atomic(control,'pending.json',journal);
    await guardRemoteBackups(base,executionId,{ignorePending:taskDirectory.slice(6)});
    await mergeRemoteOutput({taskRoot,jobDir,journalPath,controlDir:control,journal,hook});
  }
  journal.phase='release_pending';journal.release={resultDigest:status.resultDigest,exitCode,evidence:{directory:jobId,receipt:'result.json',stdout:'stdout',stderr:'stderr',...(status.state==='succeeded'?{retained:'retained.json'}:{})}};
  await atomic(control,'pending.json',journal);
  return await releaseJournal(call,executionId,journal,journalPath);
  } finally {await jobDir?.close();await lock?.close();await control?.close();await taskRoot?.close();await base.close();}
}
