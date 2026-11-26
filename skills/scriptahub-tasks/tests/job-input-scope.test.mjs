import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {openRoot} from '../scripts/anchored-files.mjs';
import {jobInputScope} from '../scripts/job-input-scope.mjs';

async function fixture(t) {
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'editorial-scope-'));
  const root=await openRoot(directory);
  t.after(async()=>{await root.close();await fs.rm(directory,{recursive:true,force:true});});
  const write=async(name,value)=>{await fs.mkdir(path.dirname(path.join(directory,name)),{recursive:true});await fs.writeFile(path.join(directory,name),value);};
  await write('sources/book.html','<main><img src="figure.svg">Original book</main>');
  await write('sources/figure.svg','<svg></svg>');
  return {directory,write,scope:input=>jobInputScope(root,{taskDirectory:'tasks/a',virtualCwd:'/workspace/run',...input})};
}
for(const skill of ['comprehensive-summary','marketing-summary','short-description','relevant-keywords']) {
  test(`${skill} status includes its own job, immutable source and exact output only`,async t=>{
    const f=await fixture(t),job='editorial-jobs/'+skill;
    await f.write(job+'/job.json',JSON.stringify({source:'/workspace/run/tasks/a/sources/book.html',output:'/workspace/run/tasks/a/editorial/'+skill+'.html'}));
    const scope=await f.scope({skill,args:['status','tasks/a/'+job]});
    for(const name of [job+'/analyses/batch-0001.json','sources/book.html','sources/figure.svg','editorial/'+skill+'.html']) assert.equal(scope.allows(name),true,name);
    for(const name of ['editorial-jobs/another/analyses/batch-0001.json','translation-jobs/ro/full/job.json','editorial/another.html','sources/other.html','run-state/handoff.json']) assert.equal(scope.allows(name),false,name);
    assert.equal(scope.traverse('editorial-jobs/another'),false);
  });
}
test('parallel translation languages and resources remain separate, including recovered merges',async t=>{
  const f=await fixture(t);
  await f.write('translation-jobs/ro/full/job.json',JSON.stringify({source:'/workspace/run/tasks/a/sources/book.html',output:'/workspace/run/tasks/a/translations/ro/full.html'}));
  const request={skill:'translate-html',args:['build','tasks/a/translation-jobs/ro/full']};
  const scope=await f.scope(request);
  assert.equal(scope.allows('translation-jobs/ro/full/translations/batch-0001.json'),true);
  assert.equal(scope.allows('translations/ro/full.html'),true);
  for(const name of ['translation-jobs/es/full/context.json','translation-jobs/ro/summary/context.json','translations/es/full.html','translations/ro/summary.html','translations/manifest.json']) assert.equal(scope.allows(name),false,name);
  await fs.rm(path.join(f.directory,'translation-jobs'),{recursive:true});
  const resumed=await f.scope({...request,savedScope:{files:scope.files,trees:scope.trees}});
  assert.deepEqual(resumed.files,scope.files,'resume uses the immutable saved selection after native job cleanup');
});
test('preparation scopes include only explicit job/output, and validation needs no sibling jobs',async t=>{
  const f=await fixture(t);
  const scope=await f.scope({skill:'short-description',args:['prepare','tasks/a/sources/book.html','--job-dir=tasks/a/editorial-jobs/description','--output','tasks/a/editorial/description.html']});
  assert.equal(scope.allows('editorial-jobs/description/job.json'),true);
  assert.equal(scope.allows('editorial/description.html'),true);
  assert.equal(scope.allows('editorial/summary.html'),false);
  const reordered=await f.scope({skill:'short-description',args:['prepare','--output=tasks/a/editorial/description.html','--job-dir','tasks/a/editorial-jobs/description','tasks/a/sources/book.html']});
  assert.deepEqual(reordered.files,scope.files);
  assert.deepEqual(reordered.trees,scope.trees);
  const summary=await f.scope({skill:'comprehensive-summary',args:['prepare','tasks/a/sources/book.html',
    '--minutes','10','--max-duration','--job-dir','tasks/a/editorial-jobs/summary','--output','tasks/a/editorial/summary.html']});
  assert.deepEqual(summary.files,['editorial/summary.html','sources/book.html','sources/figure.svg']);
  assert.deepEqual(summary.trees,['editorial-jobs/summary']);
  const validation=await f.scope({skill:'translate-html',args:['validate','tasks/a/sources/book.html','--html','tasks/a/translations/ro/full.html','--to','ro']});
  assert.equal(validation.allows('translations/ro/full.html'),true);
  assert.equal(validation.allows('translation-jobs/ro/full/job.json'),false);
  await assert.rejects(f.scope({skill:'short-description',args:['prepare','tasks/a/sources/book.html']}),/--job-dir/);
  await assert.rejects(f.scope({skill:'translate-html',args:['prepare','tasks/a/sources/book.html','--job-dir','tasks/a/translation-jobs/ro','--output','tasks/a/translations/ro/full.html']}),/one job/);
});
test('PDF export includes responsive images using srcset and keeps other assets outside its scope',async t=>{
  const f=await fixture(t);
  await f.write('sources/book.html','<main><picture><source srcset="wide.webp 2x, detail.svg 3x"><img srcset="data:image/png;base64,AAAA 1x, even.png 2x" src="figure.svg"></picture></main>');
  const scope=await f.scope({skill:'book-pdf',args:['export','tasks/a/sources/book.html','--output','tasks/a/ro/book.pdf','--language','ro']});
  assert.deepEqual(scope.files,['ro/book.pdf','sources/book.html','sources/detail.svg','sources/even.png','sources/figure.svg','sources/wide.webp']);
});
for(const skill of ['comprehensive-summary','marketing-summary','short-description','relevant-keywords','translate-html']) {
  test(`${skill} batch contracts and admission keep the same isolated job boundary`,async t=>{
    const f=await fixture(t),job=skill==='translate-html'?'translation-jobs/ro/full':'editorial-jobs/'+skill;
    await f.write(job+'/job.json',JSON.stringify({source:'/workspace/run/tasks/a/sources/book.html',output:'/workspace/run/tasks/a/outputs/result.html'}));
    for(const command of ['batch-contract','submit-batch']) {
      const scope=await f.scope({skill,args:[command,'tasks/a/'+job,'--batch','batch-0001.json',...(command==='submit-batch'?['--batch-sha256','a'.repeat(64),'--replace-sha256','b'.repeat(64)]:[])]});
      for(const file of [job+'/job.json',job+'/batches/batch-0001.json',job+'/analyses/batch-0001.json','sources/book.html','outputs/result.html'])assert.equal(scope.allows(file),true,file);
      for(const file of ['working/editorial/note.json','editorial-jobs/other/analyses/batch-0001.json','translation-jobs/es/full/translations/batch-0001.json','outputs/other.html','run-state/handoff.json'])assert.equal(scope.allows(file),false,file);
    }
  });
}
