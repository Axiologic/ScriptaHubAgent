import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { activeSite, buildSnapshot, combineCollections, resolveSources, safeRelative, sourceState } from '../sync.mjs';
import { createSiteServer } from '../server.mjs';

const codes = ['en', 'fr', 'de', 'es', 'pt', 'it', 'ro', 'pl'];

async function fixture(root, id) {
  const docs = path.join(root, 'docs');
  const directory = `books/example/${id}`;
  const bookRoot = path.join(docs, directory);
  await fs.mkdir(path.join(bookRoot, 'en'), { recursive: true });
  await fs.writeFile(path.join(bookRoot, 'manifest.json'), JSON.stringify({ id }));
  await fs.writeFile(path.join(bookRoot, 'editions.json'), JSON.stringify({ currentEdition: 'edition-1', editions: [] }));
  await fs.writeFile(path.join(bookRoot, 'en/book.html'), '<h1>Example</h1>');
  await fs.mkdir(path.join(bookRoot, 'Animation'));
  await fs.writeFile(path.join(bookRoot, 'Animation/index.html'), '<script src="../../assets/workflow.js?v=1"></script>');
  const book = { id, directory, title: { en: 'Example' }, editions: { en: { book: `${directory}/en/book.html` } }, keywordIds: ['term:a'], keywords: Object.fromEntries(codes.map(code => [code, ['Example keyword']])) };
  await fs.writeFile(path.join(docs, 'collection.json'), JSON.stringify({ bookCount: 1, books: [book] }));
  return { docs, book };
}

test('catalogue composition preserves paths and counts keywords across repositories', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'scripta-snapshot-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const one = await fixture(path.join(root, 'one'), 'bk-one');
  const two = await fixture(path.join(root, 'two'), 'bk-two');
  two.book.keywords.en[0] = 'example keyword';
  await fs.writeFile(path.join(two.docs, 'collection.json'), JSON.stringify({ bookCount: 1, books: [two.book] }));
  const dataDir = path.join(root, 'data');
  const configPath = path.join(root, 'sources.json');
  await fs.writeFile(configPath, JSON.stringify({ schemaVersion: 1, repositories: [{ id: 'one', path: path.dirname(one.docs), contentPath: 'docs' }, { id: 'two', path: path.dirname(two.docs), contentPath: 'docs' }] }));
  const result = await buildSnapshot({ configPath, dataDir, allowLocal: true });
  assert.equal(result.bookCount, 2);
  assert.deepEqual((await fs.readdir(path.join(dataDir, 'snapshots', result.generation))).sort(), ['remote-books.json', 'site']);
  const active = await activeSite(dataDir);
  const collection = JSON.parse(await fs.readFile(path.join(active, 'collection.json'), 'utf8'));
  assert.equal(collection.bookCount, 2);
  assert.equal(collection.keywords.en[0].count, 2);
  assert.equal(collection.keywords.en[0].label, 'Example keyword');
  assert.match(await fs.readFile(path.join(active, 'collection.js'), 'utf8'), /^globalThis\.SCRIPTA_COLLECTION = /);
  assert.equal(await fs.readFile(path.join(active, one.book.directory, 'en/book.html'), 'utf8'), '<h1>Example</h1>');
  assert.equal(await fs.readFile(path.join(active, one.book.directory, 'Animation/index.html'), 'utf8'), '<script src="../../assets/workflow-bridge.js"></script><script src="../../assets/workflow.js"></script>');

  const server = createSiteServer(active).listen(0, '127.0.0.1');
  t.after(() => server.close());
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const response = await fetch(`${base}/base-agent-additional-server/scriptahubAgent/3002/${one.book.directory}/en/book.html`);
  assert.equal(response.status, 200);
  assert.equal(await response.text(), '<h1>Example</h1>');
  assert.equal((await fetch(`${base}/books/%2e%2e/manifest.json`)).status, 404);

  await fs.rm(path.join(two.docs, two.book.directory, 'en/book.html'));
  await assert.rejects(buildSnapshot({ configPath, dataDir, allowLocal: true }), /ENOENT|Missing file/);
  assert.equal(await activeSite(dataDir), active);
});

test('unsafe paths and duplicate identities are refused', () => {
  assert.throws(() => safeRelative('books/../private'), /Unsafe/);
  assert.throws(() => safeRelative('/books/book'), /Unsafe/);
  const book = { id: 'bk-one', keywordIds: ['term:a'], keywords: Object.fromEntries(codes.map(code => [code, ['Alpha']])) };
  assert.equal(combineCollections([book]).bookCount, 1);
  assert.throws(() => combineCollections([{ ...book, keywords: { en: ['Alpha'] } }]), /Invalid keyword/);
});

test('catalogue URLs detect changes and normalize GitHub blob links without branch fallback', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'scripta-http-direct-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const fixtureBook = await fixture(path.join(root, 'book'), 'bk-direct');
  let text = await fs.readFile(path.join(fixtureBook.docs, 'collection.json'), 'utf8');
  const urls = [];
  const fetchImpl = async url => { urls.push(String(url)); return new Response(text); };
  const url = 'https://books.example.org/published/collection.json';
  const config = { schemaVersion: 1, repositories: [url] };
  const first = await resolveSources(config, { fetchImpl });
  assert.deepEqual(urls, [url]);
  assert.equal(first[0].baseUrl, 'https://books.example.org/published/');
  text = text.replace('Example keyword', 'Updated keyword');
  const changed = await resolveSources(config, { fetchImpl });
  assert.notEqual(sourceState(first), sourceState(changed));
  assert.equal(sourceState(changed), sourceState(await resolveSources(config, { fetchImpl })));
  const blob = 'https://github.com/example/books/blob/master/collection.json';
  const converted = await resolveSources({ ...config, repositories: [blob] }, { fetchImpl });
  assert.equal(new URL(urls.at(-1)).pathname, '/example/books/master/collection.json');
  assert.equal(new URL(urls.at(-1)).hostname, 'raw.githubusercontent.com');
  const raw = 'https://raw.githubusercontent.com/example/books/master/collection.json';
  assert.equal(sourceState(converted), sourceState(await resolveSources({ ...config, repositories: [raw] }, { fetchImpl })));
  await assert.rejects(resolveSources({ ...config, repositories: [blob, raw] }, { fetchImpl }), /Duplicate source/);
  const nested = 'https://github.com/example/books/blob/main/published/collection.json';
  const nestedSource = await resolveSources({ ...config, repositories: [nested] }, { fetchImpl });
  assert.equal(nestedSource[0].baseUrl, 'https://raw.githubusercontent.com/example/books/main/published/');
  await assert.rejects(resolveSources({ ...config, repositories: ['https://github.com/example/books.git'] }, { fetchImpl }), /direct HTTPS/);
  await assert.rejects(resolveSources({ ...config, repositories: [{ url }] }, { fetchImpl }), /URL strings/);
  await assert.rejects(resolveSources(config, { fetchImpl: async () => new Response('Missing', { status: 404 }) }), /HTTP 404/);
});

test('content-only HTTP repository is read on demand and the running site switches catalogues', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'scripta-http-content-'));
  const first = await fixture(path.join(root, 'published'), 'bk-first');
  const dataDir = path.join(root, 'data');
  const calls = [];
  const origin = http.createServer(async (req, res) => {
    calls.push({ method: req.method, path: req.url, range: req.headers.range, ifNoneMatch: req.headers['if-none-match'] });
    if (req.url.endsWith('/outage.pdf')) { res.writeHead(503); res.end(); return; }
    try {
      const filename = path.join(first.docs, decodeURIComponent(new URL(req.url, 'http://fixture').pathname));
      const body = await fs.readFile(filename);
      const etag = '"' + crypto.createHash('sha256').update(body).digest('hex') + '"';
      res.setHeader('etag', etag);
      if (req.headers['if-none-match'] === etag) { res.writeHead(304); res.end(); return; }
      if (req.headers.range === 'bytes=0-4') {
        res.writeHead(206, { 'content-range': `bytes 0-4/${body.length}`, 'accept-ranges': 'bytes' });
        res.end(body.subarray(0, 5)); return;
      }
      res.writeHead(200); res.end(req.method === 'HEAD' ? undefined : body);
    } catch { res.writeHead(404); res.end(); }
  });
  await new Promise(resolve => origin.listen(0, '127.0.0.1', resolve));
  let server;
  t.after(async () => {
    if (server) await new Promise(resolve => server.close(resolve));
    await new Promise(resolve => origin.close(resolve));
    await fs.rm(root, { recursive: true, force: true });
  });
  const config = { schemaVersion: 1, repositories: [{ id: 'books', baseUrl: `http://127.0.0.1:${origin.address().port}/` }] };
  const resolved = await resolveSources(config, { allowLocal: true });
  assert.deepEqual(calls.map(call => call.path), ['/collection.json']);
  const unchanged = await resolveSources(config, { allowLocal: true });
  assert.equal(sourceState(resolved), sourceState(unchanged));
  assert.match(calls.at(-1).ifNoneMatch, /^"[a-f0-9]{64}"$/);
  const snapshot = await buildSnapshot({ config, resolved, dataDir, allowLocal: true });
  assert.deepEqual(calls.map(call => call.path), ['/collection.json', '/collection.json']);
  await assert.rejects(fs.stat(path.join(snapshot.site, 'books')), /ENOENT/);
  assert.deepEqual((await fs.readdir(path.dirname(snapshot.site))).sort(), ['remote-books.json', 'site']);
  server = createSiteServer(snapshot.site);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}/base-agent-additional-server/scriptahubAgent/3002/`;
  const bookUrl = new URL(`${first.book.directory}/en/book.html`, base);
  const html = await fetch(bookUrl);
  assert.equal(html.headers.get('content-type'), 'text/html; charset=utf-8');
  assert.equal(await html.text(), '<h1>Example</h1>');
  assert.equal(calls.at(-1).path, `/${first.book.directory}/en/book.html`);
  assert.equal((await fetch(bookUrl, { method: 'HEAD' })).status, 200);
  assert.equal(calls.at(-1).method, 'HEAD');
  const animation = await (await fetch(new URL(`${first.book.directory}/Animation/`, base))).text();
  assert.match(animation, /workflow-bridge\.js/);
  await fs.mkdir(path.join(first.docs, first.book.directory, 'en/assets'));
  await fs.writeFile(path.join(first.docs, first.book.directory, 'en/assets/figure.svg'), '<svg></svg>');
  const image = await fetch(new URL(`${first.book.directory}/en/assets/figure.svg`, base));
  assert.equal(image.headers.get('content-type'), 'image/svg+xml');
  assert.equal(await image.text(), '<svg></svg>');
  await fs.writeFile(path.join(first.docs, first.book.directory, 'en/book.pdf'), '%PDF-123456789');
  const pdf = await fetch(new URL(`${first.book.directory}/en/book.pdf`, base), { headers: { range: 'bytes=0-4' } });
  assert.equal(pdf.status, 206);
  assert.equal(pdf.headers.get('content-range'), 'bytes 0-4/14');
  assert.equal(await pdf.text(), '%PDF-');
  assert.equal((await fetch(new URL(`${first.book.directory}/missing.png`, base))).status, 404);
  assert.equal((await fetch(new URL(`${first.book.directory}/outage.pdf`, base))).status, 502);
  assert.equal((await fetch(new URL('remote-books.json', base))).status, 404);
  const beforeUnknown = calls.length;
  assert.equal((await fetch(new URL('books/unknown/bk-unknown/en/book.html', base))).status, 404);
  assert.equal(calls.length, beforeUnknown);

  const second = await fixture(path.join(root, 'published'), 'bk-second');
  const updated = await resolveSources(config, { allowLocal: true });
  assert.notEqual(sourceState(resolved), sourceState(updated));
  const next = await buildSnapshot({ config, resolved: updated, dataDir, allowLocal: true });
  server.setSiteRoot(next.site);
  assert.equal((await (await fetch(new URL('collection.json', base))).json()).books[0].id, 'bk-second');
  assert.equal((await fetch(bookUrl)).status, 404);
  assert.equal(await (await fetch(new URL(`${second.book.directory}/en/book.html`, base))).text(), '<h1>Example</h1>');
  const priorSite = await activeSite(dataDir);
  updated[0].collection.books[0].directory = '../private';
  await assert.rejects(buildSnapshot({ config, resolved: updated, dataDir, allowLocal: true }), /Unsafe/);
  assert.equal(await activeSite(dataDir), priorSite);
});

test('legacy reader resources use the agent landing page at the original URL, including existing snapshots', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(),'scripta-legacy-reader-'));
  const source = await fixture(path.join(root,'published'),'bk-legacy');
  const directory = source.book.directory;
  source.book.title = {ro:'Cartea publicată'};
  source.book.shortDescription = {ro:'Descrierea cărții'};
  source.book.editions = {ro:{book:`${directory}/ro/book.html`,fullContent:`${directory}/ro/full_content.html`,shortContent:`${directory}/ro/short_content.html`}};
  await fs.mkdir(path.join(source.docs,directory,'ro'));
  const full = '<main data-reader-content>Conținutul integral</main>';
  const short = '<main data-reader-content>Rezumatul de zece minute</main>';
  await fs.writeFile(path.join(source.docs,directory,'ro/book.html'),full);
  await fs.writeFile(path.join(source.docs,directory,'ro/full_content.html'),full);
  await fs.writeFile(path.join(source.docs,directory,'ro/short_content.html'),short);
  await fs.writeFile(path.join(source.docs,'collection.json'),JSON.stringify({schemaVersion:1,bookCount:1,books:[source.book]}));
  const requests = [];
  const origin = http.createServer(async(req,res)=>{
    requests.push(req.url);
    try {res.end(await fs.readFile(path.join(source.docs,new URL(req.url,'http://fixture').pathname)));}
    catch {res.writeHead(404);res.end();}
  });
  await new Promise(resolve=>origin.listen(0,'127.0.0.1',resolve));
  let server;
  t.after(async()=>{
    if(server) await new Promise(resolve=>server.close(resolve));
    await new Promise(resolve=>origin.close(resolve));
    await fs.rm(root,{recursive:true,force:true});
  });
  const config={schemaVersion:1,repositories:[{id:'legacy',baseUrl:`http://127.0.0.1:${origin.address().port}/`}]};
  const resolved=await resolveSources(config,{allowLocal:true});
  const snapshot=await buildSnapshot({config,resolved,dataDir:path.join(root,'data'),allowLocal:true});
  // Old snapshots did not retain book metadata in their routing manifest.
  const routesFile=path.join(snapshot.site,'../remote-books.json');
  const routes=JSON.parse(await fs.readFile(routesFile));delete routes.books[0].book;
  await fs.writeFile(routesFile,JSON.stringify(routes));
  server=createSiteServer(snapshot.site);
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}/base-agent-additional-server/scriptahubAgent/3002/`;
  const pageUrl=new URL(`${directory}/ro/book.html?lang=ro`,base);
  const before=requests.length;
  const response=await fetch(pageUrl),markup=await response.text();
  assert.equal(response.status,200);assert.equal(response.url,pageUrl.href);
  assert.match(markup,/Cartea publicată/);
  assert.match(markup,/data-reading-format="short"/);assert.match(markup,/data-reading-format="read"/);
  assert.doesNotMatch(markup,/data-download-pdf/);
  assert.equal(requests.length,before,'landing is rendered without fetching legacy book.html');
  for(const [format,content] of [['read',full],['short',short]]) {
    const href=markup.match(new RegExp(`data-reading-format="${format}"[^>]*href="([^"]+)"`))[1].replaceAll('&amp;','&');
    const reader=new URL(href,pageUrl);
    assert.equal(reader.pathname,new URL('reader/index.html',base).pathname);
    assert.equal(reader.searchParams.get('language'),'ro');
    assert.equal((await fetch(reader)).status,200);
    assert.equal(await (await fetch(new URL(reader.searchParams.get('html'),reader))).text(),content);
  }
  const head=await fetch(pageUrl,{method:'HEAD'});
  assert.equal(head.status,200);assert.equal(await head.text(),'');
});

for (const format of ['fullContent', 'shortContent', 'otherLanguage']) {
  test(`legacy ${format} sharing a book page URL remains readable`, async t => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'scripta-legacy-shared-'));
    const site = path.join(root, 'site');
    await fs.mkdir(site);
    const directory = 'books/legacy-shared';
    const resource = `${directory}/en/book.html`;
    const editions = {en: {book: resource}};
    if (format === 'otherLanguage') editions.ro = {book: `${directory}/ro/book.html`, fullContent: resource};
    else editions.en[format] = resource;
    const book = {id: 'legacy-shared', directory, title: {en: 'Shared resource'}, editions};
    await fs.writeFile(path.join(site, 'collection.json'), JSON.stringify({schemaVersion: 1, bookCount: 1, books: [book]}));
    const manuscript = '<main data-reader-content>Original manuscript</main>';
    const requests = [];
    const origin = http.createServer((req, res) => {
      requests.push(req.url);
      res.setHeader('content-type', 'text/html');
      res.end(req.method === 'HEAD' ? undefined : manuscript);
    });
    let server;
    t.after(async () => {
      if (server) await new Promise(resolve => server.close(resolve));
      await new Promise(resolve => origin.close(resolve));
      await fs.rm(root, {recursive: true, force: true});
    });
    await new Promise(resolve => origin.listen(0, '127.0.0.1', resolve));
    await fs.writeFile(path.join(root, 'remote-books.json'), JSON.stringify({schemaVersion: 1,
      books: [{directory, baseUrl: `http://127.0.0.1:${origin.address().port}/`}]}));
    server = createSiteServer(site);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${server.address().port}/${resource}`;
    const response = await fetch(url);
    assert.equal(response.status, 200);
    assert.equal(await response.text(), manuscript);
    const head = await fetch(url, {method: 'HEAD'});
    assert.equal(head.status, 200);
    assert.equal(await head.text(), '');
    assert.deepEqual(requests, [`/${resource}`, `/${resource}`]);
  });
}
