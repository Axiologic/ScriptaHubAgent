import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { isInstalledPath, INSTALL_OVERRIDES, dependencyEntry } from './deployment/skill-source.mjs';
import { dependencyFingerprint } from './deployment/dependency-fingerprint.mjs';
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

const openChild=async(dir,name,options)=>{try {return await openDirectory(dir,name,options);} catch {return null;}};
const closeAll=async nodes=>{for(const node of [...nodes].reverse())await closeDirectory(node).catch(()=>{});};
const sameNode=(a,b)=>!!a&&!!b&&a.stat.dev===b.stat.dev&&a.stat.ino===b.stat.ino;
// Reopens <parent>/<name>/{scriptahubAgent,skills} through the held parent and compares them with the held descriptors,
// so a checkout swapped after discovery is detected; the capture itself only ever reads through the held descriptors.
async function unchanged(parent,name,skillsName,held) {
  const opened=[];
  try {
    const checkout=await openDirectory(parent,name,{mount:true});opened.push(checkout);
    const agent=await openDirectory(checkout,'scriptahubAgent');opened.push(agent);
    const skills=await openDirectory(skillsName===null?checkout:parent,skillsName??'skills');opened.push(skills);
    return sameNode(checkout,held.checkout)&&sameNode(agent,held.agent)&&sameNode(skills,held.skills);
  } catch {return false;} finally {await closeAll(opened);}
}

// The checkout is opened through descriptors held for the whole capture: the workspace root, then each candidate with
// O_DIRECTORY|O_NOFOLLOW relative to its parent (anchored-read.mjs). A candidate matches when its scriptahubAgent,
// opened relative to the held candidate, is the same directory as the code root; skills is opened relative to the same
// candidate. identity(path), when given (tests), replaces the descriptor's {dev,ino} for the code root and for
// <candidate>/scriptahubAgent. A non-empty skillsDir (tests only) is opened through its parent instead. close() releases
// every descriptor.
export async function locateSkills({codeRoot,workspace=process.env.WORKSPACE_PATH,skillsDir,identity,pathMode=false}={}) {
  const held=[];
  try {
    if(typeof skillsDir==='string'&&skillsDir) {
      const unavailable='ScriptaHub skill source not found: the configured skills directory is unavailable';
      let real;try {real=fs.realpathSync(skillsDir);} catch {fail(unavailable);}
      const repo=await openRoot(path.dirname(real),pathMode,'Skill source');held.push(repo);
      const skills=await openChild(repo,path.basename(real)),agent=await openChild(repo,'scriptahubAgent');
      for(const node of [skills,agent])if(node)held.push(node);
      if(!skills||!agent)fail(unavailable);
      const nodes=[...held];held.length=0;
      return {repoRoot:path.dirname(real),skillsRoot:real,checkout:repo,agent,skills,
        unchanged:async()=>{
          const opened=[];
          try {
            const again=await openTree(path.dirname(real),{pathMode});opened.push(again);
            const skillsAgain=await openDirectory(again,path.basename(real));opened.push(skillsAgain);
            const agentAgain=await openDirectory(again,'scriptahubAgent');opened.push(agentAgain);
            return sameNode(again,repo)&&sameNode(skillsAgain,skills)&&sameNode(agentAgain,agent);
          } catch {return false;} finally {await closeAll(opened);}
        },
        close:()=>closeAll(nodes)};
    }
    let code;
    try {const stat=identity?identity(codeRoot):fs.statSync(codeRoot);code={dev:stat.dev,ino:stat.ino};} catch {fail(NOT_FOUND);}
    if(typeof workspace!=='string'||!path.isAbsolute(workspace))fail(NOT_FOUND);
    let root;
    try {root=await openTree(workspace,{pathMode});} catch(error) {if(!error.code)fail(error.message);fail(NOT_FOUND);}
    held.push(root);
    const parents=[{node:root,path:workspace}];
    const ploinky=await openChild(root,'.ploinky',{mount:true});
    if(ploinky) {
      held.push(ploinky);const repos=await openChild(ploinky,'repos',{mount:true});
      if(repos){held.push(repos);parents.push({node:repos,path:path.join(workspace,'.ploinky','repos')});}
    }
    const matches=[];
    for(const parent of parents) {
      let entries;try {entries=await listDirectory(parent.node);} catch {continue;}
      for(const entry of entries) {
        if(!entry.isDirectory())continue;
        const checkout=await openChild(parent.node,entry.name,{mount:true});if(!checkout)continue;
        const agent=await openChild(checkout,'scriptahubAgent');
        if(agent) {
          let stat=null;try {stat=identity?identity(path.join(parent.path,entry.name,'scriptahubAgent')):agent.stat;} catch {}
          if(stat&&stat.dev===code.dev&&stat.ino===code.ino){held.push(checkout,agent);matches.push({parent,name:entry.name,checkout,agent});continue;}
          await closeDirectory(agent);
        }
        await closeDirectory(checkout);
      }
    }
    if(!matches.length)fail(NOT_FOUND);
    if(matches.length>1)fail(`ScriptaHub skill source is ambiguous: ${matches.length} checkouts match /code`);
    const [{parent,name,checkout,agent}]=matches;
    const skills=await openChild(checkout,'skills');
    if(!skills)fail('ScriptaHub skill source not found: the matching checkout has no skills directory');
    held.push(skills);
    const nodes=[...held],repoRoot=path.join(parent.path,name);held.length=0;
    return {repoRoot,skillsRoot:path.join(repoRoot,'skills'),checkout,agent,skills,
      unchanged:()=>unchanged(parent.node,name,null,{checkout,agent,skills}),close:()=>closeAll(nodes)};
  } catch(error) {await closeAll(held);throw error;}
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
async function walkSkills(root,{limits,hook,pass}) {
  const files=new Map();let total=0;
  const visit=async(dir,relative)=>{
    for(const entry of await listDirectory(dir)) {
      const name=relative?relative+'/'+entry.name:entry.name;
      if(isInstalledPath(name))continue;
      try {
        if(/[\\\0]/.test(entry.name))fail('Invalid skill source path: '+JSON.stringify(name));
        if(entry.isSymbolicLink())fail('Skill source must not contain symlinks: '+JSON.stringify(name));
        if(entry.isDirectory()) {
          await hook('directory',name,pass);
          const child=await openDirectory(dir,entry.name);
          try {await visit(child,name);} finally {await closeDirectory(child);}
        } else if(entry.isFile()) {
          if(files.size>=limits.files)fail(LIMIT);
          const {bytes,mode}=await readRegularFile(dir,entry.name,{admit:size=>{total+=size;if(total>limits.bytes)fail(LIMIT);}});
          files.set(name,{bytes,sha256:sha256(bytes),exec:(mode&0o100)!==0});
        } else fail('Unsupported skill source entry: '+JSON.stringify(name));
      } catch(error) {
        if(error.status)throw error;
        if(error.code==='ECHANGED')fail(CHANGED);
        fail('Skill source could not be captured safely: '+JSON.stringify(name));
      }
    }
  };
  try {await visit(root,'');}
  catch(error) {if(error.status)throw error;fail('Skill source could not be captured safely: "skills"');}
  return files;
}
// Launchers come from the held checkout's scriptahubAgent, which discovery proved is the code root's directory.
async function readLaunchers(root) {
  const files=new Map();
  for(const [directory,name,target] of LAUNCHERS) {
    const opened=[];
    try {
      let dir=root;for(const part of directory.split('/')){dir=await openDirectory(dir,part);opened.push(dir);}
      const {bytes,mode}=await readRegularFile(dir,name,{admit:size=>{if(size>CAPTURE_LIMITS.bytes)fail(LIMIT);}});
      files.set(target,{bytes,sha256:sha256(bytes),exec:(mode&0o100)!==0});
    } catch(error) {if(error.status)throw error;fail('Skill launcher could not be captured safely: '+target);}
    finally {for(const dir of opened.reverse())await closeDirectory(dir);}
  }
  return files;
}
// F over exactly what was captured: skills inputs and captured launchers (skills-runtime.json) are the captured bytes;
// the other deployment inputs, which the snapshot does not contain, are read through the held scriptahubAgent
// descriptor. Validation messages name only repository-relative inputs; filesystem errors carry absolute paths and are
// replaced.
async function fingerprint(agent,files,launchers) {
  const prefix='scriptahubAgent/deployment/';let deployment;
  const read=async file=>{
    if(file.startsWith('skills/')) {
      const captured=files.get(file.slice('skills/'.length));
      if(!captured)throw Object.assign(new Error('Dependency input was not captured'),{code:'ENOENT'});
      return captured.bytes;
    }
    if(!file.startsWith(prefix)||file.slice(prefix.length).includes('/'))throw new Error('Dependency input is outside the captured checkout: '+file);
    const launcher=LAUNCHERS.find(([directory,name])=>directory==='deployment'&&name===file.slice(prefix.length));
    if(launcher)return launchers.get(launcher[2]).bytes;
    deployment??=await openDirectory(agent,'deployment');
    return (await readRegularFile(deployment,file.slice(prefix.length),{admit:size=>{if(size>CAPTURE_LIMITS.bytes)fail(LIMIT);}})).bytes;
  };
  try {return (await dependencyFingerprint(read)).fingerprint;}
  catch(error) {if(error.status)throw error;fail('Skill dependency fingerprint failed: '+(error.code?'a dependency input is missing or unreadable':error.message));}
  finally {if(deployment)await closeDirectory(deployment);}
}
// An image path is bound only when it resolves to itself under the resolved runtime root: no link anywhere on the way.
function imagePath(runtimeRoot,realRoot,relative,type) {
  const file=path.join(runtimeRoot,relative);
  try {
    if(fs.realpathSync(file)!==path.join(realRoot,relative))throw new Error('resolves elsewhere');
    const stat=fs.lstatSync(file);if(type==='dir'?!stat.isDirectory():!stat.isFile())throw new Error('wrong type');
  } catch {fail(INVALID_RECEIPT);}
  return file;
}
const sameFiles=(a,b)=>a.size===b.size&&[...a].every(([name,file])=>b.get(name)?.sha256===file.sha256&&b.get(name).exec===file.exec);

// Per-skill digests use the algorithm of the RoboTeam helper: sorted <skill>/ entries plus each declared source prefix.
function digests(files,skills) {
  const source=Object.fromEntries([...files].map(([name,file])=>[name,file.sha256])),sourceDigests={};
  for(const skill of skills) {
    let dependencies=[];const descriptor=files.get(skill+'/skill.json');
    if(descriptor) {try {dependencies=JSON.parse(descriptor.bytes.toString('utf8')).sourceDependencies||[];} catch {fail('Invalid skill source dependencies');}}
    if(!Array.isArray(dependencies)||dependencies.some(prefix=>typeof prefix!=='string'||!dependencyEntry(skill,prefix)))fail('Invalid skill source dependencies');
    for(const prefix of dependencies)if(!source[prefix+'/'+dependencyEntry(skill,prefix)])fail('Missing shared skill source receipt');
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
export async function captureRuntime({runtimeRoot=RUNTIME_PATH,located,image,snapshotRoot,pinned=new Set(),
  hook=async()=>{},limits=CAPTURE_LIMITS}) {
  const {receipt,bytes}=image;
  await hook('located',located.repoRoot,0);
  const files=await walkSkills(located.skills,{limits,hook,pass:1});
  if(!files.size)fail('ScriptaHub skill source not found: the checkout has no skill files');
  const launchers=await readLaunchers(located.agent);
  await hook('launchers',null,1);
  const checkout=await fingerprint(located.agent,files,launchers);
  if(checkout!==receipt.dependencyFingerprint)fail(`Skill dependencies differ from the agent image (checkout ${checkout.slice(0,12)}, image ${receipt.dependencyFingerprint.slice(0,12)}); rebuild docker.io/assistos/scriptahub-agent from this checkout.`);
  const sourceDigests=digests(files,receipt.skills);
  let realRoot;try {realRoot=fs.realpathSync(runtimeRoot);} catch {fail(INVALID_RECEIPT);}
  for(const entry of receipt.installed)imagePath(runtimeRoot,realRoot,entry.path,entry.type);
  for(const entry of receipt.overrides) {
    const source=files.get(entry.path.slice('skills/'.length)),file=imagePath(runtimeRoot,realRoot,entry.path,'file');
    if(!source||source.sha256!==entry.sourceSha256)fail(INVALID_RECEIPT);
    let actual;try {actual=sha256(fs.readFileSync(file));} catch {fail(INVALID_RECEIPT);}
    if(actual!==entry.installedSha256)fail('Image dependency override does not match its receipt: '+entry.path);
  }
  // Every captured file, with its exec bit, is part of the identity, so one runtimeId names exactly one snapshot content.
  const runtimeId=sha256(JSON.stringify({platform:receipt.platform,dependencyFingerprint:receipt.dependencyFingerprint,receipt:sha256(bytes),
    launchers:sorted([...launchers].map(([name,file])=>[name,file.sha256,file.exec])),sourceDigests,
    source:sha256(JSON.stringify(sorted([...files].map(([name,file])=>[name,file.sha256,file.exec]))))}));
  const layout=layoutOf(files,launchers,receipt),dev=store(snapshotRoot),snapshot=path.join(snapshotRoot,'rt-'+runtimeId);
  await hook('captured',null,1);
  if(!await located.unchanged())fail(CHANGED);
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
      try {again=await walkSkills(located.skills,{limits,hook,pass:2});launchersAgain=await readLaunchers(located.agent);await hook('launchers',null,2);}
      catch {fail(CHANGED);}
      if(!sameFiles(files,again)||!sameFiles(launchers,launchersAgain)||await fingerprint(located.agent,again,launchersAgain)!==checkout
        ||!await located.unchanged())fail(CHANGED);
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
