import test from 'node:test';
import assert from 'node:assert/strict';
import { sandboxCommand, validateSkillCommand, validateVirtualCwd } from '../processing-sandbox.mjs';

test('sandbox rejects system overlaps and dangerous command overrides',()=>{
  for (const cwd of ['/','/usr/x','/tmp','/a/../b','/opt/scriptahub']) assert.throws(()=>validateVirtualCwd(cwd));
  assert.equal(validateVirtualCwd('/workspace/run'),'/workspace/run');
  assert.equal(validateVirtualCwd('/home/worker/run'),'/home/worker/run');
  for (const [skill,args] of [['doc2pdf',['install-deps']],['scriptahub-tasks',['exec']],['validate-book',['doctor','--chromium=/tmp/x']],['theatrical-audio',['say','--engine','openai']],['theatrical-audio',['say','--python=x']]]) assert.throws(()=>validateSkillCommand(skill,args,''));
  validateSkillCommand('theatrical-audio',['say','hello','--engine','piper'],'');
  validateSkillCommand('pdf2html',['decorations','tasks/id/source.pdf'],'');
  validateSkillCommand('pdf2html',['fonts','tasks/id/source.pdf','tasks/id/fonts'],'');
});

test('sandbox binds only the service-generated task and never inherits an environment',()=>{
  const result=sandboxCommand({virtualCwd:'/workspace/run',taskId:'task-1',jobDirectory:'/private/job',skill:'pdf2html',args:['doctor'],input:''});
  assert.deepEqual(result.args.slice(result.args.indexOf('--bind'),result.args.indexOf('--bind')+3),['--bind','/private/job','/workspace/run/tasks/task-1']);
  assert.ok(result.args.includes('--clearenv'));
  assert.ok(result.args.includes('--unshare-all'));
  assert.ok(!result.args.includes('/Agent'));
  assert.ok(!result.args.includes('/data'));
  const audio=sandboxCommand({virtualCwd:'/workspace/run',taskId:'task-1',jobDirectory:'/private/job',skill:'theatrical-audio',args:['say','hello','--engine','piper'],input:''});
  assert.ok(audio.args.includes('/tmp/cache/speech'));
  assert.ok(audio.args.includes('/etc/libreoffice'));
});
