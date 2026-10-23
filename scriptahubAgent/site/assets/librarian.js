(() => {
  "use strict";

  const root = document.querySelector("[data-librarian-content]");
  const collection = globalThis.SCRIPTA_COLLECTION;
  if (!root || !collection) return;

  const text = {
    en: { kicker: "AI Librarian", results: (count) => `${count} ${count === 1 ? "recommendation" : "recommendations"}`, score: "match", keywords: "Matched ideas", details: "View Book", feedback: "Help improve these recommendations", feedbackNote: "Tell us what the Librarian understood well or missed." },
    fr: { kicker: "Bibliothécaire IA", results: (count) => `${count} recommandation${count > 1 ? "s" : ""}`, score: "correspondance", keywords: "Idées correspondantes", details: "Voir le livre", feedback: "Améliorer ces recommandations", feedbackNote: "Dites-nous ce que le bibliothécaire a bien compris ou oublié." },
    de: { kicker: "KI-Bibliothekar", results: (count) => `${count} Empfehlung${count === 1 ? "" : "en"}`, score: "Treffer", keywords: "Passende Ideen", details: "Buch ansehen", feedback: "Diese Empfehlungen verbessern", feedbackNote: "Sagen Sie uns, was der Bibliothekar richtig verstanden oder übersehen hat." },
    es: { kicker: "Bibliotecario IA", results: (count) => `${count} recomendación${count === 1 ? "" : "es"}`, score: "coincidencia", keywords: "Ideas relacionadas", details: "Ver libro", feedback: "Ayuda a mejorar estas recomendaciones", feedbackNote: "Cuéntanos qué entendió bien el Bibliotecario o qué pasó por alto." },
    pt: { kicker: "Bibliotecário IA", results: (count) => `${count} recomendação${count === 1 ? "" : "ões"}`, score: "correspondência", keywords: "Ideias relacionadas", details: "Ver livro", feedback: "Ajude a melhorar estas recomendações", feedbackNote: "Conte-nos o que o Bibliotecário entendeu bem ou deixou escapar." },
    it: { kicker: "Bibliotecario IA", results: (count) => `${count} raccomandazion${count === 1 ? "e" : "i"}`, score: "corrispondenza", keywords: "Idee corrispondenti", details: "Vedi il libro", feedback: "Aiuta a migliorare questi consigli", feedbackNote: "Dicci che cosa il Bibliotecario ha capito bene o non ha colto." },
    ro: { kicker: "Bibliotecarul AI", results: (count) => `${count} ${count === 1 ? "recomandare" : "recomandări"}`, score: "potrivire", keywords: "Idei potrivite", details: "Vezi cartea", feedback: "Ajută-ne să îmbunătățim recomandările", feedbackNote: "Spune-ne ce a înțeles bine Bibliotecarul și ce i-a scăpat." },
    pl: { kicker: "Bibliotekarz AI", results: (count) => `${count} rekomendacj${count === 1 ? "a" : "i"}`, score: "dopasowanie", keywords: "Pasujące idee", details: "Zobacz książkę", feedback: "Pomóż ulepszyć rekomendacje", feedbackNote: "Powiedz nam, co Bibliotekarz dobrze zrozumiał, a co pominął." },
  };
  const noMatch = {
    en: "No books match this question yet. Try another subject or browse the full library.",
    fr: "Aucun livre ne correspond encore à cette question. Essayez un autre sujet ou parcourez la bibliothèque.",
    de: "Zu dieser Frage passt noch kein Buch. Versuchen Sie ein anderes Thema oder stöbern Sie in der Bibliothek.",
    es: "Todavía no hay libros para esta pregunta. Prueba otro tema o explora la biblioteca.",
    pt: "Ainda não há livros para esta pergunta. Experimente outro tema ou explore a biblioteca.",
    it: "Non ci sono ancora libri per questa domanda. Prova un altro argomento o esplora la biblioteca.",
    ro: "Nu există încă o carte potrivită pentru această întrebare. Încearcă alt subiect sau răsfoiește biblioteca.",
    pl: "Nie ma jeszcze książek pasujących do tego pytania. Spróbuj innego tematu lub przejrzyj bibliotekę.",
  };

  const stopWords = {
    en: "a an and are as at be book books by can do for from how i in is it me my of on or read should that the this to want what which with without would you your",
    fr: "a au aux avec ce ces comment dans de des du en est et je la le les livre livres me mon ou par pour que quel quelle qui sans sur un une vous votre",
    de: "als am an auf aus bei buch bücher das der die ein eine für ich in ist kann mit ohne oder über und von was welche wie zu zum",
    es: "a al como con de del el en es esta este la las libro libros los me mi o para por que qué sin sobre un una y yo",
    pt: "a ao como com da das de do dos e em é este esta eu livro livros me meu o os ou para por que sem sobre um uma",
    it: "a al che come con da dei del della di e è gli i il in io la le libro libri mi o per quale senza su un una",
    ro: "a ai al ale ca care carte cărți ce cine cu cum de despre din este eu fără în la o pe pentru prin să sau un una vreau",
    pl: "a bez co czy dla do i jak jest książka książki mi na o od po przez się ta ten w z za ze",
  };

  const escape = (value) => String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
  const normalise = (value) => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const currentLanguage = () => text[document.documentElement.lang] ? document.documentElement.lang : "en";
  const termsFor = (value, language, removeStops = true) => {
    const terms = normalise(value).split(/\s+/).filter((term) => term.length > 1);
    if (!removeStops) return terms;
    const blocked = new Set(normalise(stopWords[language] || stopWords.en).split(" "));
    const useful = terms.filter((term) => !blocked.has(term));
    return useful;
  };
  const repeat = (items, count) => Array.from({ length: count }, () => items).flat();
  const ngrams = (items) => items.flatMap((term) => {
    const padded = `^${term}$`;
    if (padded.length <= 3) return [padded];
    return Array.from({ length: padded.length - 2 }, (_, index) => padded.slice(index, index + 3));
  });

  function documentTerms(book, language) {
    const title = termsFor(book.title?.[language] || book.title?.en, language, false);
    const alternateTitles = Object.entries(book.title || {}).filter(([code]) => code !== language)
      .flatMap(([, value]) => termsFor(value, language, false));
    const aliases = [book.sourceId, ...(book.sourceAliases || [])]
      .flatMap((value) => termsFor(value, language, false));
    const subtitle = termsFor(book.subtitle?.[language] || book.subtitle?.en, language, false);
    const description = termsFor(book.shortDescription?.[language] || book.shortDescription?.en, language, false);
    const category = termsFor(book.category, language, false);
    const keywords = (book.keywords?.[language] || book.keywords?.en || []).flatMap((keyword) => termsFor(keyword, language, false));
    return [...repeat(title, 6), ...repeat(alternateTitles, 5), ...repeat(aliases, 5), ...repeat(keywords, 4), ...repeat(subtitle, 2), ...repeat(category, 2), ...description];
  }

  function buildBm25Index(language, characterMode = false) {
    const documents = collection.books.map((book) => {
      const tokens = documentTerms(book, language);
      const terms = characterMode ? ngrams(tokens) : tokens;
      const frequencies = new Map();
      terms.forEach((term) => frequencies.set(term, (frequencies.get(term) || 0) + 1));
      return { book, frequencies, length: terms.length };
    });
    const frequencies = new Map();
    documents.forEach((document) => document.frequencies.forEach((_, term) => frequencies.set(term, (frequencies.get(term) || 0) + 1)));
    return { documents, frequencies, averageLength: documents.reduce((sum, document) => sum + document.length, 0) / Math.max(1, documents.length) };
  }

  function bm25(index, queryTerms) {
    const k1 = 1.35;
    const b = .72;
    const queryFrequency = new Map();
    queryTerms.forEach((term) => queryFrequency.set(term, (queryFrequency.get(term) || 0) + 1));
    const total = index.documents.length;
    return index.documents.map((document) => {
      let score = 0;
      queryFrequency.forEach((queryCount, term) => {
        const termFrequency = document.frequencies.get(term) || 0;
        if (!termFrequency) return;
        const documentFrequency = index.frequencies.get(term) || 0;
        const inverseFrequency = Math.log(1 + (total - documentFrequency + .5) / (documentFrequency + .5));
        const saturation = termFrequency * (k1 + 1) / (termFrequency + k1 * (1 - b + b * document.length / index.averageLength));
        score += inverseFrequency * saturation * (1 + Math.log(queryCount));
      });
      return { book: document.book, score };
    });
  }

  function matchedKeywords(book, queryTerms, language) {
    const query = new Set(queryTerms);
    return (book.keywords?.[language] || book.keywords?.en || []).map((keyword) => {
      const terms = termsFor(keyword, language, false);
      const strength = terms.reduce((score, term) => score + (query.has(term) ? 2 : queryTerms.some((queryTerm) => term.length > 3 && queryTerm.length > 3 && (term.startsWith(queryTerm) || queryTerm.startsWith(term))) ? 1 : 0), 0);
      return { keyword, strength };
    }).filter((item) => item.strength > 0).sort((left, right) => right.strength - left.strength || left.keyword.localeCompare(right.keyword)).slice(0, 6).map((item) => item.keyword);
  }

  function oneEditApart(left, right) {
    if (left.length < 5 || right.length < 5 || Math.abs(left.length - right.length) > 1 || left === right) return false;
    let a = 0, b = 0, edits = 0;
    while (a < left.length && b < right.length) {
      if (left[a] === right[b]) { a += 1; b += 1; continue; }
      if (++edits > 1) return false;
      if (left.length >= right.length) a += 1;
      if (right.length >= left.length) b += 1;
    }
    return edits + Number(a < left.length || b < right.length) <= 1;
  }

  function rankBooks(query, language) {
    const queryTerms = termsFor(query, language);
    if (!queryTerms.length) return [];
    const wordIndex = buildBm25Index(language);
    const wordScores = bm25(wordIndex, queryTerms);
    const characterScores = bm25(buildBm25Index(language, true), ngrams(queryTerms));
    return wordScores.map((result, index) => {
      const titleTerms = Object.values(result.book.title || {}).flatMap((title) => termsFor(title, language, false));
      const titleExact = queryTerms.some((term) => titleTerms.includes(term));
      const titleTypo = !titleExact && queryTerms.some((term) => titleTerms.some((candidate) => oneEditApart(term, candidate)));
      return { ...result, score: result.score + characterScores[index].score * .055 + (titleExact ? 8 : titleTypo ? 5 : 0), keywords: matchedKeywords(result.book, queryTerms, language), exactScore: result.score, terms: wordIndex.documents[index].frequencies };
    })
      .filter((result) => result.exactScore > 0 || queryTerms.some((term) => [...result.terms.keys()].some((candidate) => oneEditApart(term, candidate))))
      .sort((left, right) => right.score - left.score || String(left.book.title?.[language] || left.book.title?.en).localeCompare(String(right.book.title?.[language] || right.book.title?.en))).slice(0, 10);
  }

  function resultMarkup(result, index, maximum, language, words) {
    const book = result.book;
    const relevance = maximum > 0 ? Math.max(1, Math.round(result.score / maximum * 100)) : 0;
    const matched = result.keywords.length ? result.keywords : (book.keywords?.[language] || book.keywords?.en || []).slice(0, 3);
    return ScriptaBookView.markup(book, {variant: "librarian", language, rank: index + 1,
      relevance, scoreLabel: words.score, keywords: matched, keywordsLabel: words.keywords});
  }

  function render(language = currentLanguage()) {
    const words = text[language];
    const query = new URLSearchParams(location.hash.slice(1)).get("request")?.trim() || "";
    if (!query) {
      location.replace(`../index.html?lang=${language}#ask-librarian`);
      return;
    }
    const results = query ? rankBooks(query, language) : [];
    const maximum = results[0]?.score || 0;
    const feedbackParams = new URLSearchParams({ lang: language });
    const feedbackRequest = query ? `#${new URLSearchParams({ request: query }).toString()}` : "";
    document.title = `${words.kicker} · ScriptaHub`;
    ScriptaBookView.unmount(root);
    root.innerHTML = `<section class="librarian-results librarian-results-page" aria-live="polite"><header><div><p class="eyebrow">${escape(words.results(results.length))}</p><h1>“${escape(query)}”</h1></div></header><div class="librarian-results-list">${results.length ? results.map((result, index) => resultMarkup(result, index, maximum, language, words)).join("") : `<p>${escape(noMatch[language])} <a href="../all-books/index.html?lang=${language}">${escape(language === "ro" ? "Toate cărțile" : "All Books")}</a></p>`}</div><div class="librarian-results-help"><a class="librarian-feedback-link" href="feedback.html?${feedbackParams.toString()}${feedbackRequest}"><span>${escape(words.feedback)}</span><small>${escape(words.feedbackNote)}</small></a></div></section>`;
    ScriptaBookView.mount(root);
  }

  addEventListener("popstate", () => render());
  document.addEventListener("scriptahub:language", (event) => render(event.detail.language));
  render();
})();
