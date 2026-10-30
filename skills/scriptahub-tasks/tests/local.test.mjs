import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {Writable} from 'node:stream';
import {runLocalSkill} from '../scripts/local-skill.mjs';

async function fixture(t) {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'scripta-local-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const runtimeRoot=path.join(root,'runtime'),sourceRoot=path.join(root,'sources');
  await fs.mkdir(runtimeRoot);await fs.mkdir(path.join(sourceRoot,'pdf2html'),{recursive:true});
  await fs.writeFile(path.join(sourceRoot,'pdf2html/SKILL.md'),'test source');
  await fs.writeFile(path.join(runtimeRoot,'source.json'),JSON.stringify({'pdf2html/SKILL.md':crypto.createHash('sha256').update('test source').digest('hex')}));
  await fs.writeFile(path.join(runtimeRoot,'installed.json'),JSON.stringify({platform:`${process.platform}-${process.arch}`,skills:['pdf2html']}));
  return {root,runtimeRoot,sourceRoot};
}
test('skill execution is a local child process with exact arguments, stdin, stdout and exit status',async t=>{
  const f=await fixture(t);
  await fs.writeFile(path.join(f.runtimeRoot,'run-skill.mjs'),`const chunks=[];for await(const x of process.stdin)chunks.push(x);console.log(JSON.stringify({pid:process.pid,args:process.argv.slice(2),input:Buffer.concat(chunks).toString()}));process.exitCode=3;`);
  let output='';const stdout=new Writable({write(chunk,encoding,done){output+=chunk;done();}});
  const code=await runLocalSkill({skill:'pdf2html',args:['doctor','value with spaces'],input:'{}'},{...f,stdout});
  const result=JSON.parse(output);assert.equal(code,3);assert.notEqual(result.pid,process.pid);
  assert.deepEqual(result.args,['pdf2html','doctor','value with spaces']);assert.equal(result.input,'{}');
});
test('missing, outdated or incompatible robot dependencies fail before a skill starts',async t=>{
  const f=await fixture(t);
  await assert.rejects(runLocalSkill({skill:'pdf2html'},{...f,runtimeRoot:path.join(f.root,'missing')}),/not installed in the robot/);
  await fs.writeFile(path.join(f.sourceRoot,'pdf2html/SKILL.md'),'changed');
  await assert.rejects(runLocalSkill({skill:'pdf2html'},f),/outdated/);
  await fs.writeFile(path.join(f.runtimeRoot,'installed.json'),JSON.stringify({platform:'different',skills:['pdf2html']}));
  await assert.rejects(runLocalSkill({skill:'pdf2html'},f),/does not support/);
  await assert.rejects(runLocalSkill({skill:'../private'},f),/Invalid local/);
});
test('aborting a local skill terminates its child rather than leaving work in another agent',async t=>{
  const f=await fixture(t),controller=new AbortController();
  await fs.writeFile(path.join(f.runtimeRoot,'run-skill.mjs'),'setInterval(()=>{},1000);');
  const pending=runLocalSkill({skill:'pdf2html'},{...f,signal:controller.signal});
  const timer=setTimeout(()=>controller.abort(),50);
  try {await assert.rejects(pending,{name:'AbortError'});}finally{clearTimeout(timer);}
});
