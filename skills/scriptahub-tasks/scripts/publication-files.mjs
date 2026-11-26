import {posix as path} from 'node:path';
import {responsiveImageReferences} from './book-input-scope.mjs';

const cleanPath = name => typeof name === 'string' && !/[\\\0?#]/.test(name)
  && name.split('/').every(part => part && !part.startsWith('.'));
const renderingAsset = /\.(?:html?|xhtml|css|svg|woff2?|ttf|otf|eot|png|jpe?g|gif|webp|avif|ico|bmp|mp3|mp4|ogg|wav|webm|m?js)$/i;
const inspectable = /\.(?:html?|xhtml|css|svg)$/i;

function* values(value) {
  if (typeof value === 'string') yield value;
  else if (value && typeof value === 'object') {
    for (const entry of Object.values(value)) yield* values(entry);
  }
}

function* localReferences(text, cssFile) {
  const markup = text.replace(/<!--[\s\S]*?-->/g, '');
  if (!cssFile) {
    for (const [tag] of markup.matchAll(/<[a-z][^>]*>/gi)) {
      for (const [, attribute, double, single, unquoted] of tag.matchAll(/\s(src|poster|data|(?:xlink:)?href)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>\x60]+))/gi)) {
        if (!/href$/i.test(attribute) || /^<(?:link|image|use|script)\b/i.test(tag)) yield double ?? single ?? unquoted;
      }
      yield* responsiveImageReferences(tag);
    }
  }
  const css = (cssFile ? markup : [...markup.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>|\sstyle\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)]
    .map(([, block, double, single]) => block ?? double ?? single).join('\n')).replace(/\/\*[\s\S]*?\*\//g, '');
  for (const match of css.matchAll(/url\(\s*(?:"([^"]+)"|'([^']+)'|([^'"\s)]+))\s*\)|@import\s+["']([^"']+)["']/gi)) {
    yield match[1] ?? match[2] ?? match[3] ?? match[4];
  }
}

export function localRenderingFiles(name, text) {
  const files = [];
  if (!inspectable.test(name)) return files;
  for (const url of localReferences(text, /\.css$/i.test(name))) {
    const reference = url.trim().replace(/&amp;/g, '&');
    if (!reference || /^(?:[a-z][a-z0-9+.-]*:|\/)/i.test(reference)) continue;
    const decoded = decodeURIComponent(reference.split(/[?#]/, 1)[0]);
    const resource = path.join(path.dirname(name), decoded);
    if (decoded && cleanPath(resource) && renderingAsset.test(resource)) files.push(resource);
  }
  return files;
}

export async function publicationFiles(collectionPath, collection, bookId, candidates, read) {
  const book = collection.books.find(entry => entry.id === bookId);
  const prefix = path.dirname(collectionPath);
  const relative = name => path.join(prefix, name);
  const selected = new Set([collectionPath]);
  const add = name => {
    if (!cleanPath(name) || !candidates.has(name)) return false;
    selected.add(name);
    return true;
  };
  const metadata = async name => {
    if (!add(name)) throw Error('Missing package metadata: ' + name);
    return JSON.parse(await read(name));
  };

  if (collection.schemaVersion === 2) {
    if (!cleanPath(book.path) || !book.path.startsWith('books/')) throw Error('Invalid book metadata path');
    const document = await metadata(relative(book.path));
    for (const [alias, name] of Object.entries(document.resources ?? {})) {
      if (!cleanPath(alias) || !cleanPath(name)) throw Error('Invalid publication resource: ' + alias);
      if (!add(relative(name))) throw Error('Missing book resource: ' + name);
    }
    return selected;
  }

  const directory = book.directory;
  if (!cleanPath(directory) || !directory.startsWith('books/') || !directory.endsWith('/' + bookId)) {
    throw Error('Book directory does not match the claimed task');
  }
  const bookRoot = relative(directory) + '/';
  const inBook = name => name.startsWith(bookRoot);
  function addReferences(base, ...fields) {
    for (const value of values(fields)) {
      if (!cleanPath(value)) continue;
      const name = path.join(base, value);
      if (inBook(name)) add(name);
    }
  }
  const manifest = await metadata(bookRoot + 'manifest.json');
  const history = await metadata(bookRoot + 'editions.json');
  if (manifest?.id !== bookId) throw Error('Book manifest identity mismatch');
  if (history?.bookId !== bookId || !Array.isArray(history.editions)) throw Error('Invalid edition history');
  for (const edition of Object.values(book.editions ?? {})) {
    if (!edition || typeof edition !== 'object' || Array.isArray(edition)) throw Error('Invalid edition resource');
    for (const value of Object.values(edition)) {
      if (!cleanPath(value) || !inBook(relative(value)) || !add(relative(value))) throw Error('Missing or unrelated edition resource');
    }
  }
  addReferences(prefix, book.coverUrl, book.thumbnailUrl, book.animation?.page, book.animation?.shf);
  addReferences(bookRoot, manifest.editions, manifest.coverUrl, manifest.thumbnailUrl, manifest.animation?.page, manifest.animation?.shf);
  for (const edition of history.editions) {
    addReferences(bookRoot, edition.readers, edition.files, edition.covers, edition.pdf, edition.source?.filename);
  }

  // The Set iterator also visits newly discovered stylesheets and other dependencies.
  for (const name of selected) {
    if (!inspectable.test(name)) continue;
    for (const resource of localRenderingFiles(name, (await read(name)).toString('utf8'))) {
      if (inBook(resource)) add(resource);
    }
  }
  return selected;
}
