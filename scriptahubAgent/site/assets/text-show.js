/* textShow: independent, finite text presentations. See text-show.md. */
(() => {
  "use strict";
  const instances = new WeakMap();
  const escape = (value) => String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const split = (value, language = 'en') => {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    if (!text) return [];
    if (globalThis.Intl?.Segmenter) return [...new Intl.Segmenter(language, { granularity: 'sentence' }).segment(text)].map(({ segment }) => segment.trim()).filter(Boolean);
    return text.match(/[^.!?。！？]+[.!?。！？]+(?:[”’»"])?|[^.!?。！？]+$/g)?.map(s => s.trim()).filter(Boolean) || [text];
  };
  const words = (sentence) => {
    const parts = sentence.split(/(\s+)/);
    const count = parts.filter(part => /\S/.test(part)).length;
    let index = 0;
    return parts.map(part => /\S/.test(part) ? `<span class="text-show-word" style="--text-show-delay:${Math.round(index++ * Math.min(125, 3300 / Math.max(1, count - 1)))}ms">${escape(part)}</span>` : part).join('');
  };
  // Includes the final word's animation AND a readable hold; no upper cap.
  const duration = (sentence) => 440 + Math.min(3300, Math.max(0, sentence.split(/\s+/).length - 1) * 125) + Math.max(2400, sentence.split(/\s+/).length * 200);

  function textShow(target, options = {}) {
    instances.get(target)?.destroy();
    const original = target.textContent;
    const sentences = Array.isArray(options.text) ? options.text.map(String).filter(Boolean) : split(options.text ?? original, options.language);
    const reduced = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const frames = reduced && !options.render ? [sentences.join(' ')].filter(Boolean) : sentences;
    const visibilityTarget = options.visibilityTarget || target;
    let index = 0, started = false, paused = false, completed = false, destroyed = false;
    let freezeAnimation = true;
    let visible = !options.whenVisible, timer = 0, due = 0, remaining = 0;
    const ready = () => typeof options.ready !== 'function' || options.ready();
    const originalClass = target.className;
    if (!options.render) {
      target.classList.add('text-show');
      target.innerHTML = `<span class="text-show-accessible">${escape(sentences.join(' '))}</span><span class="text-show-stage" aria-hidden="true">${frames.map((sentence, i) => `<span class="text-show-frame${i === 0 ? ' is-current' : ''}">${escape(sentence)}</span>`).join('')}</span>`;
    }
    const stopTimer = () => {
      if (timer) remaining = Math.max(0, due - performance.now());
      clearTimeout(timer);
      timer = 0;
    };
    const canRun = () => started && !paused && !completed && !destroyed && visible && !document.hidden && ready();
    const finish = () => {
      if (completed || destroyed) return;
      completed = true;
      remaining = 0;
      target.dataset.textShowState = 'complete';
      options.onComplete?.(api);
      target.dispatchEvent(new CustomEvent('textshow:complete', { bubbles: true, detail: { instance: api } }));
    };
    const schedule = () => {
      stopTimer();
      if (!canRun()) return;
      due = performance.now() + remaining;
      timer = setTimeout(() => {
        timer = 0;
        if (!target.isConnected) { api.destroy(); return; }
        if (index + 1 < frames.length) show(index + 1);
        else if (options.loop) show(0);
        else finish();
      }, remaining);
    };
    const show = (next) => {
      stopTimer();
      if (destroyed || !frames.length) return;
      index = (next + frames.length) % frames.length;
      completed = false;
      remaining = (options.duration || duration)(frames[index]);
      target.dataset.textShowState = 'playing';
      if (options.render) options.render(frames[index], index, api);
      else target.querySelectorAll('.text-show-frame').forEach((frame, i) => {
        frame.classList.toggle('is-current', i === index);
        if (i === index) frame.innerHTML = reduced ? escape(frames[i]) : words(frames[i]);
      });
      options.onChange?.(api);
      schedule();
    };
    const start = () => {
      if (destroyed || started) return;
      started = true;
      if (!frames.length) { finish(); return; }
      show(0);
    };
    const animationSuspended = () => !visible || document.hidden || !ready() || (paused && freezeAnimation);
    const onVisibility = () => {
      if (visible && !document.hidden && ready() && options.autoplay !== false && !started) start();
      schedule();
      target.classList.toggle('text-show-suspended', animationSuspended());
    };
    const observer = options.whenVisible && globalThis.IntersectionObserver ? new IntersectionObserver(entries => {
      visible = entries[0].isIntersecting && entries[0].intersectionRatio > 0;
      onVisibility();
    }) : null;
    if (!observer) visible = true;
    const api = {
      get index() { return index; }, get sentences() { return [...sentences]; },
      get completed() { return completed; }, get visible() { return visible && !document.hidden; },
      get remaining() { return timer ? Math.max(0, due - performance.now()) : remaining; },
      start,
      refresh: onVisibility,
      show(next) { started = true; show(next); },
      pause(options = {}) { paused = true; freezeAnimation = options.freezeAnimation !== false; stopTimer(); target.classList.toggle('text-show-suspended', animationSuspended()); },
      resume() { paused = false; if (!started) start(); schedule(); target.classList.toggle('text-show-suspended', animationSuspended()); },
      destroy() {
        if (destroyed) return;
        destroyed = true;
        stopTimer(); observer?.disconnect();
        document.removeEventListener('visibilitychange', onVisibility);
        target.textContent = original; target.className = originalClass;
        delete target.dataset.textShowState;
        instances.delete(target);
      },
    };
    instances.set(target, api);
    document.addEventListener('visibilitychange', onVisibility);
    observer?.observe(visibilityTarget);
    target.dataset.textShowState = 'waiting';
    if (options.autoplay !== false && visible && !document.hidden && ready()) start();
    return api;
  }
  textShow.split = split;
  textShow.words = words;
  textShow.duration = duration;
  textShow.get = target => instances.get(target);
  textShow.mount = (root, options = {}) => [...root.querySelectorAll('[data-text-show]')].map(target => instances.get(target) || textShow(target, {
    language: target.lang || document.documentElement.lang, whenVisible: true,
    loop: target.dataset.textShowLoop === "true",
    visibilityTarget: target.closest('.book-card, .librarian-result, .featured-book-card') || target, ...options,
  }));
  textShow.unmount = root => root.querySelectorAll('[data-text-show]').forEach(target => instances.get(target)?.destroy());
  globalThis.textShow = textShow;
})();
