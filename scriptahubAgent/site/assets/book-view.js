/* Shared book presentation: one metadata model, structure and textShow lifecycle. */
(() => {
  'use strict';
  import(new URL('book-covers.js', document.currentScript.src));
  const rootURL = new URL('../', document.currentScript.src);
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const detailsLabels = {en:'View Book',fr:'Voir le livre',de:'Buch ansehen',es:'Ver libro',pt:'Ver detalhes',it:'Vedi il libro',ro:'Vezi cartea',pl:'Zobacz książkę'};
  const localized = (value, language) => value?.[language] || value?.en || Object.values(value || {}).find(Boolean) || '';
  const url = (path, language) => {
    if (!path) return '';
    try {
      const result = new URL(path, rootURL);
      if (language) result.searchParams.set('lang', language);
      return result.href;
    } catch { return ''; }
  };
  function model(book, language = document.documentElement.lang) {
    return {
      id: book.id, language, title: localized(book.title, language), subtitle: localized(book.subtitle, language),
      description: localized(book.shortDescription, language), category: book.category || '',
      status: localized(book.publicationLabel, language), keywords: book.keywords?.[language] || book.keywords?.en || [],
      href: url(book.editions?.[language]?.book || book.editions?.en?.book || Object.values(book.editions || {}).find(edition => edition.book)?.book, language),
      thumbnail: url(localized(book.thumbnailUrl, language) || localized(book.coverUrl, language)), details: detailsLabels[language] || detailsLabels.en,
    };
  }
  const description = (data, className = 'description', loop = data.loop || false) => `<p class="${className}" data-text-show data-text-show-loop="${loop}" lang="${escape(data.language)}">${escape(data.description)}</p>`;
  const title = (data, tag = 'h2', link = true) => `<${tag}>${link ? `<a href="${escape(data.href)}">${escape(data.title)}</a>` : escape(data.title)}</${tag}>`;
  const status = data => data.status ? `<p class="publication-status">${escape(data.status)}</p>` : '';
  const action = (data, className = 'book-card-details') => `<a class="${className}" href="${escape(data.href)}">${className === 'librarian-result-action-cell' ? `<span>${escape(data.details)}</span>` : escape(data.details)}</a>`;
  const cover = (data, className = '') => `<a class="${className}" href="${escape(data.href)}" aria-label="${escape(`${data.details}: ${data.title}`)}"><img data-book-cover data-book-id="${escape(data.id)}" ${data.thumbnail ? `src="${escape(data.thumbnail)}"` : ""} alt="${escape(data.title)}" loading="lazy" decoding="async"></a>`;
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
        return `<aside class="workflow-context" ${identity}><img data-book-cover data-book-id="${escape(data.id)}" ${data.thumbnail ? `src="${escape(data.thumbnail)}"` : ""} alt="">${title(data, 'h2', false)}${description(data)}${action(data, 'button button-quiet')}</aside>`;
      case 'compact-context': {
        const heading = options.showTitle === false ? '' : title(data, 'h2', false);
        const category = options.showCategory ? `<p class="category">${escape(data.category)}</p>` : '';
        if (options.scrollDescription && options.showDescription !== false) {
          return `<aside class="workflow-context workflow-book-compact" ${identity}>${heading}${category}
            <div class="book-description-disclosure" tabindex="0">${cover(data, 'book-description-cover')}<p class="description" lang="${escape(data.language)}">${escape(data.description)}</p></div>
          </aside>`;
        }
        return `<aside class="workflow-context workflow-book-compact" ${identity}>${cover(data)}<div>${heading}${category}${options.showDescription === false ? '' : description(data)}</div></aside>`;
      }
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
    return descriptions(root).map(target => {
      const existing = textShow.get(target);
      if (existing) { existing.refresh(); return existing; }
      return textShow(target, {language: target.lang || document.documentElement.lang, whenVisible: true,
        loop: target.dataset.textShowLoop === "true",
        ready: () => !target.closest('[aria-busy="true"]')});
    });
  }
  function unmount(root) { descriptions(root).forEach(target => textShow.get(target)?.destroy()); }
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
