import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {ProcessingInputCache,inputCacheBytes} from '../processing-input-cache.mjs';
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
async function fixture(t) {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'processing-cache-')),db=new DatabaseSync(':memory:');
  db.exec("CREATE TABLE tasks(id TEXT PRIMARY KEY,state TEXT);CREATE TABLE task_executions(id TEXT PRIMARY KEY,task_id TEXT);INSERT INTO tasks VALUES('task','running'),('other','running');INSERT INTO task_executions VALUES('execution','task'),('other','other')");
  const source=path.join(root,'source');await fs.mkdir(source);
  t.after(async()=>{db.close();await fs.rm(root,{recursive:true,force:true});});
  const entry=async(name,bytes)=>{await fs.writeFile(path.join(source,name),bytes);return {path:name,size:Buffer.byteLength(bytes),sha256:hash(bytes)};};
  return {root,db,source,entry,cache:new ProcessingInputCache(root,db)};
}
test('cache restores verified copies only within the same executor and execution',async t=>{
  const f=await fixture(t),entry=await f.entry('book.html','private book');
  f.cache.retain('agent:a','execution',f.source,[entry],1000);
  const output=path.join(f.root,'output');await fs.mkdir(output);
  assert.equal(f.cache.restore('agent:b','execution',output,entry),false);
  assert.equal(f.cache.restore('agent:a','other',output,entry),false);
  assert.equal(f.cache.restore('agent:a','execution',output,entry),true);
  const cachePath=path.join(f.cache.root,f.cache.name({executor:'agent:a',execution_id:'execution',sha256:entry.sha256}));
  assert.notEqual((await fs.stat(cachePath)).ino,(await fs.stat(path.join(output,entry.path))).ino);
  await fs.writeFile(path.join(output,entry.path),'worker changes');
  assert.equal(await fs.readFile(cachePath,'utf8'),'private book');
});
test('cache verifies bytes on restart and on reuse, falling back on corrupted or missing blobs',async t=>{
  const f=await fixture(t),entry=await f.entry('book.html','original');
  f.cache.retain('agent:a','execution',f.source,[entry],1000);
  const row=f.cache.rows()[0],file=path.join(f.cache.root,f.cache.name(row));
  await fs.writeFile(file,'tampered');
  const output=path.join(f.root,'output');await fs.mkdir(output);
  assert.equal(f.cache.restore('agent:a','execution',output,entry),false);
  assert.equal(inputCacheBytes(f.db),0);
  f.cache.retain('agent:a','execution',f.source,[entry],1000);
  await fs.unlink(file);
  assert.doesNotThrow(()=>new ProcessingInputCache(f.root,f.db));
  assert.equal(inputCacheBytes(f.db),0);
});
test('cache evicts old copies within its byte budget and drops completed execution data',async t=>{
  const f=await fixture(t),one=await f.entry('one','aaaa'),two=await f.entry('two','bbbb');
  f.cache.retain('agent:a','execution',f.source,[one,two],6);
  assert.equal(inputCacheBytes(f.db),4);
  const output=path.join(f.root,'output');await fs.mkdir(output);
  assert.equal(f.cache.restore('agent:a','execution',output,one),false);
  assert.equal(f.cache.restore('agent:a','execution',output,two),true);
  f.db.prepare("UPDATE tasks SET state='completed' WHERE id='task'").run();f.cache.prune();
  assert.equal(inputCacheBytes(f.db),0);assert.deepEqual(await fs.readdir(f.cache.root),[]);
});
test('cache cannot follow a symlinked destination parent or a replaced cache root',async t=>{
  const f=await fixture(t),entry=await f.entry('book','original');
  f.cache.retain('agent:a','execution',f.source,[entry],1000);
  const output=path.join(f.root,'output'),outside=path.join(f.root,'outside');await fs.mkdir(output);await fs.mkdir(outside);
  await fs.symlink(outside,path.join(output,'nested'));
  assert.throws(()=>f.cache.restore('agent:a','execution',output,{...entry,path:'nested/book'}),/Invalid processing directory/);
  assert.deepEqual(await fs.readdir(outside),[]);
  await fs.rename(f.cache.root,f.cache.root+'-old');await fs.symlink(outside,f.cache.root);
  assert.throws(()=>f.cache.restore('agent:a','execution',output,entry),/cache changed/);
});
