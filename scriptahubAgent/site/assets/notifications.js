// One application notification, independent of page layout and scroll position.
let container, copy, closeButton, outline, symbol, timer, pending, currentKind;
const closeLabels = {en:'Dismiss notification',ro:'Închide notificarea',fr:'Fermer la notification',de:'Benachrichtigung schließen',es:'Cerrar notificación',pt:'Fechar notificação',it:'Chiudi notifica',pl:'Zamknij powiadomienie'};
function dismiss() {
  clearTimeout(timer);cancelAnimationFrame(pending);
  if (!container) return;
  container.hidePopover();copy.textContent = '';
}
function resume() {
  clearTimeout(timer);
  if (container.matches(':hover') || container.contains(document.activeElement)) return;
  timer = setTimeout(dismiss, currentKind === 'error' ? 12000 : 7000);
}
function prepare() {
  if (container) return;
  container = document.createElement('div');container.className = 'site-toast';container.setAttribute('popover', 'manual');
  const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  icon.setAttribute('viewBox', '0 0 24 24');icon.setAttribute('fill', 'none');icon.setAttribute('stroke', 'currentColor');icon.setAttribute('stroke-width', '1.8');icon.setAttribute('aria-hidden', 'true');
  icon.setAttribute('stroke-linecap', 'round');icon.setAttribute('stroke-linejoin', 'round');
  icon.innerHTML = '<path/><path/>';[outline, symbol] = icon.querySelectorAll('path');
  copy = document.createElement('p');copy.setAttribute('role', 'status');copy.setAttribute('aria-live', 'polite');copy.setAttribute('aria-atomic', 'true');
  closeButton = document.createElement('button');closeButton.type = 'button';closeButton.className = 'site-icon-button site-toast-close';
  closeButton.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>';
  closeButton.addEventListener('click', dismiss);
  container.addEventListener('pointerenter', () => clearTimeout(timer));
  container.addEventListener('focusin', () => clearTimeout(timer));
  container.addEventListener('pointerleave', resume);container.addEventListener('focusout', resume);
  container.append(icon, copy, closeButton);document.body.append(container);
}
export function showToast(text, kind = 'info') {
  if (!String(text || '').trim()) return;
  prepare();clearTimeout(timer);cancelAnimationFrame(pending);
  currentKind = ['info', 'success', 'error'].includes(kind) ? kind : 'info';container.dataset.state = currentKind;
  outline.setAttribute('d', currentKind === 'error' ? 'M12 3 2 21h20L12 3Z' : 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z');
  symbol.setAttribute('d', currentKind === 'success' ? 'm7 12 3 3 7-7' : currentKind === 'error' ? 'M12 9v5m0 3h.01' : 'M12 11v6m0-10h.01');
  closeButton.setAttribute('aria-label', closeLabels[document.documentElement.lang] || closeLabels.en);
  closeButton.title = closeButton.getAttribute('aria-label');
  copy.textContent = '';container.showPopover();
  // Update the already-visible live region, including when the same message repeats.
  pending = requestAnimationFrame(() => { copy.textContent = String(text);resume(); });
}
export const notifications = Object.freeze({ show: showToast, dismiss });
globalThis.ScriptaNotifications = notifications;
