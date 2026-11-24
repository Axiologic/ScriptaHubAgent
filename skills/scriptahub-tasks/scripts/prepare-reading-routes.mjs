import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {withExecutionLock} from './anchored-files.mjs';
import {guardRemoteBackups} from './remote-skill.mjs';
import {atomicFile, atomicJson, insideRun} from './workflow-checks.mjs';
import {artworkFields, artworkPath, artworkRequirement} from './publication-artwork.mjs';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const safePath = value => typeof value === 'string' && value.split('/').every(part => /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(part));
const escape = value => String(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[char]);
const summaryMarker = /<meta\b(?=[^>]*\sname\s*=\s*["']summary-generator["'])(?=[^>]*\scontent\s*=\s*["']comprehensivesummary-skill["'])[^>]*>/i;

export async function prepareReadingRoutes({executionId, directory, collectionPath, editions}) {
  if (!/^tasks\/[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(directory ?? '') || !safePath(collectionPath)
      || path.posix.basename(collectionPath) !== 'collection.json' || !Object.keys(editions ?? {}).length) throw Error('Provide the task, catalogue path and staged editions');
  return withExecutionLock(process.cwd(), executionId, async root => {
    await guardRemoteBackups(root, executionId);
    const read = async name => fs.readFile(await insideRun(name));
    const readJson = async name => JSON.parse(await read(name));
    const claim = (await readJson(directory + '/run-state/claimed.json')).task;
    if (claim?.executionId !== executionId || !['scriptahub.book-proposal','scriptahub.fork','scriptahub.manuscript'].includes(claim.type)) {
      throw Error('Reading routes require the matching new-book claim');
    }
    const artwork = artworkRequirement(claim);
    const pkg = directory + '/package';
    const catalogue = pkg + '/' + collectionPath;
    const collection = await readJson(catalogue);
    const book = collection.books.find(book => book.id === claim.bookId);
    if (!book || ![1,2].includes(collection.schemaVersion)) throw Error('The catalogue must contain the claimed book');
    const modern = collection.schemaVersion === 2;
    const base = path.posix.dirname(catalogue);
    const metadataPath = modern ? book.path : book.directory + '/manifest.json';
    if (!safePath(metadataPath) || !metadataPath.startsWith('books/')) throw Error('Invalid book metadata path');
    const file = base + '/' + metadataPath;
    const document = await readJson(file);
    const metadata = modern ? document.metadata : document;
    if (metadata?.id !== book.id) throw Error('Book metadata belongs to another book');
    const bookRoot = path.posix.dirname(file);
    const bookRelative = path.posix.relative(base, bookRoot);
    const languages = Object.keys(editions);
    const matchesLanguages = saved => Object.keys(saved ?? {}).every(language => languages.includes(language));
    if (!matchesLanguages(metadata.editions) || (!modern && !matchesLanguages(book.editions))) throw Error('Provide resources for each included edition');
    const chosen = {}, landings = [];
    for (const [language, input] of Object.entries(editions)) {
      if (!/^[a-z]{2,3}(?:-[A-Za-z0-9]+)*$/.test(language)) throw Error('Invalid edition language');
      const required = modern ? [input.fullContent, input.comprehensiveSummary] : [language + '/full_content.html', language + '/comprehensive-summary.html'];
      const [full, short] = required;
      const landing = language + '/book.html';
      if (!safePath(full) || !safePath(short) || full === short || full === landing || short === landing) throw Error('Stage the reader and summary at distinct HTML paths for ' + language);
      const fullBytes = await read(bookRoot + '/' + full);
      const shortBytes = await read(bookRoot + '/' + short);
      if (!fullBytes.length || !summaryMarker.test(shortBytes.toString('utf8'))) throw Error('Stage the comprehensive summary and full reader for ' + language);
      const {shortDescription, aboutBook} = input;
      if (typeof shortDescription !== 'string' || !shortDescription.trim() || !Array.isArray(aboutBook) || !aboutBook.length
          || aboutBook.some(text => typeof text !== 'string' || !text.trim())) throw Error('Provide the accepted description and presentation for ' + language);
      const reader = language + '/full_content.html', summary = language + '/comprehensive-summary.html';
      const routes = {book:landing, fullContent:reader, shortContent:summary};
      const aliases = [[reader, full, fullBytes], [summary, short, shortBytes]];
      if (input.pdf !== undefined) {
        const filename = language + '/book.pdf';
        if (input.pdf !== filename) throw Error('Stage the download PDF at ' + filename);
        const pdf = await read(bookRoot + '/' + filename);
        if (pdf.subarray(0,5).toString() !== '%PDF-') throw Error('Invalid download PDF for ' + language);
        routes.pdf = filename;
        aliases.push([filename, filename, pdf]);
      }
      const pictures = {};
      if (artwork.required || input.cover !== undefined || input.thumbnail !== undefined) {
        for (const [role, filename] of Object.entries({cover:input.cover, thumbnail:input.thumbnail ?? input.cover})) {
          if (!artworkPath(filename)) throw Error('Provide a staged ' + role + ' image for ' + language);
          const bytes = await read(bookRoot + '/' + filename);
          if (!bytes.length || (artwork.sourceHash && sha256(bytes) !== artwork.sourceHash)) {
            throw Error('Invalid ' + role + ' image for ' + language);
          }
          pictures[role] = filename;
          aliases.push([filename, filename, bytes]);
        }
      }
      for (const [target, prefix] of modern ? [[metadata, '']] : [[metadata, ''], [book, bookRelative + '/']]) {
        target.editions ??= {};
        target.editions[language] = {...target.editions[language], ...Object.fromEntries(Object.entries(routes).map(([role, route]) => [role, prefix + route]))};
        (target.shortDescription ??= {})[language] = shortDescription;
        (target.aboutBook ??= {})[language] = aboutBook;
        for (const [role, filename] of Object.entries(pictures)) {
          (target[artworkFields[role]] ??= {})[language] = prefix + filename;
        }
      }
      if (modern) {
        document.resources ??= {};
        document.resourceChecksums ??= {};
        for (const [alias, filename, bytes] of aliases) {
          document.resources[alias] = bookRelative + '/' + filename;
          document.resourceChecksums[bookRelative + '/' + filename] = sha256(bytes);
        }
      } else {
        const title = metadata.title?.[language] || book.title?.[language] || book.id;
        landings.push([bookRoot + '/' + landing, landingHtml(language, title, shortDescription, aboutBook, Boolean(routes.pdf))]);
      }
      chosen[language] = {fullContent:bookRoot + '/' + full, shortContent:bookRoot + '/' + short};
    }
    for (const [filename, html] of landings) await atomicFile(filename, html);
    const saved = await atomicJson(file, document);
    if (modern) book.sha256 = saved.sha256;
    await atomicJson(catalogue, collection);
    return {status:'prepared', editions:chosen};
  });
}

function landingHtml(language, title, description, aboutBook, hasPdf) {
  const download = hasPdf ? ' · <a href="book.pdf" download>Download PDF</a>' : '';
  return `<!doctype html><html lang="${escape(language)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)}</title></head><body><main><h1>${escape(title)}</h1><p>${escape(description)}</p><nav><a href="full_content.html">Read Online</a> · <a href="comprehensive-summary.html">Read in 10 Min</a>${download}</nav>${aboutBook.map(text => '<p>' + escape(text) + '</p>').join('')}</main></body></html>\n`;
}
