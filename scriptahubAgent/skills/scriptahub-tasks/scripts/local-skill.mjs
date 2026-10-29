import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

// Only installed runtime files are executed. Repository skill sources remain
// owned by ScriptaHub and mounted read-only by the existing robot skill system.
export async function runLocalSkill({skill,args=[],input=''}, {
  runtimeRoot=process.env.SCRIPTA_SKILL_RUNTIME_ROOT || '/usr/local/share/scriptahub/runtime',
  sourceRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'),
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
  for (const [name,hash] of files) {
    if (name.split('/').some(part=>!part||part==='.'||part==='..') || name.includes('\\')) throw new Error('Invalid runtime source record');
    const actual=crypto.createHash('sha256').update(await fs.readFile(path.join(sourceRoot,name))).digest('hex');
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
