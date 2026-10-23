const CDN = {
  pdf: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs',
  pdfWorker: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs',
  jszip: 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js',
  epub: 'https://cdn.jsdelivr.net/npm/epubjs@0.3.93/dist/epub.min.js'
};

const app = document.querySelector('[data-reader-app]');
const stage = document.querySelector('[data-reader-stage]');
const loading = document.querySelector('[data-reader-loading]');
const titleNode = document.querySelector('[data-reader-title]');
const formatNode = document.querySelector('[data-reader-format]');
const statusNode = document.querySelector('[data-reader-status]');
const locationNode = document.querySelector('[data-reader-location]');
const originalLink = document.querySelector('[data-reader-original]');
const downloadLink = document.querySelector('[data-reader-download]');
const backLink = document.querySelector('[data-reader-back]');
const languageWrap = document.querySelector('[data-reader-language-wrap]');
const languageSelect = document.querySelector('[data-reader-language]');
const pdfControls = document.querySelector('[data-reader-pdf-controls]');
const readingControls = document.querySelector('[data-reader-reading-controls]');
const textControls = document.querySelector('[data-reader-text-controls]');
const zoomControls = document.querySelector('[data-reader-zoom-controls]');
const previousButton = document.querySelector('[data-reader-previous]');
const nextButton = document.querySelector('[data-reader-next]');
const pageInput = document.querySelector('[data-reader-page]');
const pageTotal = document.querySelector('[data-reader-page-total]');
const readingPreviousButton = document.querySelector('[data-reader-reading-previous]');
const readingNextButton = document.querySelector('[data-reader-reading-next]');
const virtualPageNode = document.querySelector('[data-reader-virtual-page]');
const seekInput = document.querySelector('[data-reader-seek]');
const textSmallerButton = document.querySelector('[data-reader-text-smaller]');
const textLargerButton = document.querySelector('[data-reader-text-larger]');
const zoomOutButton = document.querySelector('[data-reader-zoom-out]');
const zoomInButton = document.querySelector('[data-reader-zoom-in]');
const sizeButton = document.querySelector('[data-reader-text-size]');
const fitButton = document.querySelector('[data-reader-fit]');
const themeButton = document.querySelector('[data-reader-theme]');
const resetButton = document.querySelector('[data-reader-reset]');
const audioWrap = document.querySelector('[data-reader-audio]');
const audioPlayer = document.querySelector('[data-reader-audio-player]');

resetButton.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 11a9 9 0 1 1 2.6 7M3 4v7h7"/></svg>';
downloadLink.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/></svg>';
originalLink.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3h7v7m0-7L10 14M10 3H3v18h18v-7"/></svg>';

const query = new URLSearchParams(window.location.search);
const homeLink = document.querySelector('[data-reader-home]');
if (homeLink) {
  const labels = { en: 'Home', fr: 'Accueil', de: 'Startseite', es: 'Inicio', pt: 'Início', it: 'Home', ro: 'Acasă', pl: 'Strona główna' };
  const language = query.get('lang') || document.documentElement.lang || 'en';
  const chosen = Object.hasOwn(labels, language) ? language : 'en';
  homeLink.href = new URL(`../index.html?lang=${chosen}`, location.href).href;
  homeLink.title = labels[chosen];
  homeLink.setAttribute('aria-label', labels[chosen]);
}
const validTypes = ['html', 'epub', 'pdf'];
const themeOrder = ['light', 'orange', 'nord', 'dark', 'dark-orange'];
const preferenceKey = 'axiologic-reader:preferences:v1';
const siteThemeKey = 'scripta-site-theme';
const sourceFromParam = (name) => query.get(name) ? new URL(query.get(name), window.location.href).href : '';
const supplied = Object.fromEntries([...validTypes, 'audio'].map((type) => [type, sourceFromParam(type)]));
const title = query.get('title') || 'ScriptaHub Reader';
const readingMode = query.get('mode') === 'ten-minute' ? 'ten-minute' : 'full';
const sourceId = query.get('id') || supplied.html || supplied.epub || supplied.pdf || title;
const progressKey = `axiologic-reader:progress:v1:${sourceId}`;
const isLocalFilePreview = window.location.protocol === 'file:';

function sharedSiteTheme() {
  try { const theme=window.localStorage.getItem(siteThemeKey);return ['light','orange','nord','dark','dark-orange'].includes(theme)?theme:'light'; } catch { return 'light'; }
}

function saveSharedSiteTheme(theme) {
  try { window.localStorage.setItem(siteThemeKey, theme); } catch { /* Storage is optional. */ }
}
const defaultFontSize = 1.16;
const boundedFontSize = value => Math.max(defaultFontSize * .8, Math.min(defaultFontSize * 1.5, Number(value) || defaultFontSize));

async function configureLanguageSelector() {
  const directory = query.get('book');
  const reading = globalThis.ScriptaReading;
  if (!directory || !languageWrap || !languageSelect || !reading) return;
  try {
    let collection = globalThis.SCRIPTA_COLLECTION;
    if (!collection) {
      const response = await fetch(new URL('../collection.json', window.location.href), { cache: 'no-store' });
      if (!response.ok) return;
      collection = await response.json();
    }
    const book = collection.books.find((item) => item.directory === directory);
    if (!book) return;
    const preferred = reading.locale(query.get('language'));
    const historicalEdition = query.get('pdf')?.match(/\/edition-files\/edition-(\d+)\//);
    downloadLink.download = reading.pdfDownloadName(reading.localized(book.title, preferred), historicalEdition?.[1]);
    const uiLanguage = reading.locale(query.get('lang') || preferred);
    const format = query.get('format') || (readingMode === 'ten-minute' ? 'short' : 'read');
    const words = reading.labels[uiLanguage];
    document.documentElement.lang = uiLanguage;
    languageSelect.setAttribute('aria-label', 'Language');
    languageSelect.innerHTML = collection.supportedLanguages.map(({ code, name }) => `<option value="${escapeHtml(code)}"${code === uiLanguage ? ' selected' : ''}>${escapeHtml(name)}</option>`).join('');
    languageWrap.hidden = false;
    const notice = document.querySelector('[data-reader-translation-notice]');
    if (notice && !reading.available(book, uiLanguage, format)) {
      notice.textContent = reading.unavailableMessage(uiLanguage);
      notice.href = reading.requestUrl(book, uiLanguage, format, uiLanguage, new URL('../', location.href), preferred).href;
      notice.hidden = false;
    }
    // Preserve archived downloads; current downloads follow the reading language.
    if (!supplied.pdf.includes('/edition-files/')) supplied.pdf = book.editions[preferred]?.pdf ? new URL(`../${book.editions[preferred].pdf}`, location.href).href : '';

    languageSelect.addEventListener('change', () => {
      const url = reading.readingUrl(book, languageSelect.value, format, languageSelect.value, new URL('../', location.href), preferred);
      if (url) window.location.href = url.href;
      else languageSelect.value = uiLanguage;
    });
  } catch {
    // The reader stays usable if the catalogue is unavailable.
  }
}

const state = {
  type: '',
  source: '',
  progress: readStored(progressKey, {}),
  preferences: { ...readStored(preferenceKey, {}), fontSize: boundedFontSize(readStored(preferenceKey, {}).fontSize), theme: sharedSiteTheme().startsWith('dark') ? 'night' : 'paper' },
  pdf: { document: null, page: 1, zoom: 1.15, fit: true, task: null, native: false, source: '' },
  epub: { book: null, rendition: null },
  htmlFrame: null,
  htmlSaveTimer: 0
};

function readStored(key, fallback) {
  try {
    const value = window.localStorage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function store(key, value) {
  try { window.localStorage.setItem(key, JSON.stringify(value)); } catch { /* Private browsing can deny storage. */ }
}

function saveProgress(update = {}) {
  state.progress = { ...state.progress, ...update, type: state.type, source: state.source, updatedAt: Date.now() };
  store(progressKey, state.progress);
}

function savePreferences() {
  store(preferenceKey, state.preferences);
}

function setStatus(message, location = '') {
  statusNode.textContent = message;
  locationNode.textContent = location;
}

function showLoading(message = 'Preparing your reading edition…') {
  loading.hidden = false;
  loading.querySelector('p').textContent = message;
}

function hideLoading() { loading.hidden = true; }

function showError(message) {
  loading.hidden = true;
  stage.innerHTML = `<div class="reader-error"><p>${escapeHtml(message)}</p>${state.source ? `<p><a href="${escapeAttribute(state.source)}" target="_blank" rel="noreferrer">Open the original file instead →</a></p>` : ''}</div>`;
  setStatus('This edition could not be opened here.');
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;' })[character]);
}

function escapeAttribute(value) { return escapeHtml(value); }

function candidateFor(source, extension) {
  if (!source) return '';
  const url = new URL(source);
  url.pathname = url.pathname.replace(/\.pdf$/i, extension);
  return url.href;
}

async function fetchWithTimeout(url, options = {}, timeout = 4500) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeout);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    window.clearTimeout(timer);
  }
}

async function exists(url, timeout = 4500) {
  if (!url) return false;
  try {
    const response = await fetchWithTimeout(url, { method: 'HEAD', cache: 'no-store' }, timeout);
    if (response.ok) return true;
    if (response.status !== 405 && response.status !== 501) return false;
    const fallback = await fetchWithTimeout(url, { headers: { Range: 'bytes=0-0' }, cache: 'no-store' }, timeout);
    return fallback.ok || fallback.status === 206;
  } catch {
    return false;
  }
}

function cataloguedContentBook() {
  return globalThis.SCRIPTA_COLLECTION?.books?.find(book => book.contentFormat === 2 && book.directory === query.get('book'));
}

async function resolveResources() {
  if (isLocalFilePreview) {
    return {
      html: supplied.html || candidateFor(supplied.pdf, '.html'),
      epub: supplied.epub,
      pdf: supplied.pdf
    };
  }
  const candidates = {
    html: supplied.html || candidateFor(supplied.pdf, '.html'),
    epub: supplied.epub || (cataloguedContentBook() ? '' : candidateFor(supplied.pdf, '.epub')),
    pdf: supplied.pdf
  };

  const tested = await Promise.all(Object.entries(candidates).map(async ([type, url]) => [type, url, await exists(url)]));
  const available = Object.fromEntries(tested.map(([type, url, available]) => [type, available ? url : '']));

  // Some static hosts do not implement HEAD. A passed-in PDF is still worth attempting.
  if (!available.pdf && supplied.pdf) available.pdf = supplied.pdf;
  return available;
}

async function resolveAudio() {
  const candidates = (cataloguedContentBook() ? [supplied.audio] : [
    supplied.audio,
    candidateFor(supplied.pdf, '.m4a'),
    candidateFor(supplied.pdf, '.mp3'),
    candidateFor(supplied.pdf, '.ogg')
  ]).filter(Boolean);
  for (const candidate of candidates) {
    if (await exists(candidate, 2500)) return candidate;
  }
  return '';
}

function setControls(type) {
  pdfControls.hidden = type !== 'pdf';
  readingControls.hidden = type === 'pdf';
  zoomControls.hidden = type !== 'pdf';
  textControls.hidden = type === 'pdf';
  formatNode.textContent = type === 'epub'
    ? 'Reflowable EPUB edition'
    : type === 'html'
      ? readingMode === 'ten-minute' ? 'Adaptable 10-minute synthesis' : 'Adaptable web edition'
      : 'PDF edition';
}

function updateReadingProgress(position, page, total) {
  const safePosition = Math.max(0, Math.min(1, Number(position) || 0));
  const safeTotal = Math.max(1, Math.round(Number(total) || 1));
  const safePage = Math.max(1, Math.min(safeTotal, Math.round(Number(page) || Math.ceil(safePosition * safeTotal) || 1)));
  seekInput.value = String(safePosition * 100);
  virtualPageNode.textContent = `Page ${safePage} of ${safeTotal}`;
  readingPreviousButton.disabled = safePosition <= 0;
  readingNextButton.disabled = safePosition >= .9999;
  return { position: safePosition, page: safePage, total: safeTotal };
}

function updateHtmlProgress(position) {
  const total = Math.max(1, Math.ceil(stage.scrollHeight / Math.max(1, stage.clientHeight)));
  const page = Math.min(total, Math.floor(stage.scrollTop / Math.max(1, stage.clientHeight)) + 1);
  return updateReadingProgress(position, page, total);
}

function applyTheme() {
  app.dataset.theme = state.preferences.theme;
  const appearance = sharedSiteTheme();
  document.documentElement.dataset.theme = appearance;
  app.dataset.appearance = appearance;
  app.dataset.accent = appearance;
  app.dataset.darkAccent = appearance;
  const icon = state.preferences.theme === 'night'
    ? '<path d="M20.5 13a8.5 8.5 0 0 1-9.5-9.5A8.5 8.5 0 1 0 20.5 13Z"/>'
    : '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.4 1.4m11.2 11.2L19 19M5 19l1.4-1.4M17.6 6.4 19 5"/>';
  themeButton.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icon}</svg>`;
  const names = { light: 'Light Green', orange: 'Light Orange', nord: 'Light Linen', dark: 'Dark Green', 'dark-orange': 'Dark Orange' };
  themeButton.title = `${names[appearance]} · Switch to ${names[themeOrder[(themeOrder.indexOf(appearance) + 1) % themeOrder.length]]}`;
  themeButton.setAttribute('aria-label', themeButton.title);
  postHtmlFrameSettings();
  if (state.type === 'epub' && state.epub.rendition) {
    state.epub.rendition.themes.override('color', getComputedStyle(app).getPropertyValue('--reader-ink').trim());
    state.epub.rendition.themes.override('background', getComputedStyle(app).getPropertyValue('--reader-paper').trim());
  }
}

function applyTextSize() {
  app.style.setProperty('--reader-font-size', `${state.preferences.fontSize}rem`);
  postHtmlFrameSettings();
  if (state.type === 'epub' && state.epub.rendition) state.epub.rendition.themes.fontSize(`${state.preferences.fontSize * 1.24}rem`);
  sizeButton.textContent = `${Math.round(state.preferences.fontSize / defaultFontSize * 100)}%`;
  textSmallerButton.disabled = Math.round(state.preferences.fontSize / defaultFontSize * 100) <= 80;
  textLargerButton.disabled = Math.round(state.preferences.fontSize / defaultFontSize * 100) >= 150;
}

function resetDisplay() {
  state.preferences.fontSize = 1.16;
  state.pdf.fit = true;
  applyTextSize();
  if (state.type === 'pdf') renderPdfPage(state.pdf.page);
  savePreferences();
}

function changeTextSize(delta) {
  if (state.type === 'pdf') {
    state.pdf.fit = false;
    state.pdf.zoom = Math.max(.55, Math.min(3, state.pdf.zoom + delta * .14));
    renderPdfPage(state.pdf.page);
  } else {
    state.preferences.fontSize = boundedFontSize(Number((state.preferences.fontSize + delta * .058).toFixed(4)));
    applyTextSize();
    savePreferences();
  }
}

function usableBackHref() {
  const explicitBack = query.get('back');
  if (explicitBack) return new URL(explicitBack, window.location.href).href;
  if (document.referrer && new URL(document.referrer).origin === window.location.origin) return document.referrer;
  return '../index.html';
}

function cleanReadableDocument(sourceDocument, sourceUrl) {
  const original = sourceDocument.querySelector('[data-reader-content], article, main, .edition-reading') || sourceDocument.body;
  const content = document.createElement('article');
  content.className = 'reader-html-content';
  const clone = original.cloneNode(true);
  clone.querySelectorAll('script, style, noscript, iframe, form, nav, header, footer').forEach((node) => node.remove());
  clone.querySelectorAll('*').forEach((element) => {
    [...element.attributes].forEach((attribute) => {
      if (attribute.name.startsWith('on')) element.removeAttribute(attribute.name);
    });
    ['src', 'href', 'poster'].forEach((attribute) => {
      if (element.hasAttribute(attribute)) element.setAttribute(attribute, new URL(element.getAttribute(attribute), sourceUrl).href);
    });
  });
  content.append(...clone.childNodes);
  return content;
}

async function renderHtml(url) {
  showLoading('Loading the adaptable web edition…');
  if (isLocalFilePreview || new URL(url).protocol === 'file:') {
    renderLocalHtml(url);
    return;
  }
  const response = await fetch(url);
  if (!response.ok) throw new Error(`The HTML edition returned ${response.status}.`);
  const sourceDocument = new DOMParser().parseFromString(await response.text(), 'text/html');
  stage.innerHTML = '';
  stage.append(cleanReadableDocument(sourceDocument, url));
  applyTheme();
  applyTextSize();
  const restore = Number(state.progress.htmlPosition);
  requestAnimationFrame(() => {
    if (Number.isFinite(restore) && restore > 0) {
      stage.scrollTop = Math.max(0, (stage.scrollHeight - stage.clientHeight) * restore);
      setStatus('Resumed where you left off.', `${Math.round(restore * 100)}% read`);
    } else setStatus('Reading position is saved on this device.', 'Beginning');
    updateHtmlProgress(Number.isFinite(restore) ? restore : 0);
  });
  stage.addEventListener('scroll', scheduleHtmlSave, { passive: true });
  hideLoading();
}

function renderLocalHtml(url) {
  const frame = document.createElement('iframe');
  frame.className = 'reader-html-frame';
  frame.src = url;
  frame.title = title;
  state.htmlFrame = frame;
  stage.replaceChildren(frame);
  frame.addEventListener('load', () => {
    postHtmlFrameSettings(true);
    hideLoading();
    const restored = Number(state.progress.htmlPosition) || 0;
    setStatus(restored > 0 ? 'Resumed where you left off.' : 'Reading position is saved on this device.', restored > 0 ? `${Math.round(restored * 100)}% read` : 'Beginning');
  }, { once: true });
}

function postHtmlFrameSettings(includePosition = false) {
  if (!state.htmlFrame?.contentWindow) return;
  state.htmlFrame.contentWindow.postMessage({
    type: 'axiologic-reader-settings',
    fontSize: state.preferences.fontSize * 1.24,
    theme: state.preferences.theme,
    position: includePosition ? Number(state.progress.htmlPosition) || 0 : undefined
  }, '*');
}

function turnReadingPage(direction) {
  if (state.htmlFrame?.contentWindow) {
    state.htmlFrame.contentWindow.postMessage({ type: 'axiologic-reader-page', direction }, '*');
    return;
  }
  if (state.type === 'html') {
    stage.scrollBy({ top: direction * stage.clientHeight * .9, behavior: 'smooth' });
    return;
  }
  if (state.type === 'epub') {
    const action = direction < 0 ? 'prev' : 'next';
    state.epub.rendition?.[action]?.();
  }
}

function seekReading(position) {
  const safePosition = Math.max(0, Math.min(1, Number(position) || 0));
  if (state.type === 'pdf') {
    const total = state.pdf.document?.numPages || Number(pageInput.max) || state.pdf.page || 1;
    renderPdfPage(Math.max(1, Math.round(safePosition * Math.max(0, total - 1)) + 1));
    return;
  }
  if (state.htmlFrame?.contentWindow) {
    state.htmlFrame.contentWindow.postMessage({ type: 'axiologic-reader-seek', position: safePosition }, '*');
    return;
  }
  if (state.type === 'html') {
    stage.scrollTo({ top: (stage.scrollHeight - stage.clientHeight) * safePosition, behavior: 'smooth' });
    return;
  }
  if (state.type === 'epub' && state.epub.book?.locations?.length()) {
    state.epub.rendition.display(state.epub.book.locations.cfiFromPercentage(safePosition));
  }
}

function scheduleHtmlSave() {
  window.clearTimeout(state.htmlSaveTimer);
  state.htmlSaveTimer = window.setTimeout(() => {
    const available = stage.scrollHeight - stage.clientHeight;
    const position = available > 0 ? stage.scrollTop / available : 0;
    saveProgress({ htmlPosition: Math.max(0, Math.min(1, position)) });
    const metrics = updateHtmlProgress(position);
    setStatus('Reading position saved.', `${Math.round(metrics.position * 100)}% · Page ${metrics.page} of ${metrics.total}`);
  }, 180);
}

function loadScript(url, timeout = 10000) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    const finish = (callback, value) => {
      window.clearTimeout(timer);
      script.onload = null;
      script.onerror = null;
      callback(value);
    };
    script.src = url;
    script.async = true;
    script.onload = () => finish(resolve);
    script.onerror = () => finish(reject, new Error('The reading engine could not be loaded.'));
    const timer = window.setTimeout(() => {
      script.remove();
      finish(reject, new Error('The reading engine took too long to respond.'));
    }, timeout);
    document.head.append(script);
  });
}

async function renderEpub(url) {
  showLoading('Loading the reflowable EPUB edition…');
  if (!window.JSZip) await loadScript(CDN.jszip);
  if (!window.ePub) await loadScript(CDN.epub);
  stage.innerHTML = '<div class="reader-epub" data-reader-epub></div>';
  const target = stage.querySelector('[data-reader-epub]');
  state.epub.book = window.ePub();
  await state.epub.book.open(url);
  state.epub.rendition = state.epub.book.renderTo(target, { width: '100%', height: '100%', manager: 'continuous', flow: 'scrolled-doc' });
  await state.epub.book.ready;
  applyTheme();
  applyTextSize();
  await state.epub.rendition.display(state.progress.epubCfi || undefined);
  state.epub.rendition.on('relocated', (location) => {
    const progress = state.epub.book.locations?.length() ? state.epub.book.locations.percentageFromCfi(location.start?.cfi) : location.start?.percentage;
    saveProgress({ epubCfi: location.start?.cfi, epubPosition: Number.isFinite(progress) ? progress : undefined });
    const label = Number.isFinite(progress) ? `${Math.round(progress * 100)}% read` : 'Position saved';
    updateReadingProgress(progress, Math.round((progress || 0) * 100) + 1, 101);
    setStatus('Reading position saved.', label);
  });
  if (state.progress.epubCfi) setStatus('Resumed where you left off.', state.progress.epubPosition ? `${Math.round(state.progress.epubPosition * 100)}% read` : '');
  else setStatus('Reading position is saved on this device.', 'Beginning');
  hideLoading();
}

async function renderPdf(url) {
  showLoading('Loading the PDF edition…');
  if (isLocalFilePreview || new URL(url).protocol === 'file:') {
    renderNativePdf(url);
    hideLoading();
    return;
  }
  const pdfjsLib = await Promise.race([
    import(CDN.pdf),
    new Promise((_, reject) => window.setTimeout(() => reject(new Error('The PDF engine took too long to respond.')), 10000))
  ]);
  pdfjsLib.GlobalWorkerOptions.workerSrc = CDN.pdfWorker;
  state.pdf.document = await pdfjsLib.getDocument({ url }).promise;
  state.pdf.page = Math.min(Math.max(1, Number(state.progress.pdfPage) || 1), state.pdf.document.numPages);
  pageInput.max = state.pdf.document.numPages;
  pageTotal.textContent = `of ${state.pdf.document.numPages}`;
  await renderPdfPage(state.pdf.page);
  hideLoading();
}

async function renderPdfPage(pageNumber) {
  if (state.pdf.native) {
    renderNativePdfPage(pageNumber);
    return;
  }
  const pdf = state.pdf.document;
  if (!pdf) return;
  const requestedPage = Math.max(1, Math.min(pdf.numPages, Number(pageNumber) || 1));
  state.pdf.task?.cancel?.();
  const page = await pdf.getPage(requestedPage);
  const unscaled = page.getViewport({ scale: 1 });
  const fitScale = Math.max(.3, (stage.clientWidth - 32) / unscaled.width);
  const scale = state.pdf.fit ? fitScale : state.pdf.zoom;
  const viewport = page.getViewport({ scale });
  const outputScale = Math.min(window.devicePixelRatio || 1, 2);
  const canvas = document.createElement('canvas');
  canvas.width = Math.floor(viewport.width * outputScale);
  canvas.height = Math.floor(viewport.height * outputScale);
  canvas.style.width = `${Math.floor(viewport.width)}px`;
  canvas.style.height = `${Math.floor(viewport.height)}px`;
  const pageView = document.createElement('div');
  pageView.className = 'reader-pdf-page';
  pageView.append(canvas);
  stage.replaceChildren(pageView);
  const context = canvas.getContext('2d', { alpha: false });
  state.pdf.task = page.render({ canvasContext: context, transform: outputScale === 1 ? null : [outputScale, 0, 0, outputScale, 0, 0], viewport });
  try { await state.pdf.task.promise; } catch (error) { if (error?.name !== 'RenderingCancelledException') throw error; return; }
  state.pdf.page = requestedPage;
  pageInput.value = requestedPage;
  previousButton.disabled = requestedPage <= 1;
  nextButton.disabled = requestedPage >= pdf.numPages;
  const location = `Page ${requestedPage} of ${pdf.numPages}`;
  const resumed = requestedPage === Number(state.progress.pdfPage);
  saveProgress({ pdfPage: requestedPage });
  seekInput.value = String(pdf.numPages > 1 ? ((requestedPage - 1) / (pdf.numPages - 1)) * 100 : 0);
  setStatus(resumed ? 'Resumed where you left off.' : 'Reading position saved.', location);
}

function renderNativePdf(url) {
  state.pdf.native = true;
  state.pdf.source = url;
  state.pdf.page = Math.max(1, Number(state.progress.pdfPage) || 1);
  pageInput.removeAttribute('max');
  pageTotal.textContent = '';
  renderNativePdfPage(state.pdf.page);
}

function renderNativePdfPage(pageNumber) {
  const requestedPage = Math.max(1, Number(pageNumber) || 1);
  const source = new URL(state.pdf.source);
  const zoom = state.pdf.fit ? 'page-width' : `${Math.round(state.pdf.zoom * 100)}`;
  source.hash = `page=${requestedPage}&zoom=${zoom}`;
  const frame = document.createElement('iframe');
  frame.className = 'reader-native-pdf';
  frame.src = source.href;
  frame.title = `${title}, PDF page ${requestedPage}`;
  stage.replaceChildren(frame);
  state.pdf.page = requestedPage;
  pageInput.value = requestedPage;
  previousButton.disabled = requestedPage <= 1;
  nextButton.disabled = false;
  saveProgress({ pdfPage: requestedPage });
  seekInput.value = '0';
  setStatus('This PDF has no adaptable HTML edition available.', `Page ${requestedPage}`);
}

function setupAudio(url) {
  if (!url) return;
  audioWrap.hidden = false;
  audioPlayer.src = url;
  audioPlayer.addEventListener('loadedmetadata', () => {
    if (Number.isFinite(Number(state.progress.audioTime)) && state.progress.audioTime > 0) audioPlayer.currentTime = state.progress.audioTime;
  }, { once: true });
  audioPlayer.addEventListener('timeupdate', () => saveProgress({ audioTime: audioPlayer.currentTime }), { passive: true });
  audioPlayer.addEventListener('pause', () => saveProgress({ audioTime: audioPlayer.currentTime }));
}

function resetProgress() {
  if (!window.confirm('Start this edition from the beginning? Your saved position will be cleared.')) return;
  state.progress = {};
  try { window.localStorage.removeItem(progressKey); } catch { /* Storage is optional. */ }
  if (state.type === 'pdf') renderPdfPage(1);
  if (state.type === 'html') stage.scrollTo({ top: 0, behavior: 'smooth' });
  if (state.htmlFrame?.contentWindow) state.htmlFrame.contentWindow.postMessage({ type: 'axiologic-reader-reset' }, '*');
  if (state.type === 'epub') state.epub.rendition?.display();
  if (!audioPlayer.paused) audioPlayer.pause();
  audioPlayer.currentTime = 0;
  setStatus('Started again.', 'Beginning');
}

function bindControls() {
  previousButton.addEventListener('click', () => renderPdfPage(state.pdf.page - 1));
  nextButton.addEventListener('click', () => renderPdfPage(state.pdf.page + 1));
  pageInput.addEventListener('change', () => renderPdfPage(pageInput.value));
  readingPreviousButton.addEventListener('click', () => turnReadingPage(-1));
  readingNextButton.addEventListener('click', () => turnReadingPage(1));
  seekInput.addEventListener('input', () => seekReading(Number(seekInput.value) / 100));
  textSmallerButton.addEventListener('click', () => changeTextSize(-1));
  textLargerButton.addEventListener('click', () => changeTextSize(1));
  zoomOutButton.addEventListener('click', () => changeTextSize(-1));
  zoomInButton.addEventListener('click', () => changeTextSize(1));
  sizeButton.addEventListener('click', resetDisplay);
  fitButton.addEventListener('click', () => { state.pdf.fit = true; renderPdfPage(state.pdf.page); });
  themeButton.addEventListener('click', () => {
    const next = themeOrder[(themeOrder.indexOf(sharedSiteTheme()) + 1) % themeOrder.length];
    saveSharedSiteTheme(next);
    state.preferences.theme = next.startsWith('dark') ? 'night' : 'paper';
    applyTheme();
    savePreferences();
  });
  resetButton.addEventListener('click', resetProgress);
  document.addEventListener('keydown', (event) => {
    if (state.type !== 'pdf' || event.target.matches('input, textarea')) return;
    if (event.key === 'ArrowLeft') { event.preventDefault(); renderPdfPage(state.pdf.page - 1); }
    if (event.key === 'ArrowRight') { event.preventDefault(); renderPdfPage(state.pdf.page + 1); }
  });
  window.addEventListener('resize', () => { if (state.type === 'pdf' && state.pdf.fit) renderPdfPage(state.pdf.page); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') saveProgress(); });
  window.addEventListener('pagehide', () => saveProgress());
  window.addEventListener('message', (event) => {
    if (event.source !== state.htmlFrame?.contentWindow || event.data?.type !== 'axiologic-reader-progress') return;
    const position = Math.max(0, Math.min(1, Number(event.data.position) || 0));
    const metrics = updateReadingProgress(position, event.data.page, event.data.total);
    saveProgress({ htmlPosition: metrics.position });
    setStatus('Reading position saved.', `${Math.round(metrics.position * 100)}% · Page ${metrics.page} of ${metrics.total}`);
  });
}

async function start() {
  document.title = `${title} · Reader · ScriptaHub`;
  titleNode.textContent = title;
  backLink.href = usableBackHref();
  applyTheme();
  applyTextSize();
  bindControls();
  await configureLanguageSelector();
  const resources = await resolveResources();
  const type = validTypes.find((candidate) => resources[candidate]);
  if (!type) {
    showError('No compatible HTML, EPUB or PDF edition was found for this reader link.');
    return;
  }
  state.type = type;
  state.source = resources[type];
  originalLink.href = resources.pdf || resources[type];
  if (resources.pdf) { downloadLink.href = resources.pdf; downloadLink.hidden = false; }
  else downloadLink.hidden = true;
  setControls(type);
  try {
    if (type === 'html') await renderHtml(state.source);
    else if (type === 'epub') await renderEpub(state.source);
    else await renderPdf(state.source);
    resolveAudio().then(setupAudio).catch(() => {});
  } catch (error) {
    console.error(`Reader could not load the ${type} edition.`, error);
    if (type !== 'pdf' && resources.pdf) {
      state.type = 'pdf';
      state.source = resources.pdf;
      setControls('pdf');
      setStatus('The adaptable edition was unavailable. Opening the PDF instead…');
      try {
        await renderPdf(resources.pdf);
        resolveAudio().then(setupAudio).catch(() => {});
        return;
      } catch (pdfError) {
        console.error('Reader could not load the PDF fallback.', pdfError);
      }
    }
    showError(error?.message || 'This edition could not be loaded.');
  }
}

start().catch((error) => {
  console.error('Reader could not start.', error);
  showError(error?.message || 'The reader could not be started.');
});

// Keep account navigation available without loading the catalogue application shell.
const readerAccount = document.querySelector('[data-reader-account]');
if (readerAccount) {
  const language = query.get('lang') || 'en';
  const labels = { en: 'My account', ro: 'Contul meu', fr: 'Mon compte', de: 'Mein Konto', es: 'Mi cuenta', pt: 'A minha conta', it: 'Il mio account', pl: 'Moje konto' };
  readerAccount.title = labels[language] || labels.en;
  readerAccount.setAttribute('aria-label', readerAccount.title);
  readerAccount.href = `../account/index.html?lang=${encodeURIComponent(language)}`;
}
