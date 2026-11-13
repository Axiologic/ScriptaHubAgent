import {createInputCacheTable,inputCacheBytes} from './processing-input-cache.mjs';
import crypto from 'node:crypto';
import { validateVirtualCwd } from './processing-sandbox.mjs';

const active = "'uploading','starting','running','stopping'";
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const identifier = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);

export function createProcessingTables(store) {
  createInputCacheTable(store.db);
  store.db.exec(`CREATE TABLE IF NOT EXISTS task_processing_jobs (
    execution_id TEXT NOT NULL REFERENCES task_executions(id), job_id TEXT NOT NULL,
    executor_agent_id TEXT NOT NULL, request TEXT NOT NULL, digest TEXT NOT NULL,
    state TEXT NOT NULL CHECK(state IN ('uploading','starting','running','stopping','succeeded','failed','cancelled','interrupted')),
    reserved_bytes INTEGER NOT NULL DEFAULT 0, runtime_id TEXT NOT NULL, reason TEXT, exit_code INTEGER,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(execution_id,job_id));
    CREATE UNIQUE INDEX IF NOT EXISTS task_processing_active ON task_processing_jobs(execution_id)
      WHERE state IN (${active});`);
  for (const [name,definition] of [['result_digest','TEXT'],['diagnostics_complete','INTEGER'],
    ['cleanup_requested','INTEGER NOT NULL DEFAULT 0'],['released_at','TEXT']]) {
    if(store.db.prepare('PRAGMA table_info(task_processing_jobs)').all().some(column=>column.name===name))continue;
    try {store.db.exec(`ALTER TABLE task_processing_jobs ADD COLUMN ${name} ${definition}`);}
    catch(error) {if(!store.db.prepare('PRAGMA table_info(task_processing_jobs)').all().some(column=>column.name===name))throw error;}
  }
}

// Call only from the enclosing BEGIN IMMEDIATE transaction.
export function requireNoActiveProcessing(store, executionId) {
  if (store.db.prepare(`SELECT 1 FROM task_processing_jobs WHERE execution_id=? AND state IN (${active})`).get(executionId)) {
    fail('Processing must stop before this operation', 409);
  }
}

export class ProcessingStore {
  constructor(service) { this.service = service; this.store = service.store; createProcessingTables(this.store); }
  row(executor, executionId, jobId) {
    if (!identifier(jobId)) fail('Invalid job ID');
    this.service.execution(executor, executionId);
    return this.store.db.prepare('SELECT * FROM task_processing_jobs WHERE execution_id=? AND job_id=? AND executor_agent_id=?')
      .get(executionId, jobId, executor) || fail('Processing job not found', 404);
  }
  prepare(executor, request, runtimeId, reservedBytes) {
    const { executionId, jobId } = request;
    validateVirtualCwd(request.virtualCwd);
    if (!identifier(jobId) || typeof runtimeId !== 'string' || !runtimeId || !Number.isSafeInteger(reservedBytes) || reservedBytes < 0) fail('Invalid processing job');
    const text = JSON.stringify(request), digest = crypto.createHash('sha256').update(text).digest('hex');
    return this.store.transaction(() => {
      const execution = this.service.execution(executor, executionId);
      const existing = this.store.db.prepare('SELECT * FROM task_processing_jobs WHERE execution_id=? AND job_id=?').get(executionId,jobId);
      if (existing) {
        if (existing.executor_agent_id !== executor) fail('Processing job not found',404);
        if (existing.digest !== digest || existing.runtime_id !== runtimeId) fail('Conflicting processing job retry',409);
        return existing;
      }
      if (execution.state !== 'running' || execution.finished_at) fail('Execution is not running',409);
      if (this.store.db.prepare('SELECT 1 FROM task_publications WHERE execution_id=?').get(executionId)) fail('Publication already registered',409);
      requireNoActiveProcessing(this.store,executionId);
      const prior = this.store.db.prepare('SELECT request FROM task_processing_jobs WHERE execution_id=? LIMIT 1').get(executionId);
      if (prior && JSON.parse(prior.request).virtualCwd !== request.virtualCwd) fail('Virtual working directory changed',409);
      const usage = this.store.db.prepare(`SELECT COALESCE(SUM(reserved_bytes),0) AS bytes,
        SUM(CASE WHEN state IN (${active}) THEN 1 ELSE 0 END) AS active_count FROM task_processing_jobs`).get();
      if (usage.bytes + inputCacheBytes(this.store.db) + reservedBytes > 4 * 1024 * 1024 * 1024 + 48 * 1024 * 1024 || usage.active_count >= 4) fail('Processing capacity unavailable',503);
      const time = new Date().toISOString();
      this.store.db.prepare(`INSERT INTO task_processing_jobs
        (execution_id,job_id,executor_agent_id,request,digest,state,reserved_bytes,runtime_id,created_at,updated_at)
        VALUES(?,?,?,?,?,'uploading',?,?,?,?)`).run(executionId,jobId,executor,text,digest,reservedBytes,runtimeId,time,time);
      return this.row(executor,executionId,jobId);
    });
  }
  start(executor, executionId, jobId) {
    return this.store.transaction(() => {
      const row = this.row(executor,executionId,jobId);
      if (row.state !== 'uploading') return row;
      const execution = this.service.execution(executor,executionId);
      if (execution.state !== 'running' || execution.finished_at) fail('Execution is not running',409);
      if (this.store.db.prepare('SELECT 1 FROM task_publications WHERE execution_id=?').get(executionId)) fail('Publication already registered',409);
      if (this.store.db.prepare("SELECT 1 FROM task_processing_jobs WHERE state IN ('starting','running','stopping')").get()) fail('Processing capacity unavailable',503);
      this.store.db.prepare("UPDATE task_processing_jobs SET state='starting',updated_at=? WHERE execution_id=? AND job_id=?")
        .run(new Date().toISOString(),executionId,jobId);
      return this.row(executor,executionId,jobId);
    });
  }

}
