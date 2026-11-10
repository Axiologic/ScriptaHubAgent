import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';
const posixOnly={skip:['linux','darwin'].includes(process.platform)?false:'requires Linux or macOS'};

async function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'doc2pdf-runtime-test-')),src=path.join(root,'src'),modules=path.join(root,'external/runtime/node_modules');
 fs.mkdirSync(src,{recursive:true});fs.mkdirSync(path.join(modules,'fflate'),{recursive:true});fs.mkdirSync(path.join(modules,'@xmldom/xmldom'),{recursive:true});
 for(const name of ['runtime.mjs','zip.mjs','qpdf-capture.mjs'])fs.copyFileSync(new URL(`../src/${name}`,import.meta.url),path.join(src,name));
 fs.writeFileSync(path.join(root,'external/runtime/package.json'),'{}');fs.writeFileSync(path.join(modules,'fflate/index.js'),'module.exports={}');fs.writeFileSync(path.join(modules,'@xmldom/xmldom/index.js'),'module.exports={}');
 const tool=path.join(root,'custom-tool'),input=path.join(root,'input.pdf');fs.writeFileSync(input,'sentinel');
 fs.writeFileSync(tool,`#!${process.execPath}\n${String.raw`
const fs=require('fs'),mode=process.argv[2];
if(mode==='types')process.stdout.write(JSON.stringify({out:fs.fstatSync(1).isFile(),err:fs.fstatSync(2).isFile(),input:fs.readFileSync(process.argv[3],'utf8')}));
if(mode==='binary')process.stdout.write(Buffer.from([0,255,128,65]));
if(mode==='exit3')process.exitCode=3;
if(mode==='exit2'){process.stderr.write('failure');process.exitCode=2;}
if(mode==='stdout'||mode==='stderr'){process[mode].write(Buffer.alloc(Number(process.argv[3])));if(process.argv[4]==='hang')setInterval(()=>{},1000);}
if(mode==='hang'){process.on('SIGTERM',()=>{});fs.writeFileSync(process.argv[3],String(process.pid));setInterval(()=>{},1000);}
if(mode==='--version')process.stdout.write('qpdf version 12.4');
`}`,{mode:0o700});
 const previous=process.env.SCRIPTA_QPDF;process.env.SCRIPTA_QPDF=tool;
 t.after(()=>{if(previous===undefined)delete process.env.SCRIPTA_QPDF;else process.env.SCRIPTA_QPDF=previous;fs.rmSync(root,{recursive:true,force:true});});
 return {root,tool,input,...await import(pathToFileURL(path.join(src,'runtime.mjs')))};
}
test('synchronous QPDF capture uses regular files and preserves binary and source',posixOnly,async t=>{
 const f=await fixture(t),v=f.run('qpdf',['types',f.input]);assert.equal(typeof v,'string');assert.deepEqual(JSON.parse(v),{out:true,err:true,input:'sentinel'});
 assert.deepEqual(f.run(f.tool,['binary'],{encoding:'buffer'}),Buffer.from([0,255,128,65]));assert.equal(fs.readFileSync(f.input,'utf8'),'sentinel');
 assert.equal(f.run('qpdf',['exit3'],{allowed:[0,3]}),'');assert.throws(()=>f.run('qpdf',['exit3']),/failed \(3\)/);assert.throws(()=>f.run('qpdf',['exit2']),/failure/);
 assert.match(f.doctor().tools.qpdf.version,/12\.4/);
 fs.writeFileSync(f.tool,'#!/no/such/interpreter\n');assert.throws(()=>f.run('qpdf',[]),/ENOENT/);
});
test('both output limits apply at completion and during a hanging child',posixOnly,async t=>{
 const f=await fixture(t);
 for(const stream of ['stdout','stderr']){f.run('qpdf',[stream,'100'],{maxBuffer:100});assert.throws(()=>f.run('qpdf',[stream,'101'],{maxBuffer:100}),/maxBuffer/);assert.throws(()=>f.run('qpdf',[stream,'101','hang'],{maxBuffer:100,timeout:5000}),/maxBuffer/);}
});
test('timeout kills and reaps a TERM-ignoring QPDF child',posixOnly,async t=>{
 const f=await fixture(t),pidfile=path.join(f.root,'pid');assert.throws(()=>f.run('qpdf',['hang',pidfile],{timeout:500}),/timeout/);
 const pid=Number(fs.readFileSync(pidfile,'utf8'));assert.throws(()=>process.kill(pid,0),{code:'ESRCH'});
});
test('non-QPDF commands retain pipes and concurrent callers do not share captures',posixOnly,async t=>{
 const f=await fixture(t);assert.equal(f.run(process.execPath,['-e',"process.stdout.write(String(require('fs').fstatSync(1).isFile()))"]),'false');
 const code=`import {run} from ${JSON.stringify(pathToFileURL(path.join(f.root,'src/runtime.mjs')).href)}; process.stdout.write(run('qpdf',['binary'],{encoding:'buffer'}).toString('hex'));`;
 const call=()=>new Promise((resolve,reject)=>{const p=spawn(process.execPath,['--input-type=module','-e',code],{env:process.env});let out='';p.stdout.on('data',b=>out+=b);p.once('error',reject);p.once('close',code=>code===0?resolve(out):reject(new Error('child failed '+code)));});
 assert.deepEqual(await Promise.all([call(),call(),call()]),['00ff8041','00ff8041','00ff8041']);
});

const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(check){for(let i=0;i<150;i++){if(check())return;await delay(20);}throw new Error('Timed out waiting for process cleanup');}
for(const signal of ['SIGTERM','SIGKILL'])test(`helper cleans captures and QPDF after parent ${signal}`,posixOnly,async t=>{
 const f=await fixture(t),pidfile=path.join(f.root,'pid'),sentinel=path.join(f.root,'keep');fs.writeFileSync(sentinel,'safe');
 const code=`import {run} from ${JSON.stringify(pathToFileURL(path.join(f.root,'src/runtime.mjs')).href)};run('qpdf',['hang',${JSON.stringify(pidfile)}],{timeout:0});`;
 const parent=spawn(process.execPath,['--input-type=module','-e',code],{env:{...process.env,TMPDIR:f.root},stdio:'ignore'});
 t.after(()=>{try{parent.kill('SIGKILL');}catch{}});
 await until(()=>fs.existsSync(pidfile));const pid=Number(fs.readFileSync(pidfile,'utf8'));
 assert.equal(parent.kill(signal),true);await new Promise(resolve=>parent.once('close',resolve));
 await until(()=>{try{process.kill(pid,0);return false;}catch(error){return error.code==='ESRCH';}});
 await until(()=>!fs.readdirSync(f.root).some(name=>name.startsWith('doc2pdf-qpdf-')));
 assert.equal(fs.readFileSync(sentinel,'utf8'),'safe');
});

test('helper refuses a lost parent before spawning QPDF and removes owned captures',posixOnly,async t=>{
 const f=await fixture(t),dir=fs.mkdtempSync(path.join(f.root,'doc2pdf-qpdf-')),files={},fds=[];
 for(const name of ['output.json','error.json']){const fd=fs.openSync(path.join(dir,name),'wx+',0o600),st=fs.fstatSync(fd);fds.push(fd);files[name]={dev:st.dev,ino:st.ino};}
 const st=fs.lstatSync(dir),pidfile=path.join(f.root,'not-started');
 const config={parent:2147483647,command:f.tool,args:['hang',pidfile],timeout:0,maxBuffer:100,directory:dir,directoryId:{dev:st.dev,ino:st.ino},files};
 const p=spawn(process.execPath,[path.join(f.root,'src/qpdf-capture.mjs'),JSON.stringify(config)],{stdio:['ignore','pipe','pipe',...fds]});
 await new Promise((resolve,reject)=>{p.once('error',reject);p.once('close',resolve);});for(const fd of fds)fs.closeSync(fd);
 assert.equal(fs.existsSync(pidfile),false);assert.equal(fs.existsSync(dir),false);
});

test('creation, response, read and cleanup failures are reported',posixOnly,async t=>{
 const f=await fixture(t),originalOpen=fs.openSync,originalRead=fs.readSync,originalRmdir=fs.rmdirSync;
 fs.openSync=function(file,...args){if(String(file).endsWith('output.json'))throw new Error('injected create');return originalOpen.call(this,file,...args);};
 try{assert.throws(()=>f.run('qpdf',['binary']),/injected create/);}finally{fs.openSync=originalOpen;}
 const helper=path.join(f.root,'src/qpdf-capture.mjs'),source=fs.readFileSync(helper,'utf8');fs.writeFileSync(helper,"process.stdout.write('invalid');");
 try{assert.throws(()=>f.run('qpdf',['binary']),/Invalid QPDF helper response/);}finally{fs.writeFileSync(helper,source);}
 fs.readSync=function(){throw new Error('injected read');};
 try{assert.throws(()=>f.run('qpdf',['binary']),/injected read/);}finally{fs.readSync=originalRead;}
 let retained;fs.rmdirSync=function(dir,...args){if(String(dir).includes('doc2pdf-qpdf-')){retained=dir;throw new Error('injected cleanup');}return originalRmdir.call(this,dir,...args);};
 try{assert.throws(()=>f.run('qpdf',['binary']),/cleanup failed/);}finally{fs.rmdirSync=originalRmdir;if(retained)fs.rmSync(retained,{recursive:true,force:true});}
});

test('Windows QPDF fallback returns synchronous text and binary output',{skip:process.platform==='win32'?false:'requires Windows'},async t=>{
 const f=await fixture(t);process.env.SCRIPTA_QPDF=process.execPath;
 assert.equal(f.run('qpdf',['-e',"process.stdout.write('ok')"]),'ok');
 assert.deepEqual(f.run('qpdf',['-e','process.stdout.write(Buffer.from([0,255,128,65]))'],{encoding:'buffer'}),Buffer.from([0,255,128,65]));
});
