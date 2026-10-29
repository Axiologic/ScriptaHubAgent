import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { uploadLimits, submissionBodyLimit, validateDocuments, newSubmissionId } from '../site/assets/submission-policy.js';
import { annotations } from '../annotations.mjs';
import { standaloneReaderUrl } from '../site/assets/suggest.js';
import { dashboardLanguages, dashboardMessages, dashboardText } from '../site/assets/dashboard-copy.js';

test('upload contract accepts its advertised boundaries and rejects excess before upload', () => {
  const file = size => ({ name: 'book.pdf', size });
  assert.doesNotThrow(() => validateDocuments([file(uploadLimits.fileBytes), file(uploadLimits.fileBytes)]));
  assert.doesNotThrow(() => validateDocuments(Array.from({ length: 8 }, () => file(1))));
  assert.throws(() => validateDocuments([file(uploadLimits.fileBytes + 1)]), /50 MB/);
  assert.throws(() => validateDocuments([file(uploadLimits.fileBytes), file(uploadLimits.fileBytes), file(1)]), /100 MB/);
  assert.throws(() => validateDocuments(Array.from({ length: 9 }, () => file(1))), /8 documents/);
  assert.throws(() => validateDocuments([file(0)]), /contain data/);
  assert.throws(() => validateDocuments([{ name: 'book.html', size: 100 }]), /PDF, DOC and DOCX/);
  assert.ok(submissionBodyLimit > uploadLimits.totalBytes, 'multipart metadata has a bounded allowance');
});

test('submission IDs require cryptographic randomness, not the secure-context-only randomUUID API', () => {
  const context = vm.createContext({ crypto: { getRandomValues: webcrypto.getRandomValues.bind(webcrypto) } });
  const identifiers = Array.from({ length: 100 }, () => vm.runInContext(`(${newSubmissionId.toString()})()`, context));
  for (const value of identifiers) assert.match(value, /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
  assert.equal(new Set(identifiers).size, 100);
});

test('dashboard copy is complete for all supported languages and preserves template fields', () => {
  const keys = new Set();
  for (const row of dashboardMessages) {
    assert.equal(row.length, dashboardLanguages.length, row[0]);
    assert.ok(!keys.has(row[0]), `duplicate message: ${row[0]}`); keys.add(row[0]);
    const placeholders = row[0].match(/\{\w+\}/g)?.sort() || [];
    for (const translation of row) {
      assert.ok(translation.trim(), row[0]);
      assert.deepEqual(translation.match(/\{\w+\}/g)?.sort() || [], placeholders);
    }
  }
  assert.equal(dashboardText('ro', 'My books'), 'Cărțile mele');
  assert.equal(dashboardText('ro', 'Account: {name}', { name: '<Alice>' }), 'Cont: <Alice>');
});

// Isolated browser storage/transport fixtures: production modules and validation run unchanged.
async function bridgeFixture({language='en'} = {}) {
  const records = new Map();
  const db = { close() {}, transaction() {
    const tx = { objectStore() { return {
      put(value, key) { records.set(key, structuredClone(value)); queueMicrotask(() => tx.oncomplete()); },
      get(key) { const request = {}; queueMicrotask(() => { request.result = records.get(key); request.onsuccess(); }); return request; },
      delete(key) { records.delete(key); queueMicrotask(() => tx.oncomplete()); },
    }; } }; return tx;
  } };
  const requests = [];
  let response = { ok: false, status: 400, value: { error: 'Invalid form field' } };
  const context = vm.createContext({ URL, FormData, indexedDB: { open() {
    const request = {}; queueMicrotask(() => { request.result = db; request.onsuccess(); }); return request;
  } }, document: {
    currentScript: { src: new URL('../site/assets/workflow-bridge.js', import.meta.url).href },
    documentElement: {}, addEventListener() {}, querySelectorAll: () => [],
  }, location: { href: 'https://deployment.example/prefix/create/?lang='+language, pathname: '/prefix/create/' },
  MutationObserver: class { observe() {} }, fetch: async (url, options) => {
    if (String(url).endsWith('/api/session')) return { ok: true, json: async () => ({ user: { email: 'alice@example.test' } }) };
    requests.push(options.body);
    return { ok: response.ok, status: response.status, json: async () => response.value };
  } });
  const script = new vm.Script(await fs.readFile(new URL('../site/assets/workflow-bridge.js', import.meta.url), 'utf8'), {
    importModuleDynamically: vm.constants.USE_MAIN_CONTEXT_DEFAULT_LOADER,
  });
  script.runInContext(context);
  return { bridge: context.ScriptaContributionBridge, records, requests, respond: value => { response = value; } };
}

test('existing document drafts can be restored without creating another agreement step', async () => {
  const {bridge,records}=await bridgeFixture();
  const original=new File(['%PDF-1.7\noriginal content'],'manuscript.pdf');
  records.set('draft',[original]);
  const files=await bridge.loadDraftFiles('draft',['manuscript.pdf']);
  assert.equal(await files[0].text(),await original.text());
  await assert.rejects(bridge.loadDraftFiles('absent',['manuscript.pdf']),/no longer available/);
  await assert.rejects(bridge.loadDraftFiles('draft',['other.pdf']),/no longer available/);
});

test('single-page contributions require explicit consent and upload documents once', async () => {
  const fixture=await bridgeFixture(),button={disabled:false,dataset:{}},status={textContent:''};
  const draft={returnUrl:'https://deployment.example/prefix/create/index.html',lines:[],values:{titles:'Book',prompt:'Instructions'},agreementAccepted:false};
  const file=new File(['%PDF-1.7\nsource'],'book.pdf');
  await assert.rejects(fixture.bridge.submitContribution(draft,[file],status,button),/agreement is required/);
  assert.equal(fixture.requests.length,0);
  draft.agreementAccepted=true;
  assert.equal(await fixture.bridge.submitContribution(draft,[file],status,button),false);
  const id=button.dataset.submissionId;
  fixture.respond({ok:true,status:202,value:{submissionId:id}});
  assert.equal(await fixture.bridge.submitContribution(draft,[file],status,button),true);
  assert.equal(await fixture.bridge.submitContribution(draft,[file],status,button),false);
  assert.equal(fixture.requests.length,2);
  for(const body of fixture.requests){const meta=JSON.parse(body.get('metadata'));assert.equal(meta.submissionId,id);assert.equal(meta.kind,'manuscript');assert.equal(meta.agreementAccepted,true);assert.equal(meta.agreementVersion,'2026-09-10');assert.equal(meta.values.prompt,'Instructions');assert.equal(await body.get('documents').text(),await file.text());}
  assert.equal(fixture.records.size,0,'new contributions do not require IndexedDB drafts');
});

test('direct submissions preserve contribution type and source book for every original form', async () => {
  for(const [page,kind] of [['create','book-proposal'],['fork','fork'],['feedback','edit'],['translate','translation'],['animation-request','animation']]){
    const fixture=await bridgeFixture();fixture.respond({ok:true,status:202,value:{submissionId:'received'}});
    await fixture.bridge.submitContribution({returnUrl:`https://deployment.example/prefix/${page}/index.html`,lines:['Book ID: book-1'],values:{feedback:'Improve this book'},agreementAccepted:true},[],{textContent:''},{disabled:false,dataset:{}});
    const meta=JSON.parse(fixture.requests[0].get('metadata'));assert.equal(meta.kind,kind);assert.equal(meta.bookId,'book-1');
  }
});

test('an HTTP validation error allows retry; success remains terminal and preserves the idempotency key', async () => {
  const fixture = await bridgeFixture();
  const button = { disabled: false, dataset: {} }, status = { textContent: '' };
  const metadata = { submissionId: newSubmissionId() };
  assert.equal(await fixture.bridge.submitDirect(metadata, [], status, button), false);
  assert.equal(button.disabled, false);
  assert.equal(status.textContent, 'Invalid form field');
  fixture.respond({ ok: true, status: 202, value: { submissionId: metadata.submissionId } });
  assert.equal(await fixture.bridge.submitDirect(metadata, [], status, button), true);
  assert.equal(button.disabled, true);
  assert.equal(await fixture.bridge.submitDirect(metadata, [], status, button), false);
  assert.equal(fixture.requests.length, 2);
  assert.equal(JSON.parse(fixture.requests[0].get('metadata')).submissionId, JSON.parse(fixture.requests[1].get('metadata')).submissionId);
});

test('submit is disabled until all required fields and consent are valid', async () => {
  const {bridge}=await bridgeFixture();
  const input={willValidate:true,required:true,value:'',validity:{valid:false},closest:()=>null};
  const consent={willValidate:true,required:true,value:'on',validity:{valid:false},closest:()=>null};
  const button={disabled:false,dataset:{}};const listeners={};
  const form={elements:[input,consent],dataset:{},querySelectorAll:()=>[input,consent],querySelector:()=>button,addEventListener:(type,fn)=>{listeners[type]=fn;}};
  bridge.bindFormValidity(form);assert.equal(button.disabled,true);
  input.value='Book instructions';input.validity.valid=true;listeners.input();assert.equal(button.disabled,true);
  consent.validity.valid=true;listeners.change();assert.equal(button.disabled,false);
  input.value='   ';listeners.input();assert.equal(button.disabled,true);
  input.value='Book instructions';listeners.input();assert.equal(button.disabled,false);
  consent.validity.valid=false;listeners.change();assert.equal(button.disabled,true);
  consent.validity.valid=true;form.dataset.contributionReady='false';form.updateContributionState();assert.equal(button.disabled,true);
  form.dataset.contributionReady='true';form.updateContributionState();assert.equal(button.disabled,false);
  button.dataset.submissionComplete='true';form.updateContributionState();assert.equal(button.disabled,true);
});

test('an English edition can be annotated from the Romanian interface without weakening language validation',async()=>{
  const fixture=await bridgeFixture({language:'ro'});fixture.respond({ok:true,status:202,value:{submissionId:'received'}});
  const values={baseRevision:'0',annotations:JSON.stringify([{id:'one',quote:'Text',start:0,end:4,kind:'Editorial structure',feedback:'Improve this',edition:'edition-en',language:'en'}])};
  await fixture.bridge.submitContribution({returnUrl:'https://deployment.example/prefix/feedback/?lang=ro',language:'en',lines:['Book ID: bk-test'],values,agreementAccepted:true},[],{},{dataset:{}});
  const metadata=JSON.parse(fixture.requests[0].get('metadata'));
  assert.equal(metadata.language,'en');assert.doesNotThrow(()=>annotations(metadata));
  assert.throws(()=>annotations({...metadata,language:'ro'}),/Invalid annotation edition/);
});
test('standalone return from Suggest retains deployment prefix and book context but restores normal reader controls',()=>{
  const embedded=new URL('https://deployment.example/prefix/reader/index.html?id=book%3Aedition%3Aen&language=en&lang=ro&view=suggest&back=..%2Fbook.html#chapter');
  const standalone=standaloneReaderUrl(embedded);
  assert.equal(standalone.searchParams.has('view'),false);assert.equal(embedded.searchParams.get('view'),'suggest');
  assert.equal(standalone.origin,embedded.origin);assert.equal(standalone.pathname,embedded.pathname);
  for(const key of ['id','language','lang','back'])assert.equal(standalone.searchParams.get(key),embedded.searchParams.get(key));
  assert.equal(standalone.hash,'#chapter');
});
