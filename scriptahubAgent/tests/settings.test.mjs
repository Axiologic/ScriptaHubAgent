import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { loadSourceConfig, saveSourceConfig, assertSettingsAdmin, validateSourceConfig, settingsFile } from '../settings.mjs';
import { resolveSources } from '../sync.mjs';

test('Configure persists validated sources outside the repository and rejects broken replacements', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'scripta-config-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const configPath = path.join(root, 'defaults.json'), dataDir = path.join(root, 'data');
  const original = { schemaVersion: 1, syncIntervalSeconds: 60, repositories: ['https://books.example.org/default/collection.json'] };
  await fs.writeFile(configPath, JSON.stringify(original));
  assert.deepEqual(await loadSourceConfig({ configPath, dataDir }), {...original,publication:null});
  const config = { schemaVersion: 1, syncIntervalSeconds: 5, repositories: ['https://github.com/example/books/blob/master/collection.json'] };
  const resolve = settings => resolveSources(settings, { fetchImpl: async () => new Response('{"schemaVersion":1,"bookCount":0,"books":[]}') });
  const saved = await saveSourceConfig(config, { dataDir, resolve });
  assert.equal(saved.bookCount, 0);
  assert.deepEqual(await loadSourceConfig({ configPath, dataDir }), { ...config, publication: null });
  assert.equal((await fs.stat(settingsFile(dataDir))).mode & 0o777, 0o600);
  assert.deepEqual(JSON.parse(await fs.readFile(configPath)), original);
  await assert.rejects(saveSourceConfig({ ...config, repositories: ['https://github.com/example/books/blob/master/collection.json','https://raw.githubusercontent.com/example/books/master/collection.json'] }, { dataDir, resolve }), /Duplicate source/);
  await assert.rejects(saveSourceConfig(config, { dataDir, resolve: async () => { throw new Error('HTTP 404'); } }), /404/);
  assert.deepEqual(await loadSourceConfig({ configPath, dataDir }), { ...config, publication: null });
  await saveSourceConfig({ ...config, repositories: [] }, { dataDir });
  assert.deepEqual((await loadSourceConfig({ configPath, dataDir })).repositories, []);
});

test('Configure requires an administrator and rejects invalid URLs and intervals', () => {
  for (const auth of [{}, { user: { roles: ['member'] } }, { agent: { principalId: 'agent:example' } }]) assert.throws(() => assertSettingsAdmin(auth), /Admin access/);
  assertSettingsAdmin({ user: { roles: ['admin'] } });
  for (const repositories of [['https://github.com/example/books.git'],['http://books.example.org/collection.json'],['https://user:pass@books.example.org/collection.json'],[{ url: 'https://example.org/collection.json' }]]) {
    assert.throws(() => validateSourceConfig({ schemaVersion: 1, syncIntervalSeconds: 60, repositories }));
  }
  for (const syncIntervalSeconds of [0, 1.5, '60', 2147484]) assert.throws(() => validateSourceConfig({ schemaVersion: 1, syncIntervalSeconds, repositories: [] }));
});

test('summary duration is not exposed or persisted as a configurable setting', async t => {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'scripta-summary-config-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const configPath=path.join(root,'defaults.json'),dataDir=path.join(root,'data');
  const base={schemaVersion:1,syncIntervalSeconds:60,repositories:[]};
  await fs.writeFile(configPath,JSON.stringify({...base,summaryReadingMinutes:99}));
  assert.equal(Object.hasOwn(await loadSourceConfig({configPath,dataDir}),'summaryReadingMinutes'),false);
  await saveSourceConfig({...base,summaryReadingMinutes:7},{dataDir});
  assert.equal(Object.hasOwn(JSON.parse(await fs.readFile(settingsFile(dataDir))),'summaryReadingMinutes'),false);
  const tools=JSON.parse(await fs.readFile(new URL('../mcp-config.json',import.meta.url),'utf8')).tools;
  const schema=tools.find(tool=>tool.name==='scriptahub_config_set').inputSchema;
  assert.equal(Object.hasOwn(schema.properties,'summaryReadingMinutes'),false);
  assert.equal(schema.additionalProperties,false);
});

test('editorial configuration does not invalidate the public catalogue snapshot', async () => {
  const {snapshotFingerprint}=await import('../sync.mjs');
  const config={schemaVersion:1,syncIntervalSeconds:60,repositories:[]};
  assert.equal(await snapshotFingerprint({...config,summaryReadingMinutes:10}),await snapshotFingerprint({...config,summaryReadingMinutes:15}));
});

test('publication identity and credential stay together locally and public refresh does not depend on secret storage', async t => {
  const {PublicationAccessStore} = await import('../publication-access.mjs');
  const root = await fs.mkdtemp(path.join(os.tmpdir(),'scripta-settings-local-access-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const configPath=path.join(root,'defaults.json'), dataDir=path.join(root,'data');
  const config={schemaVersion:1,syncIntervalSeconds:60,repositories:[]};
  await fs.writeFile(configPath,JSON.stringify(config));
  const access=new PublicationAccessStore(dataDir);
  access.update(state=>{state.connection={token:'test-token-not-public',publication:{authorName:'Original',authorEmail:'original@example.test'}};});access.close();
  const publication={authorName:'Updated',authorEmail:'updated@example.test'};
  const saved=await saveSourceConfig({...config,publication},{dataDir});
  assert.deepEqual(saved.settings.publication,publication);
  assert.deepEqual((await loadSourceConfig({configPath,dataDir,includePublication:true})).publication,publication);
  assert.equal(Object.hasOwn(JSON.parse(await fs.readFile(settingsFile(dataDir))),'publication'),false);
  await fs.rm(path.join(dataDir,'private/publication/key'));
  assert.equal((await loadSourceConfig({configPath,dataDir})).syncIntervalSeconds,60);
  await assert.rejects(loadSourceConfig({configPath,dataDir,includePublication:true}),/key is missing/);
});
