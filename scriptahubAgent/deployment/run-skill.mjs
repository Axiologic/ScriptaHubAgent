import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';

export const launchers = Object.freeze({
  'comprehensive-summary':['scripts/comprehensivesummary'],
  doc2pdf:['scripts/doc2pdf'],html2doc:['scripts/html2doc'],
  'humanise-html':['scripts/humanisehtml'],'marketing-summary':['scripts/marketingsummary'],
  pdf2html:['scripts/pdf2html'],'relevant-keywords':['scripts/relevantkeywords'],
  'shf-presentation-creator':['node','scripts/shf.mjs'],
  'short-description':['scripts/shortdescription'],
  'theatrical-audio':['node','bin/audio.mjs'],'translate-html':['scripts/translatehtml'],
  'validate-book':['scripts/validatebook'],
});

// This launcher is invoked inside the processing sandbox with a cleared environment.
export function skillCommand(skill,args,cwd,root=path.dirname(fileURLToPath(import.meta.url))) {
  if (!Object.hasOwn(launchers,skill) || !Array.isArray(args) || args.length>256
      || args.some(value=>typeof value!=='string'||value.includes('\0'))
      || Buffer.byteLength(JSON.stringify(args))>60000) throw new Error('Invalid skill command');
  const workdir=fs.realpathSync(cwd);
  if (!fs.statSync(workdir).isDirectory() || workdir==='/'
      || workdir.split(path.sep).some(part=>['.data','.ploinky','.ploinky-box','.roboteam'].includes(part))) throw new Error('A non-private run directory is required');
  const directory=path.join(root,'skills',skill),launcher=launchers[skill];
  return {
    command:launcher[0]==='node'?process.execPath:'/bin/sh',
    args:[path.join(directory,launcher.at(-1)),...args],cwd:workdir,
    env:{PATH:'/usr/local/bin:/usr/bin:/bin',HOME:'/tmp/home',TMPDIR:'/tmp',XDG_CACHE_HOME:'/tmp/cache',
      HF_HUB_OFFLINE:'1',TRANSFORMERS_OFFLINE:'1',AUDIO_ENGINE:'piper',
      PDF2HTML_RUNTIME_ROOT:path.join(root,'skills/pdf2html'),
      VALIDATEBOOK_PDF2HTML:path.join(root,'skills/pdf2html/scripts/pdf2html'),
      PDF2HTML_CHROMIUM_EXECUTABLE:'/usr/local/bin/chromium-browser',
      VALIDATEBOOK_CHROMIUM:'/usr/local/bin/chromium-browser',
      VALIDATEBOOK_PDFTOTEXT:'/usr/bin/pdftotext',VALIDATEBOOK_PDFFONTS:'/usr/bin/pdffonts',
      VALIDATEBOOK_PDFIMAGES:'/usr/bin/pdfimages',VALIDATEBOOK_PDFTOHTML:'/usr/bin/pdftohtml',
      VALIDATEBOOK_READER_CSS:path.join(root,'reader/reader.css'),
      CHROMIUM_USER_FLAGS:'--no-sandbox --disable-dev-shm-usage'},
  };
}

if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  try {
    const plan=skillCommand(process.argv[2],process.argv.slice(3),process.cwd());
    const child=spawn(plan.command,plan.args,{stdio:'inherit',cwd:plan.cwd,env:plan.env});
    for (const signal of ['SIGTERM','SIGINT']) process.once(signal,()=>child.kill(signal));
    child.once('error',error=>{console.error(error.message);process.exitCode=1;});
    child.once('exit',(code,signal)=>{process.exitCode=code??(signal?130:1);});
  } catch(error) {console.error(error.message);process.exitCode=1;}
}
