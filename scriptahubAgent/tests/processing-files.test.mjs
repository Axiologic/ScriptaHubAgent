import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parseProcessingManifest, processingPath, uploadProcessingChunk, verifyProcessingFile, decodeProcessingChunk } from '../processing-files.mjs';
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const manifest = entries => { const bytes=Buffer.from(JSON.stringify(entries)); return parseProcessingManifest(bytes,hash(bytes),bytes.length); };

test('manifest supports Unicode and empty files while rejecting traversal, overlap and limits',()=>{
  const entry={path:'cărți/empty',size:0,sha256:hash('')};
  assert.equal(manifest([entry]).total,0);
  for (const name of ['../x','a/../b','/x','a//b','.git/config','a/.env.secret']) assert.throws(()=>processingPath(name));
  assert.throws(()=>manifest([entry,entry]));
  assert.throws(()=>manifest([{...entry,path:'a'},{...entry,path:'a/b'}]));
  assert.throws(()=>manifest([{...entry,size:512*1024*1024+1}]));
  assert.throws(()=>decodeProcessingChunk('YR=='));
});

test('chunks are contiguous and idempotent; links and tampering are rejected',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'processing-files-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const data=Buffer.from('test'); const encoded=data.toString('base64');
  assert.equal(uploadProcessingChunk(root,'ü/file',4,0,encoded),4);
  assert.equal(uploadProcessingChunk(root,'ü/file',4,0,encoded),4);
  assert.throws(()=>uploadProcessingChunk(root,'ü/file',4,0,Buffer.from('FAIL').toString('base64')),{status:409});
  assert.throws(()=>uploadProcessingChunk(root,'new',4,1,encoded));
  verifyProcessingFile(root,{path:'ü/file',size:4,sha256:hash(data)});
  await fs.link(path.join(root,'ü/file'),path.join(root,'hardlink'));
  assert.throws(()=>verifyProcessingFile(root,{path:'ü/file',size:4,sha256:hash(data)}));
  await fs.symlink(path.join(root,'ü/file'),path.join(root,'symlink'));
  assert.throws(()=>uploadProcessingChunk(root,'symlink',4,0,encoded));
});
