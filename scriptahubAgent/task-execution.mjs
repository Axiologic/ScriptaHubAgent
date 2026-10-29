import { approvedAnnotations } from './annotations.mjs';
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
export const executionTools = new Set(['scriptahub_task_batch_snapshot', 'scriptahub_task_batch_settle', 'scriptahub_task_batch_close', 'scriptahub_task_claim', 'scriptahub_task_status', 'scriptahub_task_document_read', 'scriptahub_task_finish', 'scriptahub_task_package_prepare', 'scriptahub_task_package_upload', 'scriptahub_task_publish']);

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
    store.db.exec(`CREATE TABLE IF NOT EXISTS task_batches (
      id TEXT PRIMARY KEY, executor TEXT NOT NULL, task_type TEXT NOT NULL, created_at TEXT NOT NULL, closed_at TEXT);
      CREATE TABLE IF NOT EXISTS task_batch_items (batch_id TEXT NOT NULL REFERENCES task_batches(id),
      task_id TEXT NOT NULL REFERENCES tasks(id), position INTEGER NOT NULL, released INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY(batch_id,task_id));
      CREATE UNIQUE INDEX IF NOT EXISTS task_batch_exclusive ON task_batch_items(task_id) WHERE released=0;`);
    createPublicationTables(store);
  }
  execution(executor, executionId) {
    if (!identifier(executionId)) fail('Invalid execution ID');
    const row = this.store.db.prepare(`SELECT e.*,t.state,t.change_id,t.kind,t.base_revision,t.result,t.error FROM task_executions e
      JOIN tasks t ON t.id=e.task_id WHERE e.id=? AND e.executor_agent_id=?`).get(executionId, executor);
    return row || fail('Execution not found', 404);
  }
  present(row) {
    const change = this.store.db.prepare('SELECT * FROM changes WHERE id=?').get(row.change_id);
    const book = this.store.book(change.book_id);
    const payload = JSON.parse(change.payload);
    if (row.base_revision !== null) {
      let fileIndex = 0;
      const requests = this.store.editionRequests(row.task_id).map(request => {
        const input=JSON.parse(request.payload);
        return {id:request.id,authorId:request.author,kind:request.kind,baseRevision:request.base_revision,language:input.metadata.language,
          values:Object.fromEntries(Object.entries(input.metadata.values).filter(([key])=>!['annotations','annotationDraftKey','baseRevision'].includes(key))),
          annotations:approvedAnnotations(input),
          files:input.files.map(file=>({index:fileIndex++,originalName:file.originalName,sha256:file.sha256}))};
      });
      if (!requests.length) fail('The edition task has no approved request snapshot',409);
      const languages=[...new Set(requests.map(request=>request.language).filter(Boolean))];
      return {executionId:row.id,runId:row.run_id,taskId:row.task_id,state:row.state,bookId:book.id,ownerId:book.owner,
        type:'scriptahub.edit',baseRevision:row.base_revision,requests,values:{},language:languages.length===1?languages[0]:undefined,
        annotations:requests.flatMap(request=>request.annotations.map(item=>({...item,changeId:request.id}))),
        files:requests.flatMap(request=>request.files),result:row.result,error:row.error};
    }
    return { executionId: row.id, runId: row.run_id, taskId: row.task_id, state: row.state,
      bookId: book.id, ownerId: book.owner, authorId: change.author, type: `scriptahub.${row.kind}`,
      values: Object.fromEntries(Object.entries(payload.metadata.values).filter(([key]) => !['annotations','annotationDraftKey'].includes(key))), language: payload.metadata.language,
      baseRevision:change.base_revision, annotations:approvedAnnotations(payload),
      files: payload.files.map((file, index) => ({ index, originalName: file.originalName, sha256: file.sha256 })),
      result: row.result, error: row.error };
  }
  batch(executor,batchId) {
    if(!identifier(batchId))fail('Invalid batch ID');
    const batch=this.store.db.prepare('SELECT * FROM task_batches WHERE id=? AND executor=?').get(batchId,executor);
    return batch || fail('Task batch not found',404);
  }
  snapshot(executor,{batchId,taskType}={}) {
    if(!identifier(batchId)||!['manuscript','edit'].includes(taskType))fail('Invalid task batch');
    return this.store.transaction(()=>{
      let batch=this.store.db.prepare('SELECT * FROM task_batches WHERE id=?').get(batchId);
      if(batch){if(batch.executor!==executor||batch.task_type!==taskType)fail('Task batch identity mismatch',409);}
      else {
        this.store.db.prepare('INSERT INTO task_batches(id,executor,task_type,created_at) VALUES(?,?,?,?)').run(batchId,executor,taskType,timestamp());
        const tasks=this.store.db.prepare(`SELECT t.id FROM tasks t JOIN changes c ON c.id=t.change_id
          WHERE t.state='queued' AND c.state='accepted' AND t.kind=? AND NOT EXISTS
          (SELECT 1 FROM task_batch_items i WHERE i.task_id=t.id AND i.released=0) ORDER BY t.created_at,t.id`).all(taskType);
        const insert=this.store.db.prepare('INSERT INTO task_batch_items(batch_id,task_id,position) VALUES(?,?,?)');
        tasks.forEach((task,index)=>insert.run(batchId,task.id,index));
        batch=this.batch(executor,batchId);
      }
      const items = this.store.db.prepare(`SELECT i.task_id AS taskId,i.released,t.state,e.run_id AS runId
        FROM task_batch_items i JOIN tasks t ON t.id=i.task_id LEFT JOIN task_executions e ON e.task_id=t.id
        WHERE i.batch_id=? ORDER BY i.position`).all(batchId);
      return {batchId,taskType,closed:Boolean(batch.closed_at),taskIds:items.map(item=>item.taskId),items};
    });
  }
  settle(executor,{batchId,taskId,runId}={}) {
    if (!identifier(runId)) fail('Invalid item run ID');
    return this.store.transaction(()=>{
      this.batch(executor,batchId);
      const item=this.store.db.prepare('SELECT * FROM task_batch_items WHERE batch_id=? AND task_id=?').get(batchId,taskId);
      if(!item)fail('Task is outside this batch',403);
      const task=this.store.db.prepare('SELECT * FROM tasks WHERE id=?').get(taskId);
      const execution=this.store.db.prepare('SELECT * FROM task_executions WHERE task_id=?').get(taskId);
      if(execution && (execution.executor_agent_id!==executor||execution.run_id!==runId))fail('Task execution does not belong to this workflow run',409);
      if (!['completed','failed','cancelled'].includes(task.state)) fail('Confirm the terminal task result before releasing its reservation',409);
      this.store.db.prepare('UPDATE task_batch_items SET released=1 WHERE batch_id=? AND task_id=?').run(batchId,taskId);
      return {taskId,state:task.state};
    });
  }
  closeBatch(executor,{batchId}={}) {
    return this.store.transaction(()=>{
      this.batch(executor,batchId);
      const active=this.store.db.prepare(`SELECT 1 FROM task_batch_items i JOIN tasks t ON t.id=i.task_id
        WHERE i.batch_id=? AND i.released=0 AND t.state IN ('running','stop_requested')`).get(batchId);
      if(active)fail('Settle the active task before closing its batch',409);
      this.store.db.prepare('UPDATE task_batch_items SET released=1 WHERE batch_id=?').run(batchId);
      this.store.db.prepare('UPDATE task_batches SET closed_at=COALESCE(closed_at,?) WHERE id=?').run(timestamp(),batchId);
      return {batchId,closed:true};
    });
  }
  claim(executor, { runId, taskId, taskType = 'manuscript', batchId } = {}) {
    if (!['manuscript','edit'].includes(taskType)) fail('Invalid task type');
    if (!identifier(runId) || (taskId !== undefined && !identifier(taskId))) fail('Invalid run or task ID');
    return this.store.transaction(() => {
      if(batchId!==undefined){
        const batch=this.batch(executor,batchId);
        if(batch.closed_at||batch.task_type!==taskType||!taskId||!this.store.db.prepare('SELECT 1 FROM task_batch_items WHERE batch_id=? AND task_id=? AND released=0').get(batchId,taskId))fail('Task is not reserved for this batch',409);
        const first = this.store.db.prepare('SELECT task_id FROM task_batch_items WHERE batch_id=? AND released=0 ORDER BY position LIMIT 1').get(batchId);
        if (first?.task_id !== taskId) fail('Finish the preceding task before claiming the next batch item',409);
      }
      const existing = this.store.db.prepare('SELECT id,task_id FROM task_executions WHERE executor_agent_id=? AND run_id=?').get(executor, runId);
      if (existing) {
        if (taskId && taskId !== existing.task_id) fail('Run already belongs to another task', 409);
        const task = this.present(this.execution(executor, existing.id));
        if (task.type !== `scriptahub.${taskType}`) fail('Run already belongs to another task type',409);
        return {task};
      }
      const task = this.store.db.prepare(`SELECT t.* FROM tasks t JOIN changes c ON c.id=t.change_id JOIN books b ON b.id=c.book_id
        WHERE t.state='queued' AND c.state='accepted' AND t.kind=? AND (? IS NULL OR t.id=?) AND NOT EXISTS (SELECT 1 FROM task_batch_items i WHERE i.task_id=t.id AND i.released=0 AND (? IS NULL OR i.batch_id<>?))
        ORDER BY t.created_at,t.id LIMIT 1`).get(taskType, taskId ?? null, taskId ?? null, batchId ?? null, batchId ?? null);
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
    const members = row.base_revision === null
      ? [this.store.db.prepare('SELECT * FROM changes WHERE id=?').get(row.change_id)]
      : this.store.editionRequests(row.task_id);
    const sources = members.flatMap(change => {
      const payload=JSON.parse(change.payload);
      return payload.files.map(file=>({change,payload,file}));
    });
    const source = sources[index];
    if (!source) fail('Document not found',404);
    const {change,payload,file} = source;
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
      if (state === 'completed') this.store.db.prepare('UPDATE books SET revision=revision+1 WHERE id=?').run(change.book_id);
      this.store.event(executor, `task.${state}`, change.book_id, row.change_id, row.task_id);
      return this.status(executor, { executionId });
    });
  }
}
