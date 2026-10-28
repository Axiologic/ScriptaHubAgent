import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

const filename = new URL('../IDE-plugins/scriptahub-settings/scriptahub-settings.js',import.meta.url);
const source = (await fs.readFile(filename,'utf8')).replace(/^import[^\n]+\n/,'').replace('export class ScriptaHubSettings','class ScriptaHubSettings');
test('Repositories save sends only repository settings and preserves Publication fields',async()=>{
  const calls=[];
  const Controller=vm.runInNewContext(source+'\nScriptaHubSettings;',{callAgentTool:async(agent,tool,args)=>{calls.push({agent,tool,args});return {settings:{repositories:[],syncIntervalSeconds:60},bookCount:0};},ensureSuccess:()=>{},parseToolResult:value=>value});
  const controller=Object.create(Controller.prototype);
  let applied;
  Object.assign(controller,{element:{querySelector:()=>({querySelectorAll:()=>[]})},controls:{disabled:false},items:[],interval:{value:'60'},gitToken:{value:'unsaved-token'},apply:(settings,options)=>{applied=options;},message:()=>{}});
  await controller.saveSettings();
  assert.equal(calls.length,1);assert.equal(calls[0].tool,'scriptahub_config_set');
  assert.deepEqual(Object.keys(calls[0].args).sort(),['repositories','syncIntervalSeconds']);
  assert.equal(applied.publication,false);assert.equal(controller.gitToken.value,'unsaved-token');
});
test('Publication saves a token independently of repository validation',async()=>{
  const f=authFixture({method:'token',replies:[{connected:true,authorized:true,method:'token',pending:null,publication:{authorName:'Publisher',authorEmail:'publisher@example.test'}}]});
  f.controller.gitName.value='Publisher';f.controller.gitEmail.value='publisher@example.test';f.controller.gitToken.value='private-test-token';
  await f.controller.savePublication();
  assert.equal(f.calls.length,1);assert.equal(f.calls[0].tool,'scriptahub_publication_auth');assert.equal(f.calls[0].args.action,'token');
  assert.equal(f.controller.gitToken.value,'');
});
test('Publication saves edited identity, skips unchanged fields and queues edits during authentication',async()=>{
  const f=authFixture({replies:[{connected:true,authorized:true,method:'github',pending:null,publication:{authorName:'New author',authorEmail:'publisher@example.test'}}]});
  Object.assign(f.controller,{gitConnected:true,savedGitName:'Old author',savedGitEmail:'publisher@example.test'});
  f.controller.gitName.value='New author';f.controller.gitEmail.value='publisher@example.test';
  f.controller.authBusy=true;await f.controller.savePublication();assert.equal(f.controller.publicationSavePending,true);assert.equal(f.calls.length,0);
  f.controller.authBusy=false;f.controller.publicationSavePending=false;
  await f.controller.savePublication();await f.controller.savePublication();
  assert.equal(f.calls.length,1);assert.equal(f.calls[0].args.action,'connect');
});
test('failed automatic token validation retains the draft and existing connection without saving repositories',async()=>{
  const f=authFixture({method:'token',replies:[new Error('Git authentication failed.')]});
  f.controller.gitConnected=true;f.controller.gitToken.value='invalid-test-token';
  await f.controller.savePublication();
  assert.equal(f.controller.gitConnected,true);assert.equal(f.controller.gitToken.value,'invalid-test-token');
  assert.equal(f.controller.gitToken.readOnly,false);assert.equal(f.calls.length,1);
  assert.equal(f.calls[0].tool,'scriptahub_publication_auth');
});

test('token authentication goes only to ScriptaHub and clears the browser field after success',async()=>{
  const calls=[];
  const Controller=vm.runInNewContext(source+'\nScriptaHubSettings;',{URL,setTimeout,clearTimeout,clearInterval,
    callAgentTool:async(agent,tool,args)=>{
      calls.push({agent,tool,args});
      return {authorized:true,connected:true,method:'token',pending:null,user:{login:'publisher'},publication:{authorName:'Publisher',authorEmail:'publisher@example.test'}};
    },ensureSuccess:()=>{},parseToolResult:value=>value});
  const nodes=new Map();const element={querySelector:selector=>{if(!nodes.has(selector))nodes.set(selector,{dataset:{},setAttribute(){}});return nodes.get(selector);}};
  const controller=Object.create(Controller.prototype);
  Object.assign(controller,{element,controls:{disabled:false},gitName:{value:'Publisher'},gitEmail:{value:'publisher@example.test'},gitToken:{value:'private-test-token'},publicationStatus:{dataset:{}},githubStatus:{},message:()=>{},methodChosen:true});
  const result=await controller.authenticate('token');
  assert.equal(result.authorized,true);
  assert.equal(controller.publicationStatus.dataset.state,'configured');
  assert.equal(calls.length,1);assert.equal(calls[0].agent,'scriptahubAgent');assert.equal(calls[0].tool,'scriptahub_publication_auth');
  assert.equal(calls[0].args.token,'private-test-token');assert.equal(calls[0].args.action,'token');
  assert.equal(controller.gitToken.value,'');
});

function authFixture({method='github', replies=[]}={}) {
  const calls=[],timers=new Map(),nodes=new Map(),opened=[],copied=[];
  const radios=['github','token'].map(value=>({value,checked:value===method}));
  const element={isConnected:true,querySelectorAll:()=>radios,querySelector:selector=>{
    if(selector==='[name=scriptaGitMethod]:checked')return radios.find(radio=>radio.checked);
    if(!nodes.has(selector))nodes.set(selector,{dataset:{},hidden:false,setAttribute(){}});
    return nodes.get(selector);
  }};
  let timerId=0;
  const Controller=vm.runInNewContext(source+'\nScriptaHubSettings;',{URL,
    setTimeout:callback=>{timers.set(++timerId,callback);return timerId;},clearTimeout:id=>timers.delete(id),
    setInterval:callback=>{timers.set(++timerId,callback);return timerId;},clearInterval:id=>timers.delete(id),
    navigator:{clipboard:{writeText:async code=>{copied.push(code);}}},window:{open:(url,target)=>{opened.push({url,target});return {closed:false,opener:{}};}},
    callAgentTool:async(agent,tool,args)=>{calls.push({agent,tool,args});const reply=replies.shift();if(reply instanceof Error)throw reply;return reply;},
    ensureSuccess:()=>{},parseToolResult:value=>value});
  const controller=Object.create(Controller.prototype);
  Object.assign(controller,{element,methodChosen:true,controls:{disabled:false},gitName:{value:'',checkValidity:()=>true},gitEmail:{value:'',checkValidity:()=>true},gitToken:{value:''},publicationStatus:{dataset:{}},githubStatus:{},message:()=>{}});
  return {controller,calls,timers,nodes,radios,opened,copied};
}
const disconnected={connected:false,method:null,publication:null,pending:null};
const pending={...disconnected,pending:{userCode:'TEST-CODE',verificationUri:'https://github.com/login/device',interval:5}};
test('selecting GitHub prepares the code automatically, resumes pending authorization and never calls GitAgent',async()=>{
  const f=authFixture({replies:[disconnected,pending]});
  await f.controller.ensureGithubAuthorization();
  assert.deepEqual(f.calls.map(call=>call.args.action),['status','begin']);
  assert.ok(f.calls.every(call=>call.agent==='scriptahubAgent'));
  assert.equal(f.nodes.get('#scriptaGithubCode').textContent,'TEST-CODE');
  assert.equal(f.nodes.get('#scriptaGithubPending').hidden,false);
  assert.equal(f.timers.size,1);
  await f.controller.ensureGithubAuthorization();assert.equal(f.calls.length,2);
  f.controller.setAuthMethod('token');
  assert.equal(f.timers.size,0);assert.equal(f.nodes.get('#scriptaGithubPanel').hidden,true);
  assert.equal(f.nodes.get('#scriptaTokenPanel').hidden,false);
});
test('saved connection restores its method and shows the stored-token notice without returning the credential',async()=>{
  const f=authFixture({method:'token',replies:[{connected:true,method:'github',user:{login:'publisher'},publication:{authorName:'Publisher',authorEmail:'publisher@example.test'},pending:null}]});
  f.controller.methodChosen=false;await f.controller.loadPublicationAuth();
  assert.equal(f.controller.selectedAuthMethod(),'github');assert.equal(f.calls.length,1);
  assert.equal(f.nodes.get('#scriptaGithubDisconnect').hidden,false);
  assert.equal(f.nodes.get('#scriptaTokenStoredNotice').hidden,false);
  assert.equal(f.controller.gitToken.value,'');
});
test('copy-and-open uses the displayed code and fixed GitHub destination; closing removes timers and token drafts',async()=>{
  const f=authFixture({replies:[pending]});await f.controller.authenticate('begin');
  await f.controller.continueGithubAuth();
  assert.deepEqual(f.copied,['TEST-CODE']);assert.deepEqual(f.opened,[{url:'https://github.com/login/device',target:'_blank'}]);
  f.controller.gitToken.value='unsaved-token-draft';f.controller.afterUnload();
  assert.equal(f.timers.size,0);assert.equal(f.controller.gitToken.value,'');
});
test('authorization errors clear pending code presentation and release loading state',async()=>{
  const f=authFixture({replies:[pending,new Error('GitHub authorization was denied or expired. Start again.')]});
  await f.controller.authenticate('begin');await f.controller.authenticate('poll');
  assert.equal(f.controller.authPending,false);assert.equal(f.nodes.get('#scriptaGithubPending').hidden,true);
  assert.equal(f.controller.authBusy,false);assert.equal(f.timers.size,0);
});
