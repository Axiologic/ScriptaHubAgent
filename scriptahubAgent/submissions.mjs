import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { verifyRouterUser } from './identity.mjs';
import { sealRecord, verifyRecord } from './record-integrity.mjs';

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KINDS = new Set(['manuscript', 'book-proposal', 'fork', 'edit', 'animation', 'translation', 'librarian-feedback']);

export { verifyRouterUser };

export async function readBody(req, maxBytes = 100 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw Object.assign(new Error('Upload too large'), { status: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function validateMeta(meta) {
  if (!meta || !ID.test(meta.submissionId || '') || !KINDS.has(meta.kind)) throw new Error('Invalid submission');
  if (meta.agreementVersion !== '2026-09-10' || meta.agreementAccepted !== true) throw new Error('Contribution agreement is required');
  if (!meta.values || typeof meta.values !== 'object' || Array.isArray(meta.values)) throw new Error('Invalid form data');
  for (const [key, value] of Object.entries(meta.values)) {
    if (!/^[a-zA-Z][a-zA-Z0-9_-]{0,50}$/.test(key) || typeof value !== 'string' || value.length > 16000) throw new Error('Invalid form field');
    if (key === 'name' || key === 'email') throw new Error('Contact details come from the signed-in account');
  }
  if (meta.bookId !== undefined && !/^bk-[a-z0-9]+$/.test(meta.bookId)) throw new Error('Invalid book ID');
  if (meta.language !== undefined && !/^(en|fr|de|es|pt|it|ro|pl)$/.test(meta.language)) throw new Error('Invalid language');
}

function fileKind(filename, bytes) {
  const extension = path.extname(filename).toLowerCase();
  if (extension === '.pdf' && bytes.subarray(0, 5).toString() === '%PDF-') return extension;
  if (extension === '.docx' && bytes.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) return extension;
  if (extension === '.doc' && bytes.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))) return extension;
  throw new Error('Only PDF, DOC and DOCX manuscripts are accepted');
}

export async function saveSubmission({ body, contentType, user, dataDir }) {
  if (!user?.id || !user.email) throw Object.assign(new Error('Sign in to submit'), { status: 401 });
  const request = new Request('http://localhost/upload', { method: 'POST', body, headers: { 'content-type': contentType || '' } });
  const form = await request.formData();
  const meta = JSON.parse(String(form.get('metadata') || 'null'));
  validateMeta(meta);
  const uploads = form.getAll('documents');
  if (uploads.length > 8) throw new Error('Too many documents');
  if (meta.kind === 'manuscript' && !uploads.length) throw new Error('A manuscript is required');
  const files = [];
  for (const upload of uploads) {
    if (typeof upload === 'string') throw new Error('Invalid document');
    const bytes = Buffer.from(await upload.arrayBuffer());
    if (!bytes.length || bytes.length > 50 * 1024 * 1024) throw new Error('Document size is outside the accepted range');
    const ext = fileKind(upload.name, bytes);
    files.push({ originalName: path.basename(upload.name), name: `${crypto.randomUUID()}${ext}`, sha256: crypto.createHash('sha256').update(bytes).digest('hex'), bytes });
  }
  const inbox = path.join(dataDir, 'inbox');
  const directory = path.join(inbox, meta.submissionId);
  const staging = path.join(inbox, `.staging-${meta.submissionId}-${crypto.randomUUID()}`);
  await fs.mkdir(inbox, { recursive: true, mode: 0o700 });
  const existingReceipt = async () => {
    const existing = verifyRecord(JSON.parse(await fs.readFile(path.join(directory, 'record.json'), 'utf8')));
    if (existing.owner !== user.id || JSON.stringify(existing.metadata) !== JSON.stringify(meta) || existing.files.length !== files.length || existing.files.some((file, i) => file.sha256 !== files[i].sha256)) {
      throw Object.assign(new Error('Submission ID already used'), { status: 409 });
    }
    return publicSubmission(existing);
  };
  if (await fs.stat(directory).then(() => true, error => error.code === 'ENOENT' ? false : Promise.reject(error))) return existingReceipt();
  await fs.mkdir(staging, { mode: 0o700 });
  try {
    for (const file of files) await fs.writeFile(path.join(staging, file.name), file.bytes, { flag: 'wx', mode: 0o600 });
    const record = sealRecord({ id: meta.submissionId, owner: user.id, contact: { email: user.email, displayName: user.displayName || '' }, metadata: meta, files: files.map(({ bytes, ...rest }) => rest), createdAt: new Date().toISOString(), state: 'pending', task: { schemaVersion: 1, id: meta.submissionId, type: `scriptahub.${meta.kind}` } });
    await fs.writeFile(path.join(staging, 'record.json'), JSON.stringify(record, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    try { await fs.rename(staging, directory); }
    catch (error) {
      if (error.code !== 'EEXIST' && error.code !== 'ENOTEMPTY') throw error;
      return existingReceipt();
    }
    return publicSubmission(record);
  } finally { await fs.rm(staging, { recursive: true, force: true }); }
}

function publicSubmission(record) {
  return { submissionId: record.id, state: record.state, task: record.task, createdAt: record.createdAt };
}

export async function readSubmission({ submissionId, user, dataDir }) {
  if (!ID.test(submissionId)) throw new Error('Invalid submission ID');
  const record = verifyRecord(JSON.parse(await fs.readFile(path.join(dataDir, 'inbox', submissionId, 'record.json'), 'utf8')));
  if (user && record.owner !== user.id) throw Object.assign(new Error('Forbidden'), { status: 403 });
  return publicSubmission(record);
}
