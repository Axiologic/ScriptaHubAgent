(() => {
  const storageKey = `axiologic-standalone-reader:v2:${window.location.pathname}`;
  let saveTimer;

  const readState = () => {
    try { return JSON.parse(window.localStorage.getItem(storageKey) || '{}'); } catch { return {}; }
  };

  const writeState = (value) => {
    try { window.localStorage.setItem(storageKey, JSON.stringify(value)); } catch { /* Storage is optional. */ }
  };

  const maximumScroll = () => Math.max(0, document.documentElement.scrollHeight - window.innerHeight);

  const metrics = () => {
    const available = maximumScroll();
    const position = available > 0 ? window.scrollY / available : 0;
    const total = Math.max(1, Math.ceil(document.documentElement.scrollHeight / Math.max(1, window.innerHeight)));
    const page = Math.min(total, Math.floor(window.scrollY / Math.max(1, window.innerHeight)) + 1);
    return { position: Math.max(0, Math.min(1, position)), page, total };
  };

  const report = () => {
    const progress = metrics();
    writeState({ ...readState(), ...progress, updatedAt: Date.now() });
    window.parent.postMessage({ type: 'axiologic-reader-progress', ...progress }, '*');
  };

  const goToPosition = (position, behavior = 'auto') => {
    const safePosition = Math.max(0, Math.min(1, Number(position) || 0));
    window.scrollTo({ top: maximumScroll() * safePosition, behavior });
    window.setTimeout(report, behavior === 'smooth' ? 360 : 0);
  };

  const applySettings = ({ fontSize, theme, position } = {}) => {
    const preservedPosition = metrics().position;
    if (Number(fontSize)) document.documentElement.style.setProperty('--standalone-size', `${fontSize}rem`);
    if (theme) document.documentElement.dataset.theme = theme;
    window.requestAnimationFrame(() => goToPosition(Number.isFinite(Number(position)) ? Number(position) : preservedPosition));
  };

  document.querySelectorAll('p').forEach((paragraph) => {
    if (!paragraph.textContent.replace(/\u00a0/g, ' ').trim()) paragraph.remove();
  });

  window.addEventListener('scroll', () => {
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(report, 160);
  }, { passive: true });
  window.addEventListener('pagehide', report);
  window.addEventListener('resize', () => window.setTimeout(report, 120));
  window.addEventListener('message', (event) => {
    if (event.data?.type === 'axiologic-reader-settings') applySettings(event.data);
    if (event.data?.type === 'axiologic-reader-reset') {
      writeState({ position: 0, page: 1, updatedAt: Date.now() });
      goToPosition(0, 'smooth');
    }
    if (event.data?.type === 'axiologic-reader-page') {
      window.scrollBy({ top: (Number(event.data.direction) < 0 ? -1 : 1) * window.innerHeight * .9, behavior: 'smooth' });
    }
    if (event.data?.type === 'axiologic-reader-seek') goToPosition(event.data.position, 'smooth');
  });

  const saved = readState();
  window.requestAnimationFrame(() => goToPosition(saved.position || 0));
})();
