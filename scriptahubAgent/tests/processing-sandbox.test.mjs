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

const R='/opt/scriptahub/runtime';
const view={snapshot:'/data/skill-runtime/rt-1',binds:[{source:R+'/skills/pdf2html/external/html/node_modules',destination:R+'/skills/pdf2html/external/html/node_modules'},
  {source:R+'/skills/pdf2html/external/native/integrity.json',destination:R+'/skills/pdf2html/external/native/integrity.json'}]};
test('sandbox binds only the service-generated task and never inherits an environment',()=>{
  const result=sandboxCommand({virtualCwd:'/workspace/run',taskId:'task-1',jobDirectory:'/private/job',skill:'pdf2html',args:['doctor'],input:'',view});
  assert.deepEqual(result.args.slice(result.args.indexOf('--bind'),result.args.indexOf('--bind')+3),['--bind','/private/job','/workspace/run/tasks/task-1']);
  assert.ok(result.args.includes('--clearenv'));
  assert.ok(result.args.includes('--unshare-all'));
  assert.ok(!result.args.includes('/Agent'));
  assert.ok(!result.args.includes('/data'));
  const audio=sandboxCommand({virtualCwd:'/workspace/run',taskId:'task-1',jobDirectory:'/private/job',skill:'theatrical-audio',args:['say','hello','--engine','piper'],input:'',view});
  assert.ok(audio.args.includes('/tmp/cache/speech'));
  assert.ok(audio.args.includes('/etc/libreoffice'));
});

test('sandbox binds the source snapshot and image dependency paths, never the baked runtime tree',()=>{
  // WORKSPACE_PATH is /workspace in a global-mode agent; the virtual cwd is RoboTeam's and unrelated.
  const {args}=sandboxCommand({virtualCwd:'/home/worker/run',taskId:'task-1',jobDirectory:'/data/processing/job-1/task',skill:'pdf2html',args:['doctor'],input:'',view});
  const at=args.indexOf(view.snapshot);
  assert.deepEqual(args.slice(at-1,at+2),['--ro-bind',view.snapshot,R]);
  assert.deepEqual(args.slice(at+2,at+8),['--ro-bind',view.binds[0].source,view.binds[0].destination,'--ro-bind',view.binds[1].source,view.binds[1].destination]);
  assert.ok(at<args.indexOf('/etc/fonts'),'runtime binds come before the /etc binds');
  const binds=[];for(let index=0;index<args.length;index++)if(['--ro-bind','--bind'].includes(args[index]))binds.push([args[index],args[index+1],args[index+2]]);
  for(const [,source,destination] of binds.filter(([,,destination])=>destination.startsWith(R+'/'))) {
    assert.equal(source,destination,'a dependency keeps its image path in the sandbox');assert.match(destination,/^\/opt\/scriptahub\/runtime\/skills\//);
  }
  assert.equal(binds.filter(([,source,destination])=>source===R&&destination===R).length,0,'the baked runtime tree is never bound');
  for(const forbidden of ['/code','/data','/workspace','/workspace/ScriptaHubAgent'])assert.ok(!args.includes(forbidden),forbidden);
  assert.ok(!binds.some(([,source])=>source.startsWith('/code')||source.startsWith('/workspace')));
  assert.deepEqual(args.slice(args.lastIndexOf('--')),['--','/usr/local/bin/node','/opt/scriptahub/runtime/run-skill.mjs','pdf2html','doctor']);
});

test('a missing or invalid runtime view refuses to build a sandbox',()=>{
  const base={virtualCwd:'/workspace/run',taskId:'task-1',jobDirectory:'/private/job',skill:'pdf2html',args:['doctor'],input:''};
  const refused=(value,options)=>assert.throws(()=>sandboxCommand({...base,view:value},options),error=>error.status===503&&error.message==='Processing runtime view is required',JSON.stringify(value));
  refused(undefined);refused(null);refused({binds:[]});refused({snapshot:'relative',binds:[]});refused({snapshot:'/data/rt',binds:'no'});
  refused({snapshot:R,binds:[]});refused({snapshot:R+'/skills',binds:[]});refused({snapshot:'/opt',binds:[]});refused({snapshot:'/data/rt/../x',binds:[]});
  const bind=(source,destination=source)=>({snapshot:'/data/rt',binds:[{source,destination}]});
  refused(bind('/code/skills/pdf2html/x'));refused(bind('/workspace/ScriptaHubAgent/skills/x'));
  refused(bind(R+'/skills/pdf2html/x',R+'/skills/pdf2html/y'));refused(bind(R+'/run-skill.mjs'));refused(bind(R+'/skills/../../etc/x'));
  refused(bind('/image/skills/a/b','/opt/scriptahub/runtime/skills/a/b'));
  refused(bind('/image/skills/a/b','/opt/scriptahub/runtime/skills/a/b'),{imageRoot:'/image/'});
  const custom=sandboxCommand({...base,view:bind('/image/skills/a/b','/opt/scriptahub/runtime/skills/a/b')},{imageRoot:'/image'});
  assert.ok(custom.args.join('\0').includes(['--ro-bind','/image/skills/a/b','/opt/scriptahub/runtime/skills/a/b'].join('\0')));
  assert.throws(()=>sandboxCommand({...base,args:['--help'],view}),{status:400},'command validation still runs first');
});
