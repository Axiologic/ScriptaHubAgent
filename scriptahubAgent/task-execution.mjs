import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { verifyRecord } from './record-integrity.mjs';
import { validateSourceConfig, SUMMARY_READING_MINUTES } from './settings.mjs';
import { createPublicationTables } from './publication-transfer.mjs';

const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const identifier = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);
const timestamp = () => new Date().toISOString();
export const executionTools = new Set(['scriptahub_task_claim', 'scriptahub_task_status', 'scriptahub_task_document_read', 'scriptahub_task_finish', 'scriptahub_task_package_prepare', 'scriptahub_task_package_upload', 'scriptahub_task_publish']);

// The envelope is supplied by AgentServer only after secure-wire verification.
// Do not call this with browser headers or client-provided identity fields.
export function requireExecutor(auth, tool, env = process.env) {
  const allowed = String(env.SCRIPTA_EXECUTOR_AGENT_IDS || '').split(',').map(value => value.trim()).filter(Boolean);
  const caller = auth?.invocation?.caller;
  const actor = auth?.invocation?.actor;
  if (!allowed.length || allowed.some(value => !/^agent:[^/\s:]+\/[^/\s:]+$/.test(value))) fail('Task executor identities are not configured', 503);
  if (!executionTools.has(tool) || auth?.invocation?.tool !== tool || caller?.kind !== 'agent'
    || actor?.kind !== 'agent' || actor.id !== caller.id || auth.invocation.subject !== caller.id
    || auth.user || auth.invocation.delegation || !allowed.includes(caller.id)) fail('Task executor access denied', 403);
  return caller.id;
}

export class TaskExecution {
  constructor(store, dataDir) {
    this.store = store;
    this.dataDir = dataDir;
    store.db.exec(`CREATE TABLE IF NOT EXISTS task_executions (
      id TEXT PRIMARY KEY, task_id TEXT NOT NULL UNIQUE REFERENCES tasks(id),
      executor_agent_id TEXT NOT NULL, run_id TEXT NOT NULL, created_at TEXT NOT NULL,
      finished_at TEXT, finish_digest TEXT, UNIQUE(executor_agent_id,run_id));`);
    createPublicationTables(store);
  }
  execution(executor, executionId) {
    if (!identifier(executionId)) fail('Invalid execution ID');
    const row = this.store.db.prepare(`SELECT e.*,t.state,t.change_id,t.result,t.error FROM task_executions e
      JOIN tasks t ON t.id=e.task_id WHERE e.id=? AND e.executor_agent_id=?`).get(executionId, executor);
    return row || fail('Execution not found', 404);
  }
  present(row) {
    const change = this.store.db.prepare('SELECT * FROM changes WHERE id=?').get(row.change_id);
    const book = this.store.book(change.book_id);
    const payload = JSON.parse(change.payload);
    return { executionId: row.id, runId: row.run_id, taskId: row.task_id, state: row.state,
      bookId: book.id, ownerId: book.owner, authorId: change.author, type: `scriptahub.${change.kind}`,
      values: payload.metadata.values, language: payload.metadata.language,
      files: payload.files.map((file, index) => ({ index, originalName: file.originalName, sha256: file.sha256 })),
      result: row.result, error: row.error };
  }
  claim(executor, { runId, taskId } = {}) {
    if (!identifier(runId) || (taskId !== undefined && !identifier(taskId))) fail('Invalid run or task ID');
    return this.store.transaction(() => {
      const existing = this.store.db.prepare('SELECT id,task_id FROM task_executions WHERE executor_agent_id=? AND run_id=?').get(executor, runId);
      if (existing) {
        if (taskId && taskId !== existing.task_id) fail('Run already belongs to another task', 409);
        return { task: this.present(this.execution(executor, existing.id)) };
      }
      const task = this.store.db.prepare(`SELECT t.* FROM tasks t JOIN changes c ON c.id=t.change_id JOIN books b ON b.id=c.book_id
        WHERE t.state='queued' AND c.state='accepted' AND c.kind='manuscript' AND (? IS NULL OR t.id=?)
        ORDER BY t.created_at,t.id LIMIT 1`).get(taskId ?? null, taskId ?? null);
      if (!task) return { task: null };
      const id = crypto.randomUUID(), time = timestamp();
      const changed = this.store.db.prepare("UPDATE tasks SET state='running',updated_at=? WHERE id=? AND state='queued'").run(time, task.id);
      if (changed.changes !== 1) fail('Task was already claimed', 409);
      this.store.db.prepare('INSERT INTO task_executions(id,task_id,executor_agent_id,run_id,created_at) VALUES(?,?,?,?,?)')
        .run(id, task.id, executor, runId, time);
      const change = this.store.db.prepare('SELECT book_id FROM changes WHERE id=?').get(task.change_id);
      this.store.event(executor, 'task.started', change.book_id, task.change_id, task.id);
      return { task: this.present(this.execution(executor, id)) };
    });
  }
  claimConfigured(executor, args, settings) {
    const config = validateSourceConfig(settings);
    if (!config.repositories.length) fail('No content repositories are configured', 503);
    const result = this.claim(executor, args);
    if (result.task) {
      result.task.repositories = config.repositories;
      // Application configuration is execution context, never task-authored input.
      result.processingSettings = { summaryReadingMinutes: SUMMARY_READING_MINUTES };
    }
    return result;
  }
  status(executor, { executionId } = {}) {
    const row = this.execution(executor, executionId);
    return { executionId: row.id, taskId: row.task_id, state: row.state, result: row.result, taskError: row.error };
  }
  async document(executor, { executionId, index, offset = 0, length = 196608 } = {}) {
    const row = this.execution(executor, executionId);
    if (row.state !== 'running' || row.finished_at) fail('Execution is not running', 409);
    if (![index, offset, length].every(Number.isSafeInteger) || index < 0 || offset < 0 || length < 1 || length > 196608) fail('Invalid document range');
    const change = this.store.db.prepare('SELECT * FROM changes WHERE id=?').get(row.change_id);
    const payload = JSON.parse(change.payload);
    const file = payload.files[index];
    if (!file || !/^[0-9a-f-]{36}$/.test(change.id) || typeof file.name !== 'string'
      || file.name !== path.basename(file.name) || !/^[0-9a-f-]{36}\.(pdf|doc|docx)$/.test(file.name)) fail('Document not found', 404);
    const root = await fs.realpath(this.dataDir);
    const folder = path.join(root, 'inbox', change.id);
    // Reject symlinked directories/files before opening private input.
    for (const directory of [path.join(root, 'inbox'), folder]) {
      if (!(await fs.lstat(directory)).isDirectory()) fail('Invalid document directory');
      if (await fs.realpath(directory) !== directory) fail('Invalid document directory');
    }
    const recordPath = path.join(folder, 'record.json');
    if (!(await fs.lstat(recordPath)).isFile()) fail('Invalid submission record');
    const record = verifyRecord(JSON.parse(await fs.readFile(recordPath, 'utf8')));
    if (record.id !== change.id || record.owner !== change.author || JSON.stringify(record.metadata) !== JSON.stringify(payload.metadata)
      || JSON.stringify(record.files) !== JSON.stringify(payload.files)) fail('Submission integrity check failed');
    const filename = path.join(folder, file.name);
    const handle = await fs.open(filename, constants.O_RDONLY | constants.O_NOFOLLOW);
    let bytes;
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > 50000000) fail('Invalid document');
      bytes = await handle.readFile();
    } finally { await handle.close(); }
    if (bytes.length > 50000000) fail('Document exceeds the size limit');
    if (crypto.createHash('sha256').update(bytes).digest('hex') !== file.sha256) fail('Document integrity check failed');
    if (offset > bytes.length) fail('Document offset exceeds size');
    // A cancellation committed while reading must prevent further delivery.
    if (this.execution(executor, executionId).state !== 'running') fail('Execution is not running', 409);
    const chunk = bytes.subarray(offset, offset + length);
    return { originalName: file.originalName, sha256: file.sha256, size: bytes.length,
      offset, nextOffset: offset + chunk.length, eof: offset + chunk.length === bytes.length, encoding: 'base64', data: chunk.toString('base64') };
  }
  finish(executor, { executionId, state, result = '', error = '' } = {}, { publication = false } = {}) {
    if (!['completed','failed','cancelled'].includes(state) || typeof result !== 'string' || result.length > 32768
      || typeof error !== 'string' || error.length > 16000 || (state === 'failed' && !error.trim())
      || (state === 'completed' && (!result.trim() || error))) fail('Invalid execution result');
    const digest = crypto.createHash('sha256').update(JSON.stringify([state,result,error])).digest('hex');
    return this.store.transaction(() => {
      const row = this.execution(executor, executionId);
      if (row.finished_at) {
        if (row.finish_digest !== digest) fail('Execution already finished with another result', 409);
        return this.status(executor, { executionId });
      }
      const packageRow = this.store.db.prepare('SELECT commit_id,receipt,lease_until FROM task_publications WHERE execution_id=?').get(executionId);
      if (state === 'completed' && (!publication || !packageRow?.receipt)) fail('Only ScriptaHub can complete a confirmed publication', 409);
      if (state !== 'completed' && packageRow && (packageRow.receipt || packageRow.commit_id || packageRow.lease_until > Date.now())) fail('Publication must be reconciled before finishing the task', 409);
      if (row.state === 'stop_requested' && state !== 'cancelled' && !publication) fail('Task has a pending stop request', 409);
      if (!['running','stop_requested'].includes(row.state) || (state === 'cancelled' && row.state !== 'stop_requested')) fail('Invalid task transition', 409);
      const time = timestamp();
      this.store.db.prepare('UPDATE tasks SET state=?,result=?,error=?,updated_at=? WHERE id=?').run(state,result,error || null,time,row.task_id);
      this.store.db.prepare('UPDATE task_executions SET finished_at=?,finish_digest=? WHERE id=?').run(time,digest,executionId);
      const change = this.store.db.prepare('SELECT book_id FROM changes WHERE id=?').get(row.change_id);
      this.store.event(executor, `task.${state}`, change.book_id, row.change_id, row.task_id);
      return this.status(executor, { executionId });
    });
  }
}
