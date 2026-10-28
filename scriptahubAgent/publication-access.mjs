import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

// Both encryption key and encrypted records belong to this agent's private,
// persistent volume. No runtime identity key or other service is required.
export class PublicationAccessStore {
  constructor(dataDir = process.env.SCRIPTA_DATA_DIR || path.join(import.meta.dirname, 'data')) {
    const directory = path.join(dataDir, 'private', 'publication');
    fs.mkdirSync(dataDir, {recursive:true, mode:0o700});
    for (const name of ['private', 'publication']) {
      const parent = name === 'private' ? dataDir : path.join(dataDir, 'private');
      const current = path.join(parent, name);
      try { fs.mkdirSync(current, {mode:0o700}); } catch (error) { if (error.code !== 'EEXIST') throw error; }
      if (!fs.lstatSync(current).isDirectory()) throw new Error('Unsafe publication storage directory');
      fs.chmodSync(current, 0o700);
    }
    const keyFile = path.join(directory, 'key');
    if (!fs.existsSync(keyFile)) {
      if (fs.existsSync(path.join(directory, 'access.sqlite'))) throw new Error('ScriptaHub publication storage key is missing');
      const temporary = keyFile + '.' + crypto.randomUUID() + '.tmp';
      try {
        const handle = fs.openSync(temporary, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL, 0o600);
        try { fs.writeFileSync(handle, crypto.randomBytes(32)); fs.fsyncSync(handle); } finally { fs.closeSync(handle); }
        try { fs.linkSync(temporary, keyFile); } catch (error) { if (error.code !== 'EEXIST') throw error; }
      } finally { fs.rmSync(temporary, {force:true}); }
    }
    const fd = fs.openSync(keyFile, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try {
      if (!fs.fstatSync(fd).isFile()) throw new Error('Invalid publication storage key');
      this.key = fs.readFileSync(fd);
    } finally { fs.closeSync(fd); }
    if (this.key.length !== 32) throw new Error('Invalid publication storage key');
    fs.chmodSync(keyFile, 0o600);
    const filename = path.join(directory, 'access.sqlite');
    try { if (!fs.lstatSync(filename).isFile()) throw new Error('Unsafe publication database'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    // Precreate with restrictive permissions before SQLite opens it.
    const databaseFd = fs.openSync(filename, fs.constants.O_CREAT | fs.constants.O_WRONLY | fs.constants.O_NOFOLLOW, 0o600);
    fs.closeSync(databaseFd); fs.chmodSync(filename, 0o600);
    this.db = new DatabaseSync(filename);
    this.db.exec('PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS access (id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL)');
  }
  read() {
    const row = this.db.prepare('SELECT value FROM access WHERE id=1').get();
    if (!row) return {generation:0, connection:null, pending:null};
    try {
      const {iv, tag, ciphertext} = JSON.parse(row.value);
      const decipher = crypto.createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64'));
      decipher.setAAD(Buffer.from('scriptahub-publication-v1'));
      decipher.setAuthTag(Buffer.from(tag, 'base64'));
      return JSON.parse(Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64')), decipher.final()]).toString('utf8'));
    } catch { throw new Error('ScriptaHub publication access storage cannot be decrypted'); }
  }
  update(operation) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const state = this.read();
      const result = operation(state);
      const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', this.key, iv);
      cipher.setAAD(Buffer.from('scriptahub-publication-v1'));
      const ciphertext = Buffer.concat([cipher.update(JSON.stringify(state), 'utf8'), cipher.final()]);
      const value = JSON.stringify({iv:iv.toString('base64'), tag:cipher.getAuthTag().toString('base64'), ciphertext:ciphertext.toString('base64')});
      this.db.prepare('INSERT INTO access VALUES(1,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value').run(value);
      this.db.exec('COMMIT'); return result;
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  close() { this.db.close(); this.key.fill(0); }
}
export function validPublicationToken(token) {
  if (typeof token !== 'string' || !token.trim() || token.length > 4096 || /[\s\0]/.test(token)) throw new Error('Enter a valid publication token');
  return token;
}
export async function readPublicationToken(config, {dataDir} = {}) {
  if (!config) throw Object.assign(new Error('Configure Git access in ScriptaHub Settings before processing manuscripts'), {status:503});
  let store;
  try {
    store = new PublicationAccessStore(dataDir);
    const connection = store.read().connection;
    if (!connection?.publication || (connection.expiresAt && connection.expiresAt <= Date.now())) throw new Error('Missing or expired credential');
    if (connection.publication.authorName !== config.authorName || connection.publication.authorEmail !== config.authorEmail) {
      throw Object.assign(new Error('ScriptaHub Git settings changed during publication. Retry the same operation.'), {status:409});
    }
    return validPublicationToken(connection.token);
  } catch (error) {
    if (error.status === 409) throw error;
    throw Object.assign(new Error('ScriptaHub publication access is missing, expired or unreadable. Reconnect Git access in ScriptaHub Settings.'), {status:503});
  } finally { store?.close(); }
}

// Public settings contain identity only; the credential stays in this store.
export function publicationIdentity(dataDir) {
  const store = new PublicationAccessStore(dataDir);
  try {
    const connection = store.read().connection;
    return connection && (!connection.expiresAt || connection.expiresAt > Date.now()) ? connection.publication || null : null;
  } finally { store.close(); }
}
