// Manual browser gate. Set PLAYWRIGHT_MODULE and CHROMIUM_EXECUTABLE when Chromium is not bundled.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { resolveSources, buildSnapshot } from '../sync.mjs';
import { createSiteServer } from '../server.mjs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright-core');
const published = path.resolve(process.env.SCRIPTA_CONTENT_REPOSITORY || path.join(import.meta.dirname, '../../../scriptaBooks-1'));
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'scripta-v2-browser-'));
const screenshots = process.env.SCRIPTA_QA_OUTPUT || path.join(os.tmpdir(), 'scriptahub-v2-qa');
await fs.mkdir(screenshots, { recursive: true });
const origin = http.createServer(async (req, res) => {
  try { res.end(await fs.readFile(path.join(published, decodeURIComponent(new URL(req.url, 'http://fixture').pathname)))); }
  catch { res.writeHead(404); res.end(); }
});
await new Promise(resolve => origin.listen(0, '127.0.0.1', resolve));
let server, browser;
try {
  const config = { schemaVersion: 1, repositories: [{ id: 'qa-books', baseUrl: `http://127.0.0.1:${origin.address().port}/` }] };
  const resolved = await resolveSources(config, { allowLocal: true });
  const snapshot = await buildSnapshot({ config, resolved, dataDir: temporary });
  server = createSiteServer(snapshot.site);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}/`;
  let pagesChecked = 0;
  for (const { document } of resolved[0].documents) {
    for (const language of Object.keys(document.metadata.editions)) {
      const response = await fetch(new URL(`${document.legacyDirectory}/${language}/book.html?lang=${language}`, base));
      assert.equal(response.status, 200);
      assert.ok((await response.text()).includes(document.id));
      pagesChecked++;
    }
  }
  browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}), args: ['--disable-background-networking', '--disable-component-update', '--disable-sync', '--disable-extensions', '--metrics-recording-only', '--no-first-run', '--mute-audio'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.route('**/*', route => route.request().url().startsWith(base) || /^(data|blob):/.test(route.request().url()) ? route.continue() : route.abort());
  const page = await context.newPage(), errors = [], missing = [];
  page.on('pageerror', error => errors.push(error.stack));
  page.on('response', response => { if (response.status() >= 400) missing.push({ status: response.status(), url: response.url() }); });
  const legacy = 'books/metacult/bk-96a7b4595ce6486c/en/book.html?lang=en';
  await page.goto(base + legacy, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  assert.equal(page.url(), base + legacy);
  assert.equal(await page.locator('.book-copy h1').textContent(), 'Metacult');
  assert.equal(await page.locator('.cover-link img').evaluate(image => image.naturalWidth > 0), true);
  await page.screenshot({ path: path.join(screenshots, 'metacult-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.screenshot({ path: path.join(screenshots, 'metacult-mobile.png') });
  await page.setViewportSize({ width: 1440, height: 1000 });
  const read = await page.locator('[data-reading-format="read"]').getAttribute('href');
  await page.goto(new URL(read, page.url()).href, { waitUntil: 'networkidle' });
  await page.locator('.reader-html-content').waitFor();
  assert.ok((await page.locator('.reader-html-content').textContent()).length > 10000);
  await page.screenshot({ path: path.join(screenshots, 'metacult-reader.png') });
  const romanian = resolved[0].documents.find(({ document }) => document.id !== 'bk-96a7b4595ce6486c' && document.metadata.editions.ro?.fullContent).document;
  await page.goto(base + romanian.legacyDirectory + '/ro/book.html?lang=ro', { waitUntil: 'networkidle' });
  assert.equal(await page.locator('html').getAttribute('lang'), 'ro');
  const roRead = await page.locator('[data-reading-format="read"]').getAttribute('href');
  assert.equal(new URL(roRead, page.url()).searchParams.get('language'), 'ro');
  await page.goto(new URL(roRead, page.url()).href, { waitUntil: 'networkidle' });
  await page.locator('.reader-html-content').waitFor();
  await page.screenshot({ path: path.join(screenshots, 'romanian-reader.png') });
  assert.deepEqual(errors, []);
  assert.deepEqual(missing, []);
  console.log(JSON.stringify({ legacyPagesChecked: pagesChecked, desktop: 'passed', mobile: 'passed', englishReader: 'passed', romanianReader: 'passed', errors, missing, screenshots }));
} finally {
  await browser?.close();
  if (server) await new Promise(resolve => server.close(resolve));
  await new Promise(resolve => origin.close(resolve));
  await fs.rm(temporary, { recursive: true, force: true });
}
