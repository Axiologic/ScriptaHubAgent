import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const config=JSON.parse(process.argv[2]);
let child, stopped, escalation, deadline, monitor, parentGone=false;
const cleanup=()=>{
  const same=(file,id)=>{const s=fs.lstatSync(file);return s.dev===id.dev&&s.ino===id.ino;};
  if(!same(config.directory,config.directoryId))throw new Error('Capture directory changed');
  for(const [name,id] of Object.entries(config.files)) {
    const file=path.join(config.directory,name);
    try {if(!same(file,id))throw new Error('Capture file changed');fs.unlinkSync(file);}catch(error){if(error.code!=='ENOENT')throw error;}
  }
  fs.rmdirSync(config.directory);
};
const stop=reason=>{
  if(stopped)return;
  stopped=reason;
  if(child){try{child.kill('SIGTERM');}catch{} escalation=setTimeout(()=>{if(child.exitCode===null&&child.signalCode===null)try{child.kill('SIGKILL');}catch{}},1000);}
};
const checkParent=()=>{if(process.ppid!==config.parent){parentGone=true;stop('parent exited');}};
for(const sig of ['SIGTERM','SIGINT','SIGHUP'])process.on(sig,()=>stop(`helper received ${sig}`));
checkParent();
let exit={code:null,signal:null},spawnError;
if(!parentGone) {
  try {
    child=spawn(config.command,config.args,{stdio:['ignore',3,4]});
    const closed=new Promise(resolve=>{child.once('error',error=>{spawnError=error;});child.once('close',(code,signal)=>resolve({code,signal}));});
    if(config.timeout>0)deadline=setTimeout(()=>stop('timeout'),config.timeout);
    monitor=setInterval(()=>{
      checkParent();
      try{if(fs.fstatSync(3).size>config.maxBuffer||fs.fstatSync(4).size>config.maxBuffer)stop('maxBuffer exceeded');}catch(error){stop(`capture error: ${error.message}`);}
    },20);
    exit=await closed;
  } catch(error) {spawnError=error;}
}
clearTimeout(deadline);clearTimeout(escalation);clearInterval(monitor);
checkParent();
try {if(fs.fstatSync(3).size>config.maxBuffer||fs.fstatSync(4).size>config.maxBuffer)stopped||='maxBuffer exceeded';} catch(error) {stopped||=`capture error: ${error.message}`;}
if(parentGone){try{fs.closeSync(3);fs.closeSync(4);cleanup();}catch(error){process.stderr.write(`Capture cleanup failed: ${error.message}\n`);} }
else process.stdout.write(JSON.stringify({code:exit.code,signal:exit.signal,error:stopped||spawnError?.message||null}));
