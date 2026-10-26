import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { callAgent } from './identity.mjs';
import { verifyRecord } from './record-integrity.mjs';

const intervalMs = 30_000;
const message = record => ({ subject: 'ScriptaHub: contribution received', text: `We received your contribution.\nScriptaHub reference: ${record.id}` });

async function defaultSend(to, subject, text) {
  const result = await callAgent('emailAgent', 'email_send_text', { to, subject, text });
  if (!result.providerMessageId) throw new Error('EmailAgent did not confirm delivery');
}

async function notify(directory, record, state, send) {
  if (state.received) return;
  const content = message(record);
  await send(record.contact.email, content.subject, content.text);
  state.received = { at: new Date().toISOString() };
  const file = path.join(directory, 'notification-state.json');
  const temp = `${file}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(temp, JSON.stringify(state, null, 2) + '\n', { mode: 0o600 });
  await fs.rename(temp, file);
}

export async function processNotificationRecord(directory, { send = defaultSend } = {}) {
  const record = verifyRecord(JSON.parse(await fs.readFile(path.join(directory, 'record.json'), 'utf8')));
  if (!record.contact?.email || !record.id) return;
  if (record.state === 'received') {
    // A complete upload is not acknowledged until database registration succeeds.
    let database;
    try {
      database = new DatabaseSync(path.join(directory, '..', '..', 'dashboard.sqlite'), { readOnly: true });
      if (!database.prepare('SELECT 1 FROM changes WHERE id=?').get(record.id)) return;
    } finally { database?.close(); }
  }
  const state = JSON.parse(await fs.readFile(path.join(directory, 'notification-state.json'), 'utf8').catch(error => {
    if (error.code === 'ENOENT') return '{}';
    throw error;
  }));
  await notify(directory, record, state, send);
}

export async function runNotificationSweep({ dataDir, send = defaultSend, report = console.error } = {}) {
  const inbox = path.join(dataDir, 'inbox');
  const entries = await fs.readdir(inbox, { withFileTypes: true }).catch(error => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^[0-9a-f-]{36}$/i.test(entry.name)) continue;
    try { await processNotificationRecord(path.join(inbox, entry.name), { send }); }
    catch (error) { report(`Notification ${entry.name}: ${error.message}`); }
  }
}

export function startNotificationWorker({ dataDir, report = console.error } = {}) {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try { await runNotificationSweep({ dataDir, report }); }
    catch (error) { report(`Notification sweep: ${error.message}`); }
    finally { running = false; }
  };
  void tick();
  const timer = setInterval(() => { void tick(); }, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
