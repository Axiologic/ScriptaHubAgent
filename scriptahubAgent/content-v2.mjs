// Shared by the agent and the ScriptaHub static publisher. No book-specific UI lives in content repositories.
import { posix as path } from 'node:path';

export const LANGUAGES = { en: 'English', fr: 'Français', de: 'Deutsch', es: 'Español', pt: 'Português', it: 'Italiano', ro: 'Română', pl: 'Polski' };
const labels = {
  en: ['Read in 10 Min', 'Read Online', 'Download PDF', 'About Book', 'Suggest', 'Editions', 'Contributors', 'Create', 'Home', 'Keywords'],
  fr: ['Lire en 10 min', 'Lire en ligne', 'Télécharger le PDF', 'À propos du livre', 'Suggérer', 'Éditions', 'Contributeurs', 'Créer', 'Accueil', 'Mots-clés'],
  de: ['In 10 Min. lesen', 'Online lesen', 'PDF herunterladen', 'Über das Buch', 'Vorschlagen', 'Ausgaben', 'Mitwirkende', 'Erstellen', 'Startseite', 'Schlüsselwörter'],
  es: ['Leer en 10 min', 'Leer en línea', 'Descargar PDF', 'Sobre el libro', 'Sugerir', 'Ediciones', 'Colaboradores', 'Crear', 'Inicio', 'Palabras clave'],
  pt: ['Ler em 10 min', 'Ler online', 'Descarregar PDF', 'Sobre o livro', 'Sugerir', 'Edições', 'Colaboradores', 'Criar', 'Início', 'Palavras-chave'],
  it: ['Leggi in 10 min', 'Leggi online', 'Scarica PDF', 'Sul libro', 'Suggerisci', 'Edizioni', 'Collaboratori', 'Crea', 'Home', 'Parole chiave'],
  ro: ['Citește în 10 min', 'Citește online', 'Descarcă PDF', 'Despre carte', 'Sugerează', 'Ediții', 'Contribuitori', 'Creează', 'Acasă', 'Cuvinte-cheie'],
  pl: ['Przeczytaj w 10 min', 'Czytaj online', 'Pobierz PDF', 'O książce', 'Zaproponuj', 'Wydania', 'Współtwórcy', 'Utwórz', 'Strona główna', 'Słowa kluczowe'],
};
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const localized = (value, language) => value?.[language] ?? value?.en ?? Object.values(value || {}).find(value => value != null) ?? '';
const editionLanguage = (book, language, key) => [language, 'en', ...Object.keys(book.editions)].find(code => book.editions[code]?.[key]);
const query = values => new URLSearchParams(values).toString();
export function contentPath(value) {
  if (typeof value !== 'string' || !value || value.startsWith('/') || /[\\\0?#%]/.test(value) || value.split('/').some(p => !p || p === '.' || p === '..')) throw new Error(`Invalid content path: ${value}`);
  return value;
}

export function validateContentBook(document) {
  if (!document || document.schemaVersion !== 2 || !/^bk-[a-z0-9]+$/.test(document.id || '') || document.metadata?.id !== document.id) throw new Error('Invalid content book identity');
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

export function normalizeContentBook(document) {
  validateContentBook(document);
  const m = document.metadata, directory = document.legacyDirectory;
  const prefix = value => `${directory}/${contentPath(value)}`;
  return {
    ...m, directory, contentFormat: 2, currentEdition: m.currentEdition || document.history.currentEdition,
    keywords: Object.fromEntries(Object.keys(LANGUAGES).map(language => [language, localized(m.keywords, language) || []])),
    editionCount: document.history.editions.length,
    editions: Object.fromEntries(Object.entries(m.editions).map(([language, files]) => [language, Object.fromEntries(Object.entries(files).map(([key, value]) => [key, prefix(value)]))])),
    coverUrl: Object.fromEntries(Object.entries(m.coverUrl || {}).map(([language, value]) => [language, prefix(value)])),
    thumbnailUrl: Object.fromEntries(Object.entries(m.thumbnailUrl || {}).map(([language, value]) => [language, prefix(value)])),
    ...(m.animation ? { animation: { ...m.animation, page: prefix(m.animation.page), shf: prefix(m.animation.shf) } } : {}),
  };
}

function pageRoot(relative) { return '../'.repeat(contentPath(relative).split('/').length - 1); }
function readingHref(book, language, format, root) {
  const key = format === 'short' ? 'shortContent' : 'fullContent';
  const target = editionLanguage(book, language, key);
  const edition = book.editions[target];
  if (!edition?.[key]) return null;
  return root + 'reader/index.html?' + query({ id: `${book.id}:${book.currentEdition || 'edition-1'}:${target}:${format}`, book: book.directory, language: target, lang: language, format, mode: format === 'short' ? 'ten-minute' : 'full', title: localized(book.title, language), html: '../' + edition[key], back: '../' + (book.editions[editionLanguage(book, language, 'book')].book) + '?lang=' + language, ...(edition.pdf ? { pdf: '../' + edition.pdf } : {}) });
}

export function renderBookPage(book, language, relative = book.editions[editionLanguage(book, language, 'book')]?.book) {
  if (!LANGUAGES[language]) throw new Error('Unsupported page language');
  const root = pageRoot(relative), words = labels[language];
  const title = localized(book.title, language), description = localized(book.shortDescription, language);
  const workflow = query({ book: book.directory, lang: language });
  const actions = [['short', words[0]], ['read', words[1]]].map(([format, label]) => {
    const url = readingHref(book, language, format, root);
    return url ? `<a class="button button-quiet" data-reading-format="${format}" data-reading-label="${escape(label)}" href="${escape(url)}">${escape(label)}</a>` : `<span class="button button-quiet" aria-disabled="true">${escape(label)}</span>`;
  });
  const pdf = book.editions[editionLanguage(book, language, 'pdf')]?.pdf;
  if (pdf) actions.push(`<a class="button button-quiet" data-download-pdf href="${escape(root + pdf)}" download>${escape(words[2])}</a>`);
  const animation = book.animation ? root + book.animation.page + '?lang=' + language : root + 'animation-request/index.html?' + workflow;
  const tools = [['fork', 'Fork', 'data-fork-link'], ['feedback', words[4], 'data-book-feedback'], ['editions', words[5], 'data-book-editions'], ['contributors', words[6], 'data-book-contributors']].map(([route, label, marker]) => `<a class="button button-quiet" ${marker} href="${escape(root + route + '/index.html?' + workflow)}">${escape(label)}</a>`).join('');
  const about = localized(book.aboutBook, language);
  const paragraphs = Array.isArray(about) ? about : [];
  const keywords = (book.keywordIds || []).map((id, i) => ({ label: book.keywords?.[language]?.[i] || Object.values(book.keywords || {}).find(values => values?.[i])?.[i] || id, count: book.keywordWeights?.[id] || book.keywordStats?.[language]?.[id]?.count || 1, href: root + 'index.html?' + query({ lang: language, keyword: id }) }));
  const keywordJSON = JSON.stringify(keywords).replace(/</g, '\\u003c');
  const options = Object.entries(LANGUAGES).map(([code, name]) => `<option value="${escape(root + (book.editions[editionLanguage(book, code, 'book')].book) + '?lang=' + code)}"${code === language ? ' selected' : ''}>${name}</option>`).join('');
  const scripts = ['reading.js', 'text-show.js', 'book-view.js', 'site.js'].map(name => `<script src="${root}assets/${name}?v=content-v2"></script>`).join('');
  const fullLanguages = Object.entries(book.editions).filter(([, edition]) => edition.fullContent).map(([code]) => code.toUpperCase()).join(', ');
  return `<!doctype html>
<html lang="${language}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<script>try{const t=localStorage.getItem('scripta-site-theme');document.documentElement.dataset.theme=['light','orange','nord','dark','dark-orange'].includes(t)?t:'light';const s=Number(localStorage.getItem('scripta-site-scale-v2')||1);document.documentElement.style.setProperty('--site-scale',String(Math.max(.8,Math.min(1.5,s||1))))}catch{}</script>
<title>${escape(title)} · ScriptaHub</title><meta name="description" content="${escape(description)}"><meta property="og:type" content="book"><meta property="og:title" content="${escape(title)}"><meta property="og:description" content="${escape(description)}"><meta property="og:image" content="${escape(root + localized(book.coverUrl, language))}">
<link rel="stylesheet" href="${root}assets/site.css"><link rel="stylesheet" href="${root}assets/text-show.css"><link rel="icon" href="${root}favicon.ico"></head>
<body data-book-page="true" data-book-language="${language}" data-book-id="${book.id}"><main class="site-shell book-page">
<header class="site-header"><a class="wordmark" href="${root}index.html">ScriptaHub<span>.com</span></a><div class="header-tools"><a class="header-home" data-home-link href="${root}index.html?lang=${language}" aria-label="${escape(words[8])}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 10.5 12 3l9 7.5M5.5 9v11h5v-6h3v6h5V9"/></svg><span>${escape(words[8])}</span></a><a class="header-create" data-create-link href="${root}create/index.html?lang=${language}">${escape(words[7])}</a><div class="site-scale" aria-label="Site text size"><button type="button" data-site-smaller aria-label="Decrease site size">A−</button><button type="button" data-site-size>100%</button><button type="button" data-site-larger aria-label="Increase site size">A+</button></div><div class="theme-switcher"><button type="button" data-theme-toggle aria-label="Switch appearance">☼</button></div><label class="language-picker"><span class="sr-only">Language</span><select onchange="location.href=this.value">${options}</select></label></div></header>
<article class="book-hero"><button class="cover-link" type="button" data-cover-preview aria-label="${escape(title)}"><img src="${escape(root + localized(book.coverUrl, language))}" alt="${escape(title)}"></button><div class="book-details"><div class="book-copy"><p class="eyebrow">${escape(book.category)} · ScriptaHub</p><h1>${escape(title)}</h1><p class="book-subtitle">${escape(localized(book.subtitle, language))}</p><p class="lead" data-text-show>${escape(description)}</p></div><div class="book-actions"><a class="button button-quiet" data-animation-link href="${escape(animation)}">Animation</a>${actions.join('')}</div><nav class="book-side-actions" aria-label="Book tools">${tools}</nav><p class="book-availability-note" data-book-availability-note><span>Full text: ${escape(fullLanguages)}</span><span>Editions: ${book.editionCount || 1}</span></p></div><aside class="book-keyword-widget" aria-label="${escape(words[9])}"><div class="keyword-cloud book-keyword-cloud" data-book-keyword-cloud></div></aside></article>
<section class="book-introduction" id="about-book" aria-labelledby="about-book-title"><div><p class="eyebrow">ScriptaHub</p><h2 id="about-book-title">${escape(words[3])}</h2>${paragraphs.map(p => `<p>${escape(p)}</p>`).join('')}</div></section>
<footer class="site-footer"><a class="footer-wordmark" href="${root}index.html">ScriptaHub.com</a><nav aria-label="Legal">${['terms', 'privacy', 'cookies', 'notice', 'ai'].map(key => `<a data-footer-${key} data-legal-link href="${root}legal/${key}.html?lang=${language}">${key}</a>`).join('')}</nav><span class="footer-status">© ${new Date().getUTCFullYear()} ScriptaHub</span></footer></main>
<script src="${root}assets/keyword-cloud.js"></script><script>ScriptaKeywordCloud.mount(document.querySelector('[data-book-keyword-cloud]'),${keywordJSON},{showInstruction:false});</script><script src="${root}collection.js"></script>${scripts}</body></html>\n`;
}

export function renderAnimationPage(book, relative = book.directory + '/Animation/index.html', { agent = false } = {}) {
  const root = pageRoot(relative);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(localized(book.title, Object.keys(book.editions)[0]))} · Animation · ScriptaHub</title><link rel="stylesheet" href="${root}assets/site.css"><link rel="stylesheet" href="${root}assets/animation.css"></head><body data-app-page="true" data-animation-book="${book.id}"><script src="${root}collection.js"></script>${['shf/shf-player.js', 'animation.js', 'reading.js', 'text-show.js', 'book-view.js', ...(agent ? ['workflow-bridge.js'] : []), 'workflow.js', 'site.js'].map(name => `<script src="${root}assets/${name}"></script>`).join('')}</body></html>\n`;
}
