import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { uploadLimits, submissionBodyLimit, validateDocuments, newSubmissionId } from '../site/assets/submission-policy.js';
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
async function bridgeFixture() {
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
  }, location: { href: 'https://deployment.example/prefix/create/', pathname: '/prefix/create/' },
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

test('returning to a draft transfers document bytes, and missing storage fails explicitly', async () => {
  const { bridge, records } = await bridgeFixture();
  const original = new File(['%PDF-1.7\noriginal content'], 'manuscript.pdf');
  await bridge.saveDraftFiles('first', [original], null, ['manuscript.pdf']);
  await bridge.saveDraftFiles('second', [], 'first', ['manuscript.pdf']);
  assert.equal(await records.get('second')[0].text(), await original.text());
  assert.equal(records.get('second')[0].name, original.name);
  await assert.rejects(bridge.saveDraftFiles('missing', [], 'absent', ['manuscript.pdf']), /no longer available/);
  await bridge.saveDraftFiles('cleared', [], 'first', []);
  assert.equal(records.get('cleared').length, 0, 'explicitly clearing files must not restore them');
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
