import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {discardTranslationJob} from '../scripts/remote-skill.mjs';
const digest=value=>crypto.createHash('sha256').update(value).digest('hex');
async function fixture(t,skill='translate-html') {
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'translation-cleanup-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const control=path.join(root,'tasks/a/run-state/remote-processing');await fs.mkdir(control,{recursive:true});await fs.writeFile(path.join(root,'tasks/a/source.html'),'immutable source');
 await fs.writeFile(path.join(control,'pending.json'),JSON.stringify({jobId:'job',phase:'running',command:{executionId:'e',taskDirectory:'tasks/a',skill}}));
 let cancelled=false,released=false;const calls=[];
 const receipt=()=>({jobId:'job',state:cancelled?'cancelled':'running',exitCode:1,resultDigest:'b'.repeat(64),diagnosticsComplete:true});
 const call=async(tool,args)=>{
  calls.push(tool);
  if(tool.endsWith('_status'))return receipt();
  if(tool.endsWith('_cancel')){cancelled=true;return receipt();}
  if(tool.endsWith('_result'))return {...receipt(),files:[{path:'source.html',size:7,sha256:digest('partial')}],nextCursor:null};
  if(tool.endsWith('_read')){const bytes=Buffer.from(args.kind==='file'?'partial':'');return {encoding:'base64',data:bytes.toString('base64'),size:bytes.length,sha256:digest(bytes),offset:0,nextOffset:bytes.length,eof:true};}
  if(tool.endsWith('_release')){assert.ok(cancelled);assert.equal(await fs.readFile(path.join(control,'job',digest('source.html')),'utf8'),'partial');released=true;return {...receipt(),cleanupPending:false,artifactsReleased:true};}
  throw Error(tool);
 };
 return {root,control,call,calls,released:()=>released};
}
test('discard cancels only the failed translation, retains diagnostics and never merges partial source bytes',async t=>{
 const f=await fixture(t);const result=await discardTranslationJob({executionId:'e',taskDirectory:'tasks/a'},f.call,{root:f.root});
 assert.equal(result.discarded,true);assert.equal(f.released(),true);
 assert.equal(await fs.readFile(path.join(f.root,'tasks/a/source.html'),'utf8'),'immutable source');
 await assert.rejects(fs.stat(path.join(f.control,'pending.json')),{code:'ENOENT'});
 assert.deepEqual(await discardTranslationJob({executionId:'e',taskDirectory:'tasks/a'},f.call,{root:f.root}),{discarded:false});
});
test('translation cleanup refuses a different skill and retains the pending journal',async t=>{
 const f=await fixture(t,'comprehensive-summary');await assert.rejects(discardTranslationJob({executionId:'e',taskDirectory:'tasks/a'},f.call,{root:f.root}),/restricted/);
 assert.equal(f.calls.length,0);assert.ok(await fs.stat(path.join(f.control,'pending.json')));
});
