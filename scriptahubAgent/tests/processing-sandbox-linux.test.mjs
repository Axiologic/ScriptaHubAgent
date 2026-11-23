import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { sandboxCommand } from '../processing-sandbox.mjs';
import { processingRuntime } from '../processing-runtime.mjs';
import { runtimeFixture, CHECKOUT_FILES, IMAGE_FILES, OVERRIDE } from './runtime-fixture.mjs';

// Real bubblewrap proof of the runtime view. It needs Linux, bwrap and python3; elsewhere it is skipped with the reason,
// and a skip is never a pass.
const skip=process.platform!=='linux'?'requires Linux: the processing sandbox is bubblewrap'
  :!fs.existsSync('/usr/bin/bwrap')?'requires /usr/bin/bwrap':!fs.existsSync('/usr/bin/python3')?'requires /usr/bin/python3'
  :!fs.existsSync('/usr/local/bin/node')?'requires /usr/local/bin/node (the sandbox interpreter)':false;
const R='/opt/scriptahub/runtime';

test('bwrap runs the captured snapshot with image dependencies bound read-only and no service paths',{skip},async t=>{
  const f=await runtimeFixture();t.after(f.remove);
  const runtime=await processingRuntime(f.options);
  const job=path.join(f.root,'job');fs.mkdirSync(job);
  const plan=sandboxCommand({virtualCwd:'/workspace/run',taskId:'probe',jobDirectory:job,skill:'pdf2html',args:['doctor'],input:'',view:runtime.view},{imageRoot:f.runtimeRoot});
  // Test-only: hosts such as ploinky-box lack the browser and office config directories, and bwrap refuses a missing
  // bind source. Only those /etc binds are dropped; every runtime bind stays as produced.
  const args=[];
  for(let index=0;index<plan.args.length;index++) {
    const value=plan.args[index];
    if(value==='--ro-bind'&&plan.args[index+1]?.startsWith('/etc/')&&!fs.existsSync(plan.args[index+1])){index+=2;continue;}
    args.push(value);
  }
  assert.ok(args.includes('/etc/fonts')||!fs.existsSync('/etc/fonts'));
  const hidden=['/code','/data','/src',f.workspace,f.root,f.options.snapshotRoot,process.cwd()];
  const probe=`const fs=require('fs'),R=${JSON.stringify(R)},out={};
const read=p=>{try{return fs.readFileSync(p,'utf8')}catch(e){return 'ERROR '+e.code}};
const refused=fn=>{try{fn();return false}catch(e){return e.code}};
out.skill=read(R+'/skills/pdf2html/SKILL.md');out.launcher=read(R+'/run-skill.mjs');out.reader=read(R+'/reader/reader.css');
out.dependency=require(R+'/skills/pdf2html/external/html/node_modules/dep/index.js');
out.model=read(R+'/skills/pdf2html/external/native/models/model.bin');out.archive=read(R+'/skills/pdf2html/external/native/assets.zip');
out.override=read(R+'/${OVERRIDE}');
out.checkoutOnly=fs.existsSync(R+'/skills/pdf2html/.env')||fs.existsSync(R+'/skills/pdf2html/node_modules');
out.writes={snapshot:refused(()=>fs.writeFileSync(R+'/skills/x','x')),source:refused(()=>fs.appendFileSync(R+'/skills/pdf2html/SKILL.md','x')),
  dependency:refused(()=>fs.writeFileSync(R+'/skills/pdf2html/external/html/node_modules/dep/new.js','x')),
  override:refused(()=>fs.appendFileSync(R+'/${OVERRIDE}','x')),mkdir:refused(()=>fs.mkdirSync(R+'/skills/new'))};
out.visible=${JSON.stringify(hidden)}.filter(p=>fs.existsSync(p));
fs.writeFileSync('/workspace/run/tasks/probe/out.txt','job');
process.stdout.write(JSON.stringify(out));`;
  args.splice(args.lastIndexOf('--')+1,Infinity,'/usr/local/bin/node','-e',probe);
  const result=await new Promise((resolve,reject)=>{
    const child=spawn(plan.command,args,{stdio:['ignore','pipe','pipe'],env:{PATH:'/usr/local/bin:/usr/bin:/bin'}});
    let stdout='',stderr='';child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);
    const timer=setTimeout(()=>child.kill('SIGKILL'),60000);
    child.once('error',reject);child.once('close',code=>{clearTimeout(timer);resolve({code,stdout,stderr});});
  });
  assert.equal(result.code,0,result.stderr);
  const out=JSON.parse(result.stdout);
  assert.equal(out.skill,CHECKOUT_FILES['skills/pdf2html/SKILL.md'],'a snapshot file is readable');
  assert.equal(out.launcher,CHECKOUT_FILES['scriptahubAgent/deployment/run-skill.mjs']);
  assert.equal(out.reader,CHECKOUT_FILES['scriptahubAgent/site/reader/reader.css']);
  assert.equal(out.dependency,42,'the image dependency directory is visible at its placeholder');
  assert.equal(out.model,IMAGE_FILES['skills/pdf2html/external/native/models/model.bin']);
  assert.equal(out.archive,IMAGE_FILES['skills/pdf2html/external/native/assets.zip'],'a file dependency is bound onto its file placeholder');
  assert.equal(out.override,IMAGE_FILES[OVERRIDE],'the declared override shows the image bytes');
  assert.notEqual(out.override,CHECKOUT_FILES[OVERRIDE]);
  assert.equal(out.checkoutOnly,false);
  for(const [name,code] of Object.entries(out.writes))assert.ok(['EROFS','EACCES','EPERM'].includes(code),`${name} write must be refused, got ${code}`);
  assert.deepEqual(out.visible,[],'service, data, workspace and checkout paths are absent in the sandbox');
  assert.ok(['/src',process.cwd()].some(p=>fs.existsSync(p)),'the host-side checkout exists outside the sandbox, so its absence inside is meaningful');
  assert.equal(fs.readFileSync(path.join(job,'out.txt'),'utf8'),'job','only the job directory is writable');
});
