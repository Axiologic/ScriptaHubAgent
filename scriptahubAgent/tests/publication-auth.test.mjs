import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {PublicationAccessStore, readPublicationToken} from '../publication-access.mjs';
import {publicationAuthentication} from '../publication-auth.mjs';
const auth={user:{id:'admin-one',roles:['admin']}};
const identity={authorName:'Publisher',authorEmail:'publisher@example.test'};
async function fixture(t) {
  const dataDir=await fs.mkdtemp(path.join(os.tmpdir(),'scripta-auth-'));
  const store=new PublicationAccessStore(dataDir);t.after(async()=>{store.close();await fs.rm(dataDir,{recursive:true,force:true});});
  let config={schemaVersion:1,syncIntervalSeconds:60,repositories:[],publication:null}, time=100000;
  const requests=[], replies=[];
  const deps={store,load:async()=>config,save:async value=>{config=value;},now:()=>time,
    fetchImpl:async(url,options)=>{requests.push({url,options});const reply=replies.shift();if(reply instanceof Error)throw reply;return new Response(JSON.stringify(reply),{status:reply?.statusCode||200});}};
  return {dataDir,store,deps,requests,replies,advance:n=>{time+=n;},get config(){return {...config,publication:store.read().connection?.publication||null};}};
}
const profile={login:'publisher',name:'Publisher',email:'publisher@example.test'};
const device={device_code:'private-device-code',user_code:'ABCD-EFGH',verification_uri:'https://github.com/login/device',expires_in:900,interval:5};

test('status and mutation require an authenticated administrator; status never returns secrets',async t=>{
  const f=await fixture(t);
  for(const other of [{user:{id:'member',roles:['member']}},{agent:{principalId:'agent:test'}}]) await assert.rejects(publicationAuthentication(other,{action:'status'},f.deps),/Admin/);
  assert.deepEqual(await publicationAuthentication(auth,{action:'status'},f.deps),{connected:false,method:null,user:null,publication:null,pending:null});
  assert.equal(f.requests.length,0);
});
test('manual token is validated, encrypted locally and persists across store reopen without another agent',async t=>{
  const f=await fixture(t);f.replies.push(profile);
  const result=await publicationAuthentication(auth,{action:'token',token:'private-test-token',...identity},f.deps);
  assert.equal(result.authorized,true);assert.deepEqual(result.publication,identity);
  assert.equal(JSON.stringify(result).includes('private-test-token'),false);
  assert.equal(JSON.stringify(f.config).includes('private-test-token'),false);
  assert.equal(await readPublicationToken(f.config.publication,{dataDir:f.dataDir}),'private-test-token');
  await assert.rejects(readPublicationToken({...identity,authorName:'Stale'},{dataDir:f.dataDir}),/changed during publication/);
  const folder=path.join(f.dataDir,'private/publication');
  assert.equal((await fs.stat(folder)).mode&0o777,0o700);
  for(const name of ['key','access.sqlite']) assert.equal((await fs.stat(path.join(folder,name))).mode&0o777,0o600);
  assert.equal((await fs.readFile(path.join(folder,'access.sqlite'))).includes(Buffer.from('private-test-token')),false);
});
test('bad token and provider failure cannot replace working publication access',async t=>{
  const f=await fixture(t);f.replies.push(profile);await publicationAuthentication(auth,{action:'token',token:'working-token',...identity},f.deps);
  await assert.rejects(publicationAuthentication(auth,{action:'token',token:'bad\nheader',...identity},f.deps),/valid publication token/);
  f.replies.push({statusCode:401,secret:'never expose this'});
  await assert.rejects(publicationAuthentication(auth,{action:'token',token:'rejected-token',...identity},f.deps),/GitHub authentication failed/);
  assert.equal(f.store.read().connection.token,'working-token');
});
test('device flow binds private codes to the initiating administrator and respects polling and slow-down',async t=>{
  const f=await fixture(t);f.replies.push(device);
  const begin=await publicationAuthentication(auth,{action:'begin'},f.deps);
  assert.equal(begin.pending.userCode,device.user_code);assert.equal(JSON.stringify(begin).includes(device.device_code),false);
  const other={user:{id:'admin-two',roles:['admin']}};
  assert.equal((await publicationAuthentication(other,{action:'status'},f.deps)).pending,null);
  await assert.rejects(publicationAuthentication(other,{action:'poll'},f.deps),/administrator account/);
  await publicationAuthentication(auth,{action:'poll'},f.deps);assert.equal(f.requests.length,1);
  f.advance(5000);f.replies.push({error:'slow_down'});
  assert.equal((await publicationAuthentication(auth,{action:'poll'},f.deps)).pending.interval,10);
  f.advance(10000);f.replies.push({access_token:'oauth-test-token',expires_in:3600},profile);
  const result=await publicationAuthentication(auth,{action:'poll',...identity},f.deps);
  assert.equal(result.authorized,true);assert.equal(result.pending,null);
  assert.equal(f.store.read().connection.token,'oauth-test-token');
  f.advance(3600001);assert.equal((await publicationAuthentication(auth,{action:'status'},f.deps)).connected,false);
  await assert.rejects(readPublicationToken(f.config.publication,{dataDir:f.dataDir}),/expired/);
});
test('disconnect invalidates an in-flight authorization and clears only ScriptaHub access',async t=>{
  const f=await fixture(t);f.replies.push(device);await publicationAuthentication(auth,{action:'begin'},f.deps);f.advance(5000);
  let release;const waiting=new Promise(resolve=>{release=resolve;});
  const fetchImpl=async url=>{if(url.includes('access_token')){await waiting;return new Response(JSON.stringify({access_token:'stale-token'}));}return new Response(JSON.stringify(profile));};
  const polling=publicationAuthentication(auth,{action:'poll',...identity},{...f.deps,fetchImpl});
  await new Promise(resolve=>setImmediate(resolve));
  await publicationAuthentication(auth,{action:'disconnect'},f.deps);release();
  await assert.rejects(polling,/changed during/);
  assert.equal(f.store.read().connection,null);assert.equal(f.store.read().pending,null);assert.equal(f.config.publication,null);
});
test('a missing private Git identity blocks publication until saved; symlink storage is refused',async t=>{
  const f=await fixture(t);f.replies.push({...profile,email:''},[]);
  const result=await publicationAuthentication(auth,{action:'token',token:'identity-token'},f.deps);
  assert.equal(result.needsIdentity,true);assert.equal(result.publication,null);
  await assert.rejects(readPublicationToken(identity,{dataDir:f.dataDir}),/missing/);
  assert.equal((await publicationAuthentication(auth,{action:'connect',...identity},f.deps)).authorized,true);
  assert.equal(await readPublicationToken(identity,{dataDir:f.dataDir}),'identity-token');
  const other=await fs.mkdtemp(path.join(os.tmpdir(),'scripta-unsafe-'));t.after(()=>fs.rm(other,{recursive:true,force:true}));
  await fs.symlink(path.join(f.dataDir,'private'),path.join(other,'private'));
  assert.throws(()=>new PublicationAccessStore(other),/Unsafe/);
});


test('publication storage cannot be opened with a changed key and never substitutes an empty credential',async t=>{
  const f=await fixture(t);f.replies.push(profile);await publicationAuthentication(auth,{action:'token',token:'stored-token',...identity},f.deps);
  const keyFile=path.join(f.dataDir,'private/publication/key');
  const original=await fs.readFile(keyFile);await fs.writeFile(keyFile,Buffer.alloc(32,1));
  await assert.rejects(readPublicationToken(identity,{dataDir:f.dataDir}),/unreadable/);
  await fs.writeFile(keyFile,original);
  assert.equal(await readPublicationToken(identity,{dataDir:f.dataDir}),'stored-token');
});


test('concurrent processes initialize one private key and serialize access changes without lost updates',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'scripta-access-concurrent-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const moduleUrl=new URL('../publication-access.mjs',import.meta.url).href;
  const source=`import {PublicationAccessStore} from ${JSON.stringify(moduleUrl)}; const store=new PublicationAccessStore(process.argv[1]); store.update(state=>{state.generation++;}); store.close();`;
  await Promise.all(Array.from({length:4},()=>promisify(execFile)(process.execPath,['--input-type=module','-e',source,root])));
  const store=new PublicationAccessStore(root);
  try {assert.equal(store.read().generation,4);} finally {store.close();}
});
