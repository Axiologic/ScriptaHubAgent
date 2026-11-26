import path from 'node:path';
import {packagePath, publicationError as fail, sha256} from './publication-transfer.mjs';

export function createModerationArtifactTables(store) {
  const {db} = store;
  db.exec(`CREATE TABLE IF NOT EXISTS task_moderation_artifacts (
    execution_id TEXT PRIMARY KEY REFERENCES task_executions(id), digest TEXT NOT NULL, manifest TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS task_moderation_artifact_chunks (
    execution_id TEXT NOT NULL REFERENCES task_moderation_artifacts(execution_id),
    file TEXT NOT NULL, offset INTEGER NOT NULL, data BLOB NOT NULL, PRIMARY KEY(execution_id,file,offset));
    CREATE TABLE IF NOT EXISTS task_moderation_verdicts (
    execution_id TEXT NOT NULL REFERENCES task_executions(id),
    policy_version INTEGER NOT NULL, fingerprint TEXT NOT NULL, PRIMARY KEY(execution_id,policy_version,fingerprint));`);
  if (!db.prepare('PRAGMA table_info(task_moderation_units)').all().some(column => column.name === 'fingerprint')) {
    store.transaction(() => {
      if (!db.prepare('PRAGMA table_info(task_moderation_units)').all().some(column => column.name === 'fingerprint')) {
        db.exec('ALTER TABLE task_moderation_units ADD COLUMN fingerprint TEXT');
      }
    });
  }
}

export function clearModerationArtifact(db, executionId) {
  db.prepare('DELETE FROM task_moderation_artifact_chunks WHERE execution_id=?').run(executionId);
  db.prepare('DELETE FROM task_moderation_artifacts WHERE execution_id=?').run(executionId);
}

export function artifactFileReview(file, sha) {
  packagePath(file);
  if (!/^[a-f0-9]{64}$/.test(sha || '')) fail('Invalid moderation file digest');
  return 'artifact-file:' + path.extname(file).toLowerCase() + ':' + sha;
}

export function activeModerationArtifact(db, executionId, artifactId) {
  const row = db.prepare('SELECT digest,manifest FROM task_moderation_artifacts WHERE execution_id=?').get(executionId);
  if (!row || row.digest !== artifactId) fail('Moderation artifact does not match this execution',409);
  return JSON.parse(row.manifest);
}

export function approvedArtifactFile(db, executionId, artifactId) {
  const {file,files} = activeModerationArtifact(db,executionId,artifactId);
  return artifactFileReview(file,files.find(entry => entry.path === file).sha256);
}

export function moderationArtifact(db, executionId, action, input, policyVersion) {
  if (action === 'prepare') {
    const row = db.prepare('SELECT digest FROM task_moderation_artifacts WHERE execution_id=?').get(executionId);
    const {file, files} = input;
    packagePath(file);
    if (!Array.isArray(files) || !files.length || files.length > 500) fail('Invalid moderation artifact inventory');
    const seen = new Set();
    let bytes = 0;
    for (const entry of files) {
      packagePath(entry.path);
      if (seen.has(entry.path) || !/^[a-f0-9]{64}$/.test(entry.sha256 || '') || !Number.isSafeInteger(entry.size)
        || entry.size < 0 || entry.size > 50000000) fail('Invalid moderation artifact inventory');
      seen.add(entry.path);
      bytes += entry.size;
    }
    if (!seen.has(file) || bytes > 512000000) fail('Invalid moderation artifact inventory');
    const manifest = JSON.stringify({file, files:[...files].sort((a,b) => a.path.localeCompare(b.path))});
    if (Buffer.byteLength(manifest) > 100000) fail('Moderation artifact inventory is too large');
    const artifactId = sha256(manifest);
    if (db.prepare(`SELECT 1 FROM task_moderation WHERE execution_id=? AND stage=? AND policy_version=?`)
      .get(executionId,'artifact:'+artifactId,policyVersion)) return {artifactId,status:'passed'};
    if (row && row.digest !== artifactId) fail('Finish the active artifact review first',409);
    if (!row) db.prepare('INSERT INTO task_moderation_artifacts VALUES(?,?,?)').run(executionId,artifactId,manifest);
    return {artifactId};
  }
  const {file,files} = activeModerationArtifact(db,executionId,input.artifactId);
  if (action === 'upload') {
    const {file:filename,offset,data} = input;
    const entry = files.find(entry => entry.path === filename);
    if (!entry || !Number.isSafeInteger(offset) || offset < 0 || typeof data !== 'string' || data.length > 87384
      || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data)) fail('Invalid moderation artifact chunk');
    const bytes = Buffer.from(data,'base64');
    if (!bytes.length || bytes.length > 65536 || offset+bytes.length > entry.size) fail('Invalid moderation artifact chunk size');
    const previous = db.prepare('SELECT data FROM task_moderation_artifact_chunks WHERE execution_id=? AND file=? AND offset=?').get(executionId,filename,offset);
    if (previous) {
      if (!Buffer.from(previous.data).equals(bytes)) fail('Conflicting moderation upload retry',409);
    } else {
      const {size} = db.prepare('SELECT COALESCE(SUM(length(data)),0) AS size FROM task_moderation_artifact_chunks WHERE execution_id=? AND file=?').get(executionId,filename);
      if (size !== offset) fail('Moderation upload offset is not contiguous',409);
      db.prepare('INSERT INTO task_moderation_artifact_chunks VALUES(?,?,?,?)').run(executionId,filename,offset,bytes);
    }
    return {nextOffset:offset+bytes.length};
  }
  return files.map(entry => {
    const chunks = db.prepare('SELECT data FROM task_moderation_artifact_chunks WHERE execution_id=? AND file=? ORDER BY offset').all(executionId,entry.path);
    const bytes = Buffer.concat(chunks.map(chunk => Buffer.from(chunk.data)));
    if (bytes.length !== entry.size || sha256(bytes) !== entry.sha256) fail('Moderation artifact upload is incomplete or changed',409);
    return {path:entry.path,bytes,sha256:entry.sha256,alreadyReviewed:entry.path !== file};
  });
}
