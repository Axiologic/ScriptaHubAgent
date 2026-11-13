import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {insideRun, writeHandoff, requirePreflight, verifyPackage} from '../scripts/workflow-checks.mjs';

async function inRun(callback) {
  const previous = process.cwd();
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'scripta-checks-')));
  try { process.chdir(root); await callback(root); }
  finally { process.chdir(previous); await fs.rm(root, {recursive:true, force:true}); }
}
const context = {executionId:'execution-one', runId:'run-one', taskId:'task-one', bookId:'book-one'};

test('durable handoffs preserve execution identity and reject secrets, oversized context and symlinks', async () => inRun(async root => {
  const saved = await writeHandoff({step:'prepare-manuscript', context});
  assert.match(saved.sha256, /^[a-f0-9]{64}$/);
  await writeHandoff({step:'process-content', context:{...context, artifact:'book.html'}});
  assert.equal(JSON.parse(await fs.readFile(saved.path)).context.artifact, 'book.html');
  await assert.rejects(writeHandoff({step:'process-content', context:{...context, executionId:'another'}}), /another execution/);
  await assert.rejects(writeHandoff({step:'process-content', context:{...context, data:{password:'private'}}}), /Secrets/);
  await assert.rejects(writeHandoff({step:'process-content', context:{...context, data:'x'.repeat(25000)}}), /24 KB/);
  await assert.rejects(insideRun('../outside'), /leaves/);
  await fs.symlink(path.join(root, saved.path), 'link.json');
  await assert.rejects(insideRun('link.json'), /symlinks/);
  await fs.rm(saved.path); await fs.symlink(path.join(root,'link.json'), saved.path);
  await assert.rejects(writeHandoff({step:'process-content', context}), /symlinks/);
}));

test('claim requires a fresh successful preflight, including a valid timestamp', async () => inRun(async () => {
  await assert.rejects(requirePreflight(), /preflight/);
  await fs.mkdir('run-state');
  const now = Date.now();
  const report = {ok:true, runtimeId:'runtime', platform:'linux-x64', sourceDigests:{}, checks:Array.from({length:8}, () => ({status:'passed'})), checkedAt:new Date(now).toISOString()};
  await fs.writeFile('run-state/preflight.json', JSON.stringify(report));
  await requirePreflight(now);
  for (const change of [{ok:false}, {checkedAt:'invalid'}, {checkedAt:new Date(now+1000).toISOString()}, {checkedAt:new Date(now-900001).toISOString()}, {checks:[]}]) {
    await fs.writeFile('run-state/preflight.json', JSON.stringify({...report,...change}));
    await assert.rejects(requirePreflight(now), /preflight/);
  }
}));

test('batch verification refuses different bytes, execution identity and unsafe inventory paths before remote access', async () => inRun(async () => {
  await fs.mkdir('package');
  const bytes = Buffer.from('book'); await fs.writeFile('package/book.html', bytes);
  const entry = {path:'book.html', size:bytes.length, sha256:crypto.createHash('sha256').update(bytes).digest('hex')};
  const inventory = {executionId:context.executionId, baseCommit:null, files:[entry]};
  const input = {...context, packageRoot:'package', inventory:'inventory.json', catalogue:'https://github.com/example/books/blob/main/collection.json', branch:'main'};
  for (const [change, pattern] of [[{executionId:'another'}, /another execution/], [{files:[{...entry,sha256:'0'.repeat(64)}]}, /differs/], [{files:[{...entry,path:'../book.html'}]}, /Unsafe/], [{files:[entry,entry]}, /duplicate/]]) {
    await fs.writeFile('inventory.json', JSON.stringify({...inventory,...change}));
    await assert.rejects(verifyPackage(input), pattern);
  }
}));

test('batch item handoffs isolate identities and reject directories outside the item namespace', async () => inRun(async () => {
  const first=await writeHandoff({step:'prepare-manuscript',directory:'tasks/task-one',context});
  const secondContext={...context,executionId:'execution-two',runId:'run-two',taskId:'task-two'};
  const second=await writeHandoff({step:'claim-edit',directory:'tasks/task-two',context:secondContext});
  assert.notEqual(first.path,second.path);
  assert.equal(JSON.parse(await fs.readFile(first.path)).context.executionId,'execution-one');
  assert.equal(JSON.parse(await fs.readFile(second.path)).context.executionId,'execution-two');
  await assert.rejects(writeHandoff({step:'prepare-manuscript',directory:'tasks/../outside',context}),/Invalid task directory/);
  await assert.rejects(writeHandoff({step:'apply-edit',directory:'tasks/task-one',context:secondContext}),/another execution/);
}));

test('a sparse non-Git publication package keeps its validated baseline when the remote advances',async()=>inRun(async root=>{
 const originalPath=process.env.PATH;
 try{
  const sha='a'.repeat(40),head='b'.repeat(40),collection={schemaVersion:1,bookCount:1,books:[{id:context.bookId,directory:'books/current/'+context.bookId}]};
  await fs.mkdir('package');await fs.mkdir('bin');
  await fs.writeFile('package/collection.json',JSON.stringify(collection));await fs.writeFile('package/book.html','current book');
  const files=[];for(const name of ['collection.json','book.html']){const bytes=await fs.readFile('package/'+name);files.push({path:name,size:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex')});}
  await fs.writeFile('inventory.json',JSON.stringify({executionId:context.executionId,baseCommit:sha,files}));
  await fs.writeFile('bin/git',`#!${process.execPath}\nif(process.argv.includes('ls-remote'))process.stdout.write('${head}\\trefs/heads/main\\n');else process.exit(99);\n`,{mode:0o700});
  process.env.PATH=path.join(root,'bin')+path.delimiter+originalPath;
  const result=await verifyPackage({...context,packageRoot:'package',inventory:'inventory.json',catalogue:'https://github.com/example/books/blob/main/collection.json',branch:'main'});
  assert.equal(result.ok,true);assert.equal(result.baseCommit,sha);assert.equal(result.fileCount,2);
 }finally{process.env.PATH=originalPath;}
}));

test('generated HTML is accepted without PDF only after a strict native reader/layout audit',async()=>inRun(async root=>{
 const savedPath=process.env.PATH;
 try{
  const sha='b'.repeat(40);await fs.mkdir('package');await fs.mkdir('bin');await fs.mkdir('tasks/a/run-state',{recursive:true});
  await fs.writeFile('tasks/a/run-state/claimed.json',JSON.stringify({task:{type:'scriptahub.book-proposal',executionId:context.executionId,bookId:context.bookId}}));
  await fs.writeFile('package/book.html','<!doctype html><html lang="ro"><body><main><p>Cartea generată.</p></main></body></html>');
  await fs.writeFile('package/collection.json',JSON.stringify({schemaVersion:1,bookCount:1,books:[{id:context.bookId,directory:'books/current/'+context.bookId}]}));
  const files=[];for(const name of ['collection.json','book.html']){const bytes=await fs.readFile('package/'+name);files.push({path:name,size:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex')});}
  await fs.writeFile('inventory.json',JSON.stringify({executionId:context.executionId,baseCommit:sha,files}));
  await fs.writeFile('bin/git',`#!${process.execPath}\nif(process.argv.includes('ls-remote'))process.stdout.write('${sha}\\trefs/heads/main\\n');else process.exit(99);\n`,{mode:0o700});process.env.PATH=path.join(root,'bin')+path.delimiter+savedPath;
  const native={scope:'edition_layout_regression',status:'passed',autoCorrect:false,errorFindings:0,existingFindings:0,findings:[],candidate:{file:path.join(root,'package/book.html'),sha256:files[1].sha256}};
  const input={...context,directory:'tasks/a',packageRoot:'package',inventory:'inventory.json',audit:'audit.json',catalogue:'https://github.com/example/books/blob/main/collection.json',branch:'main'};
  await fs.writeFile('audit.json',JSON.stringify(native));
  assert.equal((await verifyPackage(input)).audit.scope,'html_layout_integrity');
  await fs.writeFile('audit.json',JSON.stringify({...native,existingFindings:1,status:'passed_with_warnings'}));
  await assert.rejects(verifyPackage(input),/baseline defects/);
  await fs.writeFile('audit.json',JSON.stringify({...native,candidate:{...native.candidate,sha256:'0'.repeat(64)}}));
  await assert.rejects(verifyPackage(input),/HTML changed/);
 }finally{process.env.PATH=savedPath;}
}));
