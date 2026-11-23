import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { processingRuntime } from '../processing-runtime.mjs';
import { locateSkills, CAPTURE_LIMITS } from '../processing-source.mjs';
import { ProcessingService } from '../processing-service.mjs';
import { skillSource } from '../deployment/skill-source.mjs';
import { dependencyFingerprint, checkoutReader } from '../deployment/dependency-fingerprint.mjs';
import { runtimeFixture, sha256, makeWritable, pathMode, CHECKOUT_FILES, IMAGE_FILES, INSTALLED, OVERRIDE, PLATFORM } from './runtime-fixture.mjs';

const fixture=async(t,options)=>{const f=await runtimeFixture(options);t.after(f.remove);return f;};
const capture=(f,extra={})=>processingRuntime({...f.options,...extra});
const status=(pattern,code=503)=>error=>error.status===code&&pattern.test(error.message);
const NOT_FOUND=/^ScriptaHub skill source not found: no workspace checkout matches \/code \(the agent must run in global mode with the ScriptaHubAgent checkout in the workspace\)$/;
async function tree(root,relative='') {
  const result={};
  for(const entry of await fs.readdir(path.join(root,relative),{withFileTypes:true})) {
    const name=relative?relative+'/'+entry.name:entry.name,stat=await fs.lstat(path.join(root,name));
    if(stat.isDirectory()){result[name]={type:'dir',mode:stat.mode&0o777};Object.assign(result,await tree(root,name));}
    else result[name]={type:stat.isFile()?'file':'other',mode:stat.mode&0o777,bytes:await fs.readFile(path.join(root,name))};
  }
  return result;
}

test('discovery finds the one workspace checkout whose scriptahubAgent is the code root',async t=>{
  const f=await fixture(t);
  assert.deepEqual(locateSkills({codeRoot:f.options.codeRoot,workspace:f.workspace}),{repoRoot:f.checkout,skillsRoot:f.skillsRoot});
  // An empty skillsDir is treated as unset; the env var is never read.
  process.env.SCRIPTA_SKILLS_DIR='/nonexistent';t.after(()=>{delete process.env.SCRIPTA_SKILLS_DIR;});
  assert.deepEqual(locateSkills({codeRoot:f.options.codeRoot,workspace:f.workspace,skillsDir:''}),{repoRoot:f.checkout,skillsRoot:f.skillsRoot});
  assert.equal((await capture(f,{skillsDir:''})).sourceDigests.pdf2html,(await capture(f)).sourceDigests.pdf2html);
  // Ploinky-managed checkouts are candidates too.
  const managed=path.join(f.workspace,'.ploinky/repos/ScriptaHubAgent');
  await fs.mkdir(path.dirname(managed),{recursive:true});await fs.rename(f.checkout,managed);
  assert.deepEqual(locateSkills({codeRoot:path.join(managed,'scriptahubAgent'),workspace:f.workspace}),{repoRoot:managed,skillsRoot:path.join(managed,'skills')});
});

test('discovery skips symlinked candidates and refuses a missing, unset or ambiguous checkout',async t=>{
  const f=await fixture(t),codeRoot=f.options.codeRoot;
  await fs.symlink(f.checkout,path.join(f.workspace,'Linked'));
  const other=path.join(f.workspace,'Other');await fs.mkdir(path.join(other,'skills'),{recursive:true});
  await fs.symlink(codeRoot,path.join(other,'scriptahubAgent'));
  assert.equal(locateSkills({codeRoot,workspace:f.workspace}).repoRoot,f.checkout,'a symlinked checkout or scriptahubAgent is skipped');
  const empty=path.join(f.root,'empty-workspace');await fs.mkdir(empty);
  assert.throws(()=>locateSkills({codeRoot,workspace:empty}),status(NOT_FOUND));
  await assert.rejects(capture(f,{workspace:empty}),status(NOT_FOUND));
  const saved=process.env.WORKSPACE_PATH;delete process.env.WORKSPACE_PATH;t.after(()=>{if(saved!==undefined)process.env.WORKSPACE_PATH=saved;});
  assert.throws(()=>locateSkills({codeRoot}),status(NOT_FOUND));
  assert.throws(()=>locateSkills({codeRoot,workspace:f.workspace,skillsDir:'/nonexistent'}),status(/^ScriptaHub skill source not found/));
  assert.deepEqual(locateSkills({codeRoot:'/elsewhere',workspace:'/elsewhere',skillsDir:f.skillsRoot}),{repoRoot:f.checkout,skillsRoot:f.skillsRoot});
  const copy=path.join(f.workspace,'Copy');await fs.mkdir(path.join(copy,'scriptahubAgent'),{recursive:true});await fs.mkdir(path.join(copy,'skills'));
  const identity=file=>file===codeRoot||file.endsWith('/scriptahubAgent')?{dev:1,ino:7}:{dev:1,ino:9};
  assert.throws(()=>locateSkills({codeRoot,workspace:f.workspace,identity}),status(/^ScriptaHub skill source is ambiguous: 2 checkouts match \/code$/));
});

test('an empty checkout skills directory is refused as missing source',async t=>{
  const inputs='scriptahubAgent/deployment/dependency-inputs.txt';
  const f=await fixture(t,{files:{[inputs]:inputs+'\n'}});
  await makeWritable(f.skillsRoot);await fs.rm(f.skillsRoot,{recursive:true});await fs.mkdir(f.skillsRoot);
  await assert.rejects(capture(f),status(/^ScriptaHub skill source not found: the checkout has no skill files$/));
  // A checkout whose skill has only its dependency inputs left has no source for that skill.
  const g=await fixture(t,{privateFiles:false,files:Object.fromEntries(Object.keys(CHECKOUT_FILES)
    .filter(name=>name.startsWith('skills/pdf2html/')&&!name.includes('/external/')).map(name=>[name,null]))});
  await fs.rm(path.join(g.skillsRoot,'pdf2html/external'),{recursive:true});await fs.mkdir(path.join(g.skillsRoot,'other'));await fs.writeFile(path.join(g.skillsRoot,'other/SKILL.md'),'x');
  await assert.rejects(capture(g),error=>status(/^Skill dependency fingerprint failed: a dependency input is missing or unreadable$/)(error)
    &&!/(^|[\s'"(])\//.test(error.message),'missing dependency inputs fail closed without naming service paths');
  const h=await fixture(t,{privateFiles:false,files:Object.fromEntries(Object.keys(CHECKOUT_FILES)
    .filter(name=>name.startsWith('skills/pdf2html/')&&!name.includes('/external/')).map(name=>[name,null])),override:false});
  await fs.rm(path.join(h.skillsRoot,'pdf2html/external'),{recursive:true});
  await h.write('scriptahubAgent/deployment/dependency-inputs.txt',inputs+'\n');
  await h.writeReceipt({...h.receipt,dependencyFingerprint:(await dependencyFingerprint(checkoutReader(h.checkout))).fingerprint});
  await assert.rejects(capture(h),status(/^ScriptaHub skill source not found: pdf2html$/));
  for(const each of [f,g,h])assert.deepEqual(await each.snapshots(),[]);
});

test('preflight refuses an image without a receipt and a receipt whose fingerprint differs from the checkout',async t=>{
  const f=await fixture(t),service=new ProcessingService(f.dataDir,{...f.options,launch:()=>{throw new Error('must not launch');}});
  t.after(()=>service.drain());
  await f.writeReceipt({...f.receipt,dependencyFingerprint:'0'.repeat(64)});
  await assert.rejects(service.preflight(),status(/^Skill dependencies differ from the agent image \(checkout [a-f0-9]{12}, image 000000000000\); rebuild docker\.io\/assistos\/scriptahub-agent from this checkout\.$/));
  await fs.rm(path.join(f.runtimeRoot,'dependencies.json'));
  await assert.rejects(service.preflight(),status(/predates mounted skill sources/));
  await fs.rm(f.runtimeRoot,{recursive:true});
  await assert.rejects(service.preflight(),status(/^ScriptaHub processing runtime is unavailable$/));
  assert.deepEqual(await f.snapshots(),[]);
});

test('a dependency input edit in the checkout is refused until the image is rebuilt',async t=>{
  const f=await fixture(t);await capture(f);
  await f.write('skills/pdf2html/external/html/package-lock.json','{"lockfileVersion":3}\n');
  await assert.rejects(capture(f),status(/rebuild docker\.io\/assistos\/scriptahub-agent/));
  for(const [text,reason] of [[CHECKOUT_FILES['scriptahubAgent/deployment/dependency-inputs.txt'].replaceAll('\n','\r\n'),/LF/],
    ['scriptahubAgent/deployment/dependency-inputs.txt\nskills/b\nskills/a\n',/ascending/],['scriptahubAgent/deployment/dependency-inputs.txt\nskills/../x\n',/Invalid dependency input path/]]) {
    await f.write('scriptahubAgent/deployment/dependency-inputs.txt',text);
    await assert.rejects(capture(f),status(new RegExp('^Skill dependency fingerprint failed: .*'+reason.source)));
  }
});

test('invalid or orphaned image receipts are refused',async t=>{
  const f=await fixture(t),invalid=status(/^Invalid image dependency receipt$/);
  const refuse=async(receipt,check=invalid)=>{await f.writeReceipt(receipt);await assert.rejects(capture(f),check,JSON.stringify(receipt).slice(0,200));};
  await refuse('{not json');
  await refuse({...f.receipt,schemaVersion:2});
  await refuse({...f.receipt,extra:true});
  await refuse({...f.receipt,dependencyFingerprint:f.receipt.dependencyFingerprint.toUpperCase()});
  await refuse({...f.receipt,skills:['../x']});
  await refuse({...f.receipt,installed:[...INSTALLED,{path:'skills/pdf2html/external/native/linux-arm64',type:'dir'}]},invalid);
  await refuse({...f.receipt,installed:[{path:'skills/pdf2html/scripts',type:'dir'}]},invalid);
  await refuse({...f.receipt,installed:[{path:'skills/pdf2html/external/html/node_modules',type:'file'}]},invalid);
  await refuse({...f.receipt,installed:[{path:'skills/pdf2html/external/html/node_modules',type:'dir'},{path:'skills/pdf2html/external/html/node_modules/dep',type:'dir'}]},invalid);
  await refuse({...f.receipt,installed:[{path:'skills/pdf2html/external/../node_modules',type:'dir'}]},invalid);
  await refuse({...f.receipt,installed:[...INSTALLED].reverse()},invalid);
  await refuse({...f.receipt,overrides:[{...f.receipt.overrides[0],path:'skills/pdf2html/SKILL.md'}]},invalid);
  await refuse({...f.receipt,overrides:[{...f.receipt.overrides[0],sourceSha256:'0'.repeat(64)}]},invalid);
  await refuse({...f.receipt,overrides:[{...f.receipt.overrides[0],installedSha256:'0'.repeat(64)}]},status(/^Image dependency override does not match its receipt/));
  await refuse({...f.receipt,platform:'linux-sparc'},status(/^ScriptaHub processing runtime does not support this platform$/));
  assert.deepEqual(await f.snapshots(),[]);
});

test('the snapshot holds exactly the captured source, launchers and typed placeholders',async t=>{
  const long='skills/pdf2html/src/'+['a','b','c'].map(c=>c.repeat(60)).join('/')+'.txt';
  const f=await fixture(t,{files:{'skills/pdf2html/src/ünïcode-名前.mjs':'export const unicode="ü";\n','skills/pdf2html/src/empty.txt':'',[long]:'long path\n'}});
  assert.ok(long.length>=200);
  const runtime=await capture(f),snapshot=await tree(runtime.view.snapshot);
  assert.equal(runtime.view.snapshot,path.join(f.options.snapshotRoot,'rt-'+runtime.runtimeId));
  for(const name of Object.keys(snapshot)) {
    assert.ok(!/(^|\/)(\.env|\.apikeys|audio\.config\.json|output)(\/|$)/.test(name),name);
    if(/(^|\/)node_modules(\/|$)/.test(name))assert.equal(name,'skills/pdf2html/external/html/node_modules','only the declared placeholder is a node_modules entry');
  }
  assert.equal(snapshot['skills/pdf2html/scripts/pdf2html'].mode,0o555);
  assert.equal(snapshot['skills/pdf2html/SKILL.md'].mode,0o444);
  assert.equal(snapshot['skills/pdf2html/SKILL.md'].bytes.toString(),CHECKOUT_FILES['skills/pdf2html/SKILL.md']);
  assert.equal(snapshot['skills/pdf2html/src/ünïcode-名前.mjs'].bytes.toString(),'export const unicode="ü";\n');
  assert.equal(snapshot['skills/pdf2html/src/empty.txt'].bytes.length,0);
  assert.equal(snapshot[long].bytes.toString(),'long path\n');
  assert.equal(snapshot[OVERRIDE].bytes.toString(),CHECKOUT_FILES[OVERRIDE],'the snapshot keeps the checkout bytes; the image override is bound over them');
  for(const [name,target] of [['scriptahubAgent/deployment/run-skill.mjs','run-skill.mjs'],['scriptahubAgent/deployment/verify-skills.mjs','verify-skills.mjs'],
    ['scriptahubAgent/deployment/skills-runtime.json','skills-runtime.json'],['scriptahubAgent/site/reader/reader.css','reader/reader.css']])
    assert.equal(snapshot[target].bytes.toString(),CHECKOUT_FILES[name]);
  for(const entry of INSTALLED) {
    assert.equal(snapshot[entry.path].type,entry.type,entry.path);
    if(entry.type==='file')assert.equal(snapshot[entry.path].bytes.length,0);
    else assert.deepEqual(Object.keys(snapshot).filter(name=>name.startsWith(entry.path+'/')),[]);
  }
  assert.ok(Object.values(snapshot).every(entry=>entry.type==='dir'?entry.mode===0o555:[0o444,0o555].includes(entry.mode)));
  assert.equal((await fs.lstat(runtime.view.snapshot)).mode&0o777,0o555);
  // Digests are the old receipt algorithm applied to skillSource(): unicode, long and empty files included.
  const source=await skillSource(f.skillsRoot);
  const expected=sha256(JSON.stringify(Object.fromEntries(Object.entries(source).filter(([name])=>name.startsWith('pdf2html/')))));
  assert.equal(runtime.sourceDigests.pdf2html,expected);
  assert.deepEqual(runtime.view.binds,[...INSTALLED,{path:OVERRIDE}].map(entry=>({source:path.join(f.runtimeRoot,entry.path),destination:'/opt/scriptahub/runtime/'+entry.path})));
  assert.equal(runtime.platform,PLATFORM);
});

test('captures are idempotent and every hit is revalidated; a tampered unpinned snapshot is rebuilt',async t=>{
  const f=await fixture(t),first=await capture(f),second=await capture(f);
  assert.equal(second.runtimeId,first.runtimeId);assert.deepEqual(await f.snapshots(),['rt-'+first.runtimeId]);
  const file=path.join(first.view.snapshot,'skills/pdf2html/SKILL.md');
  await makeWritable(first.view.snapshot);await fs.chmod(file,0o644);await fs.writeFile(file,'tampered');
  const third=await capture(f);
  assert.equal(third.runtimeId,first.runtimeId);assert.equal(await fs.readFile(file,'utf8'),CHECKOUT_FILES['skills/pdf2html/SKILL.md']);
  assert.equal((await fs.lstat(file)).mode&0o777,0o444);assert.deepEqual(await f.snapshots(),['rt-'+first.runtimeId]);
  await makeWritable(first.view.snapshot);await fs.writeFile(path.join(first.view.snapshot,'skills/extra'),'x');
  await assert.rejects(capture(f,{pinned:new Set([first.runtimeId])}),status(/^Skill runtime snapshot is corrupted$/));
  assert.equal(await fs.readFile(path.join(first.view.snapshot,'skills/extra'),'utf8'),'x','a pinned snapshot is never rewritten');
  await capture(f);await assert.rejects(fs.access(path.join(first.view.snapshot,'skills/extra')),{code:'ENOENT'});
});

test('any checkout edit gives a new runtime; old snapshots are pruned unless pinned',async t=>{
  const f=await fixture(t),first=await capture(f);
  await f.write('skills/AGENTS.md','edited guidance\n');
  const second=await capture(f,{pinned:new Set([first.runtimeId])});
  assert.notEqual(second.runtimeId,first.runtimeId);assert.deepEqual(second.sourceDigests,first.sourceDigests);
  assert.deepEqual(await f.snapshots(),['rt-'+first.runtimeId,'rt-'+second.runtimeId].sort());
  await fs.chmod(path.join(f.checkout,'skills/pdf2html/src/cli.mjs'),0o755);
  const third=await capture(f);
  assert.notEqual(third.runtimeId,second.runtimeId,'the exec bit is part of the identity');assert.deepEqual(await f.snapshots(),['rt-'+third.runtimeId]);
  assert.equal((await fs.lstat(path.join(third.view.snapshot,'skills/pdf2html/src/cli.mjs'))).mode&0o777,0o555);
});

test('source edited between hashing and copying is refused and leaves no snapshot',async t=>{
  const f=await fixture(t);
  const hook=async stage=>{if(stage==='captured')await f.write('skills/pdf2html/src/cli.mjs','export const cli=2;\n');};
  await assert.rejects(capture(f,{hook}),status(/^Skill source changed during capture; retry$/));
  assert.deepEqual(await f.snapshots(),[]);
});

test('a directory swapped for a link to a private tree during capture is refused and nothing is copied',async t=>{
  for(const depth of ['leaf','ancestor']) {
    const f=await fixture(t),fake=path.join(f.root,'private');
    await fs.mkdir(path.join(fake,'src'),{recursive:true});await fs.writeFile(path.join(fake,'src/cli.mjs'),'PRIVATE');await fs.writeFile(path.join(fake,'SKILL.md'),'PRIVATE');
    let swapped=false;
    const hook=async(stage,name,pass)=>{
      if(stage!=='directory'||name!=='pdf2html/src'||pass!==1)return;swapped=true;
      const target=depth==='leaf'?path.join(f.skillsRoot,'pdf2html/src'):path.join(f.skillsRoot,'pdf2html');
      await fs.rename(target,path.join(f.root,'moved-'+depth));await fs.symlink(depth==='leaf'?path.join(fake,'src'):fake,target);
    };
    // Anchored (Linux): the leaf open refuses the link; an ancestor swapped after it was opened keeps being read through its
    // descriptor (the original bytes), and the consistency pass then refuses. The path reader refuses both at the open.
    const expected=depth==='ancestor'&&!pathMode?/^Skill source changed during capture; retry$/:/^Skill source could not be captured safely: pdf2html\/src$/;
    await assert.rejects(capture(f,{hook}),status(expected),depth);
    assert.ok(swapped);assert.deepEqual(await f.snapshots(),[],depth);
  }
});

test('anchored reads keep reading a directory through its descriptor when an ancestor is swapped and restored',async t=>{
  const f=await fixture(t),fake=path.join(f.root,'private'),moved=path.join(f.root,'moved'),target=path.join(f.skillsRoot,'pdf2html');
  await fs.mkdir(path.join(fake,'src'),{recursive:true});await fs.writeFile(path.join(fake,'src/cli.mjs'),'PRIVATE');await fs.writeFile(path.join(fake,'SKILL.md'),'PRIVATE');
  const hook=async(stage,name,pass)=>{
    if(stage==='directory'&&name==='pdf2html/src'&&pass===1){await fs.rename(target,moved);await fs.symlink(fake,target);}
    if(stage==='captured'){await fs.rm(target);await fs.rename(moved,target);}
  };
  if(pathMode) {
    // The path reader cannot hold a descriptor chain; it refuses as soon as the ancestor no longer matches.
    await assert.rejects(capture(f,{hook}),status(/^Skill source could not be captured safely: pdf2html\/src$/));
    return;
  }
  const runtime=await capture(f,{hook});
  assert.equal(await fs.readFile(path.join(runtime.view.snapshot,'skills/pdf2html/src/cli.mjs'),'utf8'),CHECKOUT_FILES['skills/pdf2html/src/cli.mjs']);
  const files=Object.entries(await tree(runtime.view.snapshot)).filter(([,entry])=>entry.type==='file');
  assert.ok(files.length>5);assert.ok(files.every(([,entry])=>!entry.bytes.includes('PRIVATE')),'no byte of the private tree reaches the snapshot');
});

test('links, hard links and special files in the checkout or launchers are refused',async t=>{
  const f=await fixture(t);
  await fs.symlink(path.join(f.root,'runtime'),path.join(f.skillsRoot,'pdf2html/linked'));
  await assert.rejects(capture(f),status(/^Skill source must not contain symlinks: pdf2html\/linked$/));
  await fs.rm(path.join(f.skillsRoot,'pdf2html/linked'));
  await fs.link(path.join(f.skillsRoot,'pdf2html/SKILL.md'),path.join(f.root,'second-name'));
  await assert.rejects(capture(f),status(/^Skill source could not be captured safely: pdf2html\/SKILL\.md$/));
  await fs.rm(path.join(f.root,'second-name'));
  const launcher=path.join(f.options.codeRoot,'deployment/run-skill.mjs');
  await fs.rename(launcher,path.join(f.root,'run-skill.mjs'));await fs.symlink(path.join(f.root,'run-skill.mjs'),launcher);
  await assert.rejects(capture(f),status(/^Skill launcher could not be captured safely: run-skill\.mjs$/));
  await fs.rm(launcher);await fs.rename(path.join(f.root,'run-skill.mjs'),launcher);
  // Installed-path names in the checkout are skipped even when they are links, like skillSource does.
  await fs.symlink('/etc',path.join(f.skillsRoot,'pdf2html/node_modules/escape'));
  assert.match((await capture(f)).runtimeId,/^[a-f0-9]{64}$/);
});

test('capture refuses source above the file or byte limit',async t=>{
  assert.deepEqual({...CAPTURE_LIMITS},{files:20000,bytes:256*1024**2});
  const f=await fixture(t);
  await assert.rejects(capture(f,{limits:{files:3,bytes:CAPTURE_LIMITS.bytes}}),status(/^Skill source exceeds the capture limit$/));
  await assert.rejects(capture(f,{limits:{files:CAPTURE_LIMITS.files,bytes:40}}),status(/^Skill source exceeds the capture limit$/));
  assert.deepEqual(await f.snapshots(),[]);
});

test('the image installed paths must exist with their declared type',async t=>{
  const f=await fixture(t);
  await fs.rm(path.join(f.runtimeRoot,'skills/pdf2html/external/native/models'),{recursive:true});
  await assert.rejects(capture(f),status(/^Invalid image dependency receipt$/));
  await fs.writeFile(path.join(f.runtimeRoot,'skills/pdf2html/external/native/models'),IMAGE_FILES['skills/pdf2html/external/native/models/model.bin']);
  await assert.rejects(capture(f),status(/^Invalid image dependency receipt$/));
  await fs.rm(path.join(f.runtimeRoot,'skills/pdf2html/external/native/models'));
  await fs.symlink(path.join(f.runtimeRoot,'skills/pdf2html/external/html'),path.join(f.runtimeRoot,'skills/pdf2html/external/native/models'));
  await assert.rejects(capture(f),status(/^Invalid image dependency receipt$/),'a linked image entry is refused');
});

test('a skills root replaced by a link, or anchored reads off Linux, fail closed with a 503',async t=>{
  const f=await fixture(t);
  const {repoRoot,skillsRoot}=locateSkills({codeRoot:f.options.codeRoot,workspace:f.workspace});
  await fs.rename(skillsRoot,path.join(f.root,'real-skills'));await fs.symlink(path.join(f.root,'real-skills'),skillsRoot);
  await assert.rejects(capture(f),status(/^ScriptaHub skill source not found: the matching checkout has no skills directory$/),'discovery refuses a linked skills root');
  const {captureRuntime,imageReceipt}=await import('../processing-source.mjs');
  const image=await imageReceipt(f.runtimeRoot);
  await fs.rm(skillsRoot);await fs.rename(path.join(f.root,'real-skills'),skillsRoot);
  // A skills root that is a link by the time the walk opens it is never followed.
  const linked=path.join(f.root,'skills-link');await fs.symlink(skillsRoot,linked);
  await assert.rejects(captureRuntime({...f.options,skillsRoot:linked,repoRoot,image}),status(/^Skill source could not be opened safely$/));
  if(process.platform!=='linux')await assert.rejects(capture(f,{pathMode:false}),status(/^Anchored source reads require Linux with \/proc\/self\/fd$/));
  else await assert.rejects(capture(f,{pathMode:true}),status(/^Path-based source reads are refused on Linux$/));
  assert.deepEqual(await f.snapshots(),[]);
});

test('the discovery override is an option only: the manifest and the service never read SCRIPTA_SKILLS_DIR',async()=>{
  for(const file of ['../manifest.json','../processing-source.mjs','../processing-runtime.mjs','../processing-service.mjs','../deployment/start.mjs'])
    assert.doesNotMatch(await fs.readFile(new URL(file,import.meta.url),'utf8'),/SCRIPTA_SKILLS_DIR/,file);
});
