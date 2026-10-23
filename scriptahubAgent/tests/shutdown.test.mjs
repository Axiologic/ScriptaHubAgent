import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';

test('agent acknowledges a targeted SIGTERM drain with exit zero', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'scripta-drain-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const config = path.join(root, 'sources.json');
  await fs.writeFile(config, JSON.stringify({ schemaVersion: 1, repositories: [] }));
  const probe = net.createServer().listen(0, '127.0.0.1');
  await new Promise(resolve => probe.once('listening', resolve));
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  const child = spawn(process.execPath, ['server.mjs'], { cwd: path.join(import.meta.dirname, '..'), env: {
    ...process.env, SCRIPTA_CONFIG: config, SCRIPTA_DATA_DIR: path.join(root, 'data'), SCRIPTA_PORT: String(port),
  }, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => { if (child.exitCode === null) child.kill('SIGKILL'); });
  await Promise.race([
    new Promise((resolve, reject) => {
      child.stdout.on('data', chunk => { if (chunk.toString().includes(`ScriptaHub on ${port}`)) resolve(); });
      child.once('error', reject);
      child.once('exit', code => reject(new Error(`Agent exited before listening: ${code}`)));
    }),
    new Promise((_, reject) => setTimeout(() => reject(new Error('Agent did not start')), 5000)),
  ]);
  child.kill('SIGTERM');
  const exit = await Promise.race([
    new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal }))),
    new Promise((_, reject) => setTimeout(() => reject(new Error('Agent did not drain')), 5000)),
  ]);
  assert.deepEqual(exit, { code: 0, signal: null });
});
