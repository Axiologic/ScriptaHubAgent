import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createSiteServer } from '../server.mjs';

test('local UI edits are served live while generated catalogue stays in the snapshot', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'scripta-live-site-'));
  const snapshot = path.join(root, 'snapshot');
  const live = path.join(root, 'live');
  await fs.mkdir(path.join(snapshot, 'assets'), { recursive: true });
  await fs.mkdir(path.join(live, 'assets'), { recursive: true });
  await fs.writeFile(path.join(snapshot, 'assets/workflow.js'), 'snapshot');
  await fs.writeFile(path.join(live, 'assets/workflow.js'), 'first edit');
  await fs.writeFile(path.join(snapshot, 'collection.json'), '{"bookCount":1}');
  await fs.writeFile(path.join(live, 'collection.json'), '{"bookCount":0}');
  const server = createSiteServer(snapshot, { liveSiteRoot: live });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    await fs.rm(root, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = relative => fetch(`${base}/base-agent-additional-server/scriptahubAgent/3002/${relative}`);

  const first = await request('assets/workflow.js');
  assert.equal(await first.text(), 'first edit');
  assert.equal(first.headers.get('cache-control'), 'no-store');
  await fs.writeFile(path.join(live, 'assets/workflow.js'), 'second edit');
  assert.equal(await (await request('assets/workflow.js')).text(), 'second edit');
  assert.equal(await (await request('collection.json')).text(), '{"bookCount":1}');
});
