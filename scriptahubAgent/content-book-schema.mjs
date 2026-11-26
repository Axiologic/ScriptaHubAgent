export const LANGUAGES = { en: 'English', fr: 'Français', de: 'Deutsch', es: 'Español', pt: 'Português', it: 'Italiano', ro: 'Română', pl: 'Polski' };

export function contentPath(value) {
  if (typeof value !== 'string' || !value || value.startsWith('/') || /[\\\0?#%]/.test(value) || value.split('/').some(p => !p || p === '.' || p === '..')) throw new Error(`Invalid content path: ${value}`);
  return value;
}

export function validateContentBook(document) {
  if (!document || document.schemaVersion !== 2 || !/^bk-[a-z0-9]+$/.test(document.id || '') || document.metadata?.id !== document.id) throw new Error('Invalid content book identity');
  if (!document.legacyDirectory) throw new Error('Missing book.json legacyDirectory');
  const directory = contentPath(document.legacyDirectory);
  if (!directory.startsWith('books/') || !directory.endsWith('/' + document.id)) throw new Error('Invalid legacy book directory');
  if (!document.history || document.history.bookId !== document.id || !Array.isArray(document.history.editions)) throw new Error('Invalid edition history');
  if (!document.resources || Array.isArray(document.resources) || typeof document.resources !== 'object') throw new Error('Missing book resources');
  const contentDirectory = document.contentDirectory && contentPath(document.contentDirectory);
  if (contentDirectory && !/^books\/[a-z0-9]+(?:-[a-z0-9]+)*$/.test(contentDirectory)) throw new Error('Invalid content directory');
  for (const [legacy, resource] of Object.entries(document.resources)) {
    contentPath(legacy); contentPath(resource);
    const readable = resource.startsWith('assets/shared/') || (contentDirectory && resource.startsWith(contentDirectory + '/'));
    const hashed = /^(?:assets\/shared|content)\/[a-f0-9]{64}(?:\.[a-z0-9]+)?$/.test(resource);
    if (!readable && !hashed) throw new Error(`Invalid book resource: ${resource}`);
  }
  const editions = document.metadata.editions;
  if (!editions || !Object.keys(editions).length) throw new Error('At least one book edition is required');
  for (const [language, edition] of Object.entries(editions)) {
    if (!edition?.book) throw new Error('Each edition needs a book page');
    if (!LANGUAGES[language]) throw new Error('Unsupported metadata language');
    for (const [key, value] of Object.entries(edition)) {
      contentPath(value);
      if (key !== 'book' && !document.resources[value]) throw new Error(`Unmapped edition resource: ${value}`);
    }
  }
  return document;
}
