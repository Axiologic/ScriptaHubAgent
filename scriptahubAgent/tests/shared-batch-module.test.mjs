import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {processingRuntime} from '../processing-runtime.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url));
const skills=['comprehensive-summary','marketing-summary','short-description','relevant-keywords','translate-html'];
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
test('batch IO is one shared module and every dependent skill declares and imports it',async()=>{
  await fs.access(path.join(root,'skills/scriptahub-tasks/shared/batch-io.mjs'));
  for(const skill of skills) {
    await assert.rejects(fs.stat(path.join(root,'skills',skill,'src/batch-io.mjs')),{code:'ENOENT'});
    const descriptor=JSON.parse(await fs.readFile(path.join(root,'skills',skill,'skill.json'),'utf8'));
    assert.equal(descriptor.selfContained,false);
    assert.ok(descriptor.dependsOn.includes('scriptahub-tasks'));
    assert.deepEqual(descriptor.sourceDependencies,['scriptahub-tasks/shared']);
    assert.match(await fs.readFile(path.join(root,'skills',skill,'src/batch-schema.mjs'),'utf8'),/\.\.\/\.\.\/scriptahub-tasks\/shared\/batch-io\.mjs/);
  }
});
test('each dependent runtime digest includes shared bytes and unrelated source stays independent',async t=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'batch-runtime-'));
  t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  const source={'short-description/SKILL.md':'a'.repeat(64),'scriptahub-tasks/shared/batch-io.mjs':'b'.repeat(64),'pdf2html/SKILL.md':'c'.repeat(64)};
  const installed={platform:`${process.platform}-${process.arch}`,skills:['short-description','pdf2html'],sourceDependencies:{'short-description':['scriptahub-tasks/shared']}};
  await fs.writeFile(path.join(directory,'installed.json'),JSON.stringify(installed));
  const update=()=>fs.writeFile(path.join(directory,'source.json'),JSON.stringify(source));await update();
  const first=await processingRuntime(directory);
  assert.equal(first.sourceDigests['short-description'],hash(JSON.stringify({'scriptahub-tasks/shared/batch-io.mjs':'b'.repeat(64),'short-description/SKILL.md':'a'.repeat(64)})));
  source['scriptahub-tasks/shared/batch-io.mjs']='d'.repeat(64);await update();
  const second=await processingRuntime(directory);
  assert.notEqual(second.sourceDigests['short-description'],first.sourceDigests['short-description']);
  assert.equal(second.sourceDigests.pdf2html,first.sourceDigests.pdf2html);
  delete source['scriptahub-tasks/shared/batch-io.mjs'];await update();
  await assert.rejects(processingRuntime(directory),/Missing shared skill source/);
  installed.sourceDependencies['short-description']=['../outside'];await fs.writeFile(path.join(directory,'installed.json'),JSON.stringify(installed));
  await assert.rejects(processingRuntime(directory),/Invalid skill source dependencies/);
});
