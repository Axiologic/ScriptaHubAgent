// Shared helper (not a test file): a fake image runtime root with dependencies.json, a fake workspace checkout and its
// code root, wired the way ProcessingService discovers them.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { dependencyFingerprint, checkoutReader, INPUTS_PATH } from '../deployment/dependency-fingerprint.mjs';

export const PLATFORM=`${process.platform}-${process.arch}`;
export const sha256=value=>crypto.createHash('sha256').update(value).digest('hex');
// Off Linux the anchored /proc/self/fd reader does not exist, so fixtures opt into the path reader. Linux runs never do.
export const pathMode=process.platform!=='linux';
export const OVERRIDE='skills/pdf2html/external/native/integrity.json';

export const CHECKOUT_FILES={
  [INPUTS_PATH]:`${INPUTS_PATH}\nskills/pdf2html/external/html/package-lock.json\nskills/pdf2html/external/native/integrity.json\n`,
  'scriptahubAgent/deployment/run-skill.mjs':'// run-skill fixture\n',
  'scriptahubAgent/deployment/verify-skills.mjs':'// verify-skills fixture\n',
  'scriptahubAgent/deployment/skills-runtime.json':'{"skills":["pdf2html"]}\n',
  'scriptahubAgent/site/reader/reader.css':'body{margin:0}\n',
  'skills/AGENTS.md':'catalog guidance\n',
  'skills/pdf2html/SKILL.md':'---\nname: pdf2html\n---\nConvert PDF.\n',
  'skills/pdf2html/scripts/pdf2html':{text:'#!/bin/sh\necho pdf2html\n',mode:0o755},
  'skills/pdf2html/src/cli.mjs':'export const cli=1;\n',
  'skills/pdf2html/external/html/package-lock.json':'{}\n',
  [OVERRIDE]:'{"files":{}}\n',
  'skills/scriptahub-tasks/shared/batch-io.mjs':'export const batch=1;\n',
};
// Private or installed checkout entries that the snapshot must never contain.
export const PRIVATE_FILES={
  'skills/pdf2html/.env':'TOKEN=private\n','skills/pdf2html/.apikeys':'private\n',
  'skills/pdf2html/node_modules/leak/index.js':'module.exports="checkout";\n','skills/pdf2html/output/result.html':'<p>old</p>\n',
  'skills/pdf2html/audio.config.json':'{"key":"private"}\n',
};
// The image side: installed dependency paths (container path = sandbox path) and the rewritten override.
export const IMAGE_FILES={
  'skills/pdf2html/external/html/node_modules/dep/index.js':'module.exports=42;\n',
  'skills/pdf2html/external/native/models/model.bin':'image model\n',
  'skills/pdf2html/external/native/assets.zip':'image archive\n',
  [OVERRIDE]:'{"files":{"linux-x64/pdf2html":"image"}}\n',
};
export const INSTALLED=[
  {path:'skills/pdf2html/external/html/node_modules',type:'dir'},
  {path:'skills/pdf2html/external/native/assets.zip',type:'file'},
  {path:'skills/pdf2html/external/native/models',type:'dir'},
];

async function write(root,name,content) {
  const file=path.join(root,name),value=typeof content==='object'&&!Buffer.isBuffer(content)?content:{text:content};
  await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,value.text);
  if(value.mode)await fs.chmod(file,value.mode);
}
export async function makeWritable(root) {try {execFileSync('/bin/chmod',['-R','u+rwx',root]);} catch {}}

// files adds to (or, with null, removes from) the checkout; receipt patches dependencies.json.
export async function runtimeFixture({files={},skills=['pdf2html'],installed=INSTALLED,override=true,receipt:patch={},privateFiles=true}={}) {
  const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'scripta-runtime-')));
  const workspace=path.join(root,'workspace'),checkout=path.join(workspace,'ScriptaHubAgent'),runtimeRoot=path.join(root,'runtime'),dataDir=path.join(root,'data');
  const all={...CHECKOUT_FILES,...(privateFiles?PRIVATE_FILES:{}),...files};
  for(const [name,content] of Object.entries(all))if(content!==null)await write(checkout,name,content);
  for(const [name,content] of Object.entries(IMAGE_FILES))await write(runtimeRoot,name,content);
  const image=await fs.readFile(path.join(runtimeRoot,OVERRIDE)),source=await fs.readFile(path.join(checkout,OVERRIDE)).catch(()=>Buffer.alloc(0));
  const receipt={schemaVersion:1,fingerprintVersion:1,dependencyFingerprint:(await dependencyFingerprint(checkoutReader(checkout))).fingerprint,
    platform:PLATFORM,skills,installed,overrides:override?[{path:OVERRIDE,sourceSha256:sha256(source),installedSha256:sha256(image)}]:[],...patch};
  const writeReceipt=async value=>fs.writeFile(path.join(runtimeRoot,'dependencies.json'),typeof value==='string'?value:JSON.stringify(value,null,2)+'\n');
  await writeReceipt(receipt);
  const options={runtimeRoot,codeRoot:path.join(checkout,'scriptahubAgent'),workspace,snapshotRoot:path.join(dataDir,'skill-runtime'),pathMode};
  return {root,workspace,checkout,skillsRoot:path.join(checkout,'skills'),runtimeRoot,dataDir,options,receipt,writeReceipt,
    write:(name,content)=>write(checkout,name,content),
    snapshots:async()=>(await fs.readdir(options.snapshotRoot).catch(()=>[])).sort(),
    remove:async()=>{await makeWritable(root);await fs.rm(root,{recursive:true,force:true});}};
}

// The RoboTeam helper's source digest (skills/scriptahub-tasks/scripts/remote-skill.mjs:17-18 and :318-332), computed
// independently over a skills tree with plain path reads.
const sourceExcluded=new Set(['node_modules','.cache','.venv','__pycache__','.pytest_cache','target','output','cache','.theatrical-audio','hf-cache','.DS_Store','.idea','.git','.apikeys','audio.config.json']);
const sourceSkip=name=>{const part=name.split('/').at(-1);return part==='.env'||part.startsWith('.env.')&&part!=='.env.example'||sourceExcluded.has(part)||part.endsWith('.pyc')||part.endsWith('.actual.html')||/\/external\/(?:browser|tools|docling-source)(?:\/|$)/.test('/'+name)||/\/external\/native\/(?:licenses|models|linux-[^/]+|darwin-[^/]+|win32-[^/]+)(?:\/|$)/.test('/'+name)||name.endsWith('.zip')||/theatrical-audio\/(?:models|runtime\/(?:qwen|kokoro|piper))(?:\/|$)/.test(name)||/theatrical-audio\/runtime\/(?:qwen|kokoro|piper)(?:\.resolved\.txt|\.json)$/.test(name);};
async function roboInventory(root,skill,relative='') {
  const result=[];
  for(const entry of await fs.readdir(path.join(root,relative),{withFileTypes:true})) {
    const name=relative?relative+'/'+entry.name:entry.name;
    if(sourceSkip(skill+'/'+name))continue;
    if(entry.isDirectory())result.push(...await roboInventory(root,skill,name));
    else result.push({path:name,sha256:sha256(await fs.readFile(path.join(root,name)))});
  }
  return result;
}
export async function roboTeamDigest(skillsRoot,skill) {
  const source=await roboInventory(path.join(skillsRoot,skill),skill);let dependencies=[];
  try {dependencies=JSON.parse(await fs.readFile(path.join(skillsRoot,skill,'skill.json'),'utf8')).sourceDependencies||[];} catch(error) {if(error.code!=='ENOENT')throw error;}
  const entries=source.map(entry=>[skill+'/'+entry.path,entry.sha256]);
  for(const prefix of new Set(dependencies))entries.push(...(await roboInventory(path.join(skillsRoot,'scriptahub-tasks/shared'),skill)).map(entry=>[prefix+'/'+entry.path,entry.sha256]));
  return sha256(JSON.stringify(Object.fromEntries(entries.sort(([a],[b])=>a<b?-1:a>b?1:0))));
}
