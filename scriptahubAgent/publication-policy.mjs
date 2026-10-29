import { isDeepStrictEqual } from 'node:util';
import { packagePath, publicationError as fail, sha256 } from './publication-transfer.mjs';
import { validateContentBook } from './content-v2.mjs';
import { combineCollections } from './sync.mjs';

// The catalogue URL, not an executor-supplied remote, selects the Git destination.
export function publicationTarget(catalogue, branch) {
  const url = new URL(catalogue);
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash) fail('Unsupported publication catalogue');
  const match = url.hostname === 'github.com' ? /^\/([\w.-]+)\/([\w.-]+)\/blob\/(.+)$/.exec(url.pathname)
    : url.hostname === 'raw.githubusercontent.com' ? /^\/([\w.-]+)\/([\w.-]+)\/(.+)$/.exec(url.pathname) : null;
  if (!match || !match[3].startsWith(branch + '/')) fail('Publication requires a configured GitHub catalogue URL with the selected branch');
  const collection = packagePath(match[3].slice(branch.length + 1));
  if (!collection.endsWith('collection.json') || collection.split('/').at(-1) !== 'collection.json') fail('Invalid catalogue path');
  return { remote: `https://github.com/${match[1]}/${match[2]}.git`, branch, collection,
    root: collection.includes('/') ? collection.slice(0, collection.lastIndexOf('/') + 1) : '' };
}

function preserveEditionHistory(previous, candidate, bookId) {
  if (!previous || previous.metadata?.id !== bookId || candidate.metadata?.id !== bookId
    || previous.history?.bookId !== bookId || candidate.history?.bookId !== bookId
    || !Array.isArray(previous.history.editions) || !Array.isArray(candidate.history.editions)) fail('A verified existing edition history is required for edits',409);
  const byId = new Map();
  for (const edition of candidate.history.editions) {
    if (!edition || typeof edition.id !== 'string' || !edition.id || byId.has(edition.id)) fail('Invalid or duplicate edition history entry');
    byId.set(edition.id,edition);
  }
  for (const edition of previous.history.editions) {
    if (!isDeepStrictEqual(edition,byId.get(edition.id))) fail('Publication cannot remove or rewrite a previous edition',409);
  }
  if (previous.history.currentEdition && !candidate.history.currentEdition) fail('Publication cannot remove the current edition reference',409);
  if (candidate.metadata.currentEdition && candidate.metadata.currentEdition !== candidate.history.currentEdition) fail('Book metadata and history disagree on the current edition');
  if (candidate.history.currentEdition && !byId.has(candidate.history.currentEdition)) fail('Current edition is missing from its history');
  for (const [name,value] of Object.entries(previous.history)) {
    if (!['editions','currentEdition'].includes(name) && !isDeepStrictEqual(value,candidate.history[name])) fail('Publication cannot rewrite edition history metadata',409);
  }
  // Existing resource aliases can be referenced by historical editions. New
  // editions add aliases; they must not redirect or discard the old mappings.
  for (const [name,value] of Object.entries(previous.resources || {})) {
    if (candidate.resources?.[name] !== value) fail('Publication cannot remove or remap a previous edition resource',409);
  }
}
function preserveEditionFormats(previous, candidate) {
  for (const [language,formats] of Object.entries(previous || {})) {
    for (const key of Object.keys(formats)) {
      if (typeof candidate?.[language]?.[key] !== 'string' || !candidate[language][key]) fail('Publication cannot remove an existing edition language or format',409);
    }
  }
}
export function checkPublicationPackage(manifest, target, bytes, oldCollection, previousDocument) {
  const parse = name => {
    const value = bytes.get(name);
    if (!value) fail(`Missing package file: ${name}`);
    try { return JSON.parse(value.toString('utf8')); } catch { fail(`Invalid package JSON: ${name}`); }
  };
  const collection = parse(target.collection);
  if (![1,2].includes(collection.schemaVersion) || (oldCollection && collection.schemaVersion !== oldCollection.schemaVersion)
    || !Array.isArray(collection.books) || collection.bookCount !== collection.books.length) fail('Invalid catalogue schema or book count');
  const ids = collection.books.map(book => book.id);
  if (ids.some(id => typeof id !== 'string') || new Set(ids).size !== ids.length || !ids.includes(manifest.bookId)) fail('Invalid catalogue identities');
  const editing = manifest.taskType === 'scriptahub.edit';
  const previousBook = oldCollection?.books?.find(book => book.id === manifest.bookId);
  if (editing && !previousBook) fail('The edited book must already exist at this destination',409);
  if (oldCollection) {
    if (!Array.isArray(oldCollection.books) || (!editing && previousBook)) fail('The book already exists at this destination', 409);
    const other = collection.books.filter(book => book.id !== manifest.bookId);
    if (!isDeepStrictEqual(other, oldCollection.books.filter(book => !editing || book.id !== manifest.bookId))) fail('Publication cannot alter other books');
    for (const [key,value] of Object.entries(oldCollection)) {
      if (!['books','bookCount','keywords'].includes(key) && !isDeepStrictEqual(collection[key], value)) fail('Publication cannot alter catalogue configuration');
    }
    if (Object.keys(collection).some(key => !Object.hasOwn(oldCollection,key) && !['books','bookCount','keywords'].includes(key))) fail('Unexpected catalogue field');
  } else if (collection.schemaVersion !== 2 || collection.books.length !== 1) fail('A new catalogue must use schema 2 and contain only the claimed book');
  if (collection.schemaVersion === 1 && collection.keywords) {
    const expected = combineCollections(collection.books).keywords;
    for (const [language,entries] of Object.entries(expected)) {
      const actual = collection.keywords[language];
      if (!Array.isArray(actual) || actual.length !== entries.length || new Set(actual.map(item => item.id)).size !== actual.length) fail('Invalid catalogue keyword index');
      const counts = new Map(entries.map(item => [item.id,item.count]));
      // Index order and label capitalization do not change keyword membership.
      if (actual.some(item => counts.get(item.id) !== item.count || typeof item.label !== 'string' || typeof item.slug !== 'string')) fail('Catalogue keyword counts do not match its books');
    }
  }
  const book = collection.books.find(book => book.id === manifest.bookId);
  if (editing && (book.directory !== previousBook.directory || book.path !== previousBook.path)) fail('An edit cannot relocate the book');
  let allowed;
  if (collection.schemaVersion === 1) {
    const directory = packagePath(book.directory);
    if (!directory.startsWith('books/') || !directory.endsWith('/' + manifest.bookId)) fail('Book directory does not match the claimed task');
    const full = target.root + directory + '/';
    const metadata=parse(full+'manifest.json'),history=parse(full+'editions.json');
    if (metadata.id !== manifest.bookId) fail('Book manifest identity mismatch');
    if (editing) {
      preserveEditionHistory(previousDocument,{metadata,history},manifest.bookId);
      preserveEditionFormats(previousBook.editions,book.editions);
      preserveEditionFormats(previousDocument.metadata.editions,metadata.editions);
    }
    for (const edition of Object.values(book.editions || {})) for (const value of Object.values(edition)) {
      if (typeof value !== 'string') fail('Invalid edition resource');
      const name = target.root + packagePath(value);
      if (!name.startsWith(full) || !bytes.has(name)) fail('Missing or unrelated edition resource');
    }
    for (const field of ['coverUrl','thumbnailUrl']) for (const value of Object.values(book[field] || {})) {
      const name = target.root + packagePath(value);
      if (!name.startsWith(full) || !bytes.has(name)) fail('Missing or unrelated book artwork');
    }
    allowed = name => name.startsWith(full);
  } else {
    const metadataPath = target.root + packagePath(book.path);
    const document = validateContentBook(parse(metadataPath));
    if (editing) {
      preserveEditionHistory(previousDocument,document,manifest.bookId);
      preserveEditionFormats(previousDocument.metadata.editions,document.metadata.editions);
    }
    if (editing && !Object.values(document.resources).every(value => Object.values(previousDocument.resources || {}).includes(value) || (target.root + packagePath(value)).startsWith(metadataPath.slice(0,metadataPath.lastIndexOf('/')+1)))) fail('Edited resources must stay inside the book directory');
    if (document.id !== manifest.bookId || sha256(bytes.get(metadataPath)) !== book.sha256) fail('Book metadata integrity mismatch');
    if (document.contentDirectory && target.root + document.contentDirectory + '/book.json' !== metadataPath) fail('Book metadata path mismatch');
    const resources = new Set(Object.values(document.resources).map(value => target.root + packagePath(value)));
    for (const name of resources) if (!bytes.has(name)) fail(`Missing book resource: ${name}`);
    allowed = name => name === metadataPath || resources.has(name);
  }
  for (const name of bytes.keys()) if (name !== target.collection && !allowed(name)) fail(`File is outside the claimed book: ${name}`, 403);
  if (!editing && !manifest.sourceHashes.some(hash => [...bytes.values()].some(value => sha256(value) === hash))) fail('The package does not contain the verified source manuscript');
  return collection;
}

export function verifyCatalogueBranch(catalogue, branch, refs) {
  const candidates = refs.split('\n').map(line => line.split('\t')[1]).filter(ref => ref?.startsWith('refs/heads/'))
    .map(ref => ref.slice('refs/heads/'.length)).filter(candidate => {
      try { publicationTarget(catalogue,candidate); return true; } catch { return false; }
    }).sort((a,b) => b.length - a.length);
  if (candidates.length && candidates[0] !== branch) fail('The selected branch does not match the configured catalogue reference',403);
}
