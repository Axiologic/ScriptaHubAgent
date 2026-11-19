import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=fileURLToPath(new URL('../../',import.meta.url));
async function definitions() {
  const directory=path.join(root,'flows');
  return Promise.all((await fs.readdir(directory)).filter(name=>name.endsWith('.json')).map(async name=>({name,graph:JSON.parse(await fs.readFile(path.join(directory,name),'utf8'))})));
}
function proseBlocks(text) {
  const lines=[];let fence=null;
  for(const line of text.split('\n')) {
    const marker=/^\s*(`{3,}|~{3,})/.exec(line)?.[1];
    if(marker) {if(!fence)fence=marker;else if(marker[0]===fence[0]&&marker.length>=fence.length)fence=null;lines.push('');continue;}
    if(!fence)lines.push(line);
  }
  return lines.join('\n').split(/\n\s*\n/).map(block=>block.trim()).filter(block=>block.length>180&&/^[A-Za-z]/.test(block));
}
test('workflow instructions use one shared contract and avoid duplicated operational paragraphs',async()=>{
  const seen=new Map();
  for(const {name,graph} of await definitions())for(const task of graph.tasks) {
    if(task.kind==='run-workflows')continue;
    assert.match(task.prompt,/scriptahub-tasks SKILL\.md/);
    const own=new Set();
    for(const block of task.prompt.split('\n\n').map(text=>text.trim()).filter(Boolean)) {
      assert.equal(own.has(block),false,`${name}/${task.id} repeats a paragraph`);own.add(block);
      if(block.length<=350)continue;
      assert.equal(seen.has(block),false,`${name}/${task.id} repeats operational instructions from ${seen.get(block)}`);
      seen.set(block,name+'/'+task.id);
    }
  }
});
test('loaded skill guidance has no repeated prose blocks or obsolete migration instructions',async()=>{
  const directory=path.join(root,'skills'),files=[];
  for(const entry of await fs.readdir(directory,{withFileTypes:true})) {
    if(!entry.isDirectory())continue;
    const base=path.join(directory,entry.name);
    for(const name of ['SKILL.md','AGENTS.md']) {
      const file=path.join(base,name);try {await fs.access(file);files.push(file);}catch(error){if(error.code!=='ENOENT')throw error;}
    }
    const references=path.join(base,'references');
    const names=await fs.readdir(references).catch(error=>{if(error.code==='ENOENT')return [];throw error;});
    files.push(...names.filter(name=>name.endsWith('.md')).map(name=>path.join(references,name)));
  }
  for(const file of files) {
    const text=await fs.readFile(file,'utf8'),blocks=proseBlocks(text),seen=new Set();
    for(const block of blocks) {assert.equal(seen.has(block),false,file+' repeats '+block.slice(0,90));seen.add(block);}
    assert.doesNotMatch(text,/\blegacy\b|older (?:prepared )?job|supersedes the former|September 2026 scope|this does not apply|not applicable/i,file);
  }
});
test('shared contract retains source-specific acceptance and read-only final validation',async()=>{
  const text=await fs.readFile(path.join(root,'skills/scriptahub-tasks/SKILL.md'),'utf8');
  for(const token of ['references/task-operations.md','publication-recovery','submit-batch','--replace-sha256','batch-defer','existingFindings=0','edition_layout_regression','translationOutcome','Final validation is read-only']) {
    assert.ok(text.includes(token),token+' is part of the common operational contract');
  }
});
