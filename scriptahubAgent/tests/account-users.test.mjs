import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createSiteServer} from '../server.mjs';
import {savePointsPolicy} from '../points-policy.mjs';

test('user administration is admin-only, paginated and independent of personal points',async t=>{
  const dataDir=await fs.mkdtemp(path.join(os.tmpdir(),'scripta-users-'));
  const calls=[];
  const verifyUser=async req=>{
    const name=req.headers['x-test-user'];if(!name)return null;
    return {id:'user:'+name,email:name+'@example.test',roles:name==='admin'?['admin']:['user'],userAgentCall:async(tool,args)=>{
      calls.push({actor:name,tool,args});
      if(tool==='userpersisto_user_list')return {users:[{id:'reader',email:'reader@example.test',displayName:'Reader',roles:['user']}],totalCount:40};
      if(tool==='userpersisto_credits_balance')return {balance:args.userId==='admin'?100:20,reservedBalance:0};
      if(tool==='userpersisto_credits_ledger')return {entries:[],totalCount:0};
      if(tool==='userpersisto_credits_grant')return {ok:true};
      throw Error('Unexpected tool '+tool);
    }};
  };
  const server=createSiteServer(dataDir,{dataDir,verifyUser});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));await fs.rm(dataDir,{recursive:true,force:true});});
  const base=`http://127.0.0.1:${server.address().port}`;
  const get=(actor,url)=>fetch(base+url,{headers:{'x-test-user':actor}});
  assert.equal((await (await get('admin','/api/session')).json()).canManageUsers,true);
  assert.equal((await (await get('reader','/api/session')).json()).canManageUsers,false);
  assert.equal((await (await get('admin','/api/dashboard')).json()).canManageUsers,true);
  const dashboard = await (await get('reader','/api/dashboard')).json();
  assert.equal(dashboard.canManageUsers,false);
  assert.equal(dashboard.isBetaVersion,true);
  assert.equal((await get('reader','/api/dashboard/points/users')).status,403);
  assert.equal(calls.some(call=>call.tool==='userpersisto_user_list'),false);
  const users=await get('admin','/api/dashboard/points/users?search=Reader&start=25');assert.equal(users.status,200);
  assert.equal((await users.json()).users[0].displayName,'Reader');
  assert.deepEqual(calls.at(-1).args,{search:'Reader',start:25,pageSize:25});
  assert.equal((await get('admin','/api/dashboard/points/users?start=-1')).status,400);
  assert.equal((await (await get('admin','/api/dashboard/points')).json()).balance.balance,100);
  assert.equal((await (await get('admin','/api/dashboard/points?userId=reader')).json()).balance.balance,20);
  assert.equal((await (await get('admin','/api/dashboard/points')).json()).balance.balance,100);
  const grant={userId:'reader',amount:10,reason:'Contribution',requestId:'19e1a966-a182-44c4-a12e-78cdc402c72a'};
  const send=actor=>fetch(base+'/api/dashboard/points/grant',{method:'POST',headers:{'x-test-user':actor,'content-type':'application/json'},body:JSON.stringify(grant)});
  assert.equal((await send('reader')).status,403);
  assert.equal((await send('admin')).status,200);
  assert.deepEqual(calls.at(-1).args,{userId:'reader',amount:10,reason:'Contribution',referenceId:'scriptahub:admin:'+grant.requestId});
  const policyUrl='/api/dashboard/points/policy';
  assert.equal((await get('reader',policyUrl)).status,403);
  const policy=(await (await get('admin',policyUrl)).json()).points;
  assert.deepEqual(policy,{initialCredits:0,bookReward:10,correctionReward:2,editionCost:5,forkCost:8,promptBookCost:8,rewardValidityDays:180,firstNoticeDays:30,lastNoticeDays:7});
  const savePolicy=(actor,points)=>fetch(base+policyUrl,{method:'POST',headers:{'x-test-user':actor,'content-type':'application/json'},body:JSON.stringify(points)});
  assert.equal((await savePolicy('reader',policy)).status,403);
  const updated={...policy,bookReward:20,correctionReward:5,editionCost:10,forkCost:15,promptBookCost:20,rewardValidityDays:90,firstNoticeDays:14,lastNoticeDays:3};
  assert.equal((await savePolicy('admin',updated)).status,200);
  assert.deepEqual((await (await get('admin',policyUrl)).json()).points,updated);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(dataDir,'points.json'),'utf8')),updated);
  assert.equal((await savePolicy('admin',{...updated,lastNoticeDays:30})).status,400);
  assert.equal((await savePolicy('admin',{...updated,bookReward:-1})).status,400);
  assert.deepEqual((await (await get('admin',policyUrl)).json()).points,updated);

  const disabled={initialCredits:0,bookReward:0,correctionReward:0,editionCost:0,forkCost:0,promptBookCost:0,rewardValidityDays:0,firstNoticeDays:0,lastNoticeDays:0};
  assert.equal((await savePolicy('admin',disabled)).status,200);
  assert.deepEqual((await (await get('admin',policyUrl)).json()).points,disabled,'saved zero values override defaults');
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(dataDir,'points.json'),'utf8')),disabled);

  const count = calls.length;
  const json = { method: 'POST', headers: {'x-test-user': 'admin', 'content-type': 'application/json'}, body: '{}' };
  const billing = '/api/dashboard/points/';
  assert.equal((await get('reader',billing+'offer')).status,404);
  assert.equal((await get('admin',billing+'offer-settings')).status,404);
  assert.equal((await fetch(base+billing+'offer-settings',json)).status,404);
  assert.equal((await fetch(base+billing+'checkout-status',json)).status,404);
  assert.equal((await fetch(base+'/base-agent-additional-server/scriptahubAgent/3002'+billing+'checkout',json)).status,404);
  assert.equal(calls.length,count,'disabled payment routes never contact UserPersisto');
});

test('outside beta the original pricing, checkout and reconciliation are available',async t=>{
  const dataDir=await fs.mkdtemp(path.join(os.tmpdir(),'scripta-purchases-'));
  const calls=[];
  const verifyUser=async req=>{
    const name=req.headers['x-test-user'];if(!name)return null;
    return {id:'user:'+name,email:name+'@example.test',roles:name==='admin'?['admin']:['user'],userAgentCall:async(tool,args)=>{
      calls.push({actor:name,tool,args});
      if(tool==='userpersisto_billing_credits_offer')return {available:true,unitAmountMinor:500,currency:'eur'};
      if(tool==='userpersisto_billing_credit_price_get')return {unitAmountMinor:500,currency:'eur'};
      if(tool==='userpersisto_billing_credit_price_set')return args;
      if(tool==='userpersisto_billing_checkout_create')return {sessionId:'cs_test_checkout'};
      if(tool==='userpersisto_billing_checkout_verify')return {status:'paid',credited:true,credits:137};
      throw Error('Unexpected tool '+tool);
    }};
  };
  const server=createSiteServer(dataDir,{dataDir,verifyUser,isBetaVersion:false});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));await fs.rm(dataDir,{recursive:true,force:true});});
  const base='http://127.0.0.1:'+server.address().port;
  const get=(actor,url)=>fetch(base+url,{headers:{'x-test-user':actor}});
  assert.equal((await (await get('reader','/api/dashboard')).json()).isBetaVersion,false);
  assert.equal((await (await get('reader','/api/dashboard/points/offer')).json()).available,true);
  assert.equal((await get('reader','/api/dashboard/points/offer-settings')).status,403);
  const pricing=await get('admin','/api/dashboard/points/offer-settings');assert.equal(pricing.status,200);
  assert.deepEqual(await pricing.json(),{unitAmountMinor:500,currency:'eur'});
  const save=(actor,payload)=>fetch(base+'/api/dashboard/points/offer-settings',{method:'POST',headers:{'x-test-user':actor,'content-type':'application/json'},body:JSON.stringify(payload)});
  const price={unitAmountMinor:999,currency:'RON'};
  assert.equal((await save('reader',price)).status,403);
  assert.equal((await save('admin',price)).status,200);
  assert.deepEqual(calls.at(-1),{actor:'admin',tool:'userpersisto_billing_credit_price_set',args:{...price,currency:'ron'}});
  const count=calls.length;
  for(const invalid of [{...price,unitAmountMinor:0},{...price,unitAmountMinor:1.5},{...price,creditsPerUnit:-1},{...price,STRIPE_SECRET_KEY:'injected'}]){
    assert.equal((await save('admin',invalid)).status,400);
  }
  assert.equal(calls.length,count,'invalid or unrelated settings never reach UserPersisto');
  const checkoutBody={requestId:'9fdfd120-b243-4559-bc4d-41891967f0f6',quantity:137,returnUrl:base+'/account/dashboard.html?tab=points&lang=ro'};
  const checkout=payload=>fetch(base+'/api/dashboard/points/checkout',{method:'POST',headers:{'x-test-user':'reader','content-type':'application/json'},body:JSON.stringify(payload)});
  assert.equal((await checkout(checkoutBody)).status,200);
  assert.deepEqual(calls.at(-1).args,{kind:'credits',uiMode:'elements',quantity:137,idempotencyKey:checkoutBody.requestId,returnUrl:checkoutBody.returnUrl});
  const checkoutCalls=calls.length;
  for (const quantity of [0,-1,1.5,Number.MAX_SAFE_INTEGER+1]) assert.equal((await checkout({...checkoutBody,quantity})).status,400);
  for(const returnUrl of [base+'/other.html?tab=points',base+'/account/dashboard.html?tab=admin',base+'/account/dashboard.html?tab=points&extra=1']){
    assert.equal((await checkout({...checkoutBody,returnUrl})).status,400);
  }
  assert.equal(calls.length,checkoutCalls);
  const mount='/base-agent-additional-server/scriptahubAgent/3002';
  const mountedBody={...checkoutBody,returnUrl:base+mount+'/account/dashboard.html?tab=points&lang=ro'};
  for(const [endpoint,extraHeaders] of [[mount+'/api/dashboard/points/checkout',{}],['/api/dashboard/points/checkout',{'x-forwarded-prefix':mount}]]) {
    const response=await fetch(base+endpoint,{method:'POST',headers:{'x-test-user':'reader','content-type':'application/json',...extraHeaders},body:JSON.stringify(mountedBody)});
    assert.equal(response.status,200,await response.text());
    assert.deepEqual(calls.at(-1).args,{kind:'credits',uiMode:'elements',quantity:137,idempotencyKey:checkoutBody.requestId,returnUrl:mountedBody.returnUrl});
  }
  const mountedCalls=calls.length;
  for(const returnUrl of [base+'/account/dashboard.html?tab=points',base+'/base-agent-additional-server/anotherAgent/3002/account/dashboard.html?tab=points']) {
    const response=await fetch(base+'/api/dashboard/points/checkout',{method:'POST',headers:{'x-test-user':'reader','content-type':'application/json','x-forwarded-prefix':mount},body:JSON.stringify({...checkoutBody,returnUrl})});
    assert.equal(response.status,400);
  }
  assert.equal(calls.length,mountedCalls,'invalid mounted return pages never reach billing');
  const verifyPayment=payload=>fetch(base+'/api/dashboard/points/checkout-status',{method:'POST',headers:{'x-test-user':'reader','content-type':'application/json'},body:JSON.stringify(payload)});
  const verified=await verifyPayment({sessionId:'cs_test_checkout'});assert.equal(verified.status,200);
  assert.deepEqual(calls.at(-1),{actor:'reader',tool:'userpersisto_billing_checkout_verify',args:{sessionId:'cs_test_checkout'}});
  const verifyCalls=calls.length;
  for(const payload of [{sessionId:'bad'}, {sessionId:'cs_test_checkout',paid:true}, {sessionId:'cs_test_checkout',userId:'admin'}, {sessionId:'cs_test_checkout',credits:999}])assert.equal((await verifyPayment(payload)).status,400);
  assert.equal(calls.length,verifyCalls);
  const manifest=JSON.parse(await fs.readFile(new URL('../manifest.json',import.meta.url),'utf8'));
  const tools=manifest.routerAccess.httpRoutes.find(route=>route.path.endsWith('/api/*')).delegations[0].tools;
  assert.ok(tools.includes('userpersisto_billing_credit_price_get'));
  assert.ok(tools.includes('userpersisto_billing_checkout_verify'));
  assert.ok(tools.includes('userpersisto_billing_credit_price_set'));
  assert.ok(!tools.includes('userpersisto_config_set'),'ScriptaHub does not receive access to provider secrets');

});
test('initial ScriptaHub credits lock the original amount and use a stable grant until confirmed',async t=>{
  const dataDir=await fs.mkdtemp(path.join(os.tmpdir(),'scripta-initial-credits-'));
  const calls=[], posted=new Map();
  let loseFirstResponse=true;
  const verifyUser=async req=>{
    const name=req.headers['x-test-user'];
    return name ? {id:'user:'+name,email:name+'@example.test'} : null;
  };
  const applyCredits=async args=>{
    calls.push(args);
    const key=args.userId+':'+args.referenceId;
    if(posted.has(key)) assert.deepEqual(posted.get(key),args);
    else posted.set(key,args);
    if(loseFirstResponse){loseFirstResponse=false;throw Error('Response lost');}
    return {ok:true};
  };
  const server=createSiteServer(dataDir,{dataDir,manageApprovals:true,verifyUser,applyCredits});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));await fs.rm(dataDir,{recursive:true,force:true});});
  const base='http://127.0.0.1:'+server.address().port;
  const get=(name,pathname='/api/session')=>fetch(base+pathname,{headers:{'x-test-user':name}});
  assert.equal((await get('existing')).status,200);
  await savePointsPolicy(dataDir,{initialCredits:12});
  assert.equal((await fetch(base+'/api/session')).status,401);
  assert.equal((await get('existing')).status,200);
  assert.equal(calls.length,0);

  assert.equal((await get('reader')).status,503);
  await savePointsPolicy(dataDir,{initialCredits:17});
  const responses=await Promise.all([get('reader'),get('reader','/api/dashboard')]);
  assert.deepEqual(responses.map(response=>response.status),[200,200]);
  assert.equal((await get('reader')).status,200);
  assert.ok(calls.length>=2);
  assert.deepEqual(calls[0],{userId:'reader',amount:12,operation:'grant',referenceId:'scriptahub:initial-credits',reason:'Initial ScriptaHub credits'});
  assert.ok(calls.every(call=>call.amount===12));
  assert.equal(posted.size,1);

  assert.equal((await get('later','/api/dashboard')).status,200);
  assert.equal(calls.at(-1).amount,17);
  assert.equal(posted.size,2);
});
