(() => {
  'use strict';
  const root = new URL('../', document.currentScript.src);
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
  document.querySelector('[data-account-text="home"]').textContent = words[1];
  document.querySelector('.account-page section').setAttribute('aria-label', words[0]);
  const frame = document.querySelector('.account-security-frame');
  function syncAccountTheme() {
    try {
      const document = frame.contentDocument;
      if (!document?.head || !frame.contentWindow.location.pathname.startsWith('/base-agent-additional-server/userPersistoAgent/7000/service/dashboard/')) return;
      if (!document.querySelector('[data-scriptahub-account-theme]')) {
        const stylesheet = document.createElement('link');
        stylesheet.rel = 'stylesheet';
        stylesheet.href = new URL('assets/account-provider.css?v=account-palette', root).href;
        stylesheet.dataset.scriptahubAccountTheme = '';
        document.head.append(stylesheet);
      }
      const style = getComputedStyle(window.document.documentElement);
      for (const name of ['ink', 'muted', 'panel', 'surface', 'field', 'line', 'green', 'button-bg', 'button-hover', 'button-ink']) {
        document.documentElement.style.setProperty(`--scripta-${name}`, style.getPropertyValue(`--${name}`));
      }
      document.documentElement.style.colorScheme = style.colorScheme;
    } catch (error) {
      // An external identity redirect cannot be styled by the embedding page.
      if (error.name !== 'SecurityError') throw error;
    }
  }
  frame.addEventListener('load', syncAccountTheme);
  new MutationObserver(syncAccountTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  syncAccountTheme();
})();
