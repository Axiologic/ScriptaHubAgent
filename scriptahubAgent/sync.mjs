import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { bridgeBookHtml, resolveSources, safeRelative, sourceState } from './published-content.mjs';
import { normalizeContentBook } from './content-v2.mjs';
export { resolveSources, safeRelative, sourceState } from './published-content.mjs';

const codeDir = path.dirname(fileURLToPath(import.meta.url));
const languages = [
  ['en', 'English'], ['fr', 'Français'], ['de', 'Deutsch'], ['es', 'Español'],
  ['pt', 'Português'], ['it', 'Italiano'], ['ro', 'Română'], ['pl', 'Polski'],
];
const langCodes = languages.map(([code]) => code);

async function hashSiteFiles(root, relative, hash) {
  const entries = await fs.readdir(path.join(root, relative), { withFileTypes: true });
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const name = path.posix.join(relative, entry.name);
    if (entry.isDirectory()) await hashSiteFiles(root, name, hash);
    else if (entry.isFile()) {
      hash.update(name).update('\0');
      hash.update(await fs.readFile(path.join(root, name)));
    } else throw new Error(`Unsupported site source: ${name}`);
  }
}

export async function snapshotFingerprint(config) {
  const hash = crypto.createHash('sha256');
  const { syncIntervalSeconds, ...contentConfig } = config;
  hash.update('http-content-v2\0').update(JSON.stringify(contentConfig)).update('\0');
  await hashSiteFiles(path.join(codeDir, 'site'), '', hash);
  return hash.digest('hex');
}

function slug(value) {
  return String(value).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'keyword';
}

export function combineCollections(books) {
  const keywords = {};
  for (const code of langCodes) {
    const counts = new Map();
    for (const book of books) {
      if (!Array.isArray(book.keywordIds) || !Array.isArray(book.keywords?.[code]) || book.keywordIds.length !== book.keywords[code].length) {
        throw new Error(`Invalid keyword catalogue for ${book.id} (${code})`);
      }
      for (let i = 0; i < book.keywordIds.length; i++) {
        const id = book.keywordIds[i];
        const label = book.keywords[code][i];
        if (typeof id !== 'string' || typeof label !== 'string') throw new Error(`Invalid keyword in ${book.id}`);
        const existing = counts.get(id);
        // ScriptaHub's catalogue uses the first label for a shared keyword ID;
        // later books may vary its case or wording in the same language.
        counts.set(id, { id, label: existing?.label || label, slug: existing?.slug || slug(label), count: (existing?.count || 0) + 1 });
      }
    }
    const values = [...counts.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, code) || a.id.localeCompare(b.id));
    const used = new Set();
    for (const item of values) {
      if (used.has(item.slug)) item.slug += `--${slug(item.id)}`;
      used.add(item.slug);
    }
    keywords[code] = values;
  }
  return { schemaVersion: 1, supportedLanguages: languages.map(([code, name]) => ({ code, name })), bookCount: books.length, books, keywords };
}

async function regularFile(root, relative) {
  const parts = safeRelative(relative).split('/');
  let current = root;
  for (const part of parts) {
    current = path.join(current, part);
    const stat = await fs.lstat(current);
    if (stat.isSymbolicLink()) throw new Error(`Symlink in published path: ${relative}`);
  }
  const stat = await fs.stat(current);
  if (!stat.isFile()) throw new Error(`Missing file: ${relative}`);
}

function bookPaths(book) {
  if (!book || !/^bk-[a-z0-9]+$/.test(book.id || '')) throw new Error('Invalid book ID');
  const directory = safeRelative(book.directory, 'books');
  const paths = [];
  for (const edition of Object.values(book.editions || {})) for (const [key, value] of Object.entries(edition || {})) {
    if (['book', 'fullContent', 'shortContent', 'cover', 'thumbnail', 'sourceCover', 'pdf'].includes(key)) paths.push(value);
  }
  for (const field of ['coverUrl', 'thumbnailUrl']) for (const value of Object.values(book[field] || {})) paths.push(value);
  for (const candidate of paths) safeRelative(candidate, directory);
  return { directory, paths };
}

async function checkBook(repoDocs, book) {
  const { directory, paths } = bookPaths(book);
  await regularFile(repoDocs, `${directory}/manifest.json`);
  await regularFile(repoDocs, `${directory}/editions.json`);
  const manifest = JSON.parse(await fs.readFile(path.join(repoDocs, directory, 'manifest.json'), 'utf8'));
  if (manifest.id !== book.id) throw new Error(`Manifest ID differs for ${directory}`);
  for (const candidate of new Set(paths)) await regularFile(repoDocs, candidate);
  return directory;
}

async function bridgeBookForms(bookRoot) {
  const animation = path.join(bookRoot, 'Animation', 'index.html');
  const html = await fs.readFile(animation, 'utf8').catch(error => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (!html) return;
  const updated = bridgeBookHtml(html);
  if (updated === html) return;
  await fs.writeFile(animation, updated);
}

export async function buildSnapshot({ configPath = process.env.SCRIPTA_CONFIG || path.join(codeDir, 'sources.json'), dataDir = process.env.SCRIPTA_DATA_DIR || path.join(codeDir, 'data'), allowLocal = false, config: suppliedConfig, resolved: suppliedResolved, signal } = {}) {
  const config = suppliedConfig || JSON.parse(await fs.readFile(path.join(dataDir, 'sources.json'), 'utf8').catch(error => {
    if (error.code !== 'ENOENT') throw error;
    return fs.readFile(configPath, 'utf8');
  }));
  const resolved = suppliedResolved || await resolveSources(config, { allowLocal, signal });
  const fingerprint = await snapshotFingerprint(config);
  const sources = sourceState(resolved);
  const snapshots = path.join(dataDir, 'snapshots');
  const generation = crypto.randomUUID();
  const staging = path.join(snapshots, generation);
  const site = path.join(staging, 'site');
  await fs.mkdir(staging, { recursive: true, mode: 0o700 });
  try {
    await fs.cp(path.join(codeDir, 'site'), site, { recursive: true });
    const books = [];
    const remoteBooks = [];
    const seenBooks = new Set();
    const seenRoutes = new Set();
    for (const entry of resolved) {
      signal?.throwIfAborted();
      const source = entry.source;
      const collection = entry.collection;
      if (entry.documents) {
        for (const { document, baseUrl } of entry.documents) {
          const book = normalizeContentBook(document);
          if (seenBooks.has(book.id) || seenRoutes.has(book.directory)) throw new Error(`Duplicate book ID or route: ${book.id}`);
          seenBooks.add(book.id); seenRoutes.add(book.directory);
          remoteBooks.push({ format: 'content-v2', directory: book.directory, canonicalDirectory: `books/${book.id}`, baseUrl, book, document });
          books.push(book);
        }
        continue;
      }
      if (!Array.isArray(collection.books) || collection.bookCount !== collection.books.length) throw new Error(`Invalid catalogue in ${source.id}`);
      for (const book of collection.books) {
        signal?.throwIfAborted();
        const { directory } = bookPaths(book);
        if (seenBooks.has(book.id) || seenRoutes.has(directory)) throw new Error(`Duplicate book ID or route: ${book.id}`);
        seenBooks.add(book.id); seenRoutes.add(directory);
        if (entry.contentRoot) {
          await checkBook(entry.contentRoot, book);
          await fs.mkdir(path.dirname(path.join(site, directory)), { recursive: true });
          await fs.cp(path.join(entry.contentRoot, directory), path.join(site, directory), { recursive: true, dereference: false });
          await bridgeBookForms(path.join(site, directory));
        } else {
          remoteBooks.push({ directory, baseUrl: entry.baseUrl });
        }
        books.push(book);
      }
    }
    const collection = combineCollections(books);
    const weights = new Map(collection.keywords.en.map(keyword => [keyword.id, keyword.count]));
    for (const route of remoteBooks) if (route.format === 'content-v2') route.keywordWeights = Object.fromEntries(route.book.keywordIds.map(id => [id, weights.get(id)]));
    await fs.writeFile(path.join(site, 'collection.json'), JSON.stringify(collection, null, 2) + '\n');
    await fs.writeFile(path.join(site, 'collection.js'), `globalThis.SCRIPTA_COLLECTION = ${JSON.stringify(collection)};\n`);
    await fs.writeFile(path.join(staging, 'remote-books.json'), JSON.stringify({ schemaVersion: 1, books: remoteBooks }) + '\n');
    const activeTemp = path.join(dataDir, 'active.tmp');
    await fs.writeFile(activeTemp, JSON.stringify({ generation, fingerprint, sources }) + '\n');
    await fs.rename(activeTemp, path.join(dataDir, 'active.json'));
    return { generation, bookCount: books.length, site };
  } catch (error) {
    await fs.rm(staging, { recursive: true, force: true });
    throw error;
  }
}

export async function activeSite(dataDir = process.env.SCRIPTA_DATA_DIR || path.join(codeDir, 'data')) {
  const { generation } = JSON.parse(await fs.readFile(path.join(dataDir, 'active.json'), 'utf8'));
  if (!/^[0-9a-f-]{36}$/.test(generation)) throw new Error('Invalid active generation');
  return path.join(dataDir, 'snapshots', generation, 'site');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  buildSnapshot().then(result => console.log(JSON.stringify(result)), error => { console.error(error); process.exitCode = 1; });
}
