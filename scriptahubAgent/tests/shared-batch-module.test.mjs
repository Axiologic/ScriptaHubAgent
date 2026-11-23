import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {processingRuntime} from '../processing-runtime.mjs';
import {runtimeFixture,roboTeamDigest} from './runtime-fixture.mjs';
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
  const descriptor=JSON.stringify({sourceDependencies:['scriptahub-tasks/shared']});
  const f=await runtimeFixture({skills:['short-description','pdf2html'],files:{'skills/short-description/SKILL.md':'short\n','skills/short-description/skill.json':descriptor}});
  t.after(f.remove);
  const shared=path.join(f.skillsRoot,'scriptahub-tasks/shared/batch-io.mjs'),bytes=name=>fs.readFile(path.join(f.skillsRoot,name));
  const first=await processingRuntime(f.options);
  assert.equal(first.sourceDigests['short-description'],hash(JSON.stringify({'scriptahub-tasks/shared/batch-io.mjs':hash(await fs.readFile(shared)),
    'short-description/SKILL.md':hash(await bytes('short-description/SKILL.md')),'short-description/skill.json':hash(await bytes('short-description/skill.json'))})));
  assert.equal(first.sourceDigests['short-description'],await roboTeamDigest(f.skillsRoot,'short-description'));
  await fs.writeFile(shared,'export const batch=2;\n');
  const second=await processingRuntime(f.options);
  assert.notEqual(second.sourceDigests['short-description'],first.sourceDigests['short-description']);
  assert.equal(second.sourceDigests.pdf2html,first.sourceDigests.pdf2html);
  await fs.rm(shared);
  await assert.rejects(processingRuntime(f.options),/Missing shared skill source/);
  await fs.writeFile(shared,'export const batch=2;\n');
  await fs.writeFile(path.join(f.skillsRoot,'short-description/skill.json'),JSON.stringify({sourceDependencies:['../outside']}));
  await assert.rejects(processingRuntime(f.options),/Invalid skill source dependencies/);
});

test('image dependency discovery accepts callable skills without optional descriptors',async()=>{
  const {skillDependencies}=await import('../deployment/skill-source.mjs');
  const config=JSON.parse(await fs.readFile(path.join(root,'scriptahubAgent/deployment/skills-runtime.json')));
  const dependencies=await skillDependencies(path.join(root,'skills'),config.skills,{'scriptahub-tasks/shared/batch-io.mjs':'a'.repeat(64)});
  assert.deepEqual(Object.keys(dependencies).sort(),[...skills].sort());
  assert.equal(Object.hasOwn(dependencies,'shf-presentation-creator'),false);
});

test('optional descriptor handling still rejects malformed JSON and missing or invalid dependencies',async t=>{
  const {skillDependencies}=await import('../deployment/skill-source.mjs');
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'skill-dependencies-'));
  t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  await fs.mkdir(path.join(directory,'sample'));const metadata=path.join(directory,'sample/skill.json');
  await fs.writeFile(metadata,'{bad JSON');
  await assert.rejects(skillDependencies(directory,['sample'],{}),SyntaxError);
  await fs.writeFile(metadata,JSON.stringify({sourceDependencies:['../outside']}));
  await assert.rejects(skillDependencies(directory,['sample'],{}),/Invalid skill source dependencies/);
  await fs.writeFile(metadata,JSON.stringify({sourceDependencies:['scriptahub-tasks/shared']}));
  await assert.rejects(skillDependencies(directory,['sample'],{}),/Missing shared batch module/);
  await fs.unlink(metadata);await fs.mkdir(metadata);
  await assert.rejects(skillDependencies(directory,['sample'],{}),{code:'EISDIR'});
});
