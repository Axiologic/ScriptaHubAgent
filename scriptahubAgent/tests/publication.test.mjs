import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { DashboardStore } from '../dashboard-store.mjs';
import { TaskExecution } from '../task-execution.mjs';
import { TaskPublication } from '../task-publication.mjs';
import { ProcessingStore } from '../processing-store.mjs';
import { publicationGit } from '../publication-git.mjs';
import { PublicationAccessStore } from '../publication-access.mjs';
import { publicationTarget, checkPublicationPackage, verifyCatalogueBranch } from '../publication-policy.mjs';
import { publicationConfig } from '../publication-config.mjs';
import { sha256 } from '../publication-transfer.mjs';
import { sealRecord } from '../record-integrity.mjs';
const exec = promisify(execFile), agent = 'agent:test/processor';
process.env.SCRIPTA_RECORD_KEY = 'publication-tests-record-key-012345678901234567890';
async function fixture(t, { schemaVersion = 1, kind = 'manuscript', manageApprovals = false, coverMode } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(),'scripta-publication-'));
  const remote = path.join(root,'remote.git'), seed = path.join(root,'seed'), data = path.join(root,'data');
  const git = async (cwd,...args) => (await exec('git',args,{cwd,env:{...process.env,GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1',GIT_AUTHOR_NAME:'Test',GIT_AUTHOR_EMAIL:'test@example.test',GIT_COMMITTER_NAME:'Test',GIT_COMMITTER_EMAIL:'test@example.test'}})).stdout.trim();
  await git(root,'init','--bare',remote); await fs.mkdir(seed); await git(seed,'init','--initial-branch=main');
  const previous = {schemaVersion,bookCount:0,books:[]};
  await fs.writeFile(path.join(seed,'collection.json'),JSON.stringify(previous));
  await git(seed,'add','.'); await git(seed,'commit','-m','Initial catalogue'); await git(seed,'remote','add','origin',remote); await git(seed,'push','origin','main');
  const baseCommit = await git(seed,'rev-parse','HEAD');
  const store = new DashboardStore(data,{manageApprovals}), service = new TaskExecution(store,data);
  t.after(async () => { store.close(); await fs.rm(root,{recursive:true,force:true}); });
  store.remember({id:'user:owner',email:'owner@example.test',displayName:'Owner'});
  const source = Buffer.from('%PDF-1.7\nOriginal manuscript\n');
  const submitted = store.submit(sealRecord({id:crypto.randomUUID(),owner:'user:owner',contact:{email:'owner@example.test'},
    metadata:{kind,language:'en',values:{description:kind==='book-proposal'?'A book about gardens':'Process the original manuscript',...(coverMode?{coverMode}:{})}},
    files:kind==='manuscript'?[{name:crypto.randomUUID()+'.pdf',originalName:'source.pdf',sha256:sha256(source)}]:[],createdAt:new Date().toISOString(),state:'received',task:null}));
  const task = service.claim(agent,{runId:'run-publication',taskType:kind}).task;
  const catalogue = 'https://github.com/example/books/blob/main/collection.json';
  const config = {repositories:[catalogue],publication:{authorName:'Publisher',authorEmail:'publisher@example.test'}};
  let pushes = 0, losePushResponse = false, beforeGit, afterGit;
  const access = new PublicationAccessStore(data);
  access.update(state => {state.connection={token:'test-only-secret',publication:config.publication,user:{login:'publisher'}};}); access.close();
  const publisher = new TaskPublication(service,{gitFactory:async (...args) => {
    const run = await publicationGit(...args);
    return async (...command) => {
      if (command[0] === 'remote' && command[1] === 'add') command[3] = remote;
      if (command[0] === 'push') pushes++;
      await beforeGit?.(command);
      const result = await run(...command);
      await afterGit?.(command);
      if (command[0] === 'push' && losePushResponse) { losePushResponse = false; throw new Error('Transport closed after accepted push'); }
      return result;
    };
  }});
  const directory = 'books/test/' + task.bookId;
  const files = new Map([
    ['collection.json',Buffer.from(JSON.stringify({schemaVersion:1,bookCount:1,books:[{id:task.bookId,directory,editions:{en:{pdf:directory+'/en/book.pdf',fullContent:directory+'/en/full.html'}}}]}))],
    [directory+'/manifest.json',Buffer.from(JSON.stringify({id:task.bookId}))],
    [directory+'/editions.json',Buffer.from(JSON.stringify({bookId:task.bookId,currentEdition:'edition-1',editions:[{id:'edition-1'}]}))], [directory+'/en/book.pdf',source], [directory+'/en/full.html',Buffer.from('<p>Original manuscript</p>')]
  ]);
  if(kind==='book-proposal'){
    const collection=JSON.parse(files.get('collection.json'));delete collection.books[0].editions.en.pdf;
    files.set('collection.json',Buffer.from(JSON.stringify(collection)));files.delete(directory+'/en/book.pdf');
  }
  const input = {executionId:task.executionId,catalogue,branch:'main',baseCommit,
    files:[...files].map(([path,bytes]) => ({path,size:bytes.length,sha256:sha256(bytes)})),
    validation:{executionId:task.executionId,runId:task.runId,bookId:task.bookId,publicationPermitted:true,audit:{autoCorrect:false,status:'passed_with_warnings',errorFindings:0,...(kind==='book-proposal'?{scope:'html_layout_integrity',nativeScope:'edition_layout_regression',existingFindings:0}:{})}}};
  const upload = () => {
    const result = publisher.prepare(agent,input,config);
    for (const [file,bytes] of files) publisher.upload(agent,{executionId:task.executionId,file,offset:0,data:bytes.toString('base64')});
    return result;
  };
  return {root,remote,seed,git,service,store,publisher,task,config,files,input,upload,submitted,previous, before: hook => { beforeGit = hook; }, after: hook => { afterGit = hook; }, pushes:() => pushes, loseNextPushResponse:() => { losePushResponse = true; }};
}

test('a generated book publishes HTML without an uploaded manuscript, PDF or DOCX', async t => {
  const f = await fixture(t, { kind: 'book-proposal' });
  const target = publicationTarget(f.input.catalogue, f.input.branch);
  const manifest = { taskType:f.task.type, bookId:f.task.bookId, sourceHashes:[] };
  assert.equal([...f.files.keys()].some(name=>/\.(pdf|docx)$/i.test(name)),false);
  const withPdf=new Map(f.files);withPdf.set('books/extra.pdf',Buffer.from('%PDF-1.7'));
  assert.throws(()=>checkPublicationPackage(manifest,target,withPdf,f.previous),/do not publish DOCX\/PDF/);
  const invalid=new Map(f.files);invalid.delete([...invalid.keys()].find(name=>name.endsWith('/full.html')));
  assert.throws(()=>checkPublicationPackage(manifest,target,invalid,f.previous),/resource|full HTML/);
  assert.throws(() => checkPublicationPackage({...manifest,sourceHashes:['0'.repeat(64)]},target,f.files,f.previous),/uploaded source/);
  f.upload();
  const result = await f.publisher.publish(agent,{executionId:f.task.executionId},f.config);
  assert.equal(result.state,'completed');
  assert.equal(f.pushes(),1);
});

test('only the owning executor can register a successful validated package for an authorized catalogue', async t => {
  const f = await fixture(t), {publisher,input,config} = f;
  assert.throws(() => publisher.prepare('agent:test/other',input,config),/not found/);
  assert.throws(() => publisher.prepare(agent,{...input,catalogue:'https://github.com/other/books/blob/main/collection.json'},config),/outside/);
  assert.throws(() => publisher.prepare(agent,{...input,validation:{...input.validation,executionId:'wrong'}},config),/independent/);
  assert.throws(() => publisher.prepare(agent,{...input,validation:{...input.validation,audit:{autoCorrect:true,status:'passed',errorFindings:0}}},config),/independent/);
  for (const name of ['../escape','books/.git/config','/absolute','books/x\\y','books/%2e%2e/file']) {
    assert.throws(() => publisher.prepare(agent,{...input,files:[{...input.files[0],path:name},...input.files.slice(1)]},config),/file path/);
  }
  publisher.prepare(agent,input,config);
  assert.throws(() => publisher.prepare(agent,{...input,baseCommit:'a'.repeat(40)},config),/different package/);
});

test('an edit package requires edition regression evidence, while existing findings can remain warnings',async t=>{
  const f=await fixture(t);
  f.store.submit(sealRecord({id:crypto.randomUUID(),owner:'user:owner',contact:{email:'owner@example.test'},createdAt:new Date().toISOString(),files:[],metadata:{kind:'edit',bookId:f.task.bookId,language:'en',values:{baseRevision:String(f.store.book(f.task.bookId).revision),annotations:JSON.stringify([{id:'table',quote:'Text',start:0,end:4,kind:'Editorial structure',feedback:'Render as a table',edition:'edition-1',language:'en'}])}}}));
  f.store.cancel({id:'user:owner'},f.task.taskId);f.service.finish(agent,{executionId:f.task.executionId,state:'cancelled'});
  f.store.submitEdition({id:'user:owner'},f.task.bookId,crypto.randomUUID());
  const task=f.service.claim(agent,{runId:'edit-publication',taskType:'edit'}).task;
  const input={...f.input,executionId:task.executionId,validation:{...f.input.validation,executionId:task.executionId,runId:task.runId,bookId:task.bookId}};
  assert.throws(()=>f.publisher.prepare(agent,input,f.config),/layout regression/);
  input.validation.audit={...input.validation.audit,scope:'edition_layout_regression',existingFindings:12};
  assert.equal(f.publisher.prepare(agent,input,f.config).executionId,task.executionId);
});

test('uploads are contiguous, bounded and idempotent, and the service checks actual bytes', async t => {
  const {publisher,input,config,files,task} = await fixture(t);
  publisher.prepare(agent,input,config);
  const [file,bytes] = [...files][0], data = bytes.toString('base64'), executionId = task.executionId;
  assert.throws(() => publisher.upload(agent,{executionId,file,offset:1,data}),/size|offset/);
  publisher.upload(agent,{executionId,file,offset:0,data});
  publisher.upload(agent,{executionId,file,offset:0,data});
  assert.throws(() => publisher.upload(agent,{executionId,file,offset:0,data:Buffer.alloc(bytes.length).toString('base64')}),/Conflicting/);
  await assert.rejects(publisher.publish(agent,{executionId},config),/checksum mismatch/);
});

test('real Git publication confirms the remote before completion and retries do not push twice', async t => {
  const f = await fixture(t); f.upload();
  assert.throws(() => f.service.finish(agent,{executionId:f.task.executionId,state:'completed',result:'I pushed it'}),/Only ScriptaHub/);
  const result = await f.publisher.publish(agent,{executionId:f.task.executionId},f.config);
  assert.equal(result.state,'completed'); assert.match(result.publication.commit,/^[a-f0-9]{40}$/);
  assert.equal(await f.git(f.remote,'rev-parse','refs/heads/main'),result.publication.commit);
  assert.equal(f.pushes(),1);
  assert.deepEqual(await f.publisher.publish(agent,{executionId:f.task.executionId},f.config),result);
  assert.equal(f.pushes(),1);
  assert.equal(JSON.stringify(result).includes('test-only-secret'),false);
});

async function concurrentBook(f, id = 'bk-another') {
  await f.git(f.seed,'fetch','origin','main');
  await f.git(f.seed,'merge','--ff-only','origin/main');
  const collectionPath = path.join(f.seed,'collection.json');
  const collection = JSON.parse(await fs.readFile(collectionPath,'utf8'));
  collection.books.push({id,directory:'books/another/' + id,editions:{}});
  collection.bookCount = collection.books.length;
  await fs.writeFile(collectionPath,JSON.stringify(collection));
  await f.git(f.seed,'add','collection.json');
  await f.git(f.seed,'commit','-m','Publish another book');
  await f.git(f.seed,'push','origin','main');
}

async function resume(f, executionId = f.task.executionId) {
  f.store.db.prepare('UPDATE task_publications SET retry_at=0 WHERE execution_id=?').run(executionId);
  await f.publisher.resume(async () => f.config, message => assert.fail(message));
  return f.service.status(agent,{executionId});
}

test('a newer remote catalogue keeps other books when publishing the validated book', async t => {
  const f = await fixture(t); f.upload();
  await concurrentBook(f);
  const result = await f.publisher.publish(agent,{executionId:f.task.executionId},f.config);
  assert.equal(result.state,'completed');
  const catalogue = JSON.parse(await f.git(f.remote,'show','main:collection.json'));
  assert.deepEqual(catalogue.books.map(book => book.id),['bk-another',f.task.bookId]);
  assert.equal(catalogue.bookCount,2);
});

test('a non-fast-forward rejection is resumed from the current branch without reuploading', async t => {
  const f = await fixture(t); f.upload();
  f.before(async ([command]) => {
    if (command === 'push' && f.pushes() <= 4) await concurrentBook(f,'bk-concurrent-' + f.pushes());
  });
  const pending = await f.publisher.publish(agent,{executionId:f.task.executionId},f.config);
  assert.equal(pending.publicationPending,true);
  assert.equal(f.publisher.row(f.task.executionId).commit_id,null);
  assert.throws(() => f.service.finish(agent,{executionId:f.task.executionId,state:'failed',error:'Premature finish'}),/reconciled/);
  for (let i = 0; i < 3; i++) assert.equal((await resume(f)).publicationPending,true);
  assert.equal((await resume(f)).state,'completed');
  const catalogue = JSON.parse(await f.git(f.remote,'show','main:collection.json'));
  assert.deepEqual(catalogue.books.map(book => book.id),['bk-concurrent-1','bk-concurrent-2','bk-concurrent-3','bk-concurrent-4',f.task.bookId]);
  assert.equal(f.pushes(),5);
});

test('a stop before push finishes the deferred publication as cancelled', async t => {
  const f = await fixture(t); f.upload();
  f.after(async ([command]) => {
    if (command === 'commit') {
      f.after(null);
      await concurrentBook(f);
    }
  });
  assert.equal((await f.publisher.publish(agent,{executionId:f.task.executionId},f.config)).publicationPending,true);
  assert.equal(f.pushes(),0);
  f.store.cancel({id:'user:owner'},f.submitted.task.id);
  assert.equal((await resume(f)).state,'cancelled');
  assert.equal(f.pushes(),0);
});

test('an unreadable remote defers reconciliation and an ancestor receipt completes without another push', async t => {
  const f = await fixture(t); f.upload();
  let unreachable = false;
  f.before(([command]) => {
    if (unreachable && command === 'ls-remote') throw Object.assign(new Error('Remote unavailable'),{status:502});
  });
  f.after(async ([command]) => {
    if (command === 'push') {
      unreachable = true;
      await concurrentBook(f);
    }
  });
  const pending = await f.publisher.publish(agent,{executionId:f.task.executionId},f.config);
  assert.equal(pending.publicationPending,true);
  assert.equal(f.publisher.row(f.task.executionId).push_state,'accepted');
  assert.throws(() => f.service.finish(agent,{executionId:f.task.executionId,state:'failed',error:'Guessing failure'}),/reconciled/);
  unreachable = false;
  const result = await resume(f);
  assert.equal(result.state,'completed');
  assert.equal(f.pushes(),1);
  await f.git(f.remote,'merge-base','--is-ancestor',f.publisher.row(f.task.executionId).commit_id,'main');
});

test('publications to the same repo and branch take the same lease across different catalogue URLs', async t => {
  const f = await fixture(t); f.upload();
  const other = f.store.submit(sealRecord({id:crypto.randomUUID(),owner:'user:owner',createdAt:new Date().toISOString(),
    contact:{email:'owner@example.test'},metadata:{kind:'manuscript',language:'en',values:{}},files:f.task.files.map(file => ({
      name:crypto.randomUUID()+'.pdf',originalName:file.originalName,sha256:file.sha256
    }))}));
  const {task} = f.service.claim(agent,{runId:'another-book',taskId:other.task.id,taskType:'manuscript'});
  const replace = value => value.replaceAll(f.task.bookId,task.bookId);
  const files = [...f.files].map(([name,bytes]) => [replace(name),Buffer.from(replace(bytes.toString()))]);
  const catalogue = 'https://raw.githubusercontent.com/EXAMPLE/BOOKS/main/collection.json';
  f.config.repositories.push(catalogue);
  f.publisher.prepare(agent,{...f.input,catalogue,executionId:task.executionId,
    files:files.map(([name,bytes]) => ({path:name,size:bytes.length,sha256:sha256(bytes)})),
    validation:{...f.input.validation,executionId:task.executionId,bookId:task.bookId,runId:task.runId}},f.config);
  for (const [file,bytes] of files) f.publisher.upload(agent,{executionId:task.executionId,file,offset:0,data:bytes.toString('base64')});
  let start, release;
  const started = new Promise(resolve => { start = resolve; });
  const blocked = new Promise(resolve => { release = resolve; });
  f.before(async ([command]) => { if (command === 'push' && f.pushes() === 1) { start(); await blocked; } });
  const first = f.publisher.publish(agent,{executionId:f.task.executionId},f.config);
  await started;
  try {
    assert.equal((await f.publisher.publish(agent,{executionId:task.executionId},f.config)).publicationPending,true);
    assert.equal(f.pushes(),1);
  } finally { release(); await first; }
  assert.equal((await resume(f,task.executionId)).state,'completed');
  assert.equal(f.pushes(),2);
});

test('a durable receipt can complete the task after the publisher response was lost', async t => {
  const f = await fixture(t); f.upload();
  const original = f.publisher.complete;
  f.publisher.complete = () => { throw new Error('Response lost after receipt persistence'); };
  await assert.rejects(f.publisher.publish(agent,{executionId:f.task.executionId},f.config),/Response lost/);
  assert.equal(f.service.status(agent,{executionId:f.task.executionId}).state,'running');
  assert.throws(() => f.service.finish(agent,{executionId:f.task.executionId,state:'failed',error:'Guessing failure'}),/reconciled/);
  f.publisher.complete = original;
  assert.equal((await f.publisher.publish(agent,{executionId:f.task.executionId},f.config)).state,'completed');
  assert.equal(f.pushes(),1);
});

test('a conflicting change to the current book restores a paid edition before retry', async t => {
  const f = await fixture(t,{manageApprovals:true});
  f.upload();
  await f.publisher.publish(agent,{executionId:f.task.executionId},f.config);
  await f.git(f.seed,'fetch','origin','main');
  await f.git(f.seed,'merge','--ff-only','origin/main');
  const baseCommit = await f.git(f.seed,'rev-parse','HEAD');
  const user = {id:'user:owner'};
  const request = f.store.submitEdition(user,f.task.bookId,crypto.randomUUID(),8);
  const {advanceCycles} = await import('../cycle-worker.mjs');
  const operations = [], notices = [];
  const options = {
    apply: async (_row, operation, amount) => { operations.push([operation,amount]); return {}; },
    send: async notice => { notices.push(notice.subject); return {providerMessageId:'mail'}; },
  };
  await advanceCycles(f.store,options);
  const {task} = f.service.claim(agent,{runId:'paid-edition',taskType:'edit'});
  const files = new Map(f.files);
  const catalogue = JSON.parse(files.get('collection.json'));
  const book = catalogue.books[0];
  book.currentEdition = 'edition-2';
  files.set('collection.json',Buffer.from(JSON.stringify(catalogue)));
  files.set(book.directory + '/manifest.json',Buffer.from(JSON.stringify({id:book.id,currentEdition:'edition-2'})));
  files.set(book.directory + '/editions.json',Buffer.from(JSON.stringify({bookId:book.id,currentEdition:'edition-2',editions:[{id:'edition-1'},{id:'edition-2'}]})));
  f.publisher.prepare(agent,{...f.input,executionId:task.executionId,baseCommit,
    files:[...files].map(([path,bytes]) => ({path,size:bytes.length,sha256:sha256(bytes)})),
    validation:{...f.input.validation,executionId:task.executionId,runId:task.runId,
      audit:{...f.input.validation.audit,scope:'edition_layout_regression'}}},f.config);
  for (const [file,bytes] of files) f.publisher.upload(agent,{executionId:task.executionId,file,offset:0,data:bytes.toString('base64')});
  f.before(async ([command]) => {
    if (command !== 'push') return;
    f.before(null);
    const external = book.directory + '/en/full.html';
    await fs.writeFile(path.join(f.seed,external),'<p>Externally corrected</p>');
    await f.git(f.seed,'add',external);
    await f.git(f.seed,'commit','-m','Externally edit this book');
    await f.git(f.seed,'push','origin','main');
  });
  assert.equal((await f.publisher.publish(agent,{executionId:task.executionId},f.config)).publicationPending,true);
  assert.equal(f.publisher.row(task.executionId).commit_id,null);
  const failed = await resume(f,task.executionId);
  assert.equal(failed.state,'failed');
  assert.match(failed.taskError,/current book or a resource/);
  assert.equal(await f.git(f.remote,'show','main:' + book.directory + '/en/full.html'),'<p>Externally corrected</p>');
  assert.throws(() => f.store.transaction(() => f.store.cycles.retry(user,request.id,1)),/once the previous attempt/);
  await advanceCycles(f.store,options);
  assert.equal(f.store.cycles.read(request.id).phase,'restoring');
  assert.throws(() => f.store.transaction(() => f.store.cycles.retry(user,request.id,1)),/once the previous attempt/);
  await advanceCycles(f.store,options);
  await advanceCycles(f.store,options);
  assert.deepEqual(operations,[['debit',8],['refund',8]]);
  assert.equal(notices.filter(subject => subject.endsWith('Request restored')).length,1);
  assert.notEqual(f.store.transaction(() => f.store.cycles.retry(user,request.id,1)).taskId,task.taskId);
});

test('scope checks refuse other books, unrelated files and a missing original manuscript', async t => {
  const f = await fixture(t); const target = publicationTarget(f.input.catalogue,'main');
  const manifest = {...f.input,bookId:f.task.bookId,sourceHashes:f.task.files.map(file => file.sha256)};
  checkPublicationPackage(manifest,target,f.files,f.previous);
  assert.throws(() => checkPublicationPackage(manifest,target,new Map([...f.files,['admin/settings.json',Buffer.from('{}')]]),f.previous),/outside the claimed book/);
  assert.throws(() => checkPublicationPackage({...manifest,sourceHashes:['0'.repeat(64)]},target,f.files,f.previous),/source manuscript/);
  assert.throws(() => publicationTarget('https://user:secret@github.com/example/books/blob/main/collection.json','main'),/Unsupported/);
  assert.throws(() => publicationConfig({secretKey:'SECRET',authorName:'Name\nInjected',authorEmail:'x@example.test'}),/Provide/);
});


test('a lost push response is reconciled against the real remote without a duplicate push', async t => {
  const f = await fixture(t); f.upload(); f.loseNextPushResponse();
  const result = await f.publisher.publish(agent,{executionId:f.task.executionId},f.config);
  assert.equal(result.state,'completed');
  assert.equal(f.pushes(),1);
  assert.equal(await f.git(f.remote,'rev-parse','refs/heads/main'),result.publication.commit);
});

test('a successful push remains completed when a stop request arrives before receipt finalization', async t => {
  const f = await fixture(t); f.upload();
  const complete = f.publisher.complete.bind(f.publisher);
  f.publisher.complete = (...args) => {
    f.store.cancel({id:'user:owner'},f.submitted.task.id);
    return complete(...args);
  };
  assert.equal((await f.publisher.publish(agent,{executionId:f.task.executionId},f.config)).state,'completed');
});


test('schema 2 submits content metadata and its exact mapped resources without schema conversion', async t => {
  const f = await fixture(t,{schemaVersion:2}), id = f.task.bookId, directory = 'books/converted-book';
  const source = f.files.get('books/test/' + id + '/en/book.pdf');
  const document = {schemaVersion:2,id,legacyDirectory:'books/test/' + id,contentDirectory:directory,
    metadata:{id,editions:{en:{book:'en/book.html',pdf:'en/book.pdf',fullContent:'en/full.html'}}},
    history:{bookId:id,editions:[]},resources:{'en/book.pdf':directory+'/en/book.pdf','en/full.html':directory+'/en/full.html'}};
  const metadata = Buffer.from(JSON.stringify(document));
  f.files.clear();
  f.files.set('collection.json',Buffer.from(JSON.stringify({schemaVersion:2,bookCount:1,books:[{id,path:directory+'/book.json',sha256:sha256(metadata)}]})));
  f.files.set(directory+'/book.json',metadata); f.files.set(directory+'/en/book.pdf',source); f.files.set(directory+'/en/full.html',Buffer.from('<p>Original manuscript</p>'));
  f.input.files = [...f.files].map(([path,bytes]) => ({path,size:bytes.length,sha256:sha256(bytes)}));
  f.upload();
  assert.equal((await f.publisher.publish(agent,{executionId:f.task.executionId},f.config)).state,'completed');
});

test('keyword index ordering is immaterial but incorrect membership counts are rejected', async t => {
  const f = await fixture(t), collection = JSON.parse(f.files.get('collection.json'));
  const languages = ['en','fr','de','es','pt','it','ro','pl'];
  collection.books[0].keywordIds = ['term:b','term:a'];
  collection.books[0].keywords = Object.fromEntries(languages.map(language => [language,['Beta','Alpha']]));
  collection.keywords = Object.fromEntries(languages.map(language => [language,[{id:'term:b',label:'Beta',slug:'beta',count:1},{id:'term:a',label:'Alpha',slug:'alpha',count:1}]]));
  f.files.set('collection.json',Buffer.from(JSON.stringify(collection)));
  const manifest = {...f.input,bookId:f.task.bookId,sourceHashes:f.task.files.map(file => file.sha256)};
  checkPublicationPackage(manifest,publicationTarget(f.input.catalogue,'main'),f.files,f.previous);
  collection.keywords.en[0].count = 7;
  f.files.set('collection.json',Buffer.from(JSON.stringify(collection)));
  assert.throws(() => checkPublicationPackage(manifest,publicationTarget(f.input.catalogue,'main'),f.files,f.previous),/keyword counts/);
});


test('catalogue branch resolution cannot redirect publication to a shorter matching branch', () => {
  const url = 'https://github.com/example/books/blob/content/stable/collection.json';
  const refs = 'a'.repeat(40)+'\trefs/heads/content\n'+'b'.repeat(40)+'\trefs/heads/content/stable';
  assert.throws(() => verifyCatalogueBranch(url,'content',refs),/does not match/);
  verifyCatalogueBranch(url,'content/stable',refs);
});

test('edit publication changes only its existing book and keeps its content location',()=>{
  const book={id:'bk-edited',directory:'books/example/bk-edited',editions:{}};
  const previous={schemaVersion:1,bookCount:1,books:[book]};
  const collection={...previous,books:[{...book,title:{en:'Edited title'}}]};
  const target={collection:'collection.json',root:''};
  const manifest={taskType:'scriptahub.edit',bookId:book.id,sourceHashes:[]};
  const baseline={metadata:{id:book.id},history:{bookId:book.id,editions:[]}};
  const bytes=new Map([['collection.json',Buffer.from(JSON.stringify(collection))],['books/example/bk-edited/manifest.json',Buffer.from(JSON.stringify({id:book.id}))],['books/example/bk-edited/editions.json',Buffer.from(JSON.stringify(baseline.history))]]);
  assert.equal(checkPublicationPackage(manifest,target,bytes,previous,baseline).books[0].title.en,'Edited title');
  assert.throws(()=>checkPublicationPackage({...manifest,taskType:'scriptahub.manuscript'},target,bytes,previous),/already exists/);
  assert.throws(()=>checkPublicationPackage(manifest,target,bytes,{...previous,books:[]}),/must already exist/);
  bytes.set('collection.json',Buffer.from(JSON.stringify({...collection,books:[{...collection.books[0],directory:'books/other/bk-edited'}]})));
  assert.throws(()=>checkPublicationPackage(manifest,target,bytes,previous),/cannot relocate/);
});

for (const discardHistory of [true,false]) test(`real Git edition publication ${discardHistory?'rejects lost history before push':'preserves previous editions and resources'}`,async t=>{
  const f=await fixture(t);f.upload();await f.publisher.publish(agent,{executionId:f.task.executionId},f.config);
  const baseline=await f.git(f.remote,'rev-parse','main');
  f.store.submit(sealRecord({id:crypto.randomUUID(),owner:'user:owner',createdAt:new Date().toISOString(),contact:{email:'owner@example.test'},metadata:{kind:'edit',bookId:f.task.bookId,language:'en',values:{instructions:'Improve the approved passage'}},files:[]}));
  f.store.submitEdition({id:'user:owner'},f.task.bookId,crypto.randomUUID());
  const task=f.service.claim(agent,{runId:'history-edition',taskType:'edit'}).task;
  const files=new Map(f.files),collection=JSON.parse(files.get('collection.json'));
  const book=collection.books[0],directory=book.directory;
  book.currentEdition='edition-2';book.editions.en.fullContent=directory+'/en/edition-2.html';
  files.set('collection.json',Buffer.from(JSON.stringify(collection)));
  files.set(directory+'/manifest.json',Buffer.from(JSON.stringify({id:book.id,currentEdition:'edition-2'})));
  files.set(directory+'/en/edition-2.html',Buffer.from('<p>Approved revised manuscript</p>'));
  const history=JSON.parse(files.get(directory+'/editions.json'));
  history.currentEdition='edition-2';if(discardHistory)history.editions=[];history.editions.push({id:'edition-2'});
  files.set(directory+'/editions.json',Buffer.from(JSON.stringify(history)));
  const input={...f.input,executionId:task.executionId,baseCommit:baseline,
    files:[...files].map(([path,bytes])=>({path,size:bytes.length,sha256:sha256(bytes)})),
    validation:{...f.input.validation,executionId:task.executionId,runId:task.runId,audit:{...f.input.validation.audit,scope:'edition_layout_regression'}}};
  f.publisher.prepare(agent,input,f.config);
  for(const [file,bytes]of files)f.publisher.upload(agent,{executionId:task.executionId,file,offset:0,data:bytes.toString('base64')});
  if(discardHistory){
    await assert.rejects(f.publisher.publish(agent,{executionId:task.executionId},f.config),/cannot remove or rewrite a previous edition/);
    assert.equal(f.pushes(),1);assert.equal(await f.git(f.remote,'rev-parse','main'),baseline);
    assert.equal(f.service.status(agent,{executionId:task.executionId}).state,'running');
  }else{
    await f.publisher.publish(agent,{executionId:task.executionId},f.config);assert.equal(f.pushes(),2);
    const stored=JSON.parse(await f.git(f.remote,'show','main:'+directory+'/editions.json'));
    assert.deepEqual(stored.editions.map(e=>e.id),['edition-1','edition-2']);
    assert.equal(await f.git(f.remote,'show','main:'+directory+'/en/full.html'),'<p>Original manuscript</p>');
    assert.equal(f.service.status(agent,{executionId:task.executionId}).state,'completed');
  }
});


test('processing gates publication and finish, and registered packages permanently gate new jobs',async t=>{
  const f=await fixture(t), jobs=new ProcessingStore(f.service);
  const request={executionId:f.task.executionId,jobId:'job-1',virtualCwd:'/workspace/run'};
  jobs.prepare(agent,request,'runtime',0);
  for (const state of ['uploading','starting','running','stopping']) {
    f.store.db.prepare('UPDATE task_processing_jobs SET state=? WHERE execution_id=?').run(state,request.executionId);
    assert.throws(()=>f.publisher.prepare(agent,f.input,f.config),{status:409});
    assert.throws(()=>f.service.finish(agent,{executionId:request.executionId,state:'failed',error:'stopped'}),{status:409});
  }
  f.store.db.prepare("UPDATE task_processing_jobs SET state='cancelled' WHERE execution_id=?").run(request.executionId);
  f.publisher.prepare(agent,f.input,f.config);
  assert.throws(()=>jobs.prepare(agent,{...request,jobId:'job-2'},'runtime',0),{status:409});
});

test('publication lease checks processing after a deferred credential lookup',async t=>{
  const f=await fixture(t); f.upload();
  let resume, began;
  const ready=new Promise(resolve=>{began=resolve;});
  const credentials=new Promise(resolve=>{resume=resolve;});
  const publisher=new TaskPublication(f.service,{tokenProvider:async()=>{began();return credentials;}});
  const publishing=publisher.publish(agent,{executionId:f.task.executionId},f.config);
  await ready;
  const now=new Date().toISOString();
  f.store.db.prepare(`INSERT INTO task_processing_jobs(execution_id,job_id,executor_agent_id,request,digest,state,runtime_id,created_at,updated_at) VALUES(?,?,?,?,?,'running',?,?,?)`)
    .run(f.task.executionId,'legacy-job',agent,'{}','digest','runtime',now,now);
  resume('test-token');
  await assert.rejects(publishing,{status:409});
  assert.equal(f.publisher.row(f.task.executionId).lease_until,0);
});

test('managed books publish on the workflow validation decision without a human gate and reward only once after push',async t=>{
  const f=await fixture(t,{kind:'book-proposal',manageApprovals:true});
  assert.equal(f.submitted.cycle.phase,'active');
  assert.equal(f.submitted.state,'accepted');
  f.store.db.prepare('UPDATE approval_cycles SET reward=10 WHERE id=?').run(f.submitted.submissionId);
  const {advanceCycles}=await import('../cycle-worker.mjs');
  let awarded=0;const references=new Set();
  const options={send:async()=>({providerMessageId:'test'}),apply:async(row,operation,amount)=>{
    assert.equal(operation,'reward');
    if(!references.has(row.id)){references.add(row.id);awarded+=amount;}
    return {};
  }};
  await advanceCycles(f.store,options);assert.equal(awarded,0);
  assert.throws(()=>f.publisher.prepare(agent,{...f.input,validation:{...f.input.validation,publicationPermitted:false}},f.config),/successful independent final validation/);
  assert.equal(f.pushes(),0);
  f.upload();
  const result=await f.publisher.publish(agent,{executionId:f.task.executionId},f.config);
  assert.equal(result.state,'completed');assert.ok(result.publication.commit);
  assert.equal(f.pushes(),1);
  await advanceCycles(f.store,options);await advanceCycles(f.store,options);
  assert.equal(awarded,10);
  await f.publisher.publish(agent,{executionId:f.task.executionId},f.config);
  await advanceCycles(f.store,options);
  assert.equal(f.pushes(),1);assert.equal(awarded,10);
});

test('Git publication materializes only the current package, preserving unrelated remote files in the index',async t=>{
 const f=await fixture(t);
 await fs.mkdir(path.join(f.seed,'books/unrelated'),{recursive:true});
 await fs.writeFile(path.join(f.seed,'books/unrelated/full.html'),'ANOTHER BOOK');
 await f.git(f.seed,'add','.');await f.git(f.seed,'commit','-m','Unrelated existing content');await f.git(f.seed,'push','origin','main');
 f.input.baseCommit=await f.git(f.seed,'rev-parse','HEAD');f.upload();
 const result=await f.publisher.publish(agent,{executionId:f.task.executionId},f.config);
 assert.equal(result.state,'completed');
 const worktree=path.join(f.root,'data/publications',f.task.executionId);
 await assert.rejects(fs.stat(path.join(worktree,'books/unrelated/full.html')),{code:'ENOENT'});
 assert.equal(await f.git(worktree,'show','HEAD:books/unrelated/full.html'),'ANOTHER BOOK');
});

test('schema 2 publishes a Romanian HTML-only generated book with no English or PDF edition',async t=>{
 const f=await fixture(t,{schemaVersion:2,kind:'book-proposal',coverMode:'generate'}),id=f.task.bookId,directory='books/generated-romanian';
 const document={schemaVersion:2,id,legacyDirectory:'books/generated/'+id,contentDirectory:directory,
  metadata:{id,title:{ro:'Carte generată'},coverUrl:{ro:'ro/cover.svg'},thumbnailUrl:{ro:'ro/cover.svg'},editions:{ro:{book:'ro/book.html',fullContent:'ro/full.html'}}},
  history:{bookId:id,editions:[]},resources:{'ro/full.html':directory+'/ro/full.html','ro/cover.svg':directory+'/ro/cover.svg'}};
 const metadata=Buffer.from(JSON.stringify(document));f.files.clear();
 f.files.set('collection.json',Buffer.from(JSON.stringify({schemaVersion:2,bookCount:1,books:[{id,path:directory+'/book.json',sha256:sha256(metadata)}]})));
 f.files.set(directory+'/book.json',metadata);f.files.set(directory+'/ro/full.html',Buffer.from('<!doctype html><html lang="ro"><body><main><h1>Carte generată</h1><p>Conținutul cărții.</p></main></body></html>'));
 f.files.set(directory+'/ro/cover.svg',Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 1800"><text x="100" y="250">Carte generată</text></svg>'));
 const broken=structuredClone(document);delete broken.resources['ro/cover.svg'];const brokenBytes=Buffer.from(JSON.stringify(broken));
 const brokenFiles=new Map(f.files);brokenFiles.set(directory+'/book.json',brokenBytes);
 const brokenCollection=JSON.parse(brokenFiles.get('collection.json'));brokenCollection.books[0].sha256=sha256(brokenBytes);brokenFiles.set('collection.json',Buffer.from(JSON.stringify(brokenCollection)));
 assert.throws(()=>checkPublicationPackage({taskType:f.task.type,bookId:id,sourceHashes:[],coverRequired:true},publicationTarget(f.input.catalogue,f.input.branch),brokenFiles,f.previous),/Missing.*artwork/);
 f.input.files=[...f.files].map(([path,bytes])=>({path,size:bytes.length,sha256:sha256(bytes)}));
 assert.throws(()=>f.publisher.prepare(agent,{...f.input,validation:{...f.input.validation,audit:{...f.input.validation.audit,existingFindings:1}}},f.config),/HTML integrity/);
 f.upload();assert.equal((await f.publisher.publish(agent,{executionId:f.task.executionId},f.config)).state,'completed');assert.equal(f.pushes(),1);
});

test('a requested generated cover is required, inventoried and published with its thumbnail reference', async t => {
  const f = await fixture(t,{kind:'book-proposal',coverMode:'generate'});
  const target=publicationTarget(f.input.catalogue,f.input.branch);
  const manifest={taskType:f.task.type,bookId:f.task.bookId,sourceHashes:[],coverRequired:true};
  assert.throws(()=>checkPublicationPackage(manifest,target,f.files,f.previous),/requires its generated cover/);
  const collection=JSON.parse(f.files.get('collection.json')),book=collection.books[0];
  const cover=book.directory+'/en/cover.svg';
  book.coverUrl={en:cover};book.thumbnailUrl={en:cover};
  f.files.set('collection.json',Buffer.from(JSON.stringify(collection)));
  assert.throws(()=>checkPublicationPackage(manifest,target,f.files,f.previous),/Missing.*artwork/);
  f.files.set(cover,Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 1800"><rect width="1200" height="1800" fill="#163e30"/><text x="100" y="300" fill="white">Gardens</text></svg>'));
  assert.ok(checkPublicationPackage(manifest,target,f.files,f.previous));
  f.input.files=[...f.files].map(([path,bytes])=>({path,size:bytes.length,sha256:sha256(bytes)}));
  f.upload();
  assert.equal((await f.publisher.publish(agent,{executionId:f.task.executionId},f.config)).state,'completed');
  const published=JSON.parse(await f.git(f.remote,'show','main:collection.json'));
  assert.equal(published.books[0].coverUrl.en,cover);
  assert.equal(published.books[0].thumbnailUrl.en,cover);
  assert.match(await f.git(f.remote,'show','main:'+cover),/viewBox="0 0 1200 1800"/);
});
