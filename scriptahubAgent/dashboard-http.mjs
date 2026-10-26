import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { readBody } from './submissions.mjs';
import { verifyRecord } from './record-integrity.mjs';

export async function handleDashboard({ req, res, url, pathname, verifyUser, getStore, catalogue, dataDir }) {
  const body = req.method === 'POST' ? await readBody(req, 32768) : Buffer.alloc(0);
  const user = await verifyUser(req, url, body);
  if (!user) { res.writeHead(401); res.end(); return; }
  const store = getStore(); store.remember(user, catalogue());
  let result;
  if (req.method === 'GET' && pathname === '/api/dashboard') result = store.overview(user);
  else if (req.method === 'GET' && /^\/api\/dashboard\/files\/[0-9a-f-]{36}\/\d+$/.test(pathname)) {
    const [, submissionId, index] = pathname.match(/files\/([^/]+)\/(\d+)$/);
    const change = store.db.prepare('SELECT * FROM changes WHERE id=?').get(submissionId);
    if (!change || (change.author !== user.id && (!change.book_id || !store.canRead(store.book(change.book_id), user)))) {
      res.writeHead(404); res.end(); return;
    }
    const record = verifyRecord(JSON.parse(await fs.readFile(path.join(dataDir, 'inbox', submissionId, 'record.json'), 'utf8')));
    const file = record.files[Number(index)];
    if (!file || path.basename(file.name) !== file.name) { res.writeHead(404); res.end(); return; }
    const bytes = await fs.readFile(path.join(dataDir, 'inbox', submissionId, file.name));
    if (crypto.createHash('sha256').update(bytes).digest('hex') !== file.sha256) throw new Error('Document integrity check failed');
    res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(file.originalName)}`, 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' });
    res.end(bytes); return;
  } else if (req.method === 'POST') {
    const input = JSON.parse(body.toString());
    if (pathname === '/api/dashboard/review') result = store.decide(user, input.changeId, input.decision, input.note);
    else if (pathname === '/api/dashboard/cancel') { store.cancel(user, input.taskId); result = { ok: true }; }
    else if (pathname === '/api/dashboard/access') { store.access(user, input.bookId, input.email, input.remove === true); result = { ok: true }; }
  }
  if (!result) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'private, no-store' });
  res.end(JSON.stringify(result));
}
