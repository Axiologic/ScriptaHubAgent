import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';

export function processingSocketPath(dataDir) {
  const uid=process.getuid?.() ?? 0;
  const root=path.join(process.platform==='linux'?'/dev/shm':'/tmp',`scriptahub-ipc-${uid}`);
  try {fs.mkdirSync(root,{mode:0o700});} catch(error) {if(error.code!=='EEXIST')throw error;}
  const stat=fs.lstatSync(root);
  if(!stat.isDirectory()||stat.isSymbolicLink()||stat.uid!==uid||(stat.mode&0o777)!==0o700) throw new Error('Invalid processing IPC directory');
  const id=crypto.createHash('sha256').update(path.resolve(dataDir)).digest('hex').slice(0,32);
  return path.join(root,id+'.sock');
}

export async function invokeSupervisor(dataDir,request) {
  return new Promise((resolve,reject)=>{
    const socket=net.createConnection(processingSocketPath(dataDir));let response='';
    socket.setTimeout(610000,()=>socket.destroy(new Error('Processing supervisor timeout')));
    socket.once('connect',()=>socket.write(JSON.stringify(request)+'\n'));
    socket.on('data',bytes=>{response+=bytes.toString('utf8');if(Buffer.byteLength(response)>300000)socket.destroy(new Error('Processing response too large'));});
    socket.once('error',reject);
    socket.once('end',()=>{try{resolve(JSON.parse(response));}catch{reject(new Error('Invalid processing response'));}});
  });
}
