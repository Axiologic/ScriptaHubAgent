import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import crypto from 'node:crypto';

const flags=constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW;
const proc=fd=>'/proc/self/fd/'+fd;
const parts=name=>{if(typeof name!=='string'||!name||name.startsWith('/')||name.split('/').some(p=>!p||p==='.'||p==='..'||p.includes('\0')))throw new Error('Invalid anchored path');return name.split('/');};
export async function openRoot(absolute) {
  if(process.platform!=='linux'||!path.isAbsolute(absolute)) throw new Error('Remote processing requires Linux with /proc/self/fd and flock');
  await fs.access('/proc/self/fd');let handle=await fs.open('/',flags);
  try {for(const part of absolute.split('/').filter(Boolean)){const next=await fs.open(proc(handle.fd)+'/'+part,flags);await handle.close();handle=next;}return handle;}
  catch(error){await handle.close();throw error;}
}
export async function withParent(root,name,fn,{create=false}={}) {
  const components=parts(name),leaf=components.pop(),opened=[];let fd=root.fd;
  try {for(const part of components){const next=proc(fd)+'/'+part;if(create)await fs.mkdir(next,{mode:0o700}).catch(e=>{if(e.code!=='EEXIST')throw e;});const handle=await fs.open(next,flags);opened.push(handle);fd=handle.fd;}return await fn(proc(fd)+'/'+leaf);}
  finally {for(const handle of opened.reverse())await handle.close();}
}
export async function openDir(root,name,{create=false}={}) {return withParent(root,name,async target=>{if(create)await fs.mkdir(target,{mode:0o700}).catch(e=>{if(e.code!=='EEXIST')throw e;});return fs.open(target,flags);},{create});}
export async function lockDirectory(root,name="processing.lock") {
  const file=await withParent(root,name,p=>fs.open(p,constants.O_CREAT|constants.O_RDWR|constants.O_NOFOLLOW|constants.O_NONBLOCK,0o600));
  const stat=await file.stat();if(!stat.isFile()||stat.nlink!==1){await file.close();throw new Error('Invalid processing lock');}
  try {await new Promise((resolve,reject)=>{const child=spawn('/usr/bin/flock',['--exclusive','--nonblock','3'],{stdio:['ignore','ignore','ignore',file.fd]});child.once('error',reject);child.once('close',code=>code===0?resolve():reject(new Error('Another processing command owns this task')));});return file;}
  catch(error){await file.close();throw error;}
}
export const at=(handle,name)=>proc(handle.fd)+'/'+name;

export async function executionLock(root,executionId) {
  if(typeof executionId!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(executionId))throw new Error('Invalid execution ID');
  return lockDirectory(root,'.scriptahub-processing-'+crypto.createHash('sha256').update(executionId).digest('hex')+'.lock');
}
export async function withExecutionLock(root,executionId,fn) {
  const base=await openRoot(await fs.realpath(root));let lock;
  try {lock=await executionLock(base,executionId);return await fn(base);} finally {await lock?.close();await base.close();}
}
