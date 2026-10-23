import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { validateContentBook } from './content-v2.mjs';

const catalogueCache = new Map();
const bookCache = new Map();

async function expandContentIndex(entry, { allowLocal, signal, fetchImpl }) {
  const index = entry.collection;
  if (index.schemaVersion !== 2) return entry;
  if (entry.contentRoot) throw new Error('Content format v2 needs an HTTP baseUrl for local development');
  if (!Array.isArray(index.books) || index.bookCount !== index.books.length) throw new Error('Invalid content index');
  const ids = new Set();
  for (const reference of index.books) {
    if (!reference || !/^bk-[a-z0-9]+$/.test(reference.id || '') || ids.has(reference.id) || !/^[a-f0-9]{64}$/.test(reference.sha256 || '')) throw new Error('Invalid or duplicate content index entry');
    ids.add(reference.id);
    safeRelative(reference.path);
    if (!/^books\/[a-z0-9]+(?:-[a-z0-9]+)*\/book\.json$/.test(reference.path)) throw new Error('Content metadata path must be books/<name>/book.json');
  }
  const documents = new Array(index.books.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(6, index.books.length) }, async () => {
    while (cursor < index.books.length) {
      const position = cursor++, reference = index.books[position];
      const baseUrl = reference.baseUrl ? publicBase(reference.baseUrl, allowLocal) : entry.baseUrl;
      const url = publishedFileUrl(baseUrl, reference.path);
      const cacheKey = url.href + '\0' + reference.sha256;
      let document = bookCache.get(cacheKey);
      if (!document) {
        const timeout = AbortSignal.timeout(60000);
        const requestUrl = new URL(url);
        if (requestUrl.hostname === 'raw.githubusercontent.com') requestUrl.searchParams.set('version', reference.sha256);
        const response = await fetchImpl(requestUrl, { signal: signal ? AbortSignal.any([signal, timeout]) : timeout, cache: 'no-store', headers: { 'cache-control': 'no-cache' } });
        if (!response.ok) { await response.body?.cancel(); throw new Error(`Book metadata request failed: ${reference.id} HTTP ${response.status}`); }
        const text = await responseText(response, 16 * 1024 * 1024);
        if (crypto.createHash('sha256').update(text).digest('hex') !== reference.sha256) throw new Error(`Book metadata checksum mismatch: ${reference.id}`);
        document = validateContentBook(JSON.parse(text));
        if (document.id !== reference.id) throw new Error('Book metadata identity mismatch');
        if (document.contentDirectory && document.contentDirectory !== reference.path.slice(0, -'/book.json'.length)) throw new Error('Book content directory differs from its metadata path');
        bookCache.set(cacheKey, document);
        if (bookCache.size > 512) bookCache.delete(bookCache.keys().next().value);
      }
      documents[position] = { document, baseUrl };
    }
  }));
  return { ...entry, documents };
}

export function safeRelative(value, prefix = '') {
  if (typeof value !== 'string' || !value || value.includes('\\') || value.includes('\0') || value.startsWith('/') || value.split('/').some(part => !part || part === '.' || part === '..')) {
    throw new Error(`Unsafe catalogue path: ${String(value)}`);
  }
  if (prefix && !value.startsWith(`${prefix}/`)) throw new Error(`Path is outside ${prefix}: ${value}`);
  return value;
}

export function publishedFileUrl(baseUrl, relative) {
  safeRelative(relative);
  return new URL(relative.split('/').map(encodeURIComponent).join('/'), baseUrl);
}

export async function responseText(response, limit = 128 * 1024 * 1024) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of response.body || []) {
    bytes += chunk.length;
    if (bytes > limit) throw new Error('Published metadata exceeds the size limit');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function publicBase(value, allowLocal) {
  const url = new URL(value);
  if ((url.protocol !== 'https:' && !(allowLocal && url.protocol === 'http:')) || url.username || url.password || url.search || url.hash) {
    throw new Error('Content baseUrl must be a public HTTPS directory URL');
  }
  if (!url.pathname.endsWith('/')) url.pathname += '/';
  return url.href;
}

export async function resolveSources(config, { allowLocal = false, signal, fetchImpl = fetch } = {}) {
  if (config.schemaVersion !== 1 || !Array.isArray(config.repositories)) throw new Error('Invalid sources.json');
  const seen = new Set();
  const resolved = [];
  for (const configured of config.repositories) {
    if (typeof configured !== 'string' && !allowLocal) throw new Error('Sources must be direct collection.json URL strings');
    // Filesystem and HTTP fixtures are used only by the local test harness.
    const source = typeof configured === 'string' ? { url: configured } : { ...configured };
    if (source.path) {
      if (!allowLocal || !path.isAbsolute(source.path)) throw new Error('Local test source is disabled');
      const contentPath = source.contentPath || '';
      if (contentPath) safeRelative(contentPath);
      const contentRoot = path.join(source.path, contentPath);
      source.id ||= source.path;
      if (seen.has(source.id)) throw new Error('Duplicate source URL');
      seen.add(source.id);
      const text = await fs.readFile(path.join(contentRoot, 'collection.json'), 'utf8');
      resolved.push({ source, contentRoot, baseUrl: null, revision: crypto.createHash('sha256').update(text).digest('hex'), collection: JSON.parse(text) });
      continue;
    }
    const url = new URL(source.url || new URL('collection.json', source.baseUrl).href);
    if ((url.protocol !== 'https:' && !(allowLocal && url.protocol === 'http:')) || url.username || url.password || url.search || url.hash || !url.pathname.endsWith('/collection.json')) throw new Error('Use a direct HTTPS collection.json URL');
    if (url.hostname === 'github.com') {
      const blob = /^\/([\w.-]+)\/([\w.-]+)\/blob\/(.+\/collection\.json)$/.exec(url.pathname);
      if (!blob || url.port) throw new Error('Use a GitHub blob link to collection.json');
      url.hostname = 'raw.githubusercontent.com';
      url.pathname = `/${blob[1]}/${blob[2]}/${blob[3]}`;
    }
    source.url = url.href;
    source.id = url.href;
    if (seen.has(url.href)) throw new Error('Duplicate source URL');
    seen.add(url.href);
    const baseUrl = new URL('.', url).href;
    const cached = catalogueCache.get(url.href);
    const headers = { 'cache-control': 'no-cache', ...(cached ? { 'if-none-match': cached.etag } : {}) };
    const requestUrl = new URL(url);
    // Required for GitHub edge caches that ignore Cache-Control: no-cache.
    if (requestUrl.hostname === 'raw.githubusercontent.com') requestUrl.searchParams.set('check', String(Date.now()));
    const timeout = AbortSignal.timeout(60000);
    const response = await fetchImpl(requestUrl, { signal: signal ? AbortSignal.any([signal, timeout]) : timeout, cache: 'no-store', headers });
    let revision, collection;
    if (response.status === 304 && cached) {
      ({ revision, collection } = cached);
    } else {
      if (!response.ok) { await response.body?.cancel(); throw new Error(`Catalogue request failed: ${url.href} HTTP ${response.status}`); }
      const text = await responseText(response);
      revision = crypto.createHash('sha256').update(text).digest('hex');
      collection = JSON.parse(text);
      catalogueCache.delete(url.href);
      if (response.headers.has('etag')) {
        catalogueCache.set(url.href, { etag: response.headers.get('etag'), revision, collection });
        if (catalogueCache.size > 8) catalogueCache.delete(catalogueCache.keys().next().value);
      }
    }
    resolved.push(await expandContentIndex({ source, baseUrl, revision, collection }, { allowLocal, signal, fetchImpl }));
  }
  return resolved;
}

export function sourceState(resolved) {
  return crypto.createHash('sha256').update(JSON.stringify(resolved.map(({ source, revision }) =>
    ({ url: source.url || source.path, revision })))).digest('hex');
}

export function bridgeBookHtml(html) {
  if (!html.includes('assets/workflow.js') || html.includes('assets/workflow-bridge.js')) return html;
  return html.replace(/(<script src=")([^"]*assets\/)workflow\.js[^"]*("><\/script>)/, (_match, start, prefix, end) =>
    `${start}${prefix}workflow-bridge.js${end}<script src="${prefix}workflow.js${end}`);
}
