import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {skillSource,isInstalledPath,installedEntries,installOverrides,dependencyReceipt} from '../deployment/skill-source.mjs';
import {INPUTS_PATH,parseDependencyInputs} from '../deployment/dependency-fingerprint.mjs';
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

const repo=path.resolve(import.meta.dirname,'../..');
const tmp=async t=>{const dir=await fs.mkdtemp(path.join(os.tmpdir(),'scripta-installed-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));return dir;};
const touch=async(root,name,text='x')=>{await fs.mkdir(path.dirname(path.join(root,name)),{recursive:true});await fs.writeFile(path.join(root,name),text);};

test('installedEntries returns exactly the maximal entries that skillSource leaves out',async t=>{
  const root=await tmp(t);
  for(const name of ['pdf2html/scripts/convert.mjs','pdf2html/external/html/package.json','pdf2html/external/native/integrity.json',
    'pdf2html/external/html/node_modules/lib/index.js','pdf2html/external/native/linux-x64/docling.node','pdf2html/external/native/models/m.bin',
    'pdf2html/external/native/sources/a.zip','pdf2html/external/native/licenses/x/LICENSE','pdf2html/external/tools/t','pdf2html/external/docling-source/a.rs',
    'theatrical-audio/runtime/qwen/bin/python','theatrical-audio/runtime/qwen.json','theatrical-audio/runtime/kokoro.requirements.txt',
    'theatrical-audio/models/qwen-custom/w.bin','theatrical-audio/src/__pycache__/a.pyc','theatrical-audio/.env','theatrical-audio/.env.example'])await touch(root,name);
  assert.deepEqual(await installedEntries(root),[
    {path:'pdf2html/external/docling-source',type:'dir'},{path:'pdf2html/external/html/node_modules',type:'dir'},
    {path:'pdf2html/external/native/licenses',type:'dir'},{path:'pdf2html/external/native/linux-x64',type:'dir'},
    {path:'pdf2html/external/native/models',type:'dir'},{path:'pdf2html/external/native/sources/a.zip',type:'file'},
    {path:'pdf2html/external/tools',type:'dir'},{path:'theatrical-audio/.env',type:'file'},
    {path:'theatrical-audio/models',type:'dir'},{path:'theatrical-audio/runtime/qwen',type:'dir'},
    {path:'theatrical-audio/runtime/qwen.json',type:'file'},{path:'theatrical-audio/src/__pycache__',type:'dir'}]);
  const kept=Object.keys(await skillSource(root));
  assert.ok(kept.includes('theatrical-audio/.env.example')&&kept.includes('theatrical-audio/runtime/kokoro.requirements.txt'));
  assert.equal(isInstalledPath('a/node_modules'),true);assert.equal(isInstalledPath('a/.env.example'),false);
  await fs.symlink('/etc',path.join(root,'pdf2html/external/html/node_modules2'));
  await assert.rejects(installedEntries(root),/symlinks/);
});

test('skillSource output is unchanged by the isInstalledPath refactor on the real skills tree',async()=>{
  const source=await skillSource(path.join(repo,'skills'));
  assert.ok(Object.keys(source).length>1000);
  assert.equal(Object.keys(source).some(name=>isInstalledPath(name)),false);
});

test('install partition accepts only the linux-x64 integrity rewrite and builds the receipt',()=>{
  const integrity='pdf2html/external/native/integrity.json';
  const before={'pdf2html/SKILL.md':'a',[integrity]:'b'};
  assert.deepEqual(installOverrides(before,{...before},'linux-arm64'),[]);
  assert.deepEqual(installOverrides(before,{...before},'linux-x64'),[]);
  assert.deepEqual(installOverrides(before,{...before,[integrity]:'c'},'linux-x64'),[{path:'skills/'+integrity,sourceSha256:'b',installedSha256:'c'}]);
  assert.throws(()=>installOverrides(before,{...before,[integrity]:'c'},'linux-arm64'),/changed skill source file: pdf2html\/external/);
  assert.throws(()=>installOverrides(before,{...before,'pdf2html/SKILL.md':'z'},'linux-x64'),/changed skill source file: pdf2html\/SKILL.md/);
  assert.throws(()=>installOverrides(before,{...before,'pdf2html/new.mjs':'n'},'linux-x64'),/set of skill source files/);
  const {'pdf2html/SKILL.md':_,...fewer}=before;
  assert.throws(()=>installOverrides(before,fewer,'linux-x64'),/set of skill source files/);
  assert.deepEqual(dependencyReceipt({dependencyFingerprint:'f'.repeat(64),platform:'linux-x64',skills:['pdf2html'],
    installed:[{path:'pdf2html/external/html/node_modules',type:'dir'}],overrides:[]}),
  {schemaVersion:1,fingerprintVersion:1,dependencyFingerprint:'f'.repeat(64),platform:'linux-x64',skills:['pdf2html'],
    installed:[{path:'skills/pdf2html/external/html/node_modules',type:'dir'}],overrides:[]});
});

test('the manifest stays global-only because skill discovery relies on the read-write workspace bind (decision A)',async()=>{
  const manifest=JSON.parse(await fs.readFile(path.join(repo,'scriptahubAgent/manifest.json'),'utf8'));
  assert.deepEqual(manifest.enableModes,['global'],'Decision A (find the checkout through the global-mode workspace bind) requires enableModes to be exactly ["global"]');
});

// Minimal .dockerignore matcher: anchored patterns, `**`, `*`, `?`, a trailing slash, comments and `!` negation.
// Anything else (character classes, escapes) throws so a new pattern style is noticed instead of misjudged.
function dockerIgnore(text) {
  const rules=text.split('\n').map(line=>line.trim()).filter(line=>line&&!line.startsWith('#')).map(line=>{
    const negated=line.startsWith('!');let pattern=(negated?line.slice(1):line).replace(/^\//,'').replace(/\/$/,'');
    if(/[\\\[\]{}]/.test(pattern))throw new Error('Unsupported .dockerignore pattern: '+line);
    let source='';
    for(let i=0;i<pattern.length;i++) {
      if(pattern.startsWith('**/',i)){source+='(?:.*/)?';i+=2;}
      else if(pattern.startsWith('**',i)){source+='.*';i+=1;}
      else if(pattern[i]==='*')source+='[^/]*';
      else if(pattern[i]==='?')source+='[^/]';
      else source+=pattern[i].replace(/[.+^$()|]/g,'\\$&');
    }
    return {negated,regex:new RegExp('^'+source+'$')};
  });
  return file=>{
    const parts=file.split('/');let excluded=false;
    for(const rule of rules)if(parts.some((_,i)=>rule.regex.test(parts.slice(0,i+1).join('/'))))excluded=!rule.negated;
    return excluded;
  };
}

test('the .dockerignore matcher handles the patterns this repository uses',()=>{
  const ignored=dockerIgnore(['# note','','.git','**/node_modules','**/external/native/linux-*','**/external/native/sources/*.zip','skills/theatrical-audio/runtime/*.json',
    'previews','**/.env','**/.env.*','','!**/.env.example','/.claude','**/external/docling-source/'].join('\n'));
  for(const name of ['.git/config','a/node_modules/x/y.js','skills/a/external/native/linux-x64/docling.node','skills/a/external/native/sources/x.zip',
    'skills/theatrical-audio/runtime/qwen.json','previews/a.html','.env','a/.env.local','.claude/settings.json','skills/a/external/docling-source/crate.rs'])
    assert.equal(ignored(name),true,name);
  for(const name of ['skills/a/external/html/package-lock.json','skills/a/external/native/sources/sources.json','skills/theatrical-audio/runtime/kokoro.requirements.txt',
    'x/previews/a.html','x/.git/config','a/.env.example','sub/.claude/x','envrc/none'])
    assert.equal(ignored(name),false,name);
  assert.throws(()=>dockerIgnore('a[bc]'),/Unsupported/);
});

test('the repository .dockerignore never drops a dependency input or a runtime file the image build copies',async()=>{
  const ignored=dockerIgnore(await fs.readFile(path.join(repo,'.dockerignore'),'utf8'));
  const inputs=parseDependencyInputs(await fs.readFile(path.join(repo,INPUTS_PATH),'utf8'));
  const runtime=['scriptahubAgent/deployment/run-skill.mjs','scriptahubAgent/deployment/verify-skills.mjs','scriptahubAgent/deployment/skills-runtime.json','scriptahubAgent/site/reader/reader.css'];
  assert.ok(inputs.includes(INPUTS_PATH));
  for(const name of [...inputs,...runtime])assert.equal(ignored(name),false,`.dockerignore excludes ${name}, so the image build would not receive it`);
});
