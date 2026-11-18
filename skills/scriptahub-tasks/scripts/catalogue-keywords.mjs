const languages = [
  ['en', 'English'], ['fr', 'Français'], ['de', 'Deutsch'], ['es', 'Español'],
  ['pt', 'Português'], ['it', 'Italiano'], ['ro', 'Română'], ['pl', 'Polski'],
];
const langCodes = languages.map(([code]) => code);


function slug(value) {
  return String(value).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'keyword';
}

export function combineCollections(books) {
  const keywords = {};
  for (const code of langCodes) {
    const counts = new Map();
    for (const book of books) {
      if (!Array.isArray(book.keywordIds) || new Set(book.keywordIds).size !== book.keywordIds.length
        || !Array.isArray(book.keywords?.[code]) || book.keywordIds.length !== book.keywords[code].length) {
        throw new Error(`Invalid keyword catalogue for ${book.id} (${code})`);
      }
      for (let i = 0; i < book.keywordIds.length; i++) {
        const id = book.keywordIds[i];
        const label = book.keywords[code][i];
        if (typeof id !== 'string' || !id.trim() || typeof label !== 'string' || !label.trim()) throw new Error(`Invalid keyword in ${book.id}`);
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


export function validateCatalogueKeywords(collection) {
  if (collection.schemaVersion !== 1) return;
  if (!collection.keywords || typeof collection.keywords !== 'object' || Array.isArray(collection.keywords)) {
    throw new Error('Missing or invalid catalogue keyword index');
  }
  const expected = combineCollections(collection.books).keywords;
  for (const [language, entries] of Object.entries(expected)) {
    const actual = collection.keywords[language];
    if (!Array.isArray(actual) || actual.length !== entries.length || new Set(actual.map(item => item.id)).size !== actual.length) {
      throw new Error('Invalid catalogue keyword index (' + language + ')');
    }
    const counts = new Map(entries.map(item => [item.id, item.count]));
    if (actual.some(item => counts.get(item.id) !== item.count || typeof item.label !== 'string' || typeof item.slug !== 'string')) {
      throw new Error('Catalogue keyword counts do not match its books (' + language + ')');
    }
  }
}
