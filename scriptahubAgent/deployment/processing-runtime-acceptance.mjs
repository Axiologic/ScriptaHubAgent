import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { sandboxCommand } from '../processing-sandbox.mjs';
import { processingRuntime } from '../processing-runtime.mjs';
import { locateSkills } from '../processing-source.mjs';
import { isInstalledPath } from './skill-source.mjs';
import { INPUTS_PATH, parseDependencyInputs } from './dependency-fingerprint.mjs';

// This is an offline, task-owned image acceptance probe; every child is awaited.
if (process.platform !== 'linux' || process.getuid?.() !== 1000) throw new Error('Acceptance requires Linux UID 1000');
const root=await fs.mkdtemp(path.join(os.tmpdir(),'scriptahub-acceptance-'));
const task=path.join(root,'task'),cwd='/workspace/scriptahub-accept',work=cwd+'/tasks/acceptance';
await fs.mkdir(task);
// Skills come from the mounted checkout, found through WORKSPACE_PATH like the service finds it; the image adds dependencies.
const runtimeRoot='/opt/scriptahub/runtime',codeRoot=path.resolve(import.meta.dirname,'..'),snapshots=path.join(root,'snapshots');
let repoRoot,skillsRoot,runtime;
try {
  const located=await locateSkills({codeRoot});({repoRoot,skillsRoot}=located);await located.close();
  const started=Date.now();runtime=await processingRuntime({runtimeRoot,codeRoot,snapshotRoot:snapshots});
  console.log(`Mounted skill source captured in ${Date.now()-started} ms (runtime ${runtime.runtimeId.slice(0,12)}).`);
} catch(error) {await fs.rm(root,{recursive:true,force:true}).catch(()=>{});throw error;}
const server=net.createServer(socket=>socket.end('unexpected'));
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
const port=server.address().port;
async function run(skill,args,{probe,view=runtime.view}={}) {
  const command=sandboxCommand({virtualCwd:cwd,taskId:'acceptance',jobDirectory:task,skill,args,input:'',view});
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
  test ! -e ${repoRoot} && test ! -e ${snapshots} && test ! -e ${root}
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
  await fs.copyFile(path.join(skillsRoot,'pdf2html/tests/fixtures/semantic.pdf'),path.join(task,'source.pdf'));
  await run('pdf2html',['convert',work+'/source.pdf','--output',work+'/pdf-output']);
  if(!(await fs.readdir(path.join(task,'pdf-output'))).some(name=>name.endsWith('.html')))throw new Error('PDF conversion produced no HTML');
  await run('book-pdf',['moderation-render',work+'/source.pdf','--output',work+'/moderation-pages']);
  const reviewUnits=JSON.parse(await fs.readFile(path.join(task,'moderation-pages/units.json'),'utf8'));
  const page=reviewUnits[0] && await fs.readFile(path.join(task,'moderation-pages',reviewUnits[0].image));
  if(page?.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')throw new Error('PDF moderation produced no visual evidence');
  const html='<!doctype html><html><body><main data-reader-content><h1>Acceptance</h1><p>A small test edition.</p></main></body></html>';
  await fs.writeFile(path.join(task,'baseline.html'),html);await fs.writeFile(path.join(task,'candidate.html'),html);
  await fs.writeFile(path.join(task,'print-reader.html'),html
    .replace('<body>','<head><meta charset="utf-8"><style>@media print { main { display: none; } }</style></head><body>')
    .replace('A small test edition.','A small test edition about Costești-Cetățuie.'));
  await run('book-pdf',['export',work+'/print-reader.html','--output',work+'/en/book.pdf','--language','en']);
  const bookPdf=await fs.readFile(path.join(task,'en/book.pdf'));
  if(bookPdf.subarray(0,5).toString()!=='%PDF-')throw new Error('Book export did not produce a PDF');
  await run('html2doc',['convert',work+'/baseline.html','--output',work+'/source.docx']);
  await run('doc2pdf',['convert',work+'/source.docx','--output',work+'/converted.pdf']);
  await fs.access(path.join(task,'converted.pdf'));
  await run('theatrical-audio',['say','A small offline acceptance test.','--engine','piper','--allow-degraded','--out',work+'/voice.wav']);
  if((await fs.stat(path.join(task,'voice.wav'))).size<44)throw new Error('Piper produced no audio');
  await run('validate-book',['compare-edition',work+'/baseline.html','--candidate',work+'/candidate.html','--job-dir',work+'/edition-check']);
  await fs.access(path.join(task,'edition-check','report.json'));
  const killPlan=sandboxCommand({virtualCwd:cwd,taskId:'acceptance',jobDirectory:task,skill:'pdf2html',args:['doctor'],input:'',view:runtime.view});
  const marker=path.join(task,'descendant-escaped'),at=killPlan.args.lastIndexOf('--');
  killPlan.args.splice(at+1,killPlan.args.length-at-1,'/bin/sh','-c',`(sleep 3; touch ${work}/descendant-escaped) & echo ready > ${work}/ready; wait`);
  const worker=spawn(killPlan.command,killPlan.args,{detached:true,stdio:'ignore',env:{PATH:'/usr/local/bin:/usr/bin:/bin'}});
  const done=new Promise((resolve,reject)=>{worker.once('error',reject);worker.once('close',resolve);});
  let ready=false;for(let i=0;i<100;i++){if(await fs.access(path.join(task,'ready')).then(()=>true,()=>false)){ready=true;break;}await delay(50);}
  if(!ready){try{process.kill(-worker.pid,'SIGKILL');}catch{}await done;throw new Error('Cancellation probe did not start');}
  try{process.kill(-worker.pid,'SIGTERM');}catch{} await done;await delay(3500);
  if(await fs.access(marker).then(()=>true,()=>false))throw new Error('Cancelled worker descendant survived');
  // A writable copy of the checkout in a second workspace, found by the same discovery through its own code root.
  const workspace=path.join(root,'workspace'),copy=path.join(workspace,'ScriptaHubAgent'),probeSnapshots=path.join(root,'probe-snapshots');
  const wanted=relative=>{const parts=relative.split(path.sep);
    return parts[0]==='skills'?parts.length===1||!isInstalledPath(parts.slice(1).join('/')):parts[0]==='scriptahubAgent'
      &&(parts.length===1||parts[1]==='deployment'||parts[1]==='site'&&(parts.length===2||parts[2]==='reader'));};
  await fs.cp(repoRoot,copy,{recursive:true,filter:source=>{const relative=path.relative(repoRoot,source);return !relative||wanted(relative);}});
  const probeOptions={runtimeRoot,codeRoot:path.join(copy,'scriptahubAgent'),workspace,snapshotRoot:probeSnapshots};
  const token=crypto.randomUUID(),markerName='scriptahub-acceptance-marker.txt';
  await fs.writeFile(path.join(copy,'skills/pdf2html',markerName),token+'\n');
  if(await fs.access(path.join(runtimeRoot,'skills/pdf2html',markerName)).then(()=>true,()=>false))throw new Error('The image already holds the source marker');
  const marked=await processingRuntime(probeOptions);
  await run('pdf2html',['doctor'],{view:marked.view,probe:`set -eu\n  test "$(cat ${runtimeRoot}/skills/pdf2html/${markerName})" = "${token}"`});
  console.log('mounted source marker visible');
  const input=parseDependencyInputs(await fs.readFile(path.join(copy,INPUTS_PATH),'utf8')).find(name=>name.startsWith('skills/'));
  await fs.chmod(path.join(copy,input),0o644);await fs.appendFile(path.join(copy,input),'\n');
  const refusal=await processingRuntime(probeOptions).then(()=>null,error=>error);
  if(refusal?.status!==503||!/rebuild docker\.io\/assistos\/scriptahub-agent/.test(refusal.message))throw new Error(`A dependency change was not refused: ${refusal?.message ?? 'accepted'}`);
  console.log('dependency change refused');
  console.log('Processing isolation, bounded storage, native skills and cancellation probe completed.');
} finally {
  await new Promise(resolve=>server.close(resolve));
  await fs.chmod(root,0o700).catch(()=>{});
  for(const store of ['snapshots','probe-snapshots'])await new Promise(resolve=>spawn('/bin/chmod',['-R','u+rwx',path.join(root,store)]).once('close',resolve).once('error',resolve));
  await fs.rm(root,{recursive:true,force:true});
}
