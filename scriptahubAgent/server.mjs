import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { spawn } from 'node:child_process';
import { loadSourceConfig, settingsFile } from './settings.mjs';
import { pipeline } from 'node:stream/promises';
import { activeSite, buildSnapshot, resolveSources, safeRelative, snapshotFingerprint, sourceState } from './sync.mjs';
import { bridgeBookHtml, publishedFileUrl, responseText } from './published-content.mjs';
import { renderAnimationPage, renderBookPage, validateContentBook } from './content-v2.mjs';
import { readBody, readSubmission, saveSubmission, verifyRouterUser } from './submissions.mjs';
import { startNotificationWorker } from './notifications.mjs';
import { DashboardStore } from './dashboard-store.mjs';
import { handleDashboard } from './dashboard-http.mjs';

const port = Number(process.env.SCRIPTA_PORT || 3002);
const dataDir = process.env.SCRIPTA_DATA_DIR || path.join(import.meta.dirname, 'data');
const base = '/base-agent-additional-server/scriptahubAgent/3002';
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.ico': 'image/x-icon', '.pdf': 'application/pdf', '.mp3': 'audio/mpeg', '.woff2': 'font/woff2' };
const generationId = /^[0-9a-f-]{36}$/;
Object.assign(types, { '.woff': 'font/woff', '.ttf': 'font/ttf', '.otf': 'font/otf', '.eot': 'application/vnd.ms-fontobject', '.gif': 'image/gif', '.avif': 'image/avif', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4', '.mp4': 'video/mp4', '.webm': 'video/webm' });

export function syncIntervalMs(config, env = process.env) {
  const seconds = config.syncIntervalSeconds ?? 60;
  if (!Number.isSafeInteger(seconds) || seconds < 1) throw new Error('syncIntervalSeconds must be an integer of at least 1');
  const interval = env.SCRIPTA_SYNC_INTERVAL_MS === undefined ? seconds * 1000 : Number(env.SCRIPTA_SYNC_INTERVAL_MS);
  if (!Number.isSafeInteger(interval) || interval < 1000 || interval > 2147483647) throw new Error('Sync interval must be an integer between 1000 and 2147483647 ms');
  return interval;
}

async function pruneSnapshots(dataDir, keep) {
  const directory = path.join(dataDir, 'snapshots');
  for (const entry of await fsp.readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && generationId.test(entry.name) && !keep.has(entry.name)) {
      await fsp.rm(path.join(directory, entry.name), { recursive: true, force: true });
    }
  }
}

function remoteRoutes(siteRoot) {
  let data;
  try { data = JSON.parse(fs.readFileSync(path.join(siteRoot, '..', 'remote-books.json'), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  if (data.schemaVersion !== 1 || !Array.isArray(data.books)) throw new Error('Invalid remote book routes');
  for (const route of data.books) {
    safeRelative(route.directory, 'books');
    const url = new URL(route.baseUrl);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || !url.pathname.endsWith('/')) throw new Error('Invalid content URL');
    if (route.format === 'content-v2') {
      validateContentBook(route.document);
      if (route.document.legacyDirectory !== route.directory || route.document.id !== route.book?.id || route.canonicalDirectory !== `books/${route.book.id}`) throw new Error('Invalid content book route');
    }
  }
  return data.books.sort((a, b) => b.directory.length - a.directory.length);
}

async function serveRemoteBook(req, res, relative, route, target = relative) {
  const controller = new AbortController();
  const disconnected = () => { if (!res.writableEnded) controller.abort(); };
  res.once('close', disconnected);
  try {
    const headers = { 'cache-control': 'no-cache' };
    if (req.headers.range) headers.range = req.headers.range;
    if (req.headers['if-range']) headers['if-range'] = req.headers['if-range'];
    const resourceUrl = publishedFileUrl(route.baseUrl, target);
    const checksum = route.document?.resourceChecksums?.[target];
    if (checksum && resourceUrl.hostname === 'raw.githubusercontent.com') resourceUrl.searchParams.set('version', checksum);
    const upstream = await fetch(resourceUrl, {
      method: req.method, headers, cache: 'no-store', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(60000)]),
    });
    if (!upstream.ok && upstream.status !== 416) {
      await upstream.body?.cancel();
      throw Object.assign(new Error('Published book resource is unavailable'), { status: upstream.status === 404 ? 404 : 502 });
    }
    const outgoing = {
      'content-type': types[path.extname(relative).toLowerCase()] || upstream.headers.get('content-type') || 'application/octet-stream',
      'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
    };
    for (const name of ['content-range', 'accept-ranges', 'etag', 'last-modified']) {
      if (upstream.headers.has(name)) outgoing[name] = upstream.headers.get(name);
    }
    if (req.method === 'HEAD') { res.writeHead(upstream.status, outgoing); res.end(); return; }
    if (relative.endsWith('/Animation/index.html') && upstream.status === 200 && !req.headers.range) {
      const html = bridgeBookHtml(await responseText(upstream, 2 * 1024 * 1024));
      delete outgoing.etag;
      res.writeHead(200, outgoing); res.end(html); return;
    }
    res.writeHead(upstream.status, outgoing);
    if (upstream.body) await pipeline(Readable.fromWeb(upstream.body), res);
    else res.end();
  } catch (error) {
    if (!error.status) error.status = 502;
    throw error;
  } finally { res.off('close', disconnected); }
}

async function serveContentBook(req, res, relative, route) {
  const prefix = relative.startsWith(route.directory + '/') ? route.directory : route.canonicalDirectory;
  const inner = relative.slice(prefix.length + 1), document = route.document;
  let text, type;
  if (inner === 'manifest.json' || inner === 'editions.json') {
    text = JSON.stringify(inner === 'manifest.json' ? document.metadata : document.history);
    type = types['.json'];
  } else {
    const language = Object.keys(document.metadata.editions).find(code => document.metadata.editions[code].book === inner);
    if (language) { text = renderBookPage({ ...route.book, keywordWeights: route.keywordWeights }, language, relative); type = types['.html']; }
    else if (inner === 'Animation/index.html' && document.metadata.animation) { text = renderAnimationPage(route.book, relative, { agent: true }); type = types['.html']; }
  }
  if (text !== undefined) {
    res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'content-length': Buffer.byteLength(text) });
    res.end(req.method === 'HEAD' ? undefined : text);
    return;
  }
  const resource = document.resources[inner];
  if (!resource) { res.writeHead(404); res.end(); return; }
  await serveRemoteBook(req, res, relative, route, resource);
}

export function createSiteServer(siteRoot, { dataDir: submissionDataDir = dataDir, verifyUser = verifyRouterUser, liveSiteRoot = null } = {}) {
  let currentSiteRoot = siteRoot;
  let canonicalRoot = fs.realpathSync(siteRoot);
  let bookRoutes = remoteRoutes(siteRoot);
  const canonicalLiveRoot = liveSiteRoot ? fs.realpathSync(liveSiteRoot) : null;
  let store;
  const getStore = () => store ||= new DashboardStore(submissionDataDir);
  const catalogue = () => {
    try { return JSON.parse(fs.readFileSync(path.join(currentSiteRoot, 'collection.json'), 'utf8')).books || []; }
    catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  };
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      let pathname = url.pathname;
      if (pathname === base) pathname = '/';
      else if (pathname.startsWith(`${base}/`)) pathname = pathname.slice(base.length);
      if (pathname.startsWith('/api/dashboard')) {
        await handleDashboard({ req, res, url, pathname, verifyUser, getStore, catalogue, dataDir: submissionDataDir });
        return;
      }
      if (pathname === '/api/submissions' && req.method === 'POST') {
        const body = await readBody(req);
        const user = await verifyUser(req, url, body);
        if (!user) { res.writeHead(401); res.end(); return; }
        getStore().remember(user, catalogue());
        const received = await saveSubmission({ body, contentType: req.headers['content-type'], user, dataDir: submissionDataDir, store: getStore() });
        const payload = JSON.stringify(received);
        res.writeHead(202, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload), 'cache-control': 'no-store' });
        res.end(payload);
        return;
      }
      const submissionId = /^\/api\/submissions\/([0-9a-f-]{36})$/i.exec(pathname)?.[1];
      if (submissionId && req.method === 'GET') {
        const user = await verifyUser(req, url, Buffer.alloc(0));
        if (!user) { res.writeHead(401); res.end(); return; }
        const payload = JSON.stringify(await readSubmission({ submissionId, user, dataDir: submissionDataDir, store: getStore() }));
        res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'private, no-store' });
        res.end(payload);
        return;
      }
      if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); res.end(); return; }
      if (pathname === '/health') { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":true}'); return; }
      if (pathname === '/api/session') {
        const user = await verifyUser(req, url, Buffer.alloc(0));
        if (!user) { res.writeHead(401); res.end(); return; }
        getStore().remember(user, catalogue());
        const payload = JSON.stringify({ user: { id: user.id, email: user.email, displayName: user.displayName || '' } });
        res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'private, no-store' });
        res.end(payload);
        return;
      }
      if (/^\/(?:create|fork|translate|animation-request|agreement|account)\//.test(pathname) || pathname === '/librarian/feedback.html') {
        if (!await verifyUser(req, url, Buffer.alloc(0))) { res.writeHead(401); res.end(); return; }
      }
      const decoded = decodeURIComponent(pathname);
      if (decoded.includes('%') || decoded.includes('\\') || decoded.includes('\0')) throw new Error('Invalid path');
      const relative = decoded === '/' ? 'index.html' : safeRelative(decoded.slice(1).endsWith('/') ? decoded.slice(1) + 'index.html' : decoded.slice(1));
      const remote = bookRoutes.find(route => relative.startsWith(`${route.directory}/`) || route.canonicalDirectory && relative.startsWith(route.canonicalDirectory + '/'));
      if (remote) {
        if (remote.format === 'content-v2') await serveContentBook(req, res, relative, remote);
        else await serveRemoteBook(req, res, relative, remote);
        return;
      }
      let real = await fsp.realpath(path.join(currentSiteRoot, relative)).catch(() => null);
      let root = canonicalRoot;
      let servedLive = false;
      if (canonicalLiveRoot && !['collection.js', 'collection.json'].includes(relative) && !relative.startsWith('books/')) {
        const live = await fsp.realpath(path.join(canonicalLiveRoot, relative)).catch(() => null);
        if (live) { real = live; root = canonicalLiveRoot; servedLive = true; }
      }
      if (!real || !real.startsWith(`${root}${path.sep}`)) { res.writeHead(404); res.end(); return; }
      const stat = await fsp.stat(real);
      if (!stat.isFile()) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'content-type': types[path.extname(real).toLowerCase()] || 'application/octet-stream', 'content-length': stat.size, 'cache-control': servedLive || /(?:^|\/)(collection\.js|collection\.json|[^/]+\.html)$/.test(relative) ? 'no-store' : 'public, max-age=300', 'x-content-type-options': 'nosniff' });
      if (req.method === 'HEAD') { res.end(); return; }
      fs.createReadStream(real).pipe(res);
    } catch (error) {
      if (res.headersSent) { res.destroy(error); return; }
      res.writeHead(error.status || 400, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify({ error: error.message || 'Invalid request' }));
    }
  });
  server.setSiteRoot = nextRoot => {
    const nextCanonical = fs.realpathSync(nextRoot);
    const nextRoutes = remoteRoutes(nextRoot);
    canonicalRoot = nextCanonical;
    currentSiteRoot = nextRoot;
    bookRoutes = nextRoutes;
  };
  server.once('close', () => store?.close());
  return server;
}

export async function main() {
  const refresh = new AbortController();
  const configPath = process.env.SCRIPTA_CONFIG || path.join(import.meta.dirname, 'sources.json');
  let interval = syncIntervalMs(await loadSourceConfig({ configPath, dataDir }));
  let site;
  try { site = await activeSite(dataDir); }
  catch (error) {
    site = (await buildSnapshot({ dataDir, config: { schemaVersion: 1, repositories: [] } })).site;
  }
  const server = createSiteServer(site, { dataDir, liveSiteRoot: process.env.SCRIPTA_DEV_LIVE === '1' ? path.join(import.meta.dirname, 'site') : null });
  server.listen(port, '0.0.0.0', () => console.log(`ScriptaHub on ${port}`));
  const stopNotifications = startNotificationWorker({ dataDir });
  let stopping = false;
  let timer;
  let settingsWatcher;
  let settingsServer;
  const shutdown = (code = 0) => {
    if (stopping) return;
    stopping = true;
    refresh.abort();
    clearInterval(timer);
    stopNotifications();
    settingsWatcher?.close();
    settingsServer?.kill('SIGTERM');
    server.close();
    // Ploinky requires a clean exit to acknowledge a targeted drain.
    setTimeout(() => process.exit(code), 3000).unref();
    process.exitCode = code;
  };
  process.once('SIGTERM', () => shutdown());
  process.once('SIGINT', () => shutdown());
  let refreshing = false;
  let refreshAgain = false;
  const refreshCatalogue = async () => {
    if (stopping) return;
    if (refreshing) { refreshAgain = true; return; }
    refreshing = true;
    try {
      const config = await loadSourceConfig({ configPath, dataDir });
      const nextInterval = syncIntervalMs(config);
      if (nextInterval !== interval) {
        interval = nextInterval;
        clearInterval(timer);
        timer = setInterval(() => { void refreshCatalogue(); }, interval);
        timer.unref();
      }
      const resolved = await resolveSources(config, { signal: refresh.signal });
      const fingerprint = await snapshotFingerprint(config);
      const sources = sourceState(resolved);
      const active = JSON.parse(await fsp.readFile(path.join(dataDir, 'active.json'), 'utf8'));
      if (active.fingerprint === fingerprint && active.sources === sources) return;
      const updated = await buildSnapshot({ dataDir, config, resolved, signal: refresh.signal });
      if (!stopping) {
        server.setSiteRoot(updated.site);
        console.log(`ScriptaHub catalogue ready: ${updated.bookCount} books`);
        await pruneSnapshots(dataDir, new Set([active.generation, updated.generation])).catch(error =>
          console.error(`ScriptaHub snapshot cleanup failed: ${error.message}`));
      }
    } catch (error) {
      if (!stopping) console.error(`Keeping prior ScriptaHub snapshot: ${error.message}`);
    } finally {
      refreshing = false;
      if (refreshAgain && !stopping) { refreshAgain = false; void refreshCatalogue(); }
    }
  };
  timer = setInterval(() => { void refreshCatalogue(); }, interval);
  timer.unref();
  settingsWatcher = fs.watch(dataDir, (_event, filename) => {
    if (filename === path.basename(settingsFile(dataDir))) void refreshCatalogue();
  });
  settingsWatcher.on('error', error => console.error(`ScriptaHub settings watch failed: ${error.message}`));
  // Explorer Configure uses the standard Ploinky MCP server alongside the site.
  if (process.env.PLOINKY_AGENT_ID) {
    settingsServer = spawn(process.execPath, [path.join(process.env.PLOINKY_AGENT_RUNTIME_ROOT || '/Agent', 'server/AgentServer.mjs')], {
      env: { ...process.env, PORT: '7000' }, stdio: 'inherit',
    });
    settingsServer.once('error', error => { console.error(`Settings server failed: ${error.message}`); shutdown(1); });
    settingsServer.once('exit', () => { if (!stopping) shutdown(1); });
  }
  await refreshCatalogue();
}

if (process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname) main().catch(error => { console.error(error); process.exitCode = 1; });
