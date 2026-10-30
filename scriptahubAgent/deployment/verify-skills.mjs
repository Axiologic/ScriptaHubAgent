import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const root=path.resolve(process.argv[2]||'/opt/scriptahub/runtime');
const {launchers}=await import('./run-skill.mjs');
const config=JSON.parse(await fs.readFile(path.join(root,'skills-runtime.json'),'utf8'));
const cwd=await fs.mkdtemp(path.join(os.tmpdir(),'scriptahub-runtime-'));
try {
  for(const skill of config.skills){
    const launcher=launchers[skill];if(!launcher)throw new Error(`Missing launcher for ${skill}`);
    await fs.access(path.join(root,'skills',skill,launcher.at(-1)));
  }
  await new Promise((resolve,reject)=>{
    const worker=path.join(root,'skills/pdf2html/src/pdf2html/native-worker.mjs');
    const fixture=path.join(root,'skills/pdf2html/tests/fixtures/semantic.pdf');
    const child=spawn(process.execPath,[worker,fixture],{stdio:['ignore','pipe','inherit'],cwd});
    const chunks=[];child.stdout.on('data',chunk=>chunks.push(chunk));
    child.once('error',reject);child.once('exit',code=>{
      if(code!==0)return reject(new Error(`Native PDF conversion failed (${code})`));
      try { const result=JSON.parse(Buffer.concat(chunks).toString());
        if(!result || typeof result!=='object')throw new Error('Native PDF conversion returned no document');
        console.log('Native PDF engine converted the semantic fixture.');resolve();
      }catch(error){reject(error);}
    });
  });
  const checks=await import(pathToFileURL(path.join(root,'skills/scriptahub-tasks/scripts/workflow-checks.mjs')).href);
  // Import relative to the actual installed tree, without a second source copy.
  process.chdir(cwd);const report=await checks.preflight();
  if(!report.ok)throw new Error('Manuscript runtime preflight failed');
  for(const [skill,launcher] of [['html2doc','html2doc'],['humanise-html','humanisehtml']]) {
    await new Promise((resolve,reject)=>{
      const child=spawn('/bin/sh',[path.join(root,'skills',skill,'scripts',launcher),'doctor'],{stdio:'inherit',cwd});
      child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(new Error(`${skill} doctor failed (${code})`)));
    });
  }
  for(const engine of config.audioEngines){
    await new Promise((resolve,reject)=>{
      const child=spawn(process.execPath,[path.join(root,'skills/theatrical-audio/bin/audio.mjs'),'doctor','--engine',engine],{stdio:'inherit',cwd});
      child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(new Error(`Audio ${engine} doctor failed (${code})`)));
    });
  }
  await new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,[path.join(root,'skills/shf-presentation-creator/scripts/shf.mjs')],{stdio:'inherit',cwd});
    child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(new Error(`Presentation runtime failed (${code})`)));
  });
  console.log('All ScriptaHub skill entrypoints and configured runtime doctors passed.');
} finally { await fs.rm(cwd,{recursive:true,force:true}); }
