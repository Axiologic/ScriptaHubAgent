// Covers belong to the UI; missing content images and icons are never replaced.
const siteRoot = new URL('../', import.meta.url);
const placeholders = [1, 2, 3].map(index => new URL(`assets/book-cover-default-${index}.webp`, siteRoot).href);
const choices = new Map();
const selector = '[data-book-cover], .cover-link img, [data-cover-preview] img, .book-card img, .mission-book-icon img, .workflow-context img, .librarian-result-cover img, .library-item img, .edition-history-cover, .cover-preview img';
function bookKey(image) {
  const identified = image.dataset.bookId || image.closest('[data-book-id]')?.dataset.bookId;
  if (identified) return identified;
  const book = globalThis.SCRIPTA_COLLECTION?.books?.find(book => Object.values(book.editions || {}).some(edition => edition.book && new URL(edition.book, siteRoot).pathname === location.pathname));
  return book?.id || image.getAttribute('src') || location.pathname;
}
function fallback(image) {
  // A broken default asset must not start an error/retry loop.
  if (placeholders.includes(image.src)) return;
  const key = bookKey(image);
  if (!choices.has(key)) choices.set(key, placeholders[Math.floor(Math.random() * placeholders.length)]);
  image.removeAttribute('srcset');
  image.removeAttribute('sizes');
  image.dataset.coverPlaceholder = 'true';
  image.src = choices.get(key);
}
function inspect(image) {
  if (!image.matches(selector)) return;
  if (!image.getAttribute('src')?.trim() || image.complete && image.naturalWidth === 0) fallback(image);
  else if (!placeholders.includes(image.src)) delete image.dataset.coverPlaceholder;
}
function scan(root) {
  if (root.nodeType === 1 && root.matches(selector)) inspect(root);
  root.querySelectorAll?.(selector).forEach(inspect);
}
document.addEventListener('error', event => {
  if (event.target instanceof HTMLImageElement && event.target.matches(selector)) fallback(event.target);
}, true);
const observer = new MutationObserver(records => {
  for (const record of records) {
    if (record.type === 'attributes') inspect(record.target);
    else for (const node of record.addedNodes) if (node.nodeType === 1) scan(node);
  }
});
observer.observe(document.documentElement, {childList:true, subtree:true, attributes:true, attributeFilter:['src','srcset']});
scan(document);
