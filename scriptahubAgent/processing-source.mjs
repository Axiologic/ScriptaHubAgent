import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { isInstalledPath, INSTALL_OVERRIDES } from './deployment/skill-source.mjs';
import { dependencyFingerprint, checkoutReader } from './deployment/dependency-fingerprint.mjs';
import { openTree, listDirectory, openDirectory, closeDirectory, readRegularFile } from './anchored-read.mjs';

// Skills run from a service-owned snapshot of the mounted checkout. The image only supplies the installed dependency
// paths named by its receipt, which the sandbox binds read-only onto empty placeholders in the snapshot.
export const RUNTIME_PATH='/opt/scriptahub/runtime';
export const CAPTURE_LIMITS=Object.freeze({files:20000,bytes:256*1024**2});
const fail=(message,status=503)=>{throw Object.assign(new Error(message),{status});};
const sha256=value=>crypto.createHash('sha256').update(value).digest('hex');
const sorted=entries=>entries.sort(([a],[b])=>a<b?-1:a>b?1:0);
const SKILL=/^[a-z0-9]+(?:-[a-z0-9]+)*$/, HEX=/^[a-f0-9]{64}$/, EMPTY=Buffer.alloc(0);
const PREDATES='The scriptahub-agent image predates mounted skill sources; publish an image from this ScriptaHubAgent revision or later.';
const INVALID_RECEIPT='Invalid image dependency receipt';
const NOT_FOUND='ScriptaHub skill source not found: no workspace checkout matches /code (the agent must run in global mode with the ScriptaHubAgent checkout in the workspace)';
const CHANGED='Skill source changed during capture; retry';
const LIMIT='Skill source exceeds the capture limit';
// [directory under the code root, file, path in the snapshot]
const LAUNCHERS=[['deployment','run-skill.mjs','run-skill.mjs'],['deployment','verify-skills.mjs','verify-skills.mjs'],
  ['deployment','skills-runtime.json','skills-runtime.json'],['site/reader','reader.css','reader/reader.css']];
const relativeSkillPath=value=>typeof value==='string'&&/^skills\/[a-z0-9-]+\//.test(value)&&!/[\\\0-\x1f\x7f]/.test(value)
  &&value.split('/').every(part=>part&&part!=='.'&&part!=='..');
const exactKeys=(value,keys)=>!!value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join()===[...keys].sort().join();

// A non-empty skillsDir (tests only) is used directly. Otherwise the checkout is the unique workspace directory whose
// scriptahubAgent folder is the same directory as the code root (global mode binds the workspace at its own path).
export function locateSkills({codeRoot,workspace=process.env.WORKSPACE_PATH,skillsDir,identity=file=>fs.statSync(file)}={}) {
  if(typeof skillsDir==='string'&&skillsDir) {
    let skillsRoot;
    try {skillsRoot=fs.realpathSync(skillsDir);if(!fs.lstatSync(skillsRoot).isDirectory())throw new Error('not a directory');}
    catch {fail('ScriptaHub skill source not found: the configured skills directory is unavailable');}
    return {repoRoot:path.dirname(skillsRoot),skillsRoot};
  }
  let code;
  try {const stat=identity(codeRoot);code={dev:stat.dev,ino:stat.ino};} catch {fail(NOT_FOUND);}
  if(typeof workspace!=='string'||!path.isAbsolute(workspace))fail(NOT_FOUND);
  const matches=[];
  for(const parent of [workspace,path.join(workspace,'.ploinky','repos')]) {
    let entries;try {entries=fs.readdirSync(parent,{withFileTypes:true});} catch {continue;}
    for(const entry of entries) {
      if(!entry.isDirectory())continue;
      const candidate=path.join(parent,entry.name),agent=path.join(candidate,'scriptahubAgent');
      try {
        if(!fs.lstatSync(candidate).isDirectory()||!fs.lstatSync(agent).isDirectory())continue;
        const stat=identity(agent);if(stat.dev===code.dev&&stat.ino===code.ino)matches.push(candidate);
      } catch {continue;}
    }
  }
  if(!matches.length)fail(NOT_FOUND);
  if(matches.length>1)fail(`ScriptaHub skill source is ambiguous: ${matches.length} checkouts match /code`);
  const skillsRoot=path.join(matches[0],'skills');
  try {if(!fs.lstatSync(skillsRoot).isDirectory())throw new Error('not a directory');}
  catch {fail('ScriptaHub skill source not found: the matching checkout has no skills directory');}
  return {repoRoot:matches[0],skillsRoot};
}

export async function imageReceipt(runtimeRoot=RUNTIME_PATH) {
  const file=path.join(runtimeRoot,'dependencies.json');let bytes,receipt;
  try {if(!fs.lstatSync(file).isFile())throw new Error('not a file');bytes=fs.readFileSync(file);}
  catch(error) {
    if(error.code!=='ENOENT')fail(INVALID_RECEIPT);
    if(!fs.existsSync(runtimeRoot))fail('ScriptaHub processing runtime is unavailable');
    fail(PREDATES);
  }
  try {receipt=JSON.parse(bytes.toString('utf8'));} catch {fail(INVALID_RECEIPT);}
  if(!exactKeys(receipt,['schemaVersion','fingerprintVersion','dependencyFingerprint','platform','skills','installed','overrides'])
    ||receipt.schemaVersion!==1||receipt.fingerprintVersion!==1||!HEX.test(receipt.dependencyFingerprint||'')
    ||typeof receipt.platform!=='string'||!/^[a-z0-9]+-[a-z0-9_]+$/.test(receipt.platform)
    ||!Array.isArray(receipt.skills)||!receipt.skills.length||receipt.skills.some(skill=>typeof skill!=='string'||!SKILL.test(skill))
    ||new Set(receipt.skills).size!==receipt.skills.length||!Array.isArray(receipt.installed)||!Array.isArray(receipt.overrides))fail(INVALID_RECEIPT);
  // Installed paths are the maximal entries the source partition leaves out, so a placeholder never hides captured source.
  const installed=new Set();
  receipt.installed.forEach((entry,index)=>{
    if(!exactKeys(entry,['path','type'])||!['dir','file'].includes(entry.type)||!relativeSkillPath(entry.path)
      ||!isInstalledPath(entry.path.slice('skills/'.length))||(index&&receipt.installed[index-1].path>=entry.path))fail(INVALID_RECEIPT);
    installed.add(entry.path);
  });
  const nested=value=>value.split('/').slice(0,-1).some((part,index,parts)=>installed.has(parts.slice(0,index+1).join('/')));
  if(receipt.installed.some(entry=>nested(entry.path)))fail(INVALID_RECEIPT);
  const allowed=INSTALL_OVERRIDES.map(name=>'skills/'+name),overrides=new Set();
  for(const entry of receipt.overrides) {
    if(!exactKeys(entry,['path','sourceSha256','installedSha256'])||!allowed.includes(entry.path)||overrides.has(entry.path)
      ||!HEX.test(entry.sourceSha256||'')||!HEX.test(entry.installedSha256||'')||installed.has(entry.path)||nested(entry.path))fail(INVALID_RECEIPT);
    overrides.add(entry.path);
  }
  if(receipt.platform!==`${process.platform}-${process.arch}`)fail('ScriptaHub processing runtime does not support this platform');
  return {receipt,bytes};
}

// A root that cannot be opened safely is a 503; platform refusals keep their own (path-free) message.
async function openRoot(directory,pathMode,label) {
  try {return await openTree(directory,{pathMode});} catch(error) {fail(error.code?label+' could not be opened safely':error.message);}
}
// One pass over the source: every entry is opened anchored, without following links, and read once.
async function walkSkills(skillsRoot,{limits,hook,pathMode,pass}) {
  const files=new Map();let total=0;
  const root=await openRoot(skillsRoot,pathMode,'Skill source');
  const visit=async(dir,relative)=>{
    for(const entry of await listDirectory(dir)) {
      const name=relative?relative+'/'+entry.name:entry.name;
      if(isInstalledPath(name))continue;
      try {
        if(/[\\\0]/.test(entry.name))fail('Invalid skill source path: '+name);
        if(entry.isSymbolicLink())fail('Skill source must not contain symlinks: '+name);
        if(entry.isDirectory()) {
          await hook('directory',name,pass);
          const child=await openDirectory(dir,entry.name);
          try {await visit(child,name);} finally {await closeDirectory(child);}
        } else if(entry.isFile()) {
          if(files.size>=limits.files)fail(LIMIT);
          const {bytes,mode}=await readRegularFile(dir,entry.name,{admit:size=>{total+=size;if(total>limits.bytes)fail(LIMIT);}});
          files.set(name,{bytes,sha256:sha256(bytes),exec:(mode&0o100)!==0});
        } else fail('Unsupported skill source entry: '+name);
      } catch(error) {
        if(error.status)throw error;
        if(error.code==='ECHANGED')fail(CHANGED);
        fail('Skill source could not be captured safely: '+name);
      }
    }
  };
  try {await visit(root,'');}
  catch(error) {if(error.status)throw error;fail('Skill source could not be captured safely: skills');}
  finally {await closeDirectory(root);}
  return files;
}
async function readLaunchers(codeRoot,{pathMode}) {
  const files=new Map(),root=await openRoot(codeRoot,pathMode,'Skill launcher source');
  try {
    for(const [directory,name,target] of LAUNCHERS) {
      const opened=[];
      try {
        let dir=root;for(const part of directory.split('/')){dir=await openDirectory(dir,part);opened.push(dir);}
        const {bytes,mode}=await readRegularFile(dir,name,{admit:size=>{if(size>CAPTURE_LIMITS.bytes)fail(LIMIT);}});
        files.set(target,{bytes,sha256:sha256(bytes),exec:(mode&0o100)!==0});
      } catch(error) {if(error.status)throw error;fail('Skill launcher could not be captured safely: '+target);}
      finally {for(const dir of opened.reverse())await closeDirectory(dir);}
    }
  } finally {await closeDirectory(root);}
  return files;
}
// Validation messages name only repository-relative inputs; filesystem errors carry absolute paths and are replaced.
const fingerprint=async repoRoot=>{
  try {return (await dependencyFingerprint(checkoutReader(repoRoot))).fingerprint;}
  catch(error) {fail('Skill dependency fingerprint failed: '+(error.code?'a dependency input is missing or unreadable':error.message));}
};
const sameFiles=(a,b)=>a.size===b.size&&[...a].every(([name,file])=>b.get(name)?.sha256===file.sha256&&b.get(name).exec===file.exec);

// Per-skill digests use the algorithm of the RoboTeam helper: sorted <skill>/ entries plus a declared shared prefix.
function digests(files,skills) {
  const source=Object.fromEntries([...files].map(([name,file])=>[name,file.sha256])),sourceDigests={};
  for(const skill of skills) {
    let dependencies=[];const descriptor=files.get(skill+'/skill.json');
    if(descriptor) {try {dependencies=JSON.parse(descriptor.bytes.toString('utf8')).sourceDependencies||[];} catch {fail('Invalid skill source dependencies');}}
    if(!Array.isArray(dependencies)||dependencies.some(prefix=>prefix!=='scriptahub-tasks/shared'))fail('Invalid skill source dependencies');
    for(const prefix of dependencies)if(!source[prefix+'/batch-io.mjs'])fail('Missing shared skill source receipt');
    const entries=sorted(Object.entries(source).filter(([name])=>name.startsWith(skill+'/')||dependencies.some(prefix=>name.startsWith(prefix+'/'))));
    if(!entries.length)fail('ScriptaHub skill source not found: '+skill);
    if(entries.some(([name])=>name.includes('\\')||name.split('/').some(part=>!part||part==='.'||part==='..')))fail('Invalid skill source receipt');
    sourceDigests[skill]=sha256(JSON.stringify(Object.fromEntries(entries)));
  }
  return sourceDigests;
}
// The complete snapshot content, keyed by path: captured files, launchers, placeholders and the directories they imply.
function layoutOf(files,launchers,receipt) {
  const layout=new Map();
  const add=(name,entry)=>{
    const parts=name.split('/');
    for(let index=1;index<parts.length;index++) {
      const parent=parts.slice(0,index).join('/'),existing=layout.get(parent);
      if(existing&&existing.type!=='dir')fail(INVALID_RECEIPT);
      if(!existing)layout.set(parent,{type:'dir'});
    }
    if(layout.has(name))fail(INVALID_RECEIPT);
    layout.set(name,entry);
  };
  for(const [name,file] of files)add('skills/'+name,{type:'file',bytes:file.bytes,sha256:file.sha256,mode:file.exec?0o555:0o444});
  for(const [name,file] of launchers)add(name,{type:'file',bytes:file.bytes,sha256:file.sha256,mode:file.exec?0o555:0o444});
  for(const entry of receipt.installed)add(entry.path,entry.type==='dir'?{type:'dir',placeholder:true}:{type:'file',bytes:EMPTY,sha256:sha256(EMPTY),mode:0o444});
  return layout;
}
// Validate on every hit: the snapshot must hold exactly the layout, byte for byte and mode for mode.
async function verifySnapshot(directory,layout) {
  try {
    const top=await fsp.lstat(directory);if(!top.isDirectory()||(top.mode&0o777)!==0o555)return false;
    let seen=0;
    const visit=async relative=>{
      for(const name of await fsp.readdir(relative?path.join(directory,relative):directory)) {
        const key=relative?relative+'/'+name:name,want=layout.get(key),stat=await fsp.lstat(path.join(directory,key));
        if(!want)return false;seen++;
        if(want.type==='dir') {if(!stat.isDirectory()||(stat.mode&0o777)!==0o555||!await visit(key))return false;continue;}
        if(!stat.isFile()||stat.nlink!==1||(stat.mode&0o777)!==want.mode||stat.size!==want.bytes.length)return false;
        const handle=await fsp.open(path.join(directory,key),fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
        try {if(sha256(await handle.readFile())!==want.sha256)return false;} finally {await handle.close();}
      }
      return true;
    };
    return await visit('')&&seen===layout.size;
  } catch {return false;}
}
async function writeSnapshot(directory,layout) {
  await fsp.mkdir(directory,{mode:0o700});
  const keys=[...layout.keys()].sort((a,b)=>a.split('/').length-b.split('/').length||(a<b?-1:a>b?1:0));
  for(const key of keys) {
    const entry=layout.get(key),target=path.join(directory,key);
    if(entry.type==='dir')await fsp.mkdir(target,{mode:0o700});
    else {await fsp.writeFile(target,entry.bytes,{flag:'wx',mode:0o600});await fsp.chmod(target,entry.mode);}
  }
  for(const key of keys.reverse())if(layout.get(key).type==='dir')await fsp.chmod(path.join(directory,key),0o555);
}
// Removal never follows links: only real directories on the store's device are made writable before rm.
function makeWritable(directory,dev) {
  const stat=fs.lstatSync(directory);if(!stat.isDirectory()||stat.isSymbolicLink()||stat.dev!==dev)return;
  fs.chmodSync(directory,0o700);
  for(const item of fs.readdirSync(directory,{withFileTypes:true}))if(item.isDirectory())makeWritable(path.join(directory,item.name),dev);
}
function remove(target,dev) {
  const stat=fs.lstatSync(target);
  if(stat.isDirectory()) {if(stat.dev!==dev)throw new Error('Snapshot entry is on another device');makeWritable(target,dev);fs.rmSync(target,{recursive:true});}
  else fs.rmSync(target);
}
function store(snapshotRoot) {
  try {
    fs.mkdirSync(snapshotRoot,{recursive:true,mode:0o700});
    const stat=fs.lstatSync(snapshotRoot);if(!stat.isDirectory())throw new Error('not a directory');
    return stat.dev;
  } catch {fail('Skill runtime snapshot storage is unavailable');}
}
// Removes tmp-* always and rt-* unless kept; failures are reported, never thrown.
export function pruneSnapshots(snapshotRoot,keep=()=>false) {
  let dev,entries;
  try {const stat=fs.lstatSync(snapshotRoot);if(!stat.isDirectory())throw new Error('Invalid snapshot store');dev=stat.dev;entries=fs.readdirSync(snapshotRoot);}
  catch(error) {if(error.code!=='ENOENT')console.error('Skill runtime snapshot store could not be listed');return;}
  for(const name of entries) {
    if(!name.startsWith('tmp-')&&!(name.startsWith('rt-')&&!keep(name.slice(3))))continue;
    try {remove(path.join(snapshotRoot,name),dev);} catch {console.error('Skill runtime snapshot could not be removed: '+name);}
  }
}

// Captures the checkout, validates the image receipt against it and ensures rt-<runtimeId> holds exactly the captured bytes.
// pinned.has(runtimeId) marks snapshots in use by a running child; they are never removed and never rewritten.
export async function captureRuntime({runtimeRoot=RUNTIME_PATH,codeRoot,skillsRoot,repoRoot,image,snapshotRoot,pinned=new Set(),
  hook=async()=>{},limits=CAPTURE_LIMITS,pathMode=false}) {
  const {receipt,bytes}=image;
  const checkout=await fingerprint(repoRoot);
  if(checkout!==receipt.dependencyFingerprint)fail(`Skill dependencies differ from the agent image (checkout ${checkout.slice(0,12)}, image ${receipt.dependencyFingerprint.slice(0,12)}); rebuild docker.io/assistos/scriptahub-agent from this checkout.`);
  const files=await walkSkills(skillsRoot,{limits,hook,pathMode,pass:1});
  if(!files.size)fail('ScriptaHub skill source not found: the checkout has no skill files');
  const launchers=await readLaunchers(codeRoot,{pathMode});
  const sourceDigests=digests(files,receipt.skills);
  for(const entry of receipt.installed) {
    let stat;try {stat=fs.lstatSync(path.join(runtimeRoot,entry.path));} catch {fail(INVALID_RECEIPT);}
    if(entry.type==='dir'?!stat.isDirectory():!stat.isFile())fail(INVALID_RECEIPT);
  }
  for(const entry of receipt.overrides) {
    const source=files.get(entry.path.slice('skills/'.length)),file=path.join(runtimeRoot,entry.path);
    if(!source||source.sha256!==entry.sourceSha256)fail(INVALID_RECEIPT);
    let actual;try {if(!fs.lstatSync(file).isFile())throw new Error('not a file');actual=sha256(fs.readFileSync(file));} catch {fail(INVALID_RECEIPT);}
    if(actual!==entry.installedSha256)fail('Image dependency override does not match its receipt: '+entry.path);
  }
  // Every captured file, with its exec bit, is part of the identity, so one runtimeId names exactly one snapshot content.
  const runtimeId=sha256(JSON.stringify({platform:receipt.platform,dependencyFingerprint:receipt.dependencyFingerprint,receipt:sha256(bytes),
    launchers:sorted([...launchers].map(([name,file])=>[name,file.sha256,file.exec])),sourceDigests,
    source:sha256(JSON.stringify(sorted([...files].map(([name,file])=>[name,file.sha256,file.exec]))))}));
  const layout=layoutOf(files,launchers,receipt),dev=store(snapshotRoot),snapshot=path.join(snapshotRoot,'rt-'+runtimeId);
  await hook('captured',null,1);
  let present=true;try {fs.lstatSync(snapshot);} catch(error) {if(error.code!=='ENOENT')fail('Skill runtime snapshot storage is unavailable');present=false;}
  if(present&&!await verifySnapshot(snapshot,layout)) {
    if(pinned.has(runtimeId))fail('Skill runtime snapshot is corrupted');
    try {remove(snapshot,dev);} catch {fail('Skill runtime snapshot is corrupted');}
    present=false;
  }
  if(!present) {
    const temporary=path.join(snapshotRoot,'tmp-'+crypto.randomBytes(12).toString('hex'));
    try {
      await writeSnapshot(temporary,layout);
      // The snapshot was written from the captured buffers; a second pass only proves the checkout held still meanwhile.
      let again,launchersAgain;
      try {again=await walkSkills(skillsRoot,{limits,hook,pathMode,pass:2});launchersAgain=await readLaunchers(codeRoot,{pathMode});}
      catch {fail(CHANGED);}
      if(!sameFiles(files,again)||!sameFiles(launchers,launchersAgain)||await fingerprint(repoRoot)!==checkout)fail(CHANGED);
      fs.renameSync(temporary,snapshot);fs.chmodSync(snapshot,0o555);
    } catch(error) {
      try {remove(temporary,dev);} catch(cleanup) {if(cleanup.code!=='ENOENT')console.error('Skill runtime snapshot could not be removed');}
      if(error.status)throw error;
      fail('Skill runtime snapshot could not be written');
    }
  }
  pruneSnapshots(snapshotRoot,id=>id===runtimeId||pinned.has(id));
  const binds=[...receipt.installed,...receipt.overrides].map(entry=>({source:path.join(runtimeRoot,entry.path),destination:RUNTIME_PATH+'/'+entry.path}));
  return {runtimeId,platform:receipt.platform,sourceDigests,view:{snapshot,binds}};
}
