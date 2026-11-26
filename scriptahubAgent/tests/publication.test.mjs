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
import { publishFromRobot } from '../../skills/scriptahub-tasks/scripts/robot-publication.mjs';
import { publicationTarget, checkPublicationPackage, verifyCatalogueBranch } from '../publication-policy.mjs';
import { sha256 } from '../publication-transfer.mjs';
import { sealRecord } from '../record-integrity.mjs';
import { combineCollections } from '../catalogue-keywords.mjs';
const exec = promisify(execFile), agent = 'agent:test/processor';
process.env.SCRIPTA_RECORD_KEY = 'publication-tests-record-key-012345678901234567890';
async function fixture(t, { schemaVersion = 1, kind = 'manuscript', manageApprovals = false, coverMode, coverImage, approvePackage = true } = {}) {
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
    files:[...(kind==='manuscript'?[{name:crypto.randomUUID()+'.pdf',originalName:'source.pdf',sha256:sha256(source)}]:[]),
      ...(coverImage?[{role:'cover',name:crypto.randomUUID()+'.png',originalName:'cover.png',sha256:sha256(coverImage)}]:[])],createdAt:new Date().toISOString(),state:'received',task:null}));
  const task = service.claim(agent,{runId:'run-publication',taskType:kind}).task;
  service.saveModeration(task.executionId,'submission');
  const catalogue = 'https://github.com/example/books/blob/main/collection.json';
  const config = {repositories:[catalogue]};
  let pushes = 0, losePushResponse = false, beforeGit, afterGit;
  const publisher = new TaskPublication(service,{gitFactory:async (...args) => {
    const run = await publicationGit(...args);
    return async (...command) => {
      if (command[0] === 'remote' && command[1] === 'add') command[3] = remote;
      assert.notEqual(command[0], 'push');
      assert.notEqual(command[0], 'commit');
      await beforeGit?.(command);
      const result = await run(...command);
      await afterGit?.(command);
      return result;
    };
  }});
  if (approvePackage) {
    const prepare = publisher.prepare.bind(publisher);
    publisher.prepare = (...args) => {
      const prepared = prepare(...args);
      service.saveModeration(prepared.executionId,'submission');
      service.saveModeration(prepared.executionId,'package',prepared.packageDigest);
      return prepared;
    };
  }
  const publishService = publisher.publish.bind(publisher);
  publisher.publish = (executor, payload, settings) => payload.action
    ? publishService(executor,payload,settings)
    : publishFromRobot((_tool, input) => publishService(executor,input,settings),payload.executionId,{
      executeGit:async (binary,args,options) => {
        const command = args.slice(4);
        if (command[0] === 'push') pushes++;
        await beforeGit?.(command);
        const result = await exec(binary,args.map(arg => arg.toLowerCase() === 'https://github.com/example/books.git' ? remote : arg),{
          ...options,env:{...options.env,GIT_ALLOW_PROTOCOL:'file',GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1',
            GIT_AUTHOR_NAME:'Publishing robot',GIT_AUTHOR_EMAIL:'robot@example.test',GIT_COMMITTER_NAME:'Publishing robot',GIT_COMMITTER_EMAIL:'robot@example.test'}
        });
        await afterGit?.(command);
        if (command[0] === 'push' && losePushResponse) { losePushResponse = false; throw new Error('Transport closed after accepted push'); }
        return result;
      }
    });
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
  const collection = JSON.parse(files.get('collection.json'));
  collection.books[0].keywordIds = [];
  collection.books[0].keywords = Object.fromEntries(['en','fr','de','es','pt','it','ro','pl'].map(code => [code, []]));
  collection.keywords = combineCollections(collection.books).keywords;
  files.set('collection.json', Buffer.from(JSON.stringify(collection)));
  const input = {executionId:task.executionId,catalogue,branch:'main',baseCommit,
    files:[...files].map(([path,bytes]) => ({path,size:bytes.length,sha256:sha256(bytes)})),
    validation:{executionId:task.executionId,runId:task.runId,bookId:task.bookId,publicationPermitted:true,audit:{autoCorrect:false,status:'passed_with_warnings',errorFindings:0,...(kind==='book-proposal'?{scope:'html_layout_integrity',nativeScope:'edition_layout_regression',existingFindings:0}:{scope:'layout_and_structure'})}}};
  const upload = () => {
    const result = publisher.prepare(agent,input,config);
    for (const [file,bytes] of files) publisher.upload(agent,{executionId:task.executionId,file,offset:0,data:bytes.toString('base64')});
    return result;
  };
  return {root,remote,seed,git,service,store,publisher,task,config,files,input,upload,submitted,previous, before: hook => { beforeGit = hook; }, after: hook => { afterGit = hook; }, pushes:() => pushes, loseNextPushResponse:() => { losePushResponse = true; }};
}

test('a prompt-based book publishes its declared PDF download alongside HTML', async t => {
  const f = await fixture(t, { kind: 'book-proposal' });
  const target = publicationTarget(f.input.catalogue, f.input.branch);
  const manifest = { taskType:f.task.type, bookId:f.task.bookId, sourceHashes:[] };
  assert.equal([...f.files.keys()].some(name=>/\.(pdf|docx)$/i.test(name)),false);
  const withPdf=new Map(f.files);withPdf.set('books/extra.pdf',Buffer.from('%PDF-1.7'));
  assert.throws(()=>checkPublicationPackage(manifest,target,withPdf,f.previous),/only their declared download PDFs/);
  const invalid=new Map(f.files);invalid.delete([...invalid.keys()].find(name=>name.endsWith('/full.html')));
  assert.throws(()=>checkPublicationPackage(manifest,target,invalid,f.previous),/resource|full HTML/);
  assert.throws(() => checkPublicationPackage({...manifest,sourceHashes:['0'.repeat(64)]},target,f.files,f.previous),/uploaded source/);
  const collection=JSON.parse(f.files.get('collection.json'));
  const edition=collection.books[0].editions.en;
  edition.pdf=collection.books[0].directory+'/en/book.pdf';
  f.files.set(edition.pdf,Buffer.from('%PDF-1.7\n'));
  f.files.set('collection.json',Buffer.from(JSON.stringify(collection)));
  f.input.files=[...f.files].map(([path,bytes])=>({path,size:bytes.length,sha256:sha256(bytes)}));
  f.input.validation.requirePdf=true;
  f.upload();
  const result = await f.publisher.publish(agent,{executionId:f.task.executionId},f.config);
  assert.equal(result.state,'completed');
  assert.equal(f.pushes(),1);
  assert.equal(await f.git(f.remote,'show','main:'+edition.pdf),'%PDF-1.7');
  assert.equal(await f.git(f.remote,'show','-s','--format=%an <%ae>',result.publication.commit),'Publishing robot <robot@example.test>');
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
  collection.books.push({id,directory:'books/another/' + id,editions:{},keywordIds:[],
    keywords:Object.fromEntries(['en','fr','de','es','pt','it','ro','pl'].map(code => [code, []]))});
  collection.bookCount = collection.books.length;
  collection.keywords = combineCollections(collection.books).keywords;
  await fs.writeFile(collectionPath,JSON.stringify(collection));
  await f.git(f.seed,'add','collection.json');
  await f.git(f.seed,'commit','-m','Publish another book');
  await f.git(f.seed,'push','origin','main');
}

async function resume(f, executionId = f.task.executionId) {
  f.store.db.prepare('UPDATE task_publications SET retry_at=0 WHERE execution_id=?').run(executionId);
  await f.publisher.resume(async () => f.config, message => assert.fail(message));
  const status = f.service.status(agent,{executionId});
  return status.state === 'running' ? f.publisher.publish(agent,{executionId},f.config) : status;
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
  const completed = await resume(f);
  assert.equal(completed.state,'completed');
  assert.match(completed.publication.commit,/^[a-f0-9]{40}$/);
  const catalogue = JSON.parse(await f.git(f.remote,'show','main:collection.json'));
  assert.deepEqual(catalogue.books.map(book => book.id),['bk-concurrent-1','bk-concurrent-2','bk-concurrent-3','bk-concurrent-4',f.task.bookId]);
  assert.equal(f.pushes(),5);
});

test('a stop before push finishes the deferred publication as cancelled', async t => {
  const f = await fixture(t); f.upload();
  f.after(async ([command]) => {
    if (command === 'write-tree') {
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
  assert.equal(f.publisher.row(f.task.executionId).push_state,'attempting');
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
  f.service.saveModeration(task.executionId,'submission');
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
  f.before(async ([command]) => { if (command === 'write-tree' && f.pushes() === 0) { start(); await blocked; } });
  const first = f.publisher.publish(agent,{executionId:f.task.executionId},f.config);
  await started;
  try {
    assert.equal((await f.publisher.publish(agent,{executionId:task.executionId},f.config)).publicationPending,true);
    assert.equal(f.pushes(),0);
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
    f.service.reconcileStops(message=>assert.fail(message));
    assert.equal(f.service.status(agent,{executionId:f.task.executionId}).state,'stop_requested');
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

test('missing keyword IDs are an actionable validation error before publication registration', async t => {
  const f = await fixture(t);
  const collection = JSON.parse(f.files.get('collection.json'));
  collection.books[0].keywords = {en:['Dacians']};
  delete collection.books[0].keywordIds;
  collection.keywords = {en:[]};
  f.files.set('collection.json',Buffer.from(JSON.stringify(collection)));
  const manifest = {...f.input,bookId:f.task.bookId,sourceHashes:f.task.files.map(file=>file.sha256)};
  assert.throws(()=>checkPublicationPackage(manifest,publicationTarget(f.input.catalogue,'main'),f.files,f.previous),
    error=>error.status===400 && error.message===`Invalid keyword catalogue for ${f.task.bookId} (en)`);
});

test('schema 1 publication rejects a missing keyword index', async t => {
  const f = await fixture(t);
  const collection = JSON.parse(f.files.get('collection.json'));
  delete collection.keywords;
  f.files.set('collection.json', Buffer.from(JSON.stringify(collection)));
  const manifest = {...f.input, bookId:f.task.bookId, sourceHashes:f.task.files.map(file => file.sha256)};
  assert.throws(() => checkPublicationPackage(manifest, publicationTarget(f.input.catalogue, 'main'), f.files, f.previous),
    error => error.status === 400 && /Missing or invalid catalogue keyword index/.test(error.message));
});


test('catalogue branch resolution cannot redirect publication to a shorter matching branch', () => {
  const url = 'https://github.com/example/books/blob/content/stable/collection.json';
  const refs = 'a'.repeat(40)+'\trefs/heads/content\n'+'b'.repeat(40)+'\trefs/heads/content/stable';
  assert.throws(() => verifyCatalogueBranch(url,'content',refs),/does not match/);
  verifyCatalogueBranch(url,'content/stable',refs);
});

test('edit publication changes only its existing book and keeps its content location',()=>{
  const book={id:'bk-edited',directory:'books/example/bk-edited',editions:{},keywordIds:[],
    keywords:Object.fromEntries(['en','fr','de','es','pt','it','ro','pl'].map(code => [code, []]))};
  const previous={schemaVersion:1,bookCount:1,books:[book]};
  const collection={...previous,books:[{...book,title:{en:'Edited title'}}],keywords:combineCollections([book]).keywords};
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

test('ScriptaHub rejects a robot commit for a different tree',async t=>{
  const f=await fixture(t); f.upload();
  const executionId=f.task.executionId;
  const prepared=await f.publisher.publish(agent,{executionId,action:'prepare'},f.config);
  assert.ok(prepared.push.tree);
  const changed=Buffer.from('tree '+'a'.repeat(40)+'\nparent '+prepared.push.parent+'\n\nChanged');
  await assert.rejects(f.publisher.publish(agent,{executionId,action:'authorize',tree:prepared.push.tree,commitObject:changed.toString('base64')},f.config),/validated publication tree/);
  assert.equal(f.publisher.row(executionId).commit_id,null);
  assert.equal(f.pushes(),0);
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

for (const [kind,schemaVersion] of [['book-proposal',1],['manuscript',1],['book-proposal',2]]) test(`an uploaded cover publishes unchanged for ${kind}, schema ${schemaVersion}`, async t => {
  const image=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jXioAAAAASUVORK5CYII=','base64');
  const f=await fixture(t,{kind,schemaVersion,coverMode:'upload',coverImage:image});
  const collection=JSON.parse(f.files.get('collection.json')),book=collection.books[0];
  let cover=book.directory+'/en/cover.png';
  book.coverUrl={en:cover};book.thumbnailUrl={en:cover};
  f.files.set('collection.json',Buffer.from(JSON.stringify(collection)));
  f.files.set(cover,image);
  const sourceHashes=kind==='manuscript'?[sha256(f.files.get(book.directory+'/en/book.pdf'))]:[];
  if(schemaVersion===2) {
    const html=f.files.get(book.directory+'/en/full.html');
    book.directory='books/uploaded-cover';
    cover=book.directory+'/en/cover.png';
    const document={schemaVersion:2,id:f.task.bookId,legacyDirectory:book.directory+'/'+f.task.bookId,contentDirectory:book.directory,
      metadata:{id:f.task.bookId,title:{en:'Gardens'},coverUrl:{en:'en/cover.png'},thumbnailUrl:{en:'en/cover.png'},editions:{en:{book:'en/book.html',fullContent:'en/full.html'}}},
      history:{bookId:f.task.bookId,editions:[]},resources:{'en/full.html':book.directory+'/en/full.html','en/cover.png':cover}};
    const metadata=Buffer.from(JSON.stringify(document));
    f.files.clear();
    f.files.set('collection.json',Buffer.from(JSON.stringify({schemaVersion:2,bookCount:1,books:[{id:f.task.bookId,path:book.directory+'/book.json',sha256:sha256(metadata)}]})));
    f.files.set(book.directory+'/book.json',metadata);f.files.set(book.directory+'/en/full.html',html);f.files.set(cover,image);
  }
  const manifest={taskType:f.task.type,bookId:f.task.bookId,coverRequired:true,coverSourceHash:sha256(image),sourceHashes};
  const target=publicationTarget(f.input.catalogue,f.input.branch);
  assert.ok(checkPublicationPackage(manifest,target,f.files,f.previous));
  const changed=new Map(f.files);changed.set(cover,Buffer.concat([image,Buffer.from('changed')]));
  assert.throws(()=>checkPublicationPackage(manifest,target,changed,f.previous),/uploaded cover image unchanged/);
  f.input.files=[...f.files].map(([path,bytes])=>({path,size:bytes.length,sha256:sha256(bytes)}));
  f.upload();
  const stored=JSON.parse(f.publisher.row(f.task.executionId).manifest);
  assert.deepEqual(stored.sourceHashes,sourceHashes);assert.equal(stored.coverSourceHash,sha256(image));assert.equal(stored.coverRequired,true);
  assert.equal((await f.publisher.publish(agent,{executionId:f.task.executionId},f.config)).state,'completed');
  const published=await exec('git',['show','main:'+cover],{cwd:f.remote,encoding:'buffer'});
  assert.deepEqual(published.stdout,image);
});

test('publishing the source and one translated edition retains the omitted-language warning in results and email',async t=>{
  const f=await fixture(t,{manageApprovals:true});
  const collection=JSON.parse(f.files.get('collection.json'));
  const directory=collection.books[0].directory;
  collection.books[0].editions.ro={fullContent:directory+'/ro/full.html'};
  f.files.set('collection.json',Buffer.from(JSON.stringify(collection)));
  f.files.set(directory+'/ro/full.html',Buffer.from('<html lang="ro"><p>Manuscrisul tradus.</p></html>'));
  f.input.files=[...f.files].map(([path,bytes])=>({path,size:bytes.length,sha256:sha256(bytes)}));
  f.input.validation.translationOutcome={sourceLanguage:'en',requestedLanguages:['en','ro','es'],publishedLanguages:['en','ro'],omitted:[{language:'es',reason:'Spanish translation could not be validated.'}]};
  f.store.db.prepare('UPDATE approval_cycles SET reward=10 WHERE task_id=?').run(f.task.taskId);
  f.upload();
  const result=await f.publisher.publish(agent,{executionId:f.task.executionId},f.config);
  assert.equal(result.state,'completed');assert.match(result.result,/Partially completed.*en, ro.*es.*could not be validated/);
  assert.equal(f.pushes(),1);
  const published=JSON.parse(await f.git(f.root,'--git-dir='+f.remote,'show','main:collection.json'));
  assert.deepEqual(Object.keys(published.books[0].editions).sort(),['en','ro']);
  const {advanceCycles}=await import('../cycle-worker.mjs');const mail=[];
  await advanceCycles(f.store,{apply:async()=>({}),send:async notice=>{mail.push(notice);return {providerMessageId:'test-mail'};},report:message=>assert.fail(message)});
  assert.ok(mail.some(notice=>notice.subject.includes('incomplete translations') && /en, ro.*es.*could not be validated/.test(notice.message)),'the owner must receive the partial-completion warning even when a reward is pending');
});

test('catalogue validation ships with the service independently of the installed skill image', async () => {
  const serviceModule = await fs.readFile(new URL('../catalogue-keywords.mjs',import.meta.url),'utf8');
  const skillModule = await fs.readFile(new URL('../../skills/scriptahub-tasks/scripts/catalogue-keywords.mjs',import.meta.url),'utf8');
  assert.equal(serviceModule,skillModule,'the separately deployed service and task helper must use identical keyword rules');
  assert.doesNotMatch(serviceModule,/\/opt\/scriptahub|\.\.\/skills/);
});

test('publication requires all server-prepared units for the exact uploaded package',async t=>{
  const f=await fixture(t,{kind:'book-proposal',approvePackage:false});
  f.input.validation.moderation={version:4,status:'passed'};
  f.service.prepareModeration=async (context,files)=>{
    assert.equal(context.stage,'package');
    const html=files.find(file=>file.path.endsWith('/full.html'));
    assert.ok(html);
    return {units:[
      {digest:'a'.repeat(64),file:html.path,text:'First part',changeId:null,image:null},
      {digest:'b'.repeat(64),file:html.path,text:'Second part',changeId:null,image:Buffer.from('fixture image')}
    ]};
  };
  const args={executionId:f.task.executionId,stage:'package'};
  assert.deepEqual(await f.service.moderateTask(agent,{...args,action:'status'}),{status:'pending'});
  f.upload();
  await assert.rejects(f.publisher.publish(agent,args,f.config),/Complete robot moderation/);
  const first=await f.service.moderateTask(agent,args);
  assert.equal(first.position,0);
  await assert.rejects(f.service.moderateTask(agent,{...args,action:'record',position:0,digest:'0'.repeat(64),verdict:'passed'}),/does not match/);
  const second=await f.service.moderateTask(agent,{...args,action:'record',position:0,digest:first.digest,verdict:'passed'});
  assert.deepEqual(await f.service.moderateTask(agent,args),second);
  assert.deepEqual(await f.service.moderateTask(agent,{...args,action:'status'}),{status:'pending',completedUnits:1});
  await assert.rejects(f.publisher.publish(agent,args,f.config),/Complete robot moderation/);
  const image=await f.service.moderateTask(agent,{...args,action:'image',position:1,digest:second.digest});
  assert.equal(Buffer.from(image.data,'base64').toString(),'fixture image');
  const result=await f.service.moderateTask(agent,{...args,action:'record',position:1,digest:second.digest,
    verdict:'blocked',category:'extreme_presentation'});
  assert.equal(result.state,'failed');
  assert.match(result.taskError,/outside the ScriptaHub content policy/);
  assert.equal(f.pushes(),0);
  assert.equal(f.service.moderationPassed(f.task.executionId,'package',f.publisher.row(f.task.executionId).digest),false);
});

for (const change of ['unchanged','changed bytes','changed render']) {
  test('final moderation handles earlier artifact evidence: '+change,async t=>{
    const f = await fixture(t,{kind:'book-proposal',approvePackage:false});
    const {prepareReviewUnits} = await import('../content-moderation.mjs');
    let renderedText = 'Original reader';
    f.service.prepareModeration = (context,files) => prepareReviewUnits(context,files,{
      prepare: async (root, _taskId, _file, output) => {
        const directory = path.join(root,output);
        await fs.mkdir(directory,{recursive:true});
        await fs.writeFile(path.join(directory,'page.png'),'image:'+renderedText);
        await fs.writeFile(path.join(directory,'units.json'),JSON.stringify([{image:'page.png',text:renderedText}]));
        return true;
      }
    });
    const executionId = f.task.executionId;
    const artifact = {executionId,stage:'artifact'};
    const finalFile = [...f.files.keys()].find(name => name.endsWith('/full.html'));
    const file = 'sources/reader.html';
    const bytes = change === 'changed bytes' ? Buffer.from('<p>Earlier bytes</p>') : f.files.get(finalFile);
    const inventory = [{path:file,sha256:sha256(bytes),size:bytes.length}];
    const {artifactId} = await f.service.moderateTask(agent,{...artifact,action:'prepare',file,files:inventory});
    await f.service.moderateTask(agent,{...artifact,artifactId,action:'upload',file,offset:0,data:bytes.toString('base64')});
    const first = await f.service.moderateTask(agent,{...artifact,artifactId,action:'next'});
    assert.equal(first.file,file);
    assert.equal(first.text,'Original reader');
    assert.deepEqual(await f.service.moderateTask(agent,{...artifact,artifactId,action:'record',
      position:first.position,digest:first.digest,verdict:'passed'}),{status:'passed'});
    assert.deepEqual(await f.service.moderateTask(agent,{...artifact,action:'prepare',file,files:inventory}),
      {artifactId,status:'passed'});
    assert.deepEqual(await f.service.moderateTask(agent,{...artifact,action:'status'}),{status:'idle',completedUnits:1});
    assert.deepEqual(await f.service.moderateTask(agent,{...artifact,action:'status',file,digest:sha256(bytes)}),{status:'passed'});
    assert.deepEqual(await f.service.moderateTask(agent,{...artifact,action:'status',file,digest:'0'.repeat(64)}),{status:'pending'});
    if (change === 'changed render') renderedText = 'Rendered with different dependencies';
    f.input.validation.inventorySha256 = '2'.repeat(64);
    f.upload();
    const publication = {executionId,stage:'package'};
    const reviewed = [];
    let unit = await f.service.moderateTask(agent,publication);
    while (unit.status === 'review') {
      reviewed.push(unit.file);
      unit = await f.service.moderateTask(agent,{...publication,action:'record',position:unit.position,digest:unit.digest,verdict:'passed'});
    }
    assert.equal(reviewed.includes(finalFile),change !== 'unchanged');
    assert.ok(reviewed.includes('collection.json'));
    const verdict = await f.service.moderateTask(agent,{...publication,action:'status'});
    assert.equal(verdict.status,'passed');
    assert.equal(verdict.inventorySha256,f.input.validation.inventorySha256);
    assert.ok(verdict.completedUnits >= 1);
  });
}

test('restart a partial upload for the same artifact and discard a stale draft by exact identity',async t=>{
  const f = await fixture(t,{kind:'book-proposal',approvePackage:false});
  const req = {executionId:f.task.executionId,stage:'artifact'};
  const file = 'sources/book.html';
  const prepare = (value, filename=file) => f.service.moderateTask(agent,{...req,action:'prepare',
    replaceIncomplete:true,file:filename,files:[{path:filename,sha256:sha256(value),size:Buffer.byteLength(value)}]});
  const upload = (artifactId,value) => f.service.moderateTask(agent,{...req,artifactId,action:'upload',file,offset:0,data:Buffer.from(value).toString('base64')});
  const original = await prepare('first');
  await upload(original.artifactId,'fi');
  await assert.rejects(prepare('second','sources/other.html'),/active artifact review/);
  const replacement = await prepare('second');
  assert.notEqual(replacement.artifactId,original.artifactId);
  await assert.rejects(upload(original.artifactId,'first'),/does not match/);
  await upload(replacement.artifactId,'second');
  await assert.rejects(prepare('third'),/active artifact review/);
  const discard = artifactId => f.service.moderateTask(agent,{...req,artifactId,action:'discard'});
  await assert.rejects(discard(original.artifactId),/does not match/);
  assert.equal((await discard(replacement.artifactId)).status,'discarded');
  assert.equal((await discard(replacement.artifactId)).status,'discarded');
  assert.ok((await prepare('third')).artifactId);
});

test('package rendering skips an independently moderated PDF with identical bytes',async t=>{
  const f = await fixture(t,{kind:'book-proposal',approvePackage:false});
  const {prepareReviewUnits} = await import('../content-moderation.mjs');
  const rendered = [];
  f.service.prepareModeration = (context,files) => prepareReviewUnits(context,files,{
    prepare:async (root,_task,file,output) => {
      rendered.push(file);
      const folder = path.join(root,output);
      await fs.mkdir(folder,{recursive:true});
      await fs.writeFile(path.join(folder,'page.png'),'image');
      await fs.writeFile(path.join(folder,'units.json'),JSON.stringify([{image:'page.png',text:'Readable page'}]));
      return true;
    }
  });
  const file = 'sources/download.pdf';
  const bytes = Buffer.from('%PDF-1.7\n');
  const args = {executionId:f.task.executionId,stage:'artifact'};
  const {artifactId} = await f.service.moderateTask(agent,{...args,action:'prepare',file,
    files:[{path:file,size:bytes.length,sha256:sha256(bytes)}]});
  await f.service.moderateTask(agent,{...args,artifactId,action:'upload',file,offset:0,data:bytes.toString('base64')});
  const unit = await f.service.moderateTask(agent,{...args,artifactId,action:'next'});
  await f.service.moderateTask(agent,{...args,artifactId,action:'record',position:unit.position,digest:unit.digest,verdict:'passed'});
  const publishedPdf = 'books/test/' + f.task.bookId + '/en/book.pdf';
  f.files.set(publishedPdf,bytes);
  f.input.files.push({path:publishedPdf,size:bytes.length,sha256:sha256(bytes)});
  f.upload();
  await f.service.moderateTask(agent,{executionId:args.executionId,stage:'package'});
  assert.deepEqual(rendered.filter(name=>name.endsWith('.pdf')),['inputs/'+file]);
});

test('the robot can publish after recording all submission and package verdicts',async t=>{
  const f=await fixture(t,{kind:'book-proposal',approvePackage:false});
  f.store.db.prepare("DELETE FROM task_moderation WHERE execution_id=? AND stage='submission'").run(f.task.executionId);
  f.service.prepareModeration=async ({stage},files)=>({units:[
    {digest:sha256(stage),file:files[0].path,text:'Content for review',changeId:null,image:null}
  ]});
  const executionId=f.task.executionId;
  const approve=async stage=>{
    const args={executionId,stage};
    const unit=await f.service.moderateTask(agent,args);
    assert.equal(unit.status,'review');
    return f.service.moderateTask(agent,{...args,action:'record',position:unit.position,digest:unit.digest,verdict:'passed'});
  };
  assert.deepEqual(await approve('submission'),{status:'passed'});
  const {packageDigest}=f.upload();
  assert.deepEqual(await approve('package'),{status:'passed'});
  assert.equal(f.service.moderationPassed(executionId,'package',packageDigest),true);
  assert.equal(f.service.moderationPassed(executionId,'package','another-digest'),false);
  assert.equal((await f.publisher.publish(agent,{executionId},f.config)).state,'completed');
  assert.equal(f.pushes(),1);
});
