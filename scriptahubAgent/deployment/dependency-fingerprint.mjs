import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// The image carries what these files install; everything else under skills/ runs from the mounted checkout.
export const FINGERPRINT_HEADER='scriptahub-dependency-fingerprint-v1\n';
export const INPUTS_PATH='scriptahubAgent/deployment/dependency-inputs.txt';
const PATH_PATTERN=/^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/;

export function parseDependencyInputs(text) {
  if(typeof text!=='string'||!text)throw new Error('Dependency inputs are empty');
  if(text.includes('\r'))throw new Error('Dependency inputs must use LF line endings');
  if(!text.endsWith('\n'))throw new Error('Dependency inputs must end with a newline');
  const lines=text.slice(0,-1).split('\n');
  lines.forEach((line,index)=>{
    if(!line)throw new Error(`Dependency inputs contain a blank line: ${index+1}`);
    if(!PATH_PATTERN.test(line)||line.split('/').some(part=>part==='.'||part==='..'))throw new Error(`Invalid dependency input path: ${line}`);
    if(index&&lines[index-1]>=line)throw new Error(`Dependency inputs must be strictly ascending: ${line}`);
  });
  if(!lines.includes(INPUTS_PATH))throw new Error(`Dependency inputs must list ${INPUTS_PATH}`);
  return lines;
}
export function gitBlobId(bytes) {
  return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
}
export async function dependencyFingerprint(read) {
  const inputs=[];
  for(const file of parseDependencyInputs((await read(INPUTS_PATH)).toString('utf8')))inputs.push({path:file,blob:gitBlobId(await read(file))});
  const hash=createHash('sha256').update(FINGERPRINT_HEADER);
  for(const input of inputs)hash.update(`${input.blob} ${input.path}\n`);
  return {fingerprint:hash.digest('hex'),inputs};
}
async function regularFile(filename,label) {
  const stat=await fs.lstat(filename);
  if(!stat.isFile())throw new Error(`Dependency input is not a regular file: ${label}`);
  return fs.readFile(filename);
}
export function checkoutReader(repoRoot) {
  return async file=>{
    const parts=file.split('/');
    if(!PATH_PATTERN.test(file)||parts.some(part=>part==='.'||part==='..'))throw new Error(`Invalid dependency input path: ${file}`);
    let current=path.resolve(repoRoot);
    for(const part of parts.slice(0,-1)) {
      current=path.join(current,part);
      if(!(await fs.lstat(current)).isDirectory())throw new Error(`Dependency input crosses a link or non-directory: ${file}`);
    }
    return regularFile(path.join(current,parts.at(-1)),file);
  };
}
export function imageReader(runtimeRoot='/opt/scriptahub/runtime') {
  return async file=>{
    const parts=file.split('/');
    if(!PATH_PATTERN.test(file)||parts.some(part=>part==='.'||part==='..'))throw new Error(`Invalid dependency input path: ${file}`);
    const deployment='scriptahubAgent/deployment/';
    if(file.startsWith(deployment))return regularFile(path.join(runtimeRoot,file.slice(deployment.length)),file);
    if(file.startsWith('skills/'))return regularFile(path.join(runtimeRoot,file),file);
    throw new Error(`Dependency input is outside the image runtime: ${file}`);
  };
}

if(process.argv[1]&&import.meta.url===pathToFileURL(realpathSync(process.argv[1])).href) {
  try {
    if(!process.argv[2])throw new Error('Usage: node dependency-fingerprint.mjs <repoRoot>');
    console.log((await dependencyFingerprint(checkoutReader(process.argv[2]))).fingerprint);
  } catch(error) {
    console.error(`dependency fingerprint failed: ${error.message}`);process.exit(1);
  }
}
