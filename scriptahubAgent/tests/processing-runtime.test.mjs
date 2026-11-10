import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { processingRuntime } from '../processing-runtime.mjs';

test('runtime fingerprint uses original sorted per-skill receipt and platform',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'processing-runtime-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const source={'pdf2html/z':'b'.repeat(64),'pdf2html/a':'a'.repeat(64)};
  await fs.writeFile(path.join(root,'source.json'),JSON.stringify(source));
  await fs.writeFile(path.join(root,'installed.json'),JSON.stringify({platform:`${process.platform}-${process.arch}`,skills:['pdf2html']}));
  const result=await processingRuntime(root);
  const expected=crypto.createHash('sha256').update(JSON.stringify({'pdf2html/a':'a'.repeat(64),'pdf2html/z':'b'.repeat(64)})).digest('hex');
  assert.equal(result.sourceDigests.pdf2html,expected);
  await fs.writeFile(path.join(root,'installed.json'),JSON.stringify({platform:'wrong',skills:['pdf2html']}));
  await assert.rejects(processingRuntime(root),{status:503});
});
