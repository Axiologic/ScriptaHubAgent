import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {skillSource} from '../deployment/skill-source.mjs';
import {skillCommand,launchers} from '../deployment/run-skill.mjs';

test('runtime source comparison ignores installed libraries but detects edited skill code and unsafe links',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'scripta-source-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const write=async(name,text)=>{await fs.mkdir(path.dirname(path.join(root,name)),{recursive:true});await fs.writeFile(path.join(root,name),text);};
  await write('pdf2html/scripts/convert.mjs','original');const before=await skillSource(root);
  await write('pdf2html/external/runtime/node_modules/library/index.js','installed');
  await write('pdf2html/external/native/linux-arm64/docling.node','installed');
  await write('theatrical-audio/runtime/qwen.json','installed');
  await write('pdf2html/external/docling-source/crates/engine.rs','downloaded upstream source');
  await write('pdf2html/external/native/licenses/docling/LICENSE','downloaded notice');
  assert.deepEqual(await skillSource(root),before);
  await write('pdf2html/scripts/convert.mjs','changed');assert.notDeepEqual(await skillSource(root),before);
  await fs.symlink('/etc/passwd',path.join(root,'outside'));await assert.rejects(skillSource(root),/symlinks/);
});
test('every owned skill launches locally inside the existing robot execution boundary',async()=>{
  const manifest=JSON.parse(await fs.readFile(new URL('../deployment/skills-runtime.json',import.meta.url),'utf8'));
  assert.deepEqual(Object.keys(launchers).sort(),manifest.skills.slice().sort());
  const plan=skillCommand('pdf2html',['doctor'],process.cwd(),'/usr/local/share/scriptahub/runtime');
  assert.equal(plan.command,'/bin/sh');
  assert.deepEqual(plan.args,['/usr/local/share/scriptahub/runtime/skills/pdf2html/scripts/pdf2html','doctor']);
  assert.equal(plan.cwd,await fs.realpath(process.cwd()));
  assert.equal(plan.env.SCRIPTA_SKILLS_LOCAL,'1');
  assert.equal(plan.env.PDF2HTML_RUNTIME_ROOT,'/usr/local/share/scriptahub/runtime/skills/pdf2html');
  assert.throws(()=>skillCommand('../private',[],process.cwd()));
  assert.throws(()=>skillCommand('pdf2html',['bad\0arg'],process.cwd()));
  assert.throws(()=>skillCommand('pdf2html',[],'/'));
});

test('the robot image profile installs local dependencies without a remote execution capability',async()=>{
  const profile=await fs.readFile(new URL('../deployment/Dockerfile.robot',import.meta.url),'utf8');
  assert.match(profile,/FROM \$\{ROBOTEAM_BASE_IMAGE\}/);
  for (const required of ['python3.11','chromium','libreoffice-writer','poppler-utils','qpdf','prepare-skills.mjs','verify-skills.mjs']) assert.ok(profile.includes(required));
  assert.ok(profile.includes('/usr/local/share/scriptahub/runtime'));
  const manifest=JSON.parse(await fs.readFile(new URL('../manifest.json',import.meta.url),'utf8'));
  assert.equal(manifest.skillRuntime,undefined);
});
