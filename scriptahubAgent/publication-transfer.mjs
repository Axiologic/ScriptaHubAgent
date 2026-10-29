import crypto from 'node:crypto';
import path from 'node:path';

export const publicationError = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
export const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
export function packagePath(value) {
  if (typeof value !== 'string' || value.length > 1024 || !value || /[\\\0\r\n:%?#]/.test(value)
    || value.startsWith('/') || value.split('/').some(p => !p || p === '.' || p === '..' || p.toLowerCase() === '.git')
    || path.posix.normalize(value) !== value) publicationError('Invalid publication file path');
  return value;
}
export function createPublicationTables(store) {
  store.db.exec(`CREATE TABLE IF NOT EXISTS task_publications (
    execution_id TEXT PRIMARY KEY REFERENCES task_executions(id), manifest TEXT NOT NULL, digest TEXT NOT NULL,
    commit_id TEXT, receipt TEXT, lease_until INTEGER NOT NULL DEFAULT 0, lease_owner TEXT);
    CREATE TABLE IF NOT EXISTS task_publication_chunks (
    execution_id TEXT NOT NULL REFERENCES task_publications(execution_id), file_path TEXT NOT NULL,
    byte_offset INTEGER NOT NULL, data BLOB NOT NULL, PRIMARY KEY(execution_id,file_path,byte_offset));`);
}
export class PublicationTransfer {
  constructor(service) { this.service = service; this.store = service.store; createPublicationTables(this.store); }
  row(executionId) { return this.store.db.prepare('SELECT * FROM task_publications WHERE execution_id=?').get(executionId); }
  running(executor, executionId) {
    const execution = this.service.execution(executor, executionId);
    if (execution.state !== 'running' || execution.finished_at) publicationError('Execution is not running', 409);
    return execution;
  }
  prepare(executor, input, config) {
    const { executionId, catalogue, branch, baseCommit = null, files, validation } = input;
    const execution = this.running(executor, executionId);
    if (!config.publication) publicationError('ScriptaHub publication access is not configured', 503);
    if (!config.repositories.includes(catalogue)) publicationError('Catalogue is outside ScriptaHub configuration', 403);
    if (typeof branch !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/.test(branch)
      || branch.includes('..') || branch.includes('//') || branch.endsWith('/') || branch.endsWith('.') || branch.split('/').some(p => p.endsWith('.lock'))
      || (baseCommit !== null && !/^[a-f0-9]{40}$/.test(baseCommit || ''))) publicationError('Invalid publication baseline');
    const task = this.service.present(execution);
    if (!validation || validation.executionId !== executionId || validation.runId !== task.runId || validation.bookId !== task.bookId
      || validation.publicationPermitted !== true || validation.audit?.autoCorrect !== false
      || !['passed','passed_with_warnings'].includes(validation.audit?.status) || validation.audit.errorFindings !== 0) publicationError('A successful independent final validation is required');
    if(task.type==='scriptahub.edit'&&validation.audit.scope!=='edition_layout_regression')
      publicationError('Edited editions require a layout regression check against the original edition');
    if (!Array.isArray(files) || files.length < 2 || files.length > 500) publicationError('Provide between 2 and 500 validated files');
    const seen = new Set(); let bytes = 0;
    for (const file of files) {
      packagePath(file.path);
      if (seen.has(file.path) || !/^[a-f0-9]{64}$/.test(file.sha256 || '') || !Number.isSafeInteger(file.size)
        || file.size < 0 || file.size > 50000000) publicationError('Invalid publication inventory');
      seen.add(file.path); bytes += file.size;
    }
    if (bytes > 512000000) publicationError('Publication package exceeds 512 MB');
    const manifest = { executionId, catalogue, branch, baseCommit, bookId: task.bookId, taskType:task.type,
      sourceHashes: task.files.map(file => file.sha256), files: [...files].sort((a,b) => a.path.localeCompare(b.path)), validation };
    const text = JSON.stringify(manifest);
    if (Buffer.byteLength(text) > 100000) publicationError('Publication inventory is too large');
    const digest = sha256(text);
    return this.store.transaction(() => {
      this.running(executor, executionId);
      const existing = this.row(executionId);
      if (existing && existing.digest !== digest) publicationError('A different package is already registered for this execution', 409);
      if (!existing) this.store.db.prepare('INSERT INTO task_publications(execution_id,manifest,digest) VALUES(?,?,?)').run(executionId,text,digest);
      return { executionId, packageDigest: digest };
    });
  }
  upload(executor, { executionId, file, offset, data }) {
    return this.store.transaction(() => {
      this.running(executor, executionId);
      const row = this.row(executionId);
      if (!row || row.commit_id || row.receipt || row.lease_until > Date.now()) publicationError('Package is not accepting uploads', 409);
      const entry = JSON.parse(row.manifest).files.find(entry => entry.path === file);
      if (!entry || !Number.isSafeInteger(offset) || offset < 0 || typeof data !== 'string' || data.length > 87384
        || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data)) publicationError('Invalid publication chunk');
      const bytes = Buffer.from(data, 'base64');
      if (!bytes.length || bytes.length > 65536 || offset + bytes.length > entry.size) publicationError('Invalid publication chunk size');
      const existing = this.store.db.prepare('SELECT data FROM task_publication_chunks WHERE execution_id=? AND file_path=? AND byte_offset=?').get(executionId,file,offset);
      if (existing) {
        if (!Buffer.from(existing.data).equals(bytes)) publicationError('Conflicting upload retry', 409);
      } else {
        const { size } = this.store.db.prepare('SELECT COALESCE(SUM(length(data)),0) AS size FROM task_publication_chunks WHERE execution_id=? AND file_path=?').get(executionId,file);
        if (size !== offset) publicationError('Upload offset is not contiguous', 409);
        this.store.db.prepare('INSERT INTO task_publication_chunks VALUES(?,?,?,?)').run(executionId,file,offset,bytes);
      }
      return { nextOffset: offset + bytes.length };
    });
  }
  bytes(executionId, entry) {
    const chunks = this.store.db.prepare('SELECT byte_offset,data FROM task_publication_chunks WHERE execution_id=? AND file_path=? ORDER BY byte_offset').all(executionId,entry.path);
    let offset = 0;
    for (const chunk of chunks) {
      if (chunk.byte_offset !== offset) publicationError('Incomplete publication upload', 409);
      offset += chunk.data.length;
    }
    const bytes = Buffer.concat(chunks.map(chunk => Buffer.from(chunk.data)));
    if (offset !== entry.size || sha256(bytes) !== entry.sha256) publicationError(`Publication checksum mismatch: ${entry.path}`, 409);
    return bytes;
  }
}
