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
  assert.deepEqual(await loadSourceConfig({ configPath, dataDir }), original);
  const config = { schemaVersion: 1, syncIntervalSeconds: 5, repositories: ['https://github.com/example/books/blob/master/collection.json'] };
  const resolve = settings => resolveSources(settings, { fetchImpl: async () => new Response('{"schemaVersion":1,"bookCount":0,"books":[]}') });
  const saved = await saveSourceConfig(config, { dataDir, resolve });
  assert.equal(saved.bookCount, 0);
  assert.deepEqual(await loadSourceConfig({ configPath, dataDir }), config);
  assert.equal((await fs.stat(settingsFile(dataDir))).mode & 0o777, 0o600);
  assert.deepEqual(JSON.parse(await fs.readFile(configPath)), original);
  await assert.rejects(saveSourceConfig({ ...config, repositories: ['https://github.com/example/books/blob/master/collection.json','https://raw.githubusercontent.com/example/books/master/collection.json'] }, { dataDir, resolve }), /Duplicate source/);
  await assert.rejects(saveSourceConfig(config, { dataDir, resolve: async () => { throw new Error('HTTP 404'); } }), /404/);
  assert.deepEqual(await loadSourceConfig({ configPath, dataDir }), config);
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
