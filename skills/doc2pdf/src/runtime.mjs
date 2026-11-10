import { checkZip } from './zip.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
const require=createRequire(new URL('../external/runtime/package.json',import.meta.url));
export const {unzipSync,strFromU8}=require('fflate');
const {DOMParser}=require('@xmldom/xmldom');
export const all=(doc,name)=>Array.from(doc.getElementsByTagName(name));
export function xml(text){if(/<!DOCTYPE|<!ENTITY/i.test(text))throw new Error('XML DTDs are unsupported.');return new DOMParser({onError(level,message){throw new Error('Invalid XML: '+message);}}).parseFromString(text,'application/xml');}
export function executable(name){const override=process.env[`SCRIPTA_${name.toUpperCase()}`];if(override){try{fs.accessSync(override,fs.constants.X_OK);return override;}catch{return null;}}const names=name==='soffice'?['soffice','libreoffice']:name==='gs'?['gs','gswin64c']: [name];const dirs=(process.env.PATH||'').split(path.delimiter).filter(Boolean);dirs.push('/opt/homebrew/bin','/usr/local/bin','/Applications/LibreOffice.app/Contents/MacOS');if(process.platform==='win32')dirs.push('C:\\Program Files\\LibreOffice\\program');
 for(const file of [...(override?[override]:[]),...dirs.flatMap(d=>names.map(n=>path.join(d,n+(process.platform==='win32'?'.exe':''))))])try{fs.accessSync(file,fs.constants.X_OK);return file;}catch{}return null;}
function qpdfRun(command,args,{timeout,encoding,maxBuffer}) {
 if(!Number.isFinite(maxBuffer)||maxBuffer<0||!Number.isFinite(timeout)||timeout<0)throw new Error('Invalid QPDF capture limits.');
 let directory,dirId,files={},fds=[],result,failure;
 const identity=st=>({dev:st.dev,ino:st.ino});
 try {
  directory=fs.mkdtempSync(path.join(os.tmpdir(),'doc2pdf-qpdf-'));dirId=identity(fs.lstatSync(directory));
  for(const name of ['output.json','error.json']){const file=path.join(directory,name),fd=fs.openSync(file,'wx+',0o600);fds.push(fd);files[name]=identity(fs.fstatSync(fd));}
  const config={command,args,timeout,maxBuffer,parent:process.pid,directory,directoryId:dirId,files};
  const helper=fileURLToPath(new URL('./qpdf-capture.mjs',import.meta.url));
  const p=spawnSync(process.execPath,[helper,JSON.stringify(config)],{encoding:'utf8',timeout:timeout>0?timeout+5000:0,killSignal:'SIGTERM',maxBuffer:8192,stdio:['ignore','pipe','pipe',...fds]});
  if(p.error)throw new Error(`QPDF helper: ${p.error.message}`);
  if(p.signal||p.status!==0)throw new Error(`QPDF helper failed (${p.signal||p.status}): ${p.stderr}`);
  let response;try{response=JSON.parse(p.stdout);}catch{throw new Error('Invalid QPDF helper response');}
  if(!response||typeof response!=='object'||Array.isArray(response)||Object.keys(response).sort().join(',')!=='code,error,signal'||!(response.code===null||Number.isInteger(response.code))||!(response.signal===null||typeof response.signal==='string')||!(response.error===null||typeof response.error==='string')||(response.code!==null&&response.signal!==null))throw new Error('Invalid QPDF helper response');
  const sizes=fds.map(fd=>fs.fstatSync(fd).size);if(sizes.some(size=>size>maxBuffer))throw new Error('QPDF maxBuffer exceeded');
  const read=(fd,size)=>{const buffer=Buffer.alloc(size);let offset=0;while(offset<size){const count=fs.readSync(fd,buffer,offset,size-offset,offset);if(!count)throw new Error('Short QPDF output read');offset+=count;}return encoding==='buffer'||encoding===null?buffer:buffer.toString(encoding);};
  const stdout=read(fds[0],sizes[0]),stderr=read(fds[1],sizes[1]);
  if(response.error)throw new Error(`QPDF: ${response.error}`);
  if(response.code===null&&response.signal===null)throw new Error('Invalid QPDF helper response');
  result={status:response.code,signal:response.signal,stdout,stderr};
 } catch(error){failure=error;}
 finally {
  const errors=[];for(const fd of fds)try{fs.closeSync(fd);}catch(error){errors.push(error);}
  if(directory)try{
   const root=fs.lstatSync(directory);if(!dirId||root.dev!==dirId.dev||root.ino!==dirId.ino)throw new Error('Capture directory changed');
   for(const [name,id] of Object.entries(files)){const file=path.join(directory,name);try{const st=fs.lstatSync(file);if(st.dev!==id.dev||st.ino!==id.ino)throw new Error('Capture file changed');fs.unlinkSync(file);}catch(error){if(error.code!=='ENOENT')throw error;}}
   fs.rmdirSync(directory);
  }catch(error){errors.push(error);}
  if(errors.length)failure=new AggregateError(errors,'QPDF capture cleanup failed',{cause:failure});
 }
 if(failure)throw failure;return result;
}
export function run(tool,args,{timeout=180000,encoding='utf8',allowed=[0],maxBuffer=256*1024*1024}={}){const command=path.isAbsolute(tool)?tool:executable(tool);if(!command)throw new Error(`Missing ${tool}; run doc2pdf install-deps or see dependencies.md.`);const qpdf=tool==='qpdf'||command===executable('qpdf');const p=qpdf&&['linux','darwin'].includes(process.platform)?qpdfRun(command,args,{timeout,encoding,maxBuffer}):spawnSync(command,args,{encoding,timeout,maxBuffer});if(p.error)throw new Error(`${tool}: ${p.error.message}`);if(p.signal)throw new Error(`${tool} terminated by ${p.signal}.`);if(!allowed.includes(p.status))throw new Error(`${tool} failed (${p.status}): ${p.stderr||p.stdout}`);return p.stdout;}
export function doctor(){const found={};for(const name of ['soffice','qpdf','pdftotext','pdffonts','pdftoppm','gs']){const file=executable(name);let version=null;if(file)try{version=run(file,[['pdfinfo','pdftotext','pdffonts','pdftoppm'].includes(name)?'-v':'--version'],{timeout:10000,allowed:[0]}).trim()||'available';}catch{}found[name]={path:file,version};}const q=found.qpdf.version?.match(/(\d+)\.(\d+)/);const missing=Object.entries(found).filter(([name,v])=>name!=='gs'&&(!v.path||!v.version)).map(([name])=>name);if(!q||(Number(q[1])<11||Number(q[1])===11&&Number(q[2])<4))missing.push('qpdf >=11.4');return {ok:missing.length===0,node:process.versions.node,tools:found,missing};}
export function requireRuntime(profile='fidelity'){const report=doctor();if(!report.ok)throw new Error('Missing runtime dependencies: '+report.missing.join(', '));if(profile!=='fidelity'&&(!report.tools.gs.path||!report.tools.gs.version))throw new Error('The selected profile requires Ghostscript.');return report;}
export function readDocx(file){const bytes=fs.readFileSync(file),files=checkZip(bytes,unzipSync(bytes));if(!files['word/document.xml'])throw new Error('DOCX package is incomplete.');for(const [name,data] of Object.entries(files))if(name.endsWith('.xml')||name.endsWith('.rels'))xml(strFromU8(data));return files;}
export function sourceInfo(file){file=fs.realpathSync(file);const ext=path.extname(file).toLowerCase();if(!['.doc','.docx'].includes(ext))throw new Error('Input must have a .doc or .docx extension.');if(ext==='.doc'){if(!fs.readFileSync(file).subarray(0,8).equals(Buffer.from('D0CF11E0A1B11AE1','hex')))throw new Error('The .doc input is not a valid OLE compound document.');return {source:file,fonts:[],links:null};}
 const files=readDocx(file),fonts=new Set();for(const name of ['word/document.xml','word/styles.xml','word/numbering.xml'])if(files[name])for(const n of all(xml(strFromU8(files[name])),'w:rFonts'))for(const a of ['ascii','hAnsi','eastAsia','cs']){const v=n.getAttribute('w:'+a);if(v&&!v.startsWith('+'))fonts.add(v.trim().replace(/\s+/g,' '));}return {source:file,fonts:[...fonts],links:all(xml(strFromU8(files['word/document.xml'])),'w:hyperlink').length};}
