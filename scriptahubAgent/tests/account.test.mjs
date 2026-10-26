import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildSnapshot } from '../sync.mjs';
import { createSiteServer } from '../server.mjs';

test('account page requires identity and delegates settings to UserPersisto', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'scriptahub-account-'));
  const snapshot = await buildSnapshot({ config: { schemaVersion: 1, repositories: [] }, dataDir });
  const user = { id: 'user:test', email: 'reader@example.org', displayName: 'Reader' };
  const server = createSiteServer(snapshot.site, { dataDir, verifyUser: async req => req.headers['x-test-user'] ? user : null });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await fs.rm(dataDir, { recursive: true, force: true }); });
  const root = `http://127.0.0.1:${server.address().port}/base-agent-additional-server/scriptahubAgent/3002/`;
  assert.equal((await fetch(root + 'account/index.html')).status, 401);
  const response = await fetch(root + 'account/index.html', { headers: { 'x-test-user': 'reader' } });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const html = await response.text();
  assert.match(html, /iframe[^>]+service\/dashboard\/\?view=account"/);
  const session = await fetch(root + 'api/session', { headers: { 'x-test-user': 'reader' } });
  assert.deepEqual((await session.json()).user, { id: user.id, email: user.email, displayName: user.displayName });
  const manifest = JSON.parse(await fs.readFile(new URL('../manifest.json', import.meta.url)));
  const rule = manifest.routerAccess.httpRoutes.find(route => route.path.endsWith('/account/*'));
  assert.equal(rule.access, 'authenticated');
});
