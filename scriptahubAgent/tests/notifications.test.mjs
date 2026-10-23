import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runNotificationSweep } from '../notifications.mjs';
import { sealRecord } from '../record-integrity.mjs';

process.env.SCRIPTA_RECORD_KEY = 'test-record-key-0123456789abcdef0123456789';

test('receipt uses the signed-in account email once and rejects tampering', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'scripta-notify-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const id = '9fdfd120-b243-4559-bc4d-41891967f0f6';
  const folder = path.join(dataDir, 'inbox', id);
  await fs.mkdir(folder, { recursive: true });
  const record = sealRecord({ id, owner: 'user:alice', contact: { email: 'alice@example.test' }, metadata: { kind: 'edit' },
    files: [], createdAt: new Date().toISOString(), state: 'pending', task: { schemaVersion: 1, id, type: 'scriptahub.edit' } });
  await fs.writeFile(path.join(folder, 'record.json'), JSON.stringify(record));
  const sent = [];
  const send = async (to, subject, text) => sent.push({ to, subject, text });
  await runNotificationSweep({ dataDir, send });
  await runNotificationSweep({ dataDir, send });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, 'alice@example.test');
  assert.equal(sent[0].subject, 'ScriptaHub: contribution received');
  record.contact.email = 'attacker@example.test';
  await fs.writeFile(path.join(folder, 'record.json'), JSON.stringify(record));
  const errors = [];
  await runNotificationSweep({ dataDir, send, report: error => errors.push(error) });
  assert.match(errors[0], /changed/);
  assert.equal(sent.length, 1);
});
