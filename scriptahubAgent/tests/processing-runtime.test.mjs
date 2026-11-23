import test from 'node:test';
import assert from 'node:assert/strict';
import { processingRuntime } from '../processing-runtime.mjs';
import { skillSource } from '../deployment/skill-source.mjs';
import { runtimeFixture, roboTeamDigest, sha256, PLATFORM } from './runtime-fixture.mjs';

test('runtime digest is the sorted per-skill receipt algorithm over the mounted checkout, on this platform only',async t=>{
  const f=await runtimeFixture({files:{'skills/pdf2html/z.md':'z\n','skills/pdf2html/a.md':'a\n'}});t.after(f.remove);
  const result=await processingRuntime(f.options);
  const source=await skillSource(f.skillsRoot);
  const expected=sha256(JSON.stringify(Object.fromEntries(Object.entries(source).filter(([name])=>name.startsWith('pdf2html/')).sort(([a],[b])=>a<b?-1:a>b?1:0))));
  assert.equal(result.sourceDigests.pdf2html,expected);
  assert.equal(result.sourceDigests.pdf2html,await roboTeamDigest(f.skillsRoot,'pdf2html'),'the RoboTeam helper algorithm agrees');
  assert.deepEqual(Object.keys(result).sort(),['platform','runtimeId','sourceDigests','view']);assert.equal(result.platform,PLATFORM);
  assert.match(result.runtimeId,/^[a-f0-9]{64}$/);
  await f.writeReceipt({...f.receipt,platform:'wrong-arch'});
  await assert.rejects(processingRuntime(f.options),{status:503,message:'ScriptaHub processing runtime does not support this platform'});
  // The baked-tree signature is gone: a bare runtime root no longer describes a runtime.
  await assert.rejects(processingRuntime(f.runtimeRoot),{status:503,message:'ScriptaHub processing runtime is unavailable'});
});
