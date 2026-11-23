import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';

// Reads a tree without following links. On Linux every open is relative to an already-open parent
// (/proc/self/fd/<fd>/<name>, as skills/scriptahub-tasks/scripts/anchored-files.mjs), so a directory swapped for a
// link after it was listed is never entered. Like that helper, the anchored mode refuses other platforms. The path
// mode exists only for non-Linux test hosts: it rechecks every open ancestor's lstat identity after each open, which a
// swap-and-restore race can still defeat, so it is refused on Linux.
const DIRECTORY=constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW;
const FILE=constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK;
const unsafe=name=>Object.assign(new Error('Unsafe source entry: '+name),{code:'EUNSAFE'});
const validName=name=>{if(typeof name!=='string'||!name||name==='.'||name==='..'||/[/\0]/.test(name))throw unsafe(String(name));return name;};
const at=(dir,name)=>dir.anchored?`/proc/self/fd/${dir.handle.fd}/${name}`:path.join(dir.path,name);
async function intact(node) {
  if(node.anchored)return;
  for(let current=node;current;current=current.parent) {
    const stat=await fs.lstat(current.path);
    if(!stat.isDirectory()||stat.dev!==current.stat.dev||stat.ino!==current.stat.ino)throw unsafe(current.path);
  }
}

export async function openTree(absolute,{pathMode=false}={}) {
  if(pathMode&&process.platform==='linux')throw new Error('Path-based source reads are refused on Linux');
  if(!pathMode) {
    if(process.platform!=='linux')throw new Error('Anchored source reads require Linux with /proc/self/fd');
    await fs.access('/proc/self/fd');
  }
  if(!path.isAbsolute(absolute))throw unsafe(String(absolute));
  const handle=await fs.open(absolute,DIRECTORY);
  try {
    const stat=await handle.stat();if(!stat.isDirectory())throw unsafe(absolute);
    const node={handle,stat,path:absolute,parent:null,anchored:!pathMode};node.dev=stat.dev;return node;
  } catch(error) {await handle.close();throw error;}
}
export async function listDirectory(dir) {
  const entries=await fs.readdir(dir.anchored?at(dir,'.'):dir.path,{withFileTypes:true});
  await intact(dir);return entries;
}
export async function openDirectory(dir,name) {
  const handle=await fs.open(at(dir,validName(name)),DIRECTORY);
  const node={handle,stat:null,path:path.join(dir.path,name),parent:dir,anchored:dir.anchored,dev:dir.dev};
  try {
    node.stat=await handle.stat();
    if(!node.stat.isDirectory()||node.stat.dev!==dir.dev)throw unsafe(node.path);
    await intact(node);return node;
  } catch(error) {await handle.close();throw error;}
}
export const closeDirectory=dir=>dir.handle.close();
// Returns the file's bytes and mode. admit(size) runs before any byte is buffered and may throw to enforce a limit.
export async function readRegularFile(dir,name,{admit=()=>{}}={}) {
  const handle=await fs.open(at(dir,validName(name)),FILE);
  try {
    const stat=await handle.stat();
    if(!stat.isFile()||stat.nlink!==1||stat.dev!==dir.dev||!Number.isSafeInteger(stat.size))throw unsafe(path.join(dir.path,name));
    admit(stat.size);
    const bytes=Buffer.alloc(stat.size);let offset=0;
    while(offset<stat.size) {const {bytesRead}=await handle.read(bytes,offset,stat.size-offset,offset);if(!bytesRead)break;offset+=bytesRead;}
    if(offset!==stat.size||(await handle.read(Buffer.alloc(1),0,1,offset)).bytesRead)throw Object.assign(new Error('Source file changed while it was read'),{code:'ECHANGED'});
    if(!dir.anchored) {
      const current=await fs.lstat(path.join(dir.path,name));
      if(!current.isFile()||current.dev!==stat.dev||current.ino!==stat.ino)throw unsafe(path.join(dir.path,name));
      await intact(dir);
    }
    return {bytes,mode:stat.mode};
  } finally {await handle.close();}
}
