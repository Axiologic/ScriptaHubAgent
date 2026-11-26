import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

const excluded=new Set(['node_modules','.cache','.venv','__pycache__','.pytest_cache','target','output','cache','.theatrical-audio','hf-cache','.DS_Store','.idea','.git','.apikeys','audio.config.json']);
// True for names that are installed into (or generated inside) the image rather than carried by the source.
export function isInstalledPath(name) {
  const base=path.posix.basename(name);
  return (base==='.env'||base.startsWith('.env.')&&base!=='.env.example')||excluded.has(base)||base.endsWith('.pyc')||base.endsWith('.actual.html')
    ||/\/external\/(?:browser|tools)(?:\/|$)/.test('/'+name)
    ||/\/external\/docling-source(?:\/|$)/.test('/'+name)
    ||/\/external\/native\/licenses(?:\/|$)/.test('/'+name)
    ||/\/external\/native\/(?:models|linux-[^/]+|darwin-[^/]+|win32-[^/]+)(?:\/|$)/.test('/'+name)
    ||name.endsWith('.zip')||/theatrical-audio\/(?:models|runtime\/(?:qwen|kokoro|piper))(?:\/|$)/.test(name)
    ||/theatrical-audio\/runtime\/(?:qwen|kokoro|piper)(?:\.resolved\.txt|\.json)$/.test(name);
}
export function dependencyEntry(skill, prefix) {
  if (prefix==='scriptahub-tasks/shared') return 'batch-io.mjs';
  if (skill==='book-pdf' && prefix==='validate-book/src') return 'browser.mjs';
  return null;
}
export async function skillSource(root) {
  const result={};
  async function visit(relative='') {
    for(const entry of await fs.readdir(path.join(root,relative),{withFileTypes:true})) {
      const name=path.posix.join(relative,entry.name);
      if(isInstalledPath(name))continue;
      if(entry.isSymbolicLink())throw new Error(`Skill source must not contain symlinks: ${name}`);
      if(entry.isDirectory())await visit(name);
      else if(entry.isFile())result[name]=createHash('sha256').update(await fs.readFile(path.join(root,name))).digest('hex');
      else throw new Error(`Unsupported skill source entry: ${name}`);
    }
  }
  await visit();return Object.fromEntries(Object.entries(result).sort(([a],[b])=>a<b?-1:a>b?1:0));
}


// Some callable skills use SKILL.md only; metadata is optional, but an existing
// descriptor must still parse and every declared dependency must be present.
export async function skillDependencies(root,skills,source) {
  const result={};
  for(const skill of skills) {
    let descriptor={};
    try {descriptor=JSON.parse(await fs.readFile(path.join(root,skill,'skill.json'),'utf8'));}
    catch(error){if(error.code!=='ENOENT')throw error;}
    const dependencies=descriptor.sourceDependencies||[];
    if(!Array.isArray(dependencies)||dependencies.some(prefix=>!dependencyEntry(skill,prefix)))throw Error('Invalid skill source dependencies: '+skill);
    for(const prefix of dependencies) {
      const entry=dependencyEntry(skill,prefix);
      if(!source[prefix+'/'+entry])throw Error(entry==='batch-io.mjs' ? 'Missing shared batch module for '+skill : 'Missing browser source for '+skill);
    }
    if(dependencies.length)result[skill]=dependencies;
  }
  return result;
}

// The maximal entries skillSource leaves out (installed libraries, venvs, native files, models). Paths are relative to root.
export async function installedEntries(root) {
  const result=[];
  async function visit(relative='') {
    for(const entry of await fs.readdir(path.join(root,relative),{withFileTypes:true})) {
      const name=path.posix.join(relative,entry.name),installed=isInstalledPath(name);
      if(entry.isSymbolicLink())throw new Error(`Skill tree must not contain symlinks: ${name}`);
      if(installed){
        if(entry.isDirectory())result.push({path:name,type:'dir'});
        else if(entry.isFile())result.push({path:name,type:'file'});
        else throw new Error(`Unsupported installed entry: ${name}`);
      } else if(entry.isDirectory())await visit(name);
    }
  }
  await visit();return result.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
}

// Installation may only add excluded paths, plus rewrite this one file on linux-x64 (the native build adds its asset hashes).
export const INSTALL_OVERRIDES=['pdf2html/external/native/integrity.json'];
export function installOverrides(before,after,platform) {
  const keys=Object.keys(before).sort();
  if(JSON.stringify(keys)!==JSON.stringify(Object.keys(after).sort()))throw new Error('Installation changed the set of skill source files');
  const overrides=[];
  for(const key of keys)if(before[key]!==after[key]) {
    if(platform!=='linux-x64'||!INSTALL_OVERRIDES.includes(key))throw new Error(`Installation changed skill source file: ${key}`);
    overrides.push({path:'skills/'+key,sourceSha256:before[key],installedSha256:after[key]});
  }
  return overrides;
}

export function dependencyReceipt({dependencyFingerprint,platform,skills,installed,overrides}) {
  return {schemaVersion:1,fingerprintVersion:1,dependencyFingerprint,platform,skills,
    installed:installed.map(entry=>({path:'skills/'+entry.path,type:entry.type})),overrides};
}
