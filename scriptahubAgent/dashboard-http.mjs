import fs from 'node:fs/promises';
import { loadPointsPolicy, savePointsPolicy } from './points-policy.mjs';
import { describePointsLedger } from './points-ledger.mjs';
import path from 'node:path';
import crypto from 'node:crypto';
import { readBody } from './submissions.mjs';
import { verifyRecord } from './record-integrity.mjs';

export async function handleDashboard({ req, res, url, pathname, verifyUser, getStore, catalogue, pointsPolicy, dataDir, publicMount = '' }) {
  const body = req.method === 'POST' ? await readBody(req, 32768) : Buffer.alloc(0);
  const user = await verifyUser(req, url, body);
  if (!user) { res.writeHead(401); res.end(); return; }
  const store = getStore(); store.remember(user, catalogue());
  let result;
  if (pathname === '/api/dashboard/points/policy') {
    if (!user.roles?.includes('admin')) {res.writeHead(403);res.end();return;}
    if (req.method === 'GET') result = {points:await loadPointsPolicy(dataDir)};
    else if (req.method === 'POST') result = {points:await savePointsPolicy(dataDir,JSON.parse(body.toString()))};
    else {res.writeHead(405,{'allow':'GET, POST'});res.end();return;}
    res.writeHead(200,{'content-type':'application/json','cache-control':'private, no-store'});
    res.end(JSON.stringify(result));return;
  }
  if (pathname === '/api/dashboard/points' || pathname.startsWith('/api/dashboard/points/')) {
    if (!user.userAgentCall) throw Object.assign(new Error('Points service is unavailable.'), {status:503});
    const member = user.id.slice(5);
    const admin = user.roles?.includes('admin');
    if (!admin && ['/api/dashboard/points/users','/api/dashboard/points/grant','/api/dashboard/points/offer-settings'].includes(pathname)) { res.writeHead(403); res.end(); return; }
    if (pathname === '/api/dashboard/points' && req.method === 'GET') {
      const userId = admin && url.searchParams.get('userId') || member;
      const start = Number(url.searchParams.get('start') || 0);
      if (!Number.isSafeInteger(start) || start < 0) throw new Error('Invalid history page.');
      const balance = await user.userAgentCall('userpersisto_credits_balance',{userId,includeExpiring:true});
      const ledger = await user.userAgentCall('userpersisto_credits_ledger',{userId,start,pageSize:25});
      result = {balance,ledger:describePointsLedger(store,ledger,'user:'+userId,catalogue(),url.searchParams.get('lang') || 'en'),admin};
    } else if (pathname === '/api/dashboard/points/offer' && req.method === 'GET') {
      result = await user.userAgentCall('userpersisto_billing_credits_offer',{});
    } else if (pathname === '/api/dashboard/points/offer-settings' && req.method === 'GET' && admin) {
      result = await user.userAgentCall('userpersisto_billing_credit_price_get',{});
    } else if (pathname === '/api/dashboard/points/offer-settings' && req.method === 'POST' && admin) {
      const input = JSON.parse(body.toString());
      if (!input || Object.keys(input).some(key=>!['unitAmountMinor','currency'].includes(key))
        || !Number.isSafeInteger(input.unitAmountMinor) || input.unitAmountMinor < 1 || input.unitAmountMinor > 99999999
        || typeof input.currency !== 'string' || !/^[A-Za-z]{3}$/.test(input.currency)) throw new Error('Invalid points pricing.');
      result = await user.userAgentCall('userpersisto_billing_credit_price_set',{
        unitAmountMinor:input.unitAmountMinor,currency:input.currency.toLowerCase(),
      });
    } else if (pathname === '/api/dashboard/points/users' && req.method === 'GET' && admin) {
      const start = Number(url.searchParams.get('start') || 0);
      if (!Number.isSafeInteger(start) || start < 0) throw new Error('Invalid users page.');
      result = await user.userAgentCall('userpersisto_user_list',{search:(url.searchParams.get('search') || '').slice(0,200),start,pageSize:25});
    } else if (pathname === '/api/dashboard/points/grant' && req.method === 'POST' && admin) {
      const { userId, amount, reason, requestId } = JSON.parse(body.toString());
      if (typeof userId !== 'string' || !Number.isSafeInteger(amount) || amount < 1 || amount > 1000000
        || typeof reason !== 'string' || !reason.trim() || reason.length > 500
        || typeof requestId !== 'string' || !/^[0-9a-f-]{36}$/i.test(requestId)) throw new Error('Invalid points award.');
      result = await user.userAgentCall('userpersisto_credits_grant',{userId,amount,reason:reason.trim(),referenceId:'scriptahub:admin:' + requestId});
    } else if (pathname === '/api/dashboard/points/checkout-status' && req.method === 'POST') {
      const input = JSON.parse(body.toString());
      if (!input || Object.keys(input).some(key=>key!=='sessionId') || !/^cs_[A-Za-z0-9_]{1,200}$/.test(input.sessionId || '')) throw new Error('Invalid checkout session.');
      result = await user.userAgentCall('userpersisto_billing_checkout_verify',{sessionId:input.sessionId});
    } else if (pathname === '/api/dashboard/points/checkout' && req.method === 'POST') {
      const { requestId, quantity, returnUrl } = JSON.parse(body.toString());
      if (!Number.isSafeInteger(quantity) || quantity<1 || typeof requestId !== 'string' || !/^[0-9a-f-]{36}$/i.test(requestId)) throw new Error('Invalid checkout request.');
      let destination;
      try { destination = new URL(returnUrl); } catch { throw new Error('Invalid checkout return page.'); }
      const mount = publicMount;
      if (!['https:','http:'].includes(destination.protocol) || destination.username || destination.password || destination.hash
        || destination.pathname !== mount + '/account/dashboard.html' || destination.searchParams.get('tab') !== 'points'
        || [...destination.searchParams.keys()].some(key=>!['tab','lang'].includes(key))) throw new Error('Invalid checkout return page.');
      result = await user.userAgentCall('userpersisto_billing_checkout_create',{kind:'credits',uiMode:'elements',quantity,idempotencyKey:requestId,returnUrl:destination.href});
    }
    if (!result) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, {'content-type':'application/json','cache-control':'private, no-store'});
    res.end(JSON.stringify(result)); return;
  }
  if (req.method === 'GET' && pathname === '/api/dashboard/book-context') {
    const book = store.book(url.searchParams.get('bookId'));
    if (book.origin !== 'catalogue' && book.revision === 0 && !user.roles?.includes('admin') && !store.canRead(book,user)) { res.writeHead(404);res.end();return; }
    result = {bookId:book.id,revision:book.revision,owner:book.owner === user.id};
  }
  else if (req.method === 'GET' && pathname === '/api/dashboard') result = { ...store.overview(user), pointsPolicy: await pointsPolicy() };
  else if (req.method === 'GET' && pathname === '/api/dashboard/points-policy') result = await pointsPolicy();
  else if (req.method === 'GET' && /^\/api\/dashboard\/files\/[0-9a-f-]{36}\/\d+$/.test(pathname)) {
    const [, submissionId, index] = pathname.match(/files\/([^/]+)\/(\d+)$/);
    const change = store.db.prepare('SELECT * FROM changes WHERE id=?').get(submissionId);
    if (!change || (!user.roles?.includes('admin') && change.author !== user.id
      && (!change.book_id || !store.canRead(store.book(change.book_id), user)))) {
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
    if (pathname === '/api/dashboard/review') result = store.decide(user, input.changeId, input.decision, input.note, input.annotationDecisions, input.attempt);
    else if (pathname === '/api/dashboard/editions') {
      const policy = await pointsPolicy();
      const {editionCost} = policy;
      if (!store.cycles.read(input.submissionId ?? '') && (input.confirmedCost ?? 0) !== editionCost) throw Object.assign(new Error('The points cost has changed. Review it before continuing.'), {status:409});
      result = store.submitEdition(user,input.bookId,input.submissionId,editionCost,policy);
    }
    else if (pathname === '/api/dashboard/retry') result = store.transaction(() => store.cycles.retry(user,input.cycleId,input.attempt));
    else if (pathname === '/api/dashboard/cancel') { store.cancel(user, input.taskId); result = { ok: true }; }
    else if (pathname === '/api/dashboard/access') { store.access(user, input.bookId, input.email, input.remove === true); result = { ok: true }; }
  }
  if (!result) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'private, no-store' });
  res.end(JSON.stringify(result));
}
