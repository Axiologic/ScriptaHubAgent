import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

// The declared skill name; '' when SKILL.md has none, null when there is no SKILL.md.
async function skillName(directory) {
  const text=await fs.readFile(path.join(directory,'SKILL.md'),'utf8').catch(error=>{if(error.code==='ENOENT'||error.code==='ENOTDIR')return null;throw error;});
  return text===null ? null : /^---\r?\n[\s\S]*?^name:\s*(\S+)\s*$/m.exec(text)?.[1] || '';
}

// The repository keeps each skill in skills/<name>. A RoboTeam robot step instead
// mounts every selected skill at /workspace/roboteam-skill-<n>, so the skill is
// found by the name in its SKILL.md.
async function findSkillDirectory(sourceRoot,skill) {
  const direct=path.join(sourceRoot,skill);
  if ([skill,''].includes(await skillName(direct))) return direct;
  for (const entry of await fs.readdir(sourceRoot,{withFileTypes:true}).catch(()=>[])) {
    if (!entry.isDirectory() || !/^roboteam-skill-\d+$/.test(entry.name)) continue;
    const directory=path.join(sourceRoot,entry.name);
    if (await skillName(directory)===skill) return directory;
  }
  throw new Error(`The ${skill} skill sources are not available to this robot step; select its skillset for this workflow task`);
}

const realOrSelf=directory=>fs.realpath(directory).catch(()=>path.resolve(directory));
const isWithin=(child,parent)=>{const relative=path.relative(parent,child);return relative===''||(!relative.startsWith('..')&&!path.isAbsolute(relative));};

// The robot image also contains an installed copy of every skill, which the build
// changes after recording the sources (on AMD64 it adds the compiled PDF engine to
// pdf2html's integrity.json). That copy is never a source of truth: when this helper
// is started from it, the sources are checked at the robot's skill mounts instead.
async function selectSourceRoot(sourceRoot,runtimeRoot,mountRoots,skill) {
  if (!isWithin(await realOrSelf(sourceRoot),await realOrSelf(runtimeRoot))) return sourceRoot;
  for (const root of mountRoots) {
    try { await findSkillDirectory(root,skill); return root; }
    catch (error) { if (!/skill sources are not available to this robot step/.test(error.message)) throw error; }
  }
  throw new Error(`The ${skill} skill sources must come from the robot's skill mount, not the installed runtime copy; run scriptahub-tasks from its mounted skill directory (for example /skills/scriptahub-tasks/scripts/run.mjs)`);
}

// Only installed runtime files are executed. Repository skill sources remain
// owned by ScriptaHub and mounted read-only by the existing robot skill system.
export async function runLocalSkill({skill,args=[],input=''}, {
  runtimeRoot=process.env.SCRIPTA_SKILL_RUNTIME_ROOT || '/usr/local/share/scriptahub/runtime',
  sourceRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'),
  mountRoots=['/skills','/workspace'],
  stdout=process.stdout,stderr=process.stderr,signal,
}={}) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(skill||'') || !Array.isArray(args) || args.length>256
      || args.some(value=>typeof value!=='string'||value.includes('\0')) || typeof input!=='string'
      || Buffer.byteLength(input)>65536 || Buffer.byteLength(JSON.stringify(args))>60000) throw new Error('Invalid local skill command');
  if (!path.isAbsolute(runtimeRoot)) throw new Error('The installed skill runtime path must be absolute');
  let receipt,expected;
  try {
    receipt=JSON.parse(await fs.readFile(path.join(runtimeRoot,'installed.json'),'utf8'));
    expected=JSON.parse(await fs.readFile(path.join(runtimeRoot,'source.json'),'utf8'));
  } catch(error) {
    if (error.code==='ENOENT') throw new Error('ScriptaHub skill dependencies are not installed in the robot runtime. Build and deploy the ScriptaHub robot image before running this workflow');
    throw error;
  }
  if (receipt.platform!==`${process.platform}-${process.arch}` || !receipt.skills?.includes(skill)) throw new Error('The robot skill runtime does not support this platform or skill');
  const files=Object.entries(expected).filter(([name])=>name.startsWith(skill+'/'));
  if (!files.length) throw new Error('The installed skill has no source verification record');
  const skillDirectory=await findSkillDirectory(await selectSourceRoot(sourceRoot,runtimeRoot,mountRoots,skill),skill);
  for (const [name,hash] of files) {
    if (name.split('/').some(part=>!part||part==='.'||part==='..') || name.includes('\\')) throw new Error('Invalid runtime source record');
    const actual=crypto.createHash('sha256').update(await fs.readFile(path.join(skillDirectory,name.slice(skill.length+1)))).digest('hex');
    if (actual!==hash) throw new Error(`The robot runtime is outdated for skill ${skill}; rebuild it from the deployed ScriptaHub sources`);
  }
  signal?.throwIfAborted();
  return new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,[path.join(runtimeRoot,'run-skill.mjs'),skill,...args],{cwd:process.cwd(),stdio:['pipe','pipe','pipe'],signal});
    child.stdout.pipe(stdout,{end:false});child.stderr.pipe(stderr,{end:false});
    child.stdin.on('error',error=>{if(error.code!=='EPIPE')reject(error);});
    child.once('error',reject);child.once('close',(code,termination)=>resolve(code??(termination?130:1)));
    child.stdin.end(input);
  });
}
