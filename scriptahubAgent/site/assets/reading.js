/* Shared reading routing: prefer the requested language, then English or another available edition. */
(() => {
  "use strict";
  const labels = {
    en: { language: "Reading language", request: "Request translation", title: "Read this book in your language", lead: "English and Romanian editions are prepared for each new release. Other translations are prepared on request.", target: "Requested language", format: "Reading edition", full: "Complete book (HTML)", short: "10-minute edition (HTML)", note: "Message (optional)", available: "This edition is already available.", read: "Start reading", missing: "Choose a book to request its translation.", back: "Back to the book" },
    fr: { language: "Langue de lecture", request: "Demander une traduction", title: "Lisez ce livre dans votre langue", lead: "Chaque nouvelle édition est préparée en anglais et en roumain. Les autres traductions sont réalisées sur demande.", target: "Langue souhaitée", format: "Version de lecture", full: "Livre intégral (HTML)", short: "Version de 10 minutes (HTML)", note: "Message (facultatif)", available: "Cette version est déjà disponible.", read: "Commencer la lecture", missing: "Choisissez un livre pour demander sa traduction.", back: "Retour au livre" },
    de: { language: "Lesesprache", request: "Übersetzung anfragen", title: "Lesen Sie dieses Buch in Ihrer Sprache", lead: "Jede neue Ausgabe erscheint auf Englisch und Rumänisch. Weitere Übersetzungen werden auf Anfrage erstellt.", target: "Gewünschte Sprache", format: "Leseausgabe", full: "Vollständiges Buch (HTML)", short: "10-Minuten-Ausgabe (HTML)", note: "Nachricht (optional)", available: "Diese Ausgabe ist bereits verfügbar.", read: "Jetzt lesen", missing: "Wählen Sie ein Buch aus, um eine Übersetzung anzufragen.", back: "Zurück zum Buch" },
    es: { language: "Idioma de lectura", request: "Solicitar traducción", title: "Lee este libro en tu idioma", lead: "Cada nueva edición se prepara en inglés y rumano. Las demás traducciones se realizan bajo petición.", target: "Idioma solicitado", format: "Versión de lectura", full: "Libro completo (HTML)", short: "Versión de 10 minutos (HTML)", note: "Mensaje (opcional)", available: "Esta versión ya está disponible.", read: "Empezar a leer", missing: "Elige un libro para solicitar su traducción.", back: "Volver al libro" },
    pt: { language: "Idioma de leitura", request: "Pedir tradução", title: "Leia este livro no seu idioma", lead: "Cada nova edição é preparada em inglês e romeno. As outras traduções são feitas mediante pedido.", target: "Idioma pretendido", format: "Versão de leitura", full: "Livro completo (HTML)", short: "Versão de 10 minutos (HTML)", note: "Mensagem (opcional)", available: "Esta versão já está disponível.", read: "Começar a ler", missing: "Escolha um livro para pedir a tradução.", back: "Voltar ao livro" },
    it: { language: "Lingua di lettura", request: "Richiedi traduzione", title: "Leggi questo libro nella tua lingua", lead: "Ogni nuova edizione viene preparata in inglese e romeno. Le altre traduzioni vengono realizzate su richiesta.", target: "Lingua richiesta", format: "Versione di lettura", full: "Libro completo (HTML)", short: "Versione di 10 minuti (HTML)", note: "Messaggio (facoltativo)", available: "Questa versione è già disponibile.", read: "Inizia a leggere", missing: "Scegli un libro per richiederne la traduzione.", back: "Torna al libro" },
    ro: { language: "Limba lecturii", request: "Cere traducerea", title: "Citește această carte în limba ta", lead: "Fiecare ediție nouă este pregătită în engleză și română. Traducerile în celelalte limbi sunt realizate la cerere.", target: "Limba dorită", format: "Versiunea de lectură", full: "Cartea integrală (HTML)", short: "Versiunea de 10 minute (HTML)", note: "Mesaj (opțional)", available: "Această versiune este deja disponibilă.", read: "Începe lectura", missing: "Alege o carte pentru a cere traducerea ei.", back: "Înapoi la carte" },
    pl: { language: "Język lektury", request: "Poproś o tłumaczenie", title: "Czytaj tę książkę w swoim języku", lead: "Każde nowe wydanie jest przygotowywane po angielsku i rumuńsku. Pozostałe tłumaczenia powstają na życzenie.", target: "Wybrany język", format: "Wersja do czytania", full: "Pełna książka (HTML)", short: "Wersja 10-minutowa (HTML)", note: "Wiadomość (opcjonalnie)", available: "Ta wersja jest już dostępna.", read: "Zacznij czytać", missing: "Wybierz książkę, aby poprosić o tłumaczenie.", back: "Powrót do książki" },
  };
  const supported = Object.keys(labels);
  const locale = (value) => supported.includes(value) ? value : "en";
  const formatName = (value) => value === "short" ? "short" : "read";
  const available = (book, language, format = "read") => Boolean(book?.editions?.[language]?.[formatName(format) === "short" ? "shortContent" : "fullContent"]);
  const editionLanguage = (book, language, key = "book") => [language, "en", ...Object.keys(book.editions || {})].find(code => book.editions?.[code]?.[key]);
  const localized = (value, language) => value?.[language] || value?.en || Object.values(value || {}).find(Boolean) || "";
  const requestUrl = (book, language, format, uiLanguage, siteRoot, source = "") => {
    const url = new URL("translate/index.html", siteRoot);
    url.search = new URLSearchParams({ book: book.directory, target: locale(language), format: formatName(format), lang: locale(uiLanguage) }).toString();
    if (supported.includes(source)) url.searchParams.set("source", source);
    return url;
  };
  const readingUrl = (book, language, format, uiLanguage, siteRoot, source = "") => {
    language = locale(language);
    uiLanguage = locale(uiLanguage);
    format = formatName(format);
    language = editionLanguage(book, language, format === "short" ? "shortContent" : "fullContent");
    if (!available(book, language, format)) return null;
    const edition = book.editions[language];
    const url = new URL("reader/index.html", siteRoot);
    url.search = new URLSearchParams({ id: `${book.id}:${book.currentEdition || "edition-1"}:${language}:${format}`, book: book.directory, language, lang: uiLanguage, format, mode: format === "short" ? "ten-minute" : "full", title: `${localized(book.title, language)} · ${format === "short" ? labels[uiLanguage].short : labels[uiLanguage].full}`, html: `../${edition[format === "short" ? "shortContent" : "fullContent"]}`, back: `../${book.editions[editionLanguage(book, uiLanguage)].book}?lang=${uiLanguage}` }).toString();
    if (edition.pdf) url.searchParams.set("pdf", `../${edition.pdf}`);
    return url;
  };
  const unavailableLabels = {
    en: 'This reading edition is not yet available in {language}.',
    fr: 'Cette édition de lecture n’est pas encore disponible en {language}.',
    de: 'Diese Leseausgabe ist noch nicht auf {language} verfügbar.',
    es: 'Esta edición de lectura todavía no está disponible en {language}.',
    pt: 'Esta edição de leitura ainda não está disponível em {language}.',
    it: 'Questa edizione di lettura non è ancora disponibile in {language}.',
    ro: 'Această ediție de lectură nu este încă disponibilă în {language}.',
    pl: 'To wydanie do czytania nie jest jeszcze dostępne po {language}.',
  };
  const languageNames = { en: 'English', fr: 'Français', de: 'Deutsch', es: 'Español', pt: 'Português', it: 'Italiano', ro: 'Română', pl: 'Polski' };
  const unavailableMessage = (language, uiLanguage = language) => unavailableLabels[locale(uiLanguage)].replace('{language}', languageNames[locale(language)]);
  const preparationLabels = { en: "In preparation", fr: "En préparation", de: "In Vorbereitung", es: "En preparación", pt: "Em preparação", it: "In preparazione", ro: "În lucru", pl: "W przygotowaniu" };
  const pdfDownloadName = (title, editionNumber) => {
    const stem = String(title || 'book').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'book';
    return `${stem}${editionNumber ? `-edition-${editionNumber}` : ''}.pdf`;
  };
  globalThis.ScriptaReading = { labels, preparationLabels, supported, locale, formatName, available, editionLanguage, localized, requestUrl, readingUrl, unavailableMessage, pdfDownloadName };
})();
