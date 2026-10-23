/* Shared book presentation: one metadata model, structure and textShow lifecycle. */
(() => {
  'use strict';
  const rootURL = new URL('../', document.currentScript.src);
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const detailsLabels = {en:'View Book',fr:'Voir le livre',de:'Buch ansehen',es:'Ver libro',pt:'Ver detalhes',it:'Vedi il libro',ro:'Vezi cartea',pl:'Zobacz książkę'};
  const localized = (value, language) => value?.[language] || value?.en || Object.values(value || {}).find(Boolean) || '';
  const url = (path, language) => {
    if (!path) return '';
    const result = new URL(path, rootURL);
    if (language) result.searchParams.set('lang', language);
    return result.href;
  };
  function model(book, language = document.documentElement.lang) {
    return {
      id: book.id, language, title: localized(book.title, language), subtitle: localized(book.subtitle, language),
      description: localized(book.shortDescription, language), category: book.category || '',
      status: localized(book.publicationLabel, language), keywords: book.keywords?.[language] || book.keywords?.en || [],
      href: url(book.editions?.[language]?.book || book.editions?.en?.book || Object.values(book.editions || {}).find(edition => edition.book)?.book, language),
      thumbnail: url(localized(book.thumbnailUrl, language)), details: detailsLabels[language] || detailsLabels.en,
    };
  }
  const disclosureLabels = {en:['Show full book description','Show less'],fr:['Afficher la description complète du livre','Réduire'],de:['Vollständige Buchbeschreibung anzeigen','Weniger anzeigen'],es:['Mostrar la descripción completa del libro','Mostrar menos'],pt:['Mostrar a descrição completa do livro','Mostrar menos'],it:['Mostra la descrizione completa del libro','Mostra meno'],ro:['Afișează descrierea completă a cărții','Arată mai puțin'],pl:['Pokaż pełny opis książki','Pokaż mniej']};
  const disclosures = new WeakMap();
  let descriptionSequence = 0;
  function expandableDescription(data) {
    const id = `book-description-${++descriptionSequence}`;
    const labels = disclosureLabels[data.language] || disclosureLabels.en;
    return `<div class="book-description-disclosure" data-book-description-disclosure><p id="${id}" class="description" lang="${escape(data.language)}" title="${escape(data.description)}">${escape(data.description)}</p><button type="button" class="book-description-toggle" aria-controls="${id}" aria-expanded="false" aria-label="${escape(labels[0])}" title="${escape(data.description)}" data-expand-label="${escape(labels[0])}" data-collapse-label="${escape(labels[1])}" hidden>…</button></div>`;
  }
  function disclosureTargets(root) {
    return [...(root.matches?.('[data-book-description-disclosure]') ? [root] : []), ...root.querySelectorAll('[data-book-description-disclosure]')];
  }
  function mountDisclosures(root) {
    disclosureTargets(root).forEach(target => {
      if (disclosures.has(target)) { disclosures.get(target).refresh(); return; }
      const paragraph = target.querySelector('p'), button = target.querySelector('button');
      const refresh = () => {
        if (!target.isConnected) return;
        const expanded = button.getAttribute('aria-expanded') === 'true';
        button.hidden = !expanded && paragraph.scrollHeight <= paragraph.clientHeight + 1;
      };
      const toggle = () => {
        const expanded = button.getAttribute('aria-expanded') !== 'true';
        button.setAttribute('aria-expanded', String(expanded));
        button.setAttribute('aria-label', expanded ? button.dataset.collapseLabel : button.dataset.expandLabel);
        button.textContent = expanded ? '−' : '…';
        target.classList.toggle('is-expanded', expanded);
        refresh();
      };
      button.addEventListener('click', toggle);
      const observer = new ResizeObserver(refresh);
      observer.observe(paragraph);
      disclosures.set(target, {refresh, destroy: () => {observer.disconnect();button.removeEventListener('click', toggle);disclosures.delete(target);}});
      requestAnimationFrame(refresh);
      document.fonts?.ready.then(refresh);
    });
  }
  const description = (data, className = 'description', loop = data.loop || false) => `<p class="${className}" data-text-show data-text-show-loop="${loop}" lang="${escape(data.language)}">${escape(data.description)}</p>`;
  const title = (data, tag = 'h2', link = true) => `<${tag}>${link ? `<a href="${escape(data.href)}">${escape(data.title)}</a>` : escape(data.title)}</${tag}>`;
  const status = data => data.status ? `<p class="publication-status">${escape(data.status)}</p>` : '';
  const action = (data, className = 'book-card-details') => `<a class="${className}" href="${escape(data.href)}">${className === 'librarian-result-action-cell' ? `<span>${escape(data.details)}</span>` : escape(data.details)}</a>`;
  const cover = (data, className = '') => `<a class="${className}" href="${escape(data.href)}" aria-label="${escape(`${data.details}: ${data.title}`)}"><img src="${escape(data.thumbnail)}" alt="${escape(data.title)}" loading="lazy" decoding="async"></a>`;
  const keywords = (data, className, values = data.keywords.slice(0, 5), label = '') => `<div class="${className}"${label ? ` aria-label="${escape(label)}"` : ''}>${values.map(value => `<span>${escape(value)}</span>`).join('')}</div>`;

  function markup(book, options = {}) {
    const data = model(book, options.language);
    data.loop = options.loop ?? options.variant === "page";
    if (options.actionLabel) data.details = options.actionLabel;
    const identity = `data-book-view="${escape(options.variant || 'catalogue')}" data-book-id="${escape(data.id)}"`;
    switch (options.variant) {
      case 'featured':
        return `<div class="featured-book-copy" ${identity}><p class="eyebrow">${escape(options.kicker)}</p><p class="featured-book-category">${escape(data.category)}</p>${status(data)}${title(data)}${keywords(data, 'featured-book-keywords')}${description(data, 'featured-book-description')}<nav class="book-card-actions featured-book-actions">${action(data)}</nav></div>`;
      case 'page':
        return `<div class="book-copy" ${identity}><p class="eyebrow">${escape(options.kicker || data.category)} · ScriptaHub</p>${title(data, 'h1', false)}${data.subtitle ? `<p class="book-subtitle">${escape(data.subtitle)}</p>` : ''}${description(data, 'lead', options.loop ?? true)}</div>`;
      case 'librarian':
        return `<article class="librarian-result" ${identity}>${cover(data, 'librarian-result-cover')}${action(data, 'librarian-result-action-cell')}<div class="librarian-result-copy"><div class="librarian-result-meta"><span class="librarian-rank">${String(options.rank).padStart(2,'0')}</span><span>${escape(data.category)}</span><span>${escape(options.relevance)}% ${escape(options.scoreLabel)}</span></div>${status(data)}${title(data)}${keywords(data, 'librarian-result-keywords', options.keywords, options.keywordsLabel)}${description(data)}${action(data, 'button librarian-result-action')}</div></article>`;
      case 'context':
        return `<aside class="workflow-context" ${identity}><img src="${escape(data.thumbnail)}" alt="">${title(data, 'h2', false)}${description(data)}${action(data, 'button button-quiet')}</aside>`;
      case 'compact-context':
        return `<aside class="workflow-context workflow-book-compact" ${identity}>${cover(data)}<div>${title(data, 'h2', false)}${options.showCategory ? `<p class="category">${escape(data.category)}</p>` : ''}${options.showDescription === false ? '' : options.expandDescription ? expandableDescription(data) : description(data)}</div></aside>`;
      default:
        return `<article class="book-card" ${identity} data-book-url="${escape(data.href)}" role="link" tabindex="0" aria-label="${escape(`${data.details}: ${data.title}`)}"><div class="book-card-top">${cover(data)}<div><p class="category">${escape(data.category)}</p>${title(data, 'h3')}</div></div>${status(data)}${description(data)}<nav class="book-card-actions">${action(data)}</nav></article>`;
    }
  }
  function descriptions(root) {
    const targets = [...root.querySelectorAll('[data-text-show]')];
    if (root.matches?.('[data-text-show]')) targets.unshift(root);
    return targets;
  }
  function mount(root = document) {
    mountDisclosures(root);
    return descriptions(root).map(target => {
      const existing = textShow.get(target);
      if (existing) { existing.refresh(); return existing; }
      return textShow(target, {language: target.lang || document.documentElement.lang, whenVisible: true,
        loop: target.dataset.textShowLoop === "true",
        ready: () => !target.closest('[aria-busy="true"]')});
    });
  }
  function unmount(root) { descriptions(root).forEach(target => textShow.get(target)?.destroy()); disclosureTargets(root).forEach(target => disclosures.get(target)?.destroy()); }
  function render(host, book, options = {}) {
    unmount(host);
    host.innerHTML = markup(book, options);
    return mount(host);
  }
  // One cover measurement drives the adjacent panel at every breakpoint.
  function alignCover(cover, host) {
    const height = cover?.getBoundingClientRect().height;
    if (height > 1 && host) host.style.setProperty('--book-cover-height', `${height}px`);
  }
  function page(book, language) {
    const copy = document.querySelector('.book-copy');
    if (!copy || !book) { mount(document); return; }
    const notice = copy.querySelector('.edition-unavailable');
    const kicker = copy.querySelector('.eyebrow')?.textContent.replace(/\s*·\s*ScriptaHub\s*$/, '');
    unmount(copy);
    const template = document.createElement('template');
    template.innerHTML = markup(book, {variant:'page', language, kicker});
    const fresh = template.content.firstElementChild;
    if (notice) fresh.append(notice);
    copy.replaceWith(fresh);
    mount(fresh);
  }
  // One lifecycle owns static pages and subsequently inserted/replaced results.
  // Word animation DOM updates do not remount the containing presentation.
  const observer = new MutationObserver(records => {
    for (const record of records) {
      if (record.type === 'attributes') { mount(record.target); continue; }
      if (record.target.closest?.('.text-show')) continue;
      for (const node of record.removedNodes) if (node.nodeType === 1 && !node.isConnected) unmount(node);
      for (const node of record.addedNodes) if (node.nodeType === 1 && node.isConnected) mount(node);
    }
  });
  observer.observe(document.body, {childList:true, subtree:true, attributes:true, attributeFilter:['aria-busy']});
  addEventListener('pageshow', () => mount(document));
  globalThis.ScriptaBookView = {model, markup, render, page, mount, unmount, alignCover};
})();
