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
import { publicationGit } from '../publication-git.mjs';
import { PublicationAccessStore } from '../publication-access.mjs';
import { publicationTarget, checkPublicationPackage, verifyCatalogueBranch } from '../publication-policy.mjs';
import { publicationConfig } from '../publication-config.mjs';
import { sha256 } from '../publication-transfer.mjs';
import { sealRecord } from '../record-integrity.mjs';
const exec = promisify(execFile), agent = 'agent:test/processor';
process.env.SCRIPTA_RECORD_KEY = 'publication-tests-record-key-012345678901234567890';
async function fixture(t, { schemaVersion = 1 } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(),'scripta-publication-'));
  const remote = path.join(root,'remote.git'), seed = path.join(root,'seed'), data = path.join(root,'data');
  const git = async (cwd,...args) => (await exec('git',args,{cwd,env:{...process.env,GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1',GIT_AUTHOR_NAME:'Test',GIT_AUTHOR_EMAIL:'test@example.test',GIT_COMMITTER_NAME:'Test',GIT_COMMITTER_EMAIL:'test@example.test'}})).stdout.trim();
  await git(root,'init','--bare',remote); await fs.mkdir(seed); await git(seed,'init','--initial-branch=main');
  const previous = {schemaVersion,bookCount:0,books:[]};
  await fs.writeFile(path.join(seed,'collection.json'),JSON.stringify(previous));
  await git(seed,'add','.'); await git(seed,'commit','-m','Initial catalogue'); await git(seed,'remote','add','origin',remote); await git(seed,'push','origin','main');
  const baseCommit = await git(seed,'rev-parse','HEAD');
  const store = new DashboardStore(data), service = new TaskExecution(store,data);
  t.after(async () => { store.close(); await fs.rm(root,{recursive:true,force:true}); });
  store.remember({id:'user:owner',email:'owner@example.test',displayName:'Owner'});
  const source = Buffer.from('%PDF-1.7\nOriginal manuscript\n');
  const submitted = store.submit(sealRecord({id:crypto.randomUUID(),owner:'user:owner',contact:{email:'owner@example.test'},
    metadata:{kind:'manuscript',language:'en',values:{instructions:'Process the original manuscript'}},
    files:[{name:crypto.randomUUID()+'.pdf',originalName:'source.pdf',sha256:sha256(source)}],createdAt:new Date().toISOString(),state:'received',task:null}));
  const task = service.claim(agent,{runId:'run-publication'}).task;
  const catalogue = 'https://github.com/example/books/blob/main/collection.json';
  const config = {repositories:[catalogue],publication:{authorName:'Publisher',authorEmail:'publisher@example.test'}};
  let pushes = 0, losePushResponse = false;
  const access = new PublicationAccessStore(data);
  access.update(state => {state.connection={token:'test-only-secret',publication:config.publication,user:{login:'publisher'}};}); access.close();
  const publisher = new TaskPublication(service,{gitFactory:async (...args) => {
    const run = await publicationGit(...args);
    return async (...command) => {
      if (command[0] === 'remote' && command[1] === 'add') command[3] = remote;
      if (command[0] === 'push') pushes++;
      const result = await run(...command);
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
  const input = {executionId:task.executionId,catalogue,branch:'main',baseCommit,
    files:[...files].map(([path,bytes]) => ({path,size:bytes.length,sha256:sha256(bytes)})),
    validation:{executionId:task.executionId,runId:task.runId,bookId:task.bookId,publicationPermitted:true,audit:{autoCorrect:false,status:'passed_with_warnings',errorFindings:0}}};
  const upload = () => {
    const result = publisher.prepare(agent,input,config);
    for (const [file,bytes] of files) publisher.upload(agent,{executionId:task.executionId,file,offset:0,data:bytes.toString('base64')});
    return result;
  };
  return {root,remote,seed,git,service,store,publisher,task,config,files,input,upload,submitted,previous,pushes:() => pushes, loseNextPushResponse:() => { losePushResponse = true; }};
}

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

test('concurrent remote updates and stop requests prohibit a new push', async t => {
  const f = await fixture(t); f.upload();
  await fs.writeFile(path.join(f.seed,'unrelated.txt'),'Concurrent work');
  await f.git(f.seed,'add','.'); await f.git(f.seed,'commit','-m','Concurrent change'); await f.git(f.seed,'push','origin','main');
  await assert.rejects(f.publisher.publish(agent,{executionId:f.task.executionId},f.config),/baseline changed/);
  assert.equal(f.pushes(),0);
  f.store.cancel({id:'user:owner'},f.submitted.task.id);
  await assert.rejects(f.publisher.publish(agent,{executionId:f.task.executionId},f.config),/not running/);
  assert.equal(f.service.finish(agent,{executionId:f.task.executionId,state:'cancelled',result:'Stopped'}).state,'cancelled');
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
