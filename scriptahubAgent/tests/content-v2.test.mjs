import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import vm from 'node:vm';
import { LANGUAGES, validateContentBook, normalizeContentBook, renderBookPage } from '../content-v2.mjs';
import { resolveSources, buildSnapshot, combineCollections } from '../sync.mjs';
import { createSiteServer } from '../server.mjs';

const sha = value => crypto.createHash('sha256').update(value).digest('hex');
test('content-only format renders the unchanged Metacult URL and maps shared resources', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'scripta-v2-'));
  const published = path.join(root, 'published');
  const id = 'bk-96a7b4595ce6486c', directory = `books/metacult/${id}`;
  const html = '<html lang="en"><body><h1 id="chapter">Metacult</h1><img src="cover.webp"><p>Original book text.</p></body></html>';
  const image = 'shared artwork';
  const content = 'books/metacult/en/full.html', cover = 'books/metacult/assets/cover.webp';
  await fs.mkdir(path.join(published, 'books/metacult/en'), { recursive: true });
  await fs.mkdir(path.join(published, 'books/metacult/assets'), { recursive: true });
  await fs.mkdir(path.join(published, 'books/metacult'), { recursive: true });
  await fs.writeFile(path.join(published, content), html);
  await fs.writeFile(path.join(published, cover), image);
  const localized = value => Object.fromEntries(Object.keys(LANGUAGES).map(code => [code, value]));
  const document = {
    schemaVersion: 2, id, legacyDirectory: directory, contentDirectory: 'books/metacult',
    metadata: { id, title: localized('Metacult'), subtitle: localized('Social technologies'), shortDescription: localized('Original description.'), category: 'Philosophy', group: 'philosophy', aboutBook: localized(['Original authored presentation.']), keywordIds: ['term:one'], keywords: localized(['community']), coverUrl: localized('en/cover.webp'), thumbnailUrl: localized('en/cover.webp'), editions: Object.fromEntries(Object.keys(LANGUAGES).map(code => [code, { book: `${code}/book.html`, cover: 'en/cover.webp', ...(code === 'en' ? { fullContent: 'en/full_content.html', shortContent: 'en/short_content.html' } : {}) }])) },
    history: { schemaVersion: 1, bookId: id, currentEdition: 'edition-1', editions: [{ id: 'edition-1', covers: { en: 'en/cover.webp' } }] },
    resources: { 'en/full_content.html': content, 'en/short_content.html': content, 'en/cover.webp': cover, 'ro/cover.webp': cover },
  };
  const serialized = JSON.stringify(document);
  await fs.writeFile(path.join(published, 'books/metacult/book.json'), serialized);
  await fs.writeFile(path.join(published, 'collection.json'), JSON.stringify({ schemaVersion: 2, bookCount: 1, books: [{ id, path: 'books/metacult/book.json', sha256: sha(serialized) }] }));
  const requests = [];
  const origin = http.createServer(async (req, res) => {
    requests.push(req.url);
    try { res.end(await fs.readFile(path.join(published, new URL(req.url, 'http://fixture').pathname))); }
    catch { res.writeHead(404); res.end(); }
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
  assert.deepEqual(requests, ['/collection.json', '/books/metacult/book.json']);
  const snapshot = await buildSnapshot({ config, resolved, dataDir: path.join(root, 'data') });
  server = createSiteServer(snapshot.site);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}/base-agent-additional-server/scriptahubAgent/3002/`;
  const legacyUrl = new URL(`${directory}/en/book.html?lang=en`, base);
  const page = await fetch(legacyUrl);
  assert.equal(page.status, 200);
  assert.equal(page.url, legacyUrl.href);
  const markup = await page.text();
  assert.match(markup, /data-book-id="bk-96a7b4595ce6486c"/);
  assert.match(markup, /Original authored presentation/);
  assert.match(markup, /data-reading-format="read"/);
  assert.match(markup, /data-book-feedback/);
  assert.equal(requests.length, 2, 'the book landing page is rendered by the agent');
  const css = markup.match(/href="([^"]*assets\/site\.css(?:\?[^"]*)?)"/)[1];
  assert.equal((await fetch(new URL(css, legacyUrl))).status, 200);
  const controls = markup.match(/href="([^"]*assets\/controls\.css\?[^"]*)"/)[1];
  assert.equal((await fetch(new URL(controls, legacyUrl))).status, 200);
  assert.equal((await fetch(new URL(`books/${id}/en/book.html?lang=en`, base))).status, 200);
  assert.equal(await (await fetch(new URL(`${directory}/en/full_content.html`, base))).text(), html);
  assert.equal(requests.at(-1), '/' + content);
  for (const code of ['en', 'ro']) assert.equal(await (await fetch(new URL(`${directory}/${code}/cover.webp`, base))).text(), image);
  assert.deepEqual(requests.slice(-2), ['/' + cover, '/' + cover]);
  assert.deepEqual(await (await fetch(new URL(`${directory}/editions.json`, base))).json(), document.history);
  assert.deepEqual(await (await fetch(new URL(`${directory}/manifest.json`, base))).json(), document.metadata);
  assert.equal((await fetch(new URL(`${directory}/not-published.pdf`, base))).status, 404);
  await assert.rejects(fs.stat(path.join(snapshot.site, 'books')), /ENOENT/);
  const cachedCount = requests.length;
  await resolveSources(config, { allowLocal: true });
  assert.equal(requests.length, cachedCount + 1, 'unchanged book checksums reuse metadata without fetching it again');
  await fs.writeFile(path.join(published, 'books/metacult/book.json'), '{}');
  const changed = { ...config, repositories: [{ ...config.repositories[0], baseUrl: config.repositories[0].baseUrl + 'invalid/' }] };
  const invalidFetch = async url => new Response(String(url).endsWith('collection.json') ? JSON.stringify({ schemaVersion: 2, bookCount: 1, books: [{ id, path: 'books/metacult/book.json', sha256: '0'.repeat(64) }] }) : '{}');
  await assert.rejects(resolveSources(changed, { allowLocal: true, fetchImpl: invalidFetch }), /checksum mismatch/);
});

test('content metadata rejects escaping resources and missing mapped editions', () => {
  assert.throws(() => validateContentBook({ schemaVersion: 2, id: 'bk-one', metadata: { id: 'bk-one' }, legacyDirectory: '../private' }), /Invalid content path/);
});

test('fork requests require an explicit reusable source licence before fetching content', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(),'scripta-fork-licence-'));
  const site = path.join(root,'site'), id = 'bk-licence', directory = 'books/' + id;
  await fs.mkdir(site);
  const user = {id:'user:reader',email:'reader@example.test',installationAdministratorId:'user:admin'};
  let downloads = 0;
  const origin = http.createServer((_req,res)=>{downloads++;res.end('<main>Original book</main>');});
  await new Promise(resolve=>origin.listen(0,'127.0.0.1',resolve));
  await fs.writeFile(path.join(root,'remote-books.json'),JSON.stringify({schemaVersion:1,books:[
    {directory,baseUrl:`http://127.0.0.1:${origin.address().port}/`},
  ]}));
  const server = createSiteServer(site,{dataDir:path.join(root,'data'),manageApprovals:true,verifyUser:async()=>user});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{
    await Promise.all([server,origin].map(item=>new Promise(resolve=>item.close(resolve))));
    await fs.rm(root,{recursive:true,force:true});
  });
  const oldKey = process.env.SCRIPTA_RECORD_KEY;
  process.env.SCRIPTA_RECORD_KEY = 'test-key-for-fork-source-licence';
  t.after(()=>{
    if (oldKey === undefined) delete process.env.SCRIPTA_RECORD_KEY;
    else process.env.SCRIPTA_RECORD_KEY = oldKey;
  });
  const submit = async license => {
    const book = {id,directory,title:{en:'Original book'},editions:{en:{fullContent:directory+'/en/full.html'}},license};
    await fs.writeFile(path.join(site,'collection.json'),JSON.stringify({books:[book]}));
    const form = new FormData();
    form.set('metadata',JSON.stringify({submissionId:crypto.randomUUID(),kind:'fork',bookId:id,language:'en',
      confirmedCost:0,agreementVersion:'2026-09-10',agreementAccepted:true,
      values:{titles:'Derived book',prompt:'Add a chapter',sourceEdition:'edition-1'}}));
    return fetch(`http://127.0.0.1:${server.address().port}/api/submissions`,{method:'POST',body:form});
  };
  for (const license of [undefined,'CC-BY-ND-4.0']) {
    const response = await submit(license);
    assert.equal(response.status,403);
    assert.match((await response.json()).error,/explicit CC BY 4\.0/);
    assert.equal(downloads,0);
  }
  const response = await submit('https://creativecommons.org/licenses/by/4.0/');
  assert.equal(response.status,202,await response.text());
  assert.equal(downloads,1);
});

test('Romanian-only books render and route through available languages and formats', async () => {
  const localized = value => ({ ro: value });
  const document = {
    schemaVersion: 2, id: 'bk-romanian', legacyDirectory: 'books/romanian/bk-romanian', contentDirectory: 'books/romanian',
    metadata: { id: 'bk-romanian', title: localized('Carte românească'), subtitle: localized('Subtitlu'), shortDescription: localized('Descriere'), aboutBook: localized(['Prezentare']), keywordIds: [], keywords: {}, coverUrl: localized('ro/cover.webp'), thumbnailUrl: localized('ro/cover.webp'), editions: { ro: { book: 'ro/book.html', fullContent: 'ro/full.html', pdf: 'ro/book.pdf', cover: 'ro/cover.webp' } } },
    history: { bookId: 'bk-romanian', editions: [] },
    resources: { 'ro/full.html': 'books/romanian/ro/full.html', 'ro/book.pdf': 'books/romanian/ro/book.pdf', 'ro/cover.webp': 'books/romanian/assets/cover.webp' },
  };
  const book = normalizeContentBook(document);
  assert.equal(combineCollections([book]).bookCount, 1, 'a book without English metadata can join the catalogue');
  for (const language of ['ro', 'en', 'fr']) {
    const html = renderBookPage(book, language);
    assert.match(html, /Carte românească/);
    assert.match(html, /data-download-pdf[^>]+ro\/book.pdf/);
    assert.doesNotMatch(html, /undefined/);
    assert.match(html, /aria-disabled="true"/, 'missing summary is disabled');
  }
  const context = vm.createContext({ URL, URLSearchParams });
  vm.runInContext(await fs.readFile(new URL('../site/assets/reading.js', import.meta.url), 'utf8'), context);
  const reading = context.ScriptaReading;
  const url = reading.readingUrl(book, 'en', 'read', 'en', 'http://fixture/');
  assert.equal(url.searchParams.get('language'), 'ro');
  assert.match(url.searchParams.get('html'), /ro\/full.html$/);
  assert.match(url.searchParams.get('back'), /ro\/book.html/);
  assert.match(url.searchParams.get('pdf'), /ro\/book.pdf$/);
  assert.match(url.searchParams.get('title'), /Carte românească/);
  assert.equal(reading.readingUrl(book, 'en', 'short', 'en', 'http://fixture/'), null);
  const bilingual = structuredClone(book);
  bilingual.editions.en = { book: 'en/book.html', fullContent: 'en/full.html', pdf: 'en/book.pdf' };
  assert.match(reading.readingUrl(bilingual, 'ro', 'read', 'ro', 'http://fixture/').searchParams.get('pdf'), /ro\/book.pdf$/);
  assert.match(reading.readingUrl(bilingual, 'fr', 'read', 'fr', 'http://fixture/').searchParams.get('html'), /en\/full.html$/);
  document.metadata.editions = {};
  assert.throws(() => validateContentBook(document), /At least one book edition/);
});
