import { accountLogoutPath } from './account-context.js';
(() => {
  'use strict';
  const root = new URL('../', import.meta.url);
  const labels = {
    en: ['My account', 'Home', 'Sign-in & security'],
    ro: ['Contul meu', 'Acasă', 'Autentificare și securitate'],
    fr: ['Mon compte', 'Accueil', 'Connexion et sécurité'],
    de: ['Mein Konto', 'Startseite', 'Anmeldung und Sicherheit'],
    es: ['Mi cuenta', 'Inicio', 'Inicio de sesión y seguridad'],
    pt: ['A minha conta', 'Início', 'Acesso e segurança'],
    it: ['Il mio account', 'Home', 'Accesso e sicurezza'],
    pl: ['Moje konto', 'Strona główna', 'Logowanie i bezpieczeństwo'],
  };
  const requested = new URL(location.href).searchParams.get('lang') || 'en';
  const language = labels[requested] ? requested : 'en';
  const words = labels[language];
  document.documentElement.lang = language;
  document.title = words[0] + ' · ScriptaHub';
  const homeLabel = document.querySelector('[data-account-text="home"]');
  if (homeLabel) homeLabel.textContent = words[1];
  document.querySelector('.account-page section').setAttribute('aria-label', words[0]);
  const frame = document.querySelector('.account-security-frame');
  function syncAccountTheme() {
    try {
      const document = frame.contentDocument;
      const expected = new URL(frame.getAttribute('src'), location.href);
      const actual = new URL(frame.contentWindow.location.href);
      if (!document?.head || expected.origin !== location.origin || actual.origin !== expected.origin
        || !actual.pathname.startsWith(expected.pathname)) return;
      document.documentElement.dataset.scriptaEmbedded = 'true';
      for (const signOut of document.querySelectorAll('.account-sign-out')) {
        signOut.setAttribute('href', accountLogoutPath(root, location.href));
        signOut.setAttribute('target', '_top');
      }
      let stylesheet = document.querySelector('[data-scriptahub-account-theme]');
      if (!stylesheet) {
        stylesheet = document.createElement('link');
        stylesheet.rel = 'stylesheet';
        stylesheet.href = new URL('assets/account-provider.css?v=account-theme-2', root).href;
        stylesheet.dataset.scriptahubAccountTheme = '';
      }
      // The first call may run while the iframe is still parsing its own styles.
      // Restore cascade order on load and on every application theme update.
      if (document.head.lastElementChild !== stylesheet) document.head.append(stylesheet);
      const style = getComputedStyle(window.document.documentElement);
      for (const name of ['ink', 'content', 'muted', 'panel', 'surface', 'field', 'line', 'green', 'button-bg', 'button-hover', 'button-ink', 'action-font-size']) {
        document.documentElement.style.setProperty(`--scripta-${name}`, style.getPropertyValue(`--${name}`));
      }
      document.documentElement.style.setProperty('--scripta-font-family', style.fontFamily);
      document.documentElement.style.setProperty('--scripta-font-size', style.fontSize);
      document.documentElement.style.colorScheme = style.colorScheme;
    } catch (error) {
      // An external identity redirect cannot be styled by the embedding page.
      if (error.name !== 'SecurityError') throw error;
    }
  }
  frame.addEventListener('load', syncAccountTheme);
  new MutationObserver(syncAccountTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'style'] });
  syncAccountTheme();
})();
