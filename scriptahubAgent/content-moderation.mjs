import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {sandboxCommand} from './processing-sandbox.mjs';

export const policyVersion = 4;
export function portableVisualKey(filename, sha256) {
  const extension = path.extname(filename).toLowerCase().replace('.jpeg','.jpg');
  if (['.pdf','.jpg','.png','.webp'].includes(extension)) return extension + ':' + sha256;
  return null;
}
const execute = promisify(execFile);
export const categories = new Set(['sexual_exploitation','sexually_explicit','child_endangerment',
  'graphic_violence','violent_extremism','hate_or_harassment','self_harm','dangerous_activity',
  'privacy_or_abuse','harmful_advice','extreme_presentation','unreviewable']);
export const blockedMessage = category => category === 'unreviewable'
  ? 'The book request could not be reviewed. Check that its documents and images can be opened.'
  : 'The book request contains material outside the ScriptaHub content policy (' + category.replaceAll('_',' ') + ').';
const unavailable = () => Object.assign(Error('Content moderation is temporarily unavailable.'),{status:503,code:'MODERATION_UNAVAILABLE'});

// Untrusted documents are prepared in the existing, networkless processing sandbox.
async function render(directory, taskId, filename, output,signal) {
  const virtualCwd = '/workspace/moderation', prefix = virtualCwd + '/tasks/' + taskId + '/';
  const command = sandboxCommand({virtualCwd,taskId,jobDirectory:directory,skill:'book-pdf',
    args:['moderation-render',prefix+filename,'--output',prefix+output],input:''});
  try { await execute(command.command,command.args,{timeout:180000,maxBuffer:65536,signal}); }
  catch (error) {
    if (error.code === 42) return false;
    throw unavailable();
  }
  return true;
}

export async function prepareReviewUnits(context, files, {prepare=render}={}) {
  const units = [];
  const signal = AbortSignal.timeout(540000);
  const directory = await fs.mkdtemp(path.join(os.tmpdir(),'scripta-moderation-'));
  const add = (file,text,image = null) => {
    const digest = createHash('sha256').update(JSON.stringify([file.path,file.changeId,text]));
    if (image) digest.update(image);
    units.push({digest:digest.digest('hex'),file:file.path,changeId:file.changeId ?? null,text,image});
  };
  try {
    for (const file of files) {
      const target = path.join(directory,'inputs',file.path);
      await fs.mkdir(path.dirname(target),{recursive:true});
      await fs.writeFile(target,file.bytes);
    }
    await fs.mkdir(path.join(directory,'moderation-output'));
    const reviewed = new Set();
    for (const [index, file] of files.entries()) {
      const key = file.sha256 && portableVisualKey(file.path,file.sha256);
      if (file.alreadyReviewed || (key && reviewed.has(key))) continue;
      const extension = path.extname(file.path).toLowerCase();
      if (/^\.(?:woff2?|ttf|otf|eot)$/.test(extension)) continue;
      if (/^\.(?:json|txt|css|csv|md|js|mjs)$/.test(extension)) {
        const text = file.bytes.toString('utf8');
        for (let offset=0;offset<Math.max(1,text.length);offset+=7500) add(file,text.slice(offset,offset+8000));
      } else {
        const output = 'moderation-output/' + index;
        if (!await prepare(directory,context.taskId,'inputs/' + file.path,output,signal)) {
          return {finding:{category:'unreviewable',changeId:file.changeId}};
        }
        const rendered = JSON.parse(await fs.readFile(path.join(directory,output,'units.json'),'utf8'));
        if (!Array.isArray(rendered) || !rendered.length) throw unavailable();
        for (const unit of rendered) {
          const image = await fs.readFile(path.join(directory,output,unit.image));
          const text = unit.text || '';
          for (let offset=0;offset<Math.max(1,text.length);offset+=7500) add(file,text.slice(offset,offset+8000),image);
        }
        if (key) reviewed.add(key);
        await fs.rm(path.join(directory,output),{recursive:true,force:true});
      }
    }
    return {units};
  } finally { await fs.rm(directory,{recursive:true,force:true}); }
}
