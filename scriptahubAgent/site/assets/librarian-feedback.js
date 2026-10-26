(() => {
  "use strict";

  const root = document.querySelector("[data-librarian-content]");
  if (!root) return;

  const text = {
    en: {
      kicker: "Improve recommendations", title: "Help shape the AI Librarian.", lead: "ScriptaHub offers an AI-assisted recommendation feature for readers who need something more precise than a bestseller list. Tell us what a useful librarian should understand, ask and explain before suggesting a book.",
      request: "What are you trying to read or understand?", requestHint: "A question, difficult topic, practical goal, preferred genre or unusual combination of interests…", expectations: "How should the Librarian work for you?", expectationsHint: "What should it ask, avoid, compare or explain? What would make a recommendation trustworthy and valuable?", send: "Send feedback", sideTitle: "Recommendations beyond popularity", sideBody: "The AI Librarian connects a reader’s explicit needs with niche books, manuals, tutorials and speculative work. Reader feedback will help define its questions, explanations, controls and quality criteria.",
    },
    fr: {
      kicker: "Améliorer les recommandations", title: "Aidez-nous à façonner le bibliothécaire IA.", lead: "ScriptaHub propose un système de recommandation assisté par l’IA pour les lecteurs qui ont besoin de mieux qu’une liste de best-sellers. Dites-nous ce qu’un bibliothécaire utile devrait comprendre, demander et expliquer avant de proposer un livre.",
      request: "Que cherchez-vous à lire ou à comprendre ?", requestHint: "Une question, un sujet difficile, un objectif pratique, un genre ou une combinaison inhabituelle d’intérêts…", expectations: "Comment le bibliothécaire devrait-il fonctionner pour vous ?", expectationsHint: "Que devrait-il demander, éviter, comparer ou expliquer ? Qu’est-ce qui rendrait une recommandation fiable et utile ?", send: "Envoyer le retour", sideTitle: "Des recommandations au-delà de la popularité", sideBody: "Le bibliothécaire IA relie les besoins explicites du lecteur à des livres de niche, manuels, tutoriels et œuvres spéculatives. Les retours des lecteurs aideront à définir ses questions, explications, réglages et critères de qualité.",
    },
    de: {
      kicker: "Empfehlungen verbessern", title: "Gestalten Sie den KI-Bibliothekar mit.", lead: "ScriptaHub bietet eine KI-gestützte Empfehlungsfunktion für Leser, denen eine Bestsellerliste nicht präzise genug ist. Sagen Sie uns, was ein hilfreicher Bibliothekar verstehen, fragen und erklären sollte, bevor er ein Buch empfiehlt.",
      request: "Was möchten Sie lesen oder verstehen?", requestHint: "Eine Frage, ein schwieriges Thema, ein praktisches Ziel, ein Genre oder eine ungewöhnliche Kombination von Interessen…", expectations: "Wie soll der Bibliothekar für Sie arbeiten?", expectationsHint: "Was soll er fragen, vermeiden, vergleichen oder erklären? Was macht eine Empfehlung vertrauenswürdig und wertvoll?", send: "Feedback senden", sideTitle: "Empfehlungen jenseits der Popularität", sideBody: "Der KI-Bibliothekar verbindet ausdrücklich genannte Bedürfnisse mit Nischenbüchern, Handbüchern, Tutorials und spekulativen Werken zu verbinden. Leserfeedback hilft, seine Fragen, Erklärungen, Steuerungsmöglichkeiten und Qualitätskriterien zu gestalten.",
    },
    es: {
      kicker: "Mejorar las recomendaciones", title: "Ayuda a diseñar el Bibliotecario IA.", lead: "ScriptaHub ofrece una función de recomendación asistida por IA para lectores que necesitan algo más preciso que una lista de superventas. Cuéntanos qué debería comprender, preguntar y explicar un bibliotecario útil antes de recomendar un libro.",
      request: "¿Qué quieres leer o comprender?", requestHint: "Una pregunta, un tema difícil, un objetivo práctico, un género o una combinación inusual de intereses…", expectations: "¿Cómo debería trabajar para ti el Bibliotecario?", expectationsHint: "¿Qué debería preguntar, evitar, comparar o explicar? ¿Qué haría fiable y valiosa una recomendación?", send: "Enviar comentarios", sideTitle: "Recomendaciones más allá de la popularidad", sideBody: "El Bibliotecario IA conecta las necesidades explícitas del lector con libros de nicho, manuales, tutoriales y obras especulativas. Los comentarios de los lectores ayudarán a definir sus preguntas, explicaciones, controles y criterios de calidad.",
    },
    pt: {
      kicker: "Melhorar as recomendações", title: "Ajude a criar o Bibliotecário IA.", lead: "A ScriptaHub oferece recomendações assistidas por IA para leitores que precisam de algo mais preciso do que uma lista de best-sellers. Conte-nos o que um bibliotecário útil deveria entender, perguntar e explicar antes de sugerir um livro.",
      request: "O que você quer ler ou compreender?", requestHint: "Uma pergunta, tema difícil, objetivo prático, gênero ou combinação incomum de interesses…", expectations: "Como o Bibliotecário deveria funcionar para você?", expectationsHint: "O que deveria perguntar, evitar, comparar ou explicar? O que tornaria uma recomendação confiável e valiosa?", send: "Enviar feedback", sideTitle: "Recomendações além da popularidade", sideBody: "O Bibliotecário IA liga necessidades explícitas a livros de nicho, manuais, tutoriais e obras especulativas. O feedback dos leitores ajudará a definir perguntas, explicações, controles e critérios de qualidade.",
    },
    it: {
      kicker: "Migliora i consigli", title: "Aiutaci a progettare il Bibliotecario IA.", lead: "ScriptaHub offre una funzione di raccomandazione assistita dall’IA per chi cerca qualcosa di più preciso di una classifica. Dicci che cosa dovrebbe capire, chiedere e spiegare un bibliotecario utile prima di consigliare un libro.",
      request: "Che cosa vuoi leggere o comprendere?", requestHint: "Una domanda, un tema difficile, un obiettivo pratico, un genere o una combinazione insolita di interessi…", expectations: "Come dovrebbe lavorare per te il Bibliotecario?", expectationsHint: "Che cosa dovrebbe chiedere, evitare, confrontare o spiegare? Che cosa renderebbe affidabile e prezioso un consiglio?", send: "Invia feedback", sideTitle: "Consigli oltre la popolarità", sideBody: "Il Bibliotecario IA collega i bisogni espliciti del lettore a libri di nicchia, manuali, tutorial e opere speculative. Il feedback dei lettori aiuterà a definirne domande, spiegazioni, controlli e criteri di qualità.",
    },
    ro: {
      kicker: "Îmbunătățește recomandările", title: "Ajută-ne să construim Bibliotecarul AI.", lead: "ScriptaHub oferă o funcție de recomandare asistată de AI pentru cititorii care au nevoie de ceva mai precis decât o listă de bestselleruri. Spune-ne ce ar trebui să înțeleagă, să întrebe și să explice un bibliotecar util înainte de a recomanda o carte.",
      request: "Ce încerci să citești sau să înțelegi?", requestHint: "O întrebare, un subiect dificil, un scop practic, un gen preferat sau o combinație neobișnuită de interese…", expectations: "Cum ți-ai imagina Bibliotecarul?", expectationsHint: "Ce ar trebui să întrebe, să evite, să compare sau să explice? Ce ar face recomandarea credibilă și valoroasă?", send: "Trimite feedback", sideTitle: "Recomandări dincolo de popularitate", sideBody: "Bibliotecarul AI conectează nevoile declarate ale cititorului cu cărți de nișă, manuale, tutoriale și literatură speculativă. Feedbackul cititorilor va ajuta la definirea întrebărilor, explicațiilor, controalelor și criteriilor sale de calitate.",
    },
    pl: {
      kicker: "Ulepsz rekomendacje", title: "Pomóż zaprojektować Bibliotekarza AI.", lead: "ScriptaHub oferuje rekomendacje wspierane przez AI dla czytelników, którym nie wystarcza lista bestsellerów. Powiedz nam, co użyteczny bibliotekarz powinien rozumieć, o co pytać i co wyjaśniać przed poleceniem książki.",
      request: "Co chcesz przeczytać lub zrozumieć?", requestHint: "Pytanie, trudny temat, praktyczny cel, gatunek albo nietypowe połączenie zainteresowań…", expectations: "Jak powinien działać dla Ciebie Bibliotekarz?", expectationsHint: "O co powinien pytać, czego unikać, co porównywać lub wyjaśniać? Co uczyni rekomendację wiarygodną i wartościową?", send: "Wyślij opinię", sideTitle: "Rekomendacje poza popularnością", sideBody: "Bibliotekarz AI łączy jawne potrzeby czytelnika z książkami niszowymi, podręcznikami, tutorialami i utworami spekulatywnymi. Opinie czytelników pomogą określić pytania, wyjaśnienia, kontrolę i kryteria jakości.",
    },
  };

  const escape = (value) => String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
  const currentLanguage = () => text[document.documentElement.lang] ? document.documentElement.lang : "en";

  function render(language = currentLanguage()) {
    const words = text[language];
    const initialQuery = new URLSearchParams(location.hash.slice(1)).get("request") || "";
    document.title = `${words.title} · ScriptaHub`;
    document.querySelector('meta[name="description"]')?.setAttribute("content", words.lead);
    const agreement = {en:"I accept the contribution agreement",ro:"Accept acordul de contribuție",fr:"J’accepte l’accord de contribution",de:"Ich akzeptiere die Beitragsvereinbarung",es:"Acepto el acuerdo de contribución",pt:"Aceito o acordo de contribuição",it:"Accetto l’accordo di contribuzione",pl:"Akceptuję umowę dotyczącą wkładu"};
    root.innerHTML = `<section class="workflow-hero"><div><p class="eyebrow">${escape(words.kicker)}</p><h1>${escape(words.title)}</h1></div><p class="lead">${escape(words.lead)}</p></section><section class="workflow-layout"><form class="workflow-form" data-librarian-form><div class="form-grid"><label class="form-field form-field-wide"><span>${escape(words.request)}</span><textarea name="request" required placeholder="${escape(words.requestHint)}">${escape(initialQuery)}</textarea></label><label class="form-field form-field-wide"><span>${escape(words.expectations)}</span><textarea name="expectations" required placeholder="${escape(words.expectationsHint)}"></textarea></label></div><label class="contract-accept"><input type="checkbox" name="agreement" required><span>${escape(agreement[language])} · <a href="../agreement/index.html?lang=${language}">ScriptaHub</a></span></label><button class="workflow-submit" type="submit">${escape(words.send)}</button><p class="workflow-note">${escape(ScriptaContributionBridge.note(language))}</p><p class="workflow-status" data-librarian-status aria-live="polite"></p></form><aside class="workflow-context"><p class="eyebrow">ScriptaHub</p><h2>${escape(words.sideTitle)}</h2><p>${escape(words.sideBody)}</p></aside></section>`;
    root.querySelector("form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      if (!form.reportValidity()) return;
      const data = new FormData(form);
      const values = Object.fromEntries([...data].filter(([key]) => key !== 'agreement'));
      const status = root.querySelector('[data-librarian-status]');
      try {
        form.dataset.submissionId ||= await ScriptaContributionBridge.newSubmissionId();
        const metadata = {submissionId: form.dataset.submissionId, kind:'librarian-feedback', agreementVersion:'2026-09-10', agreementAccepted:true, values, language};
        await globalThis.ScriptaContributionBridge.submitDirect(metadata, [], status, form.querySelector('button[type=submit]'));
      } catch (error) { status.textContent = error.message; }
    });
  }

  document.addEventListener("scriptahub:language", (event) => render(event.detail.language));
  render();
})();
