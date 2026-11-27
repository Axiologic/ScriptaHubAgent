import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { LANGUAGES } from '../content-v2.mjs';
import { createSiteServer } from '../server.mjs';

// D28: public answers are no-cache; authenticated, API, error, 202, redirect,
// audio and video answers stay no-store.
process.env.SCRIPTA_RECORD_KEY ||= 'test-record-key-0123456789abcdef0123456789';
const mount = '/base-agent-additional-server/scriptahubAgent/3002';
const manifestUrl = new URL('../manifest.json', import.meta.url);
const user = { id: 'user:test', email: 'reader@example.org', displayName: 'Reader' };
const verifyUser = async req => req.headers['x-test-user'] ? user : null;
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const close = server => new Promise(resolve => { server.closeAllConnections?.(); server.close(resolve); });
const cache = response => response.headers.get('cache-control');

async function staticSite(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'scripta-cache-'));
  const snapshot = path.join(root, 'snapshot'), live = path.join(root, 'live');
  for (const dir of [snapshot, live]) await fs.mkdir(path.join(dir, 'assets'), { recursive: true });
  const pages = ['index.html', 'status.html', 'legal/index.html', 'librarian/index.html', 'librarian/feedback.html',
    ...['account', 'create', 'fork', 'translate', 'agreement', 'animation-request', 'feedback'].map(name => `${name}/index.html`)];
  for (const page of pages) {
    await fs.mkdir(path.dirname(path.join(snapshot, page)), { recursive: true });
    await fs.writeFile(path.join(snapshot, page), '<html></html>');
  }
  await fs.writeFile(path.join(snapshot, 'collection.js'), 'window.x=1');
  await fs.writeFile(path.join(snapshot, 'collection.json'), '{"books":[]}');
  await fs.writeFile(path.join(snapshot, 'assets/snapshot.js'), 'snapshot');
  await fs.writeFile(path.join(snapshot, 'account/app.js'), 'account');
  await fs.writeFile(path.join(live, 'assets/live.js'), 'live');
  for (const name of ['assets/song.mp3', 'assets/clip.mp4', 'assets/clip.webm']) await fs.writeFile(path.join(snapshot, name), 'media');
  for (const name of ['assets/live-song.mp3', 'assets/live-clip.mp4']) await fs.writeFile(path.join(live, name), 'media');
  const server = createSiteServer(snapshot, { dataDir: root, verifyUser, liveSiteRoot: live });
  await listen(server);
  t.after(async () => { await close(server); await fs.rm(root, { recursive: true, force: true }); });
  return { root, origin: `http://127.0.0.1:${server.address().port}`, get: (relative, init) => fetch(`http://127.0.0.1:${server.address().port}${mount}/${relative}`, { ...init, redirect: 'manual' }) };
}

test('public static pages, catalogue and live assets answer no-cache', async t => {
  const site = await staticSite(t);
  for (const relative of ['index.html', 'status.html', 'legal/index.html', 'librarian/index.html', 'collection.js', 'collection.json', 'assets/live.js']) {
    const response = await site.get(relative);
    assert.equal(response.status, 200, relative);
    assert.equal(cache(response), 'no-cache', relative);
  }
  assert.equal(cache(await site.get('assets/snapshot.js')), 'public, max-age=300', 'non-live static files keep their existing lifetime');
});

test('authenticated static pages stay no-store', async t => {
  const site = await staticSite(t);
  const authed = { headers: { 'x-test-user': 'reader' } };
  for (const relative of ['account/index.html', 'create/index.html', 'fork/index.html', 'translate/index.html', 'agreement/index.html',
    'animation-request/index.html', 'feedback/index.html', 'librarian/feedback.html', 'account/app.js']) {
    const response = await site.get(relative, authed);
    assert.equal(response.status, 200, relative);
    assert.equal(cache(response), 'no-store', relative);
  }
});

test('API, error, 202 and redirect answers stay no-store', async t => {
  const site = await staticSite(t);
  const session = await site.get('api/session', { headers: { 'x-test-user': 'reader' } });
  assert.equal(session.status, 200);
  assert.equal(cache(session), 'private, no-store');
  const redirect = await fetch(`${site.origin}${mount}/`, { redirect: 'manual' });
  assert.equal(redirect.status, 308);
  assert.equal(cache(redirect), 'no-store');
  const invalid = await site.get('assets/..%2Fx');
  assert.equal(invalid.status, 400);
  assert.equal(cache(invalid), 'no-store');
  const form = new FormData();
  form.set('metadata', '{}');
  const rejected = await fetch(`${site.origin}${mount}/api/submissions`, { method: 'POST', body: form, headers: { 'x-test-user': 'reader' } });
  assert.ok(rejected.status >= 400, 'an invalid submission is an error answer');
  assert.equal(cache(rejected), 'no-store');
});

test('audio and video answers stay no-store on the static path, snapshot and live', async t => {
  const site = await staticSite(t);
  for (const relative of ['assets/song.mp3', 'assets/clip.mp4', 'assets/clip.webm', 'assets/live-song.mp3', 'assets/live-clip.mp4']) {
    const response = await site.get(relative);
    assert.equal(response.status, 200, relative);
    assert.match(response.headers.get('content-type'), /^(?:audio|video)\//, relative);
    assert.equal(cache(response), 'no-store', relative);
  }
});

test('the 202 submission answer stays no-store', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'scripta-cache-202-'));
  const site = path.join(root, 'site');
  await fs.mkdir(site);
  await fs.writeFile(path.join(site, 'collection.json'), '{"books":[]}');
  const server = createSiteServer(site, { dataDir: path.join(root, 'data'), verifyUser });
  await listen(server);
  t.after(async () => { await close(server); await fs.rm(root, { recursive: true, force: true }); });
  const form = new FormData();
  form.set('metadata', JSON.stringify({ submissionId: crypto.randomUUID(), kind: 'manuscript', agreementVersion: '2026-09-10', agreementAccepted: true, values: { titles: 'Test book' }, language: 'en' }));
  form.append('documents', new Blob(['%PDF-1.7\npage'], { type: 'application/pdf' }), 'book.pdf');
  const response = await fetch(`http://127.0.0.1:${server.address().port}${mount}/api/submissions`, { method: 'POST', body: form, headers: { 'x-test-user': 'reader' } });
  assert.equal(response.status, 202);
  assert.equal(cache(response), 'no-store');
});

async function bookSite(t, routes, upstream) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'scripta-cache-book-'));
  const site = path.join(root, 'site');
  await fs.mkdir(site);
  await fs.writeFile(path.join(site, 'collection.json'), JSON.stringify({ books: routes.catalogue || [] }));
  const origin = http.createServer((req, res) => upstream(req, res));
  await listen(origin);
  await fs.writeFile(path.join(root, 'remote-books.json'), JSON.stringify({ schemaVersion: 1, books: routes.books(`http://127.0.0.1:${origin.address().port}/`) }));
  const server = createSiteServer(site, { dataDir: path.join(root, 'data'), verifyUser });
  await listen(server);
  t.after(async () => { await close(server); await close(origin); await fs.rm(root, { recursive: true, force: true }); });
  return relative => fetch(`http://127.0.0.1:${server.address().port}${mount}/${relative}`, { redirect: 'manual' });
}

test('remote legacy book page and proxied resources: no-cache, media and ranges no-store', async t => {
  const directory = 'books/legacy';
  const book = { id: 'bk-legacy', directory, title: { en: 'Legacy' }, editions: { en: { book: `${directory}/en/book.html`, fullContent: `${directory}/en/full.html` } } };
  const types = { '.html': 'text/html', '.mp3': 'audio/mpeg', '.mp4': 'video/mp4', '.webm': 'video/webm', '.png': 'image/png' };
  const get = await bookSite(t,
    { catalogue: [book], books: baseUrl => [{ directory, baseUrl }] },
    (req, res) => {
      const type = types[path.extname(req.url)] || 'application/octet-stream';
      if (req.url.endsWith('missing.png')) { res.writeHead(404); res.end(); return; }
      if (req.headers.range) { res.writeHead(206, { 'content-type': type, 'content-range': 'bytes 0-1/5' }); res.end('ab'); return; }
      res.writeHead(200, { 'content-type': type }); res.end('hello');
    });
  const page = await get(`${directory}/en/book.html`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /<html/i);
  assert.equal(cache(page), 'no-cache', 'agent-rendered landing page');
  const html = await get(`${directory}/en/full.html`);
  assert.equal(cache(html), 'no-cache', 'proxied html');
  assert.equal(cache(await get(`${directory}/cover.png`)), 'no-cache', 'proxied image');
  for (const name of ['song.mp3', 'clip.mp4', 'clip.webm']) {
    const response = await get(`${directory}/${name}`);
    assert.equal(response.status, 200, name);
    assert.equal(cache(response), 'no-store', name);
  }
  const ranged = await fetch(html.url.replace('full.html', 'cover.png'), { headers: { range: 'bytes=0-1' } });
  assert.equal(ranged.status, 206);
  assert.equal(cache(ranged), 'no-store', 'a partial answer is never marked revalidatable');
  const missing = await get(`${directory}/missing.png`);
  assert.equal(missing.status, 404);
  assert.equal(cache(missing), 'no-store');
});

test('content-v2 book files answer no-cache and their media no-store', async t => {
  const id = 'bk-cachetest', directory = `books/${id}`;
  const localized = value => Object.fromEntries(Object.keys(LANGUAGES).map(code => [code, value]));
  const document = {
    schemaVersion: 2, id, legacyDirectory: directory, contentDirectory: 'books/cachetest',
    metadata: { id, title: localized('T'), subtitle: localized('S'), shortDescription: localized('D'), category: 'Philosophy', group: 'philosophy', aboutBook: localized(['A']), keywordIds: [], keywords: localized([]), coverUrl: localized('en/cover.webp'), thumbnailUrl: localized('en/cover.webp'), editions: Object.fromEntries(Object.keys(LANGUAGES).map(code => [code, { book: `${code}/book.html`, cover: 'en/cover.webp' }])) },
    history: { schemaVersion: 1, bookId: id, currentEdition: 'edition-1', editions: [{ id: 'edition-1', covers: { en: 'en/cover.webp' } }] },
    resources: { 'en/cover.webp': 'books/cachetest/cover.webp', 'en/song.mp3': 'books/cachetest/song.mp3' },
  };
  const get = await bookSite(t,
    { catalogue: [], books: baseUrl => [{ format: 'content-v2', directory, canonicalDirectory: directory, baseUrl, document, book: { id, directory, title: localized('T'), editions: document.metadata.editions } }] },
    (req, res) => { res.writeHead(200, { 'content-type': 'application/octet-stream' }); res.end('bytes'); });
  for (const name of ['manifest.json', 'editions.json']) {
    const response = await get(`${directory}/${name}`);
    assert.equal(response.status, 200, name);
    assert.equal(cache(response), 'no-cache', name);
  }
  const page = await get(`${directory}/en/book.html`);
  assert.equal(page.status, 200);
  assert.equal(cache(page), 'no-cache', 'agent-rendered book page');
  assert.equal(cache(await get(`${directory}/en/cover.webp`)), 'no-cache', 'proxied cover');
  const song = await get(`${directory}/en/song.mp3`);
  assert.equal(song.status, 200);
  assert.equal(cache(song), 'no-store', 'audio resource');
  const absent = await get(`${directory}/en/none.pdf`);
  assert.equal(absent.status, 404);
});

// The route marks of D29, in the short form the plan uses.
const pageMarks = ['/index.html', '/status.html', '/favicon.ico', '/collection.js', '/collection.json', '/assets/*', '/books/*', '/reader/*',
  '/all-books/*', '/editions/*', '/contributors/*', '/contributors.json', '/legal/*', '/librarian/index.html'];

test('manifest marks exactly the D29 routes and only public ones', async () => {
  const manifest = JSON.parse(await fs.readFile(manifestUrl, 'utf8'));
  const routes = manifest.routerAccess.httpRoutes;
  const short = route => route.path.slice(mount.length) || '/';
  assert.ok(routes.every(route => route.path === mount + '/' || route.path.startsWith(mount + '/')));
  assert.deepEqual(routes.filter(route => route.cache === 'page').map(short).sort(), [...pageMarks].sort());
  assert.deepEqual(routes.filter(route => route.cache === 'never').map(short), ['/health']);
  assert.equal(routes.filter(route => route.cache === 'immutable').length, 0, 'no content-addressed URL exists');
  for (const route of routes.filter(route => route.cache !== undefined)) assert.equal(route.access, 'public', route.path);
  assert.equal(routes.find(route => short(route) === '/').cache, undefined, 'the bare mount stays unmarked');
  assert.ok(routes.filter(route => route.access === 'authenticated').length >= 8);
});

test('every authenticated manifest route has a no-store answer', async t => {
  const manifest = JSON.parse(await fs.readFile(manifestUrl, 'utf8'));
  const authenticated = manifest.routerAccess.httpRoutes.filter(route => route.access === 'authenticated').map(route => route.path.slice(mount.length));
  for (const prefix of ['/api/', '/create/', '/fork/', '/feedback/', '/translate/', '/animation-request/', '/agreement/', '/account/']) assert.ok(authenticated.includes(`${prefix}*`), prefix);
  assert.ok(authenticated.includes('/librarian/feedback.html'));
  const { isAuthenticatedPath } = await import('../server.mjs');
  for (const route of authenticated) assert.equal(isAuthenticatedPath(route.replace('*', 'x')), true, route);
  for (const route of pageMarks) assert.equal(isAuthenticatedPath(route.replace('*', 'x')), false, route);
  assert.equal(isAuthenticatedPath('/feedback/index.html'), true, 'feedback is authenticated although the 401 gate does not list it');
  void t;
});

// Copy of the values Ploinky accepts in a route's `cache` field
// (Ploinky cli/server/policy/routeCacheMarkValues.js, isRouteCacheMark).
const acceptedMarks = new Set(['page', 'immutable', 'never']);

test('the manifest carries only cache values Ploinky accepts', async () => {
  const manifest = JSON.parse(await fs.readFile(manifestUrl, 'utf8'));
  for (const route of manifest.routerAccess.httpRoutes) {
    if (route.cache !== undefined) assert.ok(acceptedMarks.has(route.cache), `${route.path}: ${route.cache}`);
  }
});

// Ploinky's import-free values file loads with plain Node, so this check needs no AgentLib.
// It skips only when no sibling Ploinky checkout carries the file (a Ploinky without `never`).
test('the Ploinky validator accepts the manifest when its checkout is present', async t => {
  const relative = 'cli/server/policy/routeCacheMarkValues.js';
  const candidates = [process.env.PLOINKY_ROUTE_CACHE_MARKS, path.resolve(import.meta.dirname, '../../../ploinky', relative),
    path.resolve(import.meta.dirname, '../../../ploinky-cloudflare-cache', relative)].filter(Boolean);
  let file;
  for (const candidate of candidates) { try { await fs.access(candidate); file = candidate; break; } catch {} }
  if (!file) { t.skip(`no Ploinky checkout with ${relative} found; set PLOINKY_ROUTE_CACHE_MARKS to its path to enable`); return; }
  const { isRouteCacheMark } = await import(file);
  assert.equal(typeof isRouteCacheMark, 'function', `${file} exports isRouteCacheMark`);
  const manifest = JSON.parse(await fs.readFile(manifestUrl, 'utf8'));
  for (const route of manifest.routerAccess.httpRoutes) {
    if (route.cache !== undefined) assert.equal(isRouteCacheMark(route.cache), true, `${route.path}: ${route.cache}`);
  }
});
