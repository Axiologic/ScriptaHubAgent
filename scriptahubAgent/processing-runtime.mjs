import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const fail = (message, status=503) => { throw Object.assign(new Error(message),{status}); };
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');

// source.json is captured before native installation, so installed files are not
// rehashed here as if they were the original selected skill sources.
export async function processingRuntime(root = '/opt/scriptahub/runtime') {
  let source, installed;
  try {
    source=JSON.parse(await fs.readFile(path.join(root,'source.json'),'utf8'));
    installed=JSON.parse(await fs.readFile(path.join(root,'installed.json'),'utf8'));
  } catch { fail('ScriptaHub processing runtime is unavailable'); }
  if (!source || typeof source !== 'object' || Array.isArray(source)
    || installed?.platform !== `${process.platform}-${process.arch}` || !Array.isArray(installed.skills)) fail('ScriptaHub processing runtime does not support this platform');
  const sourceDigests={};
  for (const skill of installed.skills) {
    if (typeof skill !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(skill)) fail('Invalid installed skill receipt');
    const entries=Object.entries(source).filter(([name])=>name.startsWith(skill+'/')).sort(([a],[b])=>a<b?-1:a>b?1:0);
    if (!entries.length || entries.some(([name,hash])=>name.includes('\\') || name.split('/').some(part=>!part||part==='.'||part==='..') || !/^[a-f0-9]{64}$/.test(hash))) fail('Invalid skill source receipt');
    sourceDigests[skill]=sha256(JSON.stringify(Object.fromEntries(entries)));
  }
  const runtimeId=sha256(JSON.stringify({platform:installed.platform,sourceDigests}));
  return {runtimeId,platform:installed.platform,sourceDigests};
}
