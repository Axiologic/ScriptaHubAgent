import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { skillSource } from './skill-source.mjs';
import { prepareNativeNotices } from './prepare-native-notices.mjs';
import { installBuiltNative } from './install-built-native.mjs';

const root = path.resolve(process.argv[2] || '/opt/scriptahub/runtime');
const config = JSON.parse(await fs.readFile(new URL('./skills-runtime.json',import.meta.url),'utf8'));
async function run(command, args, options = {}) {
  await new Promise((resolve,reject) => {
    const child=spawn(command,args,{stdio:'inherit',...options});
    child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(new Error(`${command} failed (${code})`)));
  });
}
async function asset(filename, expected) {
  const valid = bytes => bytes.length === expected.bytes && createHash('sha256').update(bytes).digest('hex') === expected.sha256;
  try { if (valid(await fs.readFile(filename))) return; } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const response=await fetch(expected.url,{signal:AbortSignal.timeout(600000)});
  if(!response.ok)throw new Error(`Runtime asset download failed (${response.status}): ${expected.url}`);
  const bytes=Buffer.from(await response.arrayBuffer());
  if(!valid(bytes))throw new Error(`Runtime asset checksum mismatch: ${filename}`);
  await fs.mkdir(path.dirname(filename),{recursive:true});await fs.writeFile(filename,bytes,{mode:0o644});
}
const skills=path.join(root,'skills'), pdf=path.join(skills,'pdf2html');
await fs.writeFile(path.join(root,'source.json'),JSON.stringify(await skillSource(skills))+'\n');
const platform=`${process.platform}-${process.arch}`;
await installBuiltNative(root,config,platform);
const integrity=JSON.parse(await fs.readFile(path.join(pdf,'external/native/integrity.json'),'utf8'));
if(!Object.keys(integrity.files).some(name=>name.startsWith(platform+'/')))throw new Error(`No verified pdf2html native assets for ${platform}; deployment is refused`);
for(const skill of config.skills) {
  await fs.access(path.join(skills,skill,'SKILL.md'));
  for(const name of ['html','runtime']) {
    const directory=path.join(skills,skill,'external',name);
    if(await fs.access(path.join(directory,'package-lock.json')).then(()=>true,()=>false))
      await run('npm',['ci','--prefix',directory,'--ignore-scripts','--no-audit','--no-fund']);
  }
}
for(const [name,expected] of Object.entries(integrity.files)) {
  if(name.startsWith(platform+'/')) {
    const source=config.nativeAssetSource;
    await asset(path.join(pdf,'external/native',name),{...expected,url:`${source.repository}${source.revision}/${source.path}${name}`});
  } else if(name.startsWith('models/')) await asset(path.join(pdf,'external/native',name),expected);
}
await prepareNativeNotices(root);
for(const source of JSON.parse(await fs.readFile(path.join(pdf,'external/native/sources/sources.json'),'utf8')))
  await asset(path.join(pdf,source.path),source);
const audio=path.join(skills,'theatrical-audio');
for(const engine of config.audioEngines) {
  if(engine==='piper') await run('python3',[path.join(audio,'tools/setup_piper.py'),'--voice',config.piperVoice,'--download']);
  else await run('python3',[path.join(audio,'tools/bootstrap.py'),'--engine',engine,'--device','cpu','--download',
    ...(engine==='qwen' ? ['--lock',path.join(root,`qwen-linux-${process.arch}.requirements.txt`)] : [])]);
}
const receipt={schemaVersion:1,platform,skills:config.skills,audioEngines:config.audioEngines,node:process.version,
  python:'python3',preparedAt:new Date().toISOString(),architecture:os.arch()};
await fs.writeFile(path.join(root,'installed.json'),JSON.stringify(receipt,null,2)+'\n');
console.log('ScriptaHub skill dependencies installed. Runtime verification is a separate required build gate.');
