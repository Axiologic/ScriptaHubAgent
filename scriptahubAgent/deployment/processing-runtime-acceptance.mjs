import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { sandboxCommand } from '../processing-sandbox.mjs';

// This is an offline, task-owned image acceptance probe; every child is awaited.
if (process.platform !== 'linux' || process.getuid?.() !== 1000) throw new Error('Acceptance requires Linux UID 1000');
const root=await fs.mkdtemp(path.join(os.tmpdir(),'scriptahub-acceptance-'));
const task=path.join(root,'task'),cwd='/workspace/scriptahub-accept',work=cwd+'/tasks/acceptance';
await fs.mkdir(task);
const server=net.createServer(socket=>socket.end('unexpected'));
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
const port=server.address().port;
async function run(skill,args,{probe}={}) {
  const command=sandboxCommand({virtualCwd:cwd,taskId:'acceptance',jobDirectory:task,skill,args,input:''});
  if(probe) {const at=command.args.lastIndexOf('--');command.args.splice(at+1,command.args.length-at-1,'/bin/sh','-c',probe);}
  await new Promise((resolve,reject)=>{
    const child=spawn(command.command,command.args,{detached:true,stdio:['ignore','pipe','pipe'],env:{PATH:'/usr/local/bin:/usr/bin:/bin',SCRIPTA_ACCEPT_SENTINEL:'private'}});
    let output='',overflow=false;
    for(const stream of [child.stdout,child.stderr])stream.on('data',bytes=>{if(output.length<65536)output+=bytes.toString();else overflow=true;});
    const timer=setTimeout(()=>{try{process.kill(-child.pid,'SIGKILL');}catch{}},900000);
    child.once('error',reject);child.once('close',(code,signal)=>{clearTimeout(timer);if(code!==0||signal||overflow)reject(new Error(`${skill} acceptance failed (${code ?? signal}): ${output.slice(-4000)}`));else resolve();});
  });
}
try {
  const probe=`set -eu
  test -z "\${SCRIPTA_ACCEPT_SENTINEL-}"
  test ! -e /data && test ! -e /code && test ! -e /Agent && test ! -e ${cwd}/tasks/sibling
  if [ -r /proc/${process.pid}/environ ] && grep -aq 'SCRIPTA_ACCEPT_SENTINEL=' /proc/${process.pid}/environ; then exit 4; fi
  if touch /outside 2>/dev/null || touch /dev/outside 2>/dev/null; then exit 3; fi
  /usr/local/bin/node -e 'const n=require("net");const s=n.connect(${port},"127.0.0.1");s.on("connect",()=>process.exit(3));s.on("error",()=>process.exit(0));setTimeout(()=>process.exit(0),1000)'
  /usr/bin/python3 - <<'PY'
import errno, os, resource
limit=512*1024*1024
assert resource.getrlimit(resource.RLIMIT_FSIZE)==(limit,limit)
try:
    with open('/tmp/limit','wb') as f: os.posix_fallocate(f.fileno(),0,limit+1)
    raise AssertionError('file limit not enforced')
except OSError as e:
    assert e.errno in (errno.EFBIG,errno.ENOSPC)
try:
    with open('/dev/shm/limit','wb') as f: os.posix_fallocate(f.fileno(),0,70*1024*1024)
    raise AssertionError('shared memory cap not enforced')
except OSError as e:
    assert e.errno==errno.ENOSPC
try:
    for i in range(3):
        with open('/tmp/cap'+str(i),'wb') as f: os.posix_fallocate(f.fileno(),0,400*1024*1024)
    raise AssertionError('temporary storage cap not enforced')
except OSError as e:
    assert e.errno==errno.ENOSPC
PY`;
  await run('pdf2html',['doctor'],{probe});
  await fs.copyFile('/opt/scriptahub/runtime/skills/pdf2html/tests/fixtures/semantic.pdf',path.join(task,'source.pdf'));
  await run('pdf2html',['convert',work+'/source.pdf','--output',work+'/pdf-output']);
  if(!(await fs.readdir(path.join(task,'pdf-output'))).some(name=>name.endsWith('.html')))throw new Error('PDF conversion produced no HTML');
  const html='<!doctype html><html><body><main data-reader-content><h1>Acceptance</h1><p>A small test edition.</p></main></body></html>';
  await fs.writeFile(path.join(task,'baseline.html'),html);await fs.writeFile(path.join(task,'candidate.html'),html);
  await run('html2doc',['convert',work+'/baseline.html','--output',work+'/source.docx']);
  await run('doc2pdf',['convert',work+'/source.docx','--output',work+'/converted.pdf']);
  await fs.access(path.join(task,'converted.pdf'));
  await run('theatrical-audio',['say','A small offline acceptance test.','--engine','piper','--allow-degraded','--out',work+'/voice.wav']);
  if((await fs.stat(path.join(task,'voice.wav'))).size<44)throw new Error('Piper produced no audio');
  await run('validate-book',['compare-edition',work+'/baseline.html','--candidate',work+'/candidate.html','--job-dir',work+'/edition-check']);
  await fs.access(path.join(task,'edition-check','report.json'));
  const killPlan=sandboxCommand({virtualCwd:cwd,taskId:'acceptance',jobDirectory:task,skill:'pdf2html',args:['doctor'],input:''});
  const marker=path.join(task,'descendant-escaped'),at=killPlan.args.lastIndexOf('--');
  killPlan.args.splice(at+1,killPlan.args.length-at-1,'/bin/sh','-c',`(sleep 3; touch ${work}/descendant-escaped) & echo ready > ${work}/ready; wait`);
  const worker=spawn(killPlan.command,killPlan.args,{detached:true,stdio:'ignore',env:{PATH:'/usr/local/bin:/usr/bin:/bin'}});
  const done=new Promise((resolve,reject)=>{worker.once('error',reject);worker.once('close',resolve);});
  let ready=false;for(let i=0;i<100;i++){if(await fs.access(path.join(task,'ready')).then(()=>true,()=>false)){ready=true;break;}await delay(50);}
  if(!ready){try{process.kill(-worker.pid,'SIGKILL');}catch{}await done;throw new Error('Cancellation probe did not start');}
  try{process.kill(-worker.pid,'SIGTERM');}catch{} await done;await delay(3500);
  if(await fs.access(marker).then(()=>true,()=>false))throw new Error('Cancelled worker descendant survived');
  console.log('Processing isolation, bounded storage, native skills and cancellation probe completed.');
} finally {
  await new Promise(resolve=>server.close(resolve));
  await fs.rm(root,{recursive:true,force:true});
}
