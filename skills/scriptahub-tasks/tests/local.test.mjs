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
test('robot steps find each selected skill at its RoboTeam mount, named by SKILL.md',async t=>{
  const f=await fixture(t);
  // RoboTeam mounts every selected skill as /workspace/roboteam-skill-<n>, not under its own name.
  const mounted=path.join(f.root,'workspace'),skill=path.join(mounted,'roboteam-skill-3');
  await fs.mkdir(path.join(mounted,'roboteam-skill-0'),{recursive:true});await fs.mkdir(skill);
  await fs.writeFile(path.join(mounted,'roboteam-skill-0/SKILL.md'),'---\nname: scriptahub-tasks\n---\n');
  const source='---\nname: pdf2html\n---\n';
  await fs.writeFile(path.join(skill,'SKILL.md'),source);
  await fs.writeFile(path.join(f.runtimeRoot,'source.json'),JSON.stringify({'pdf2html/SKILL.md':crypto.createHash('sha256').update(source).digest('hex')}));
  await fs.writeFile(path.join(f.runtimeRoot,'run-skill.mjs'),'process.exitCode=0;');
  assert.equal(await runLocalSkill({skill:'pdf2html'},{...f,sourceRoot:mounted}),0);
  await fs.rm(skill,{recursive:true});
  await assert.rejects(runLocalSkill({skill:'pdf2html'},{...f,sourceRoot:mounted}),/pdf2html skill sources are not available to this robot step/);
});
// The robot image's installed skill copy differs from the recorded sources by design (on AMD64 the build
// adds the compiled PDF engine to pdf2html's integrity.json), so it must never be the copy that is verified.
async function installedCopy(t) {
  const f=await fixture(t),source='---\nname: pdf2html\n---\n';
  const installed=path.join(f.runtimeRoot,'skills');
  await fs.mkdir(path.join(installed,'pdf2html'),{recursive:true});
  await fs.writeFile(path.join(installed,'pdf2html/SKILL.md'),source+'installed build change\n');
  await fs.writeFile(path.join(f.runtimeRoot,'source.json'),JSON.stringify({'pdf2html/SKILL.md':crypto.createHash('sha256').update(source).digest('hex')}));
  await fs.writeFile(path.join(f.runtimeRoot,'run-skill.mjs'),'process.exitCode=0;');
  return {...f,installed,source};
}
test('a helper started from the installed runtime copy verifies the sources at the robot skill mount',async t=>{
  const f=await installedCopy(t);
  const skills=path.join(f.root,'skills');await fs.mkdir(path.join(skills,'pdf2html'),{recursive:true});
  await fs.writeFile(path.join(skills,'pdf2html/SKILL.md'),f.source);
  assert.equal(await runLocalSkill({skill:'pdf2html'},{...f,sourceRoot:f.installed,mountRoots:[path.join(f.root,'absent'),skills]}),0);
  // The mounted copy is still checked: a changed mount is refused rather than replaced by the installed copy.
  await fs.writeFile(path.join(skills,'pdf2html/SKILL.md'),'changed');
  await assert.rejects(runLocalSkill({skill:'pdf2html'},{...f,sourceRoot:f.installed,mountRoots:[skills]}),/outdated/);
});
test('the installed copy is recognised through a symlink and the RoboTeam workspace mount layout is accepted',async t=>{
  const f=await installedCopy(t);
  const link=path.join(f.root,'linked-skills');await fs.symlink(f.installed,link);
  const workspace=path.join(f.root,'workspace');await fs.mkdir(path.join(workspace,'roboteam-skill-2'),{recursive:true});
  await fs.writeFile(path.join(workspace,'roboteam-skill-2/SKILL.md'),f.source);
  assert.equal(await runLocalSkill({skill:'pdf2html'},{...f,sourceRoot:link,mountRoots:[workspace]}),0);
});
test('without a skill mount, a helper started from the installed copy is refused with the mounted path to use',async t=>{
  const f=await installedCopy(t);
  await assert.rejects(runLocalSkill({skill:'pdf2html'},{...f,sourceRoot:f.installed,mountRoots:[path.join(f.root,'absent')]}),
    /must come from the robot's skill mount, not the installed runtime copy; run scriptahub-tasks from its mounted skill directory \(for example \/skills\/scriptahub-tasks\/scripts\/run\.mjs\)/);
});
test('the first mount holding the skill is the one verified, so a matching later mount cannot mask a changed earlier one',async t=>{
  const f=await installedCopy(t);
  const skills=path.join(f.root,'skills'),workspace=path.join(f.root,'workspace');
  await fs.mkdir(path.join(skills,'pdf2html'),{recursive:true});await fs.mkdir(path.join(workspace,'pdf2html'),{recursive:true});
  await fs.writeFile(path.join(skills,'pdf2html/SKILL.md'),'---\nname: pdf2html\n---\nchanged\n');
  await fs.writeFile(path.join(workspace,'pdf2html/SKILL.md'),f.source);
  await assert.rejects(runLocalSkill({skill:'pdf2html'},{...f,sourceRoot:f.installed,mountRoots:[skills,workspace]}),/outdated/);
});
