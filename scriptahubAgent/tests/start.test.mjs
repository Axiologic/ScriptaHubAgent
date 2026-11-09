import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';

// The application image carries no skills runtime: skills run only in the robot.
// The manifest entry point must therefore serve without /opt/scriptahub/runtime.
test('the manifest entry point starts and answers /health without a skills runtime', async t => {
  const manifest = JSON.parse(await fs.readFile(new URL('../manifest.json', import.meta.url), 'utf8'));
  assert.equal(manifest.agent, 'node /code/deployment/start.mjs');
  await assert.rejects(fs.access('/opt/scriptahub/runtime'), { code: 'ENOENT' }, 'this test needs a host with no prepared skills runtime');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'scripta-start-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const config = path.join(root, 'sources.json');
  await fs.writeFile(config, JSON.stringify({ schemaVersion: 1, repositories: [] }));
  const probe = net.createServer().listen(0, '127.0.0.1');
  await new Promise(resolve => probe.once('listening', resolve));
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  const env = { ...process.env, SCRIPTA_CONFIG: config, SCRIPTA_DATA_DIR: path.join(root, 'data'), SCRIPTA_PORT: String(port) };
  delete env.PLOINKY_AGENT_ID;
  delete env.PLOINKY_WORKSPACE_ROOT;
  const child = spawn(process.execPath, [path.join(import.meta.dirname, '../deployment/start.mjs')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => { if (child.exitCode === null) child.kill('SIGKILL'); });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  await Promise.race([
    new Promise((resolve, reject) => {
      const check = () => { if (output.includes(`ScriptaHub on ${port}`)) resolve(); };
      child.stdout.on('data', check);
      child.once('error', reject);
      child.once('exit', code => reject(new Error(`Agent exited before listening (${code}): ${output.trim()}`)));
    }),
    new Promise((_, reject) => setTimeout(() => reject(new Error(`Agent did not start: ${output.trim()}`)), 10000).unref()),
  ]);
  const response = await fetch(`http://127.0.0.1:${port}/health`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  child.kill('SIGTERM');
  const exit = await Promise.race([
    new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal }))),
    new Promise((_, reject) => setTimeout(() => reject(new Error('Agent did not drain')), 10000).unref()),
  ]);
  assert.deepEqual(exit, { code: 0, signal: null });
});
