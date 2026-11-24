import fs from 'node:fs/promises';
import path from 'node:path';
import {constants} from 'node:fs';
import {parseArgs} from 'node:util';
import {withParent} from './anchored-files.mjs';

const parallelSkills = new Set(['comprehensive-summary','relevant-keywords','marketing-summary','short-description','translate-html']);
const within = (name, directory) => name === directory || name.startsWith(directory + '/');
export function operationAllows(scope, name) {
  return !scope || scope.files.includes(name) || scope.trees.some(directory => within(name, directory));
}

// The native commands remain serialized. Their snapshots contain only the addressed
// job and its declared resources, so sibling semantic workers can keep writing.
function withAccessors(scope) {
  return {...scope,allows:name=>operationAllows(scope,name),traverse:name=>operationAllows(scope,name)||[...scope.files,...scope.trees].some(entry=>entry.startsWith(name+'/'))};
}

export async function jobInputScope(root, {skill,args,taskDirectory,virtualCwd,savedScope}) {
  if (!parallelSkills.has(skill) || ['doctor','--help','repair'].includes(args[0])) return null;
  if (savedScope) {
    if (!Array.isArray(savedScope.files) || !Array.isArray(savedScope.trees)
      || [...savedScope.files,...savedScope.trees].some(name=>typeof name!=='string'||!name||name.startsWith('/')||name.includes('\\')||name.split('/').some(part=>!part||part==='.'||part==='..'))) throw Error('Invalid saved editorial input scope');
    return withAccessors(savedScope);
  }
  const files = new Set(), trees = new Set();
  const relative = value => {
    if (typeof value !== 'string') throw Error('Invalid editorial job path');
    const prefix = path.posix.join(virtualCwd,taskDirectory) + '/';
    let name = value.startsWith(prefix) ? value.slice(prefix.length)
      : value.startsWith(taskDirectory + '/') ? value.slice(taskDirectory.length + 1) : null;
    if (!name || name.includes('\\') || name.split('/').some(part=>!part || part==='.' || part==='..')) throw Error('Editorial job path must stay inside its task: ' + value);
    return name;
  };
  const {values,positionals:[input]} = parseArgs({args:args.slice(1),allowPositionals:true,
    options:{...Object.fromEntries(['batch','batch-sha256','replace-sha256','language','minutes','wpm','count','synonyms','job-dir','output','html','to','from'].map(name=>[name,{type:'string'}])),'shared-editorial':{type:'boolean'},'max-duration':{type:'boolean'},overwrite:{type:'boolean'},help:{type:'boolean',short:'h'}}});
  const option = flag => values[flag.slice(2)];
  const addFile = value => { const name=relative(value); files.add(name); return name; };
  const prepare = ['prepare','analyze'].includes(args[0]);
  const jobCommand = prepare || ['status','build','batch-contract','submit-batch'].includes(args[0]);
  if (jobCommand) {
    const jobPath = prepare ? option('--job-dir') : input;
    if (!jobPath) throw Error('Remote editorial preparation requires --job-dir to isolate parallel jobs');
    const job = relative(jobPath);
    if (['editorial-jobs','translation-jobs','sources','editorial','translations','run-state','package'].includes(job)
      || job.startsWith('translation-jobs/') && job.split('/').length<3) throw Error('The remote command must address one job, not a shared jobs directory');
    trees.add(job);
    if (prepare) {
      addFile(input);
      if (option('--output')) addFile(option('--output'));
      if (option('--synonyms')) addFile(option('--synonyms'));
      if (skill === 'relevant-keywords') files.add(path.posix.join(path.posix.dirname(relative(input)),'relevantKeywords.txt'));
      if (!option('--output') && skill !== 'relevant-keywords') throw Error('Remote editorial preparation requires --output to isolate the generated resource');
    } else {
      const filename = job + '/job.json';
      const metadata = await withParent(root,filename,async file=>{
        const handle=await fs.open(file,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
        try {const stat=await handle.stat();if(!stat.isFile()||stat.nlink!==1||stat.size>32*1024*1024)throw Error('Invalid editorial job metadata');return JSON.parse(await handle.readFile('utf8'));}
        finally {await handle.close();}
      });
      addFile(metadata.source);
      addFile(metadata.output);
    }
  } else if (args[0] === 'validate') {
    addFile(input);
    if (option('--html')) addFile(option('--html'));
    if (option('--output')) addFile(option('--output'));
  } else return null;
  // Local media/CSS dependencies belong to the selected source/output, never to
  // another job's analysis or to another translated edition.
  const inspected = new Set();
  async function inspect(name) {
    if(inspected.has(name)||! /\.(?:html?|xhtml|css|svg)$/i.test(name))return;
    inspected.add(name);
    let text;
    try {text=await withParent(root,name,async file=>{
      const handle=await fs.open(file,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
      try {const stat=await handle.stat();if(!stat.isFile()||stat.nlink!==1||stat.size>32*1024*1024)throw Error('Invalid editorial resource');return await handle.readFile('utf8');}
      finally {await handle.close();}
    });}
    catch(error){if(error.code==='ENOENT')return;throw error;}
    const refs=[...text.matchAll(/\b(?:src|poster|href)\s*=\s*["']([^"']+)["']|url\(\s*["']?([^\s"')]+)["']?\s*\)|@import\s+["']([^"']+)["']/gi)];
    for(const match of refs) {
      const ref=(match[1]||match[2]||match[3]).replaceAll('&amp;','&');
      if(/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(ref))continue;
      const dependency=path.posix.normalize(path.posix.join(path.posix.dirname(name),decodeURIComponent(ref.split(/[?#]/)[0])));
      if(!/\.(?:css|woff2?|ttf|otf|eot|png|jpe?g|gif|webp|avif|svg|ico|bmp|mp3|mp4|ogg|wav|webm)$/i.test(dependency))continue;
      if(dependency.startsWith('../')||dependency.startsWith('/'))throw Error('Editorial resource leaves the task');
      files.add(dependency);await inspect(dependency);
    }
  }
  for(const name of [...files])await inspect(name);
  const scope={files:[...files].sort(),trees:[...trees].sort()};
  return withAccessors(scope);
}
