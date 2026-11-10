import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const MAX_MANIFEST = 8 * 1024 * 1024;
const MAX_FILE = 512 * 1024 * 1024;
const MAX_WORKSPACE = 4 * 1024 * 1024 * 1024;
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

export function processingPath(value) {
  if (typeof value !== 'string' || !value || value.length > 1024 || /[\\\0\r\n]/.test(value)
    || value.startsWith('/') || path.posix.normalize(value) !== value
    || value.split('/').some(part => !part || part === '.' || part === '..' || part === '.git'
      || part === '.apikeys' || part === 'credentials' || part === 'credential' || part === '.env' || part.startsWith('.env.'))
    || value === 'run-state/remote-processing' || value.startsWith('run-state/remote-processing/')) fail('Invalid processing file path');
  return value;
}

export function parseProcessingManifest(bytes, expectedHash, expectedSize) {
  if (!Buffer.isBuffer(bytes) || bytes.length !== expectedSize || bytes.length > MAX_MANIFEST
    || digest(bytes) !== expectedHash) fail('Processing manifest checksum mismatch',409);
  let entries;
  try { entries = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { fail('Invalid processing manifest'); }
  if (!Array.isArray(entries) || entries.length > 10000) fail('Invalid processing manifest');
  let total = 0; const seen = new Set();
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)
      || Object.keys(entry).sort().join(',') !== 'path,sha256,size') fail('Invalid processing manifest entry');
    processingPath(entry.path);
    if (!Number.isSafeInteger(entry.size) || entry.size < 0 || entry.size > MAX_FILE
      || !/^[a-f0-9]{64}$/.test(entry.sha256 || '') || seen.has(entry.path)) fail('Invalid processing manifest entry');
    seen.add(entry.path); total += entry.size;
    if (total > MAX_WORKSPACE) fail('Processing workspace exceeds limit');
  }
  for (const name of seen) {
    const parts = name.split('/');
    for (let n=1;n<parts.length;n++) if (seen.has(parts.slice(0,n).join('/'))) fail('Overlapping processing paths');
  }
  return {entries,total};
}

export function decodeProcessingChunk(data) {
  if (typeof data !== 'string' || data.length > 87384
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data)) fail('Invalid processing chunk');
  const bytes = Buffer.from(data,'base64');
  if (!bytes.length || bytes.length > 65536 || bytes.toString('base64') !== data) fail('Invalid processing chunk');
  return bytes;
}

// The supervisor serializes access to its private, service-created job directory.
export function uploadProcessingChunk(root, relative, size, offset, data) {
  processingPath(relative);
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(size) || size < 0 || size > MAX_FILE) fail('Invalid processing chunk range');
  const bytes = decodeProcessingChunk(data);
  if (offset + bytes.length > size) fail('Invalid processing chunk range');
  const components = relative.split('/');
  let directory = root;
  for (const component of components.slice(0,-1)) {
    directory = path.join(directory,component);
    try { fs.mkdirSync(directory,{mode:0o700}); } catch (error) { if (error.code !== 'EEXIST') throw error; }
    const stat = fs.lstatSync(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) fail('Invalid processing directory');
  }
  const filename = path.join(directory,components.at(-1));
  const fd = fs.openSync(filename,fs.constants.O_CREAT | fs.constants.O_RDWR | fs.constants.O_NOFOLLOW,0o600);
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.nlink !== 1) fail('Invalid processing file');
    if (offset < stat.size) {
      if (offset + bytes.length > stat.size) fail('Conflicting processing chunk retry',409);
      const existing = Buffer.alloc(bytes.length);
      if (fs.readSync(fd,existing,0,existing.length,offset) !== bytes.length || !existing.equals(bytes)) fail('Conflicting processing chunk retry',409);
    } else {
      if (offset !== stat.size) fail('Processing upload offset is not contiguous',409);
      let written=0;
      while (written < bytes.length) written += fs.writeSync(fd,bytes,written,bytes.length-written,offset+written);
      fs.fsyncSync(fd);
    }
    return offset + bytes.length;
  } finally { fs.closeSync(fd); }
}

export function verifyProcessingFile(root, entry) {
  processingPath(entry.path);
  const parts = entry.path.split('/'); let directory = root;
  for (const part of parts.slice(0,-1)) {
    directory = path.join(directory,part);
    const stat = fs.lstatSync(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) fail('Invalid processing directory');
  }
  const fd = fs.openSync(path.join(directory,parts.at(-1)),fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.nlink !== 1 || stat.size !== entry.size) fail('Processing file size mismatch',409);
    const hash = crypto.createHash('sha256'), buffer = Buffer.alloc(65536);
    let offset=0, count;
    while ((count=fs.readSync(fd,buffer,0,buffer.length,offset)) !== 0) { hash.update(buffer.subarray(0,count)); offset += count; }
    if (hash.digest('hex') !== entry.sha256) fail('Processing file checksum mismatch',409);
  } finally { fs.closeSync(fd); }
}
