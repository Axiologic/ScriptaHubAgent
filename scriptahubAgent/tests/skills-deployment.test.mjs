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
test('installed skill launchers match the hosted runtime inventory',async t=>{
  const run=await fs.mkdtemp(path.join(os.tmpdir(),'scripta-skill-run-'));t.after(()=>fs.rm(run,{recursive:true,force:true}));
  const manifest=JSON.parse(await fs.readFile(new URL('../deployment/skills-runtime.json',import.meta.url),'utf8'));
  assert.deepEqual(Object.keys(launchers).sort(),manifest.skills.slice().sort());
  process.env.SCRIPTA_TEST_PRIVATE_SENTINEL='test-only';
  t.after(()=>{delete process.env.SCRIPTA_TEST_PRIVATE_SENTINEL;});
  const plan=skillCommand('pdf2html',['doctor'],run,'/opt/scriptahub/runtime');
  assert.equal(Object.hasOwn(plan.env,'SCRIPTA_TEST_PRIVATE_SENTINEL'),false);
  assert.equal(plan.command,'/bin/sh');
  assert.deepEqual(plan.args,['/opt/scriptahub/runtime/skills/pdf2html/scripts/pdf2html','doctor']);
  assert.equal(plan.cwd,await fs.realpath(run));
  assert.equal(plan.env.HF_HUB_OFFLINE,'1');
  assert.equal(Object.hasOwn(plan.env,'SCRIPTA_SKILLS_LOCAL'),false);
  assert.equal(Object.hasOwn(plan.env,'SCRIPTA_SKILL_RUNTIME_ROOT'),false);
  assert.equal(plan.env.PDF2HTML_RUNTIME_ROOT,'/opt/scriptahub/runtime/skills/pdf2html');
  assert.throws(()=>skillCommand('../private',[],process.cwd()));
  assert.throws(()=>skillCommand('pdf2html',['bad\0arg'],process.cwd()));
  assert.throws(()=>skillCommand('pdf2html',[],'/'));
});

test('the hosted entrypoint starts and drains its supervisor',async()=>{
  const startup=await fs.readFile(new URL('../deployment/start.mjs',import.meta.url),'utf8');
  assert.match(startup,/new ProcessingService/);assert.match(startup,/await supervisor.listen/);
  assert.match(startup,/onShutdown:.*supervisor.drain/);
  assert.equal(launchers['scriptahub-tasks'],undefined);
});

test('AMD64 build artifacts require the selected source and matching binary checksums', async t => {
  const {installBuiltNative}=await import('../deployment/install-built-native.mjs');
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'scripta-native-build-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const build=path.join(root,'build'),native=path.join(root,'skills/pdf2html/external/native');
  await fs.mkdir(path.join(build,'linux-x64/lib'),{recursive:true});await fs.mkdir(path.join(build,'linux-x64/notices'));
  await fs.mkdir(native,{recursive:true});await fs.writeFile(path.join(native,'integrity.json'),JSON.stringify({files:{}}));
  const {createHash}=await import('node:crypto');const files={};
  for(const name of ['docling.node','lib/libpdfium.so']){
    const bytes=Buffer.from('build artifact '+name);await fs.writeFile(path.join(build,'linux-x64',name),bytes);
    files[name]={bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
  }
  const config={nativeAssetSource:{revision:'a'.repeat(40)}};
  await fs.writeFile(path.join(build,'receipt.json'),JSON.stringify({platform:'linux-x64',sourceRevision:'b'.repeat(40),files}));
  await assert.rejects(installBuiltNative(root,config,'linux-x64',build),/source or platform/);
  await fs.writeFile(path.join(build,'receipt.json'),JSON.stringify({platform:'linux-x64',sourceRevision:config.nativeAssetSource.revision,files}));
  await installBuiltNative(root,config,'linux-x64',build);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(native,'integrity.json'))).files['linux-x64/docling.node'],files['docling.node']);
  await fs.writeFile(path.join(build,'linux-x64/docling.node'),'tampered');
  await assert.rejects(installBuiltNative(root,config,'linux-x64',build),/checksum mismatch/);
});
