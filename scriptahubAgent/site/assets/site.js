(() => {
  "use strict";

  const collection = globalThis.SCRIPTA_COLLECTION;
  if (!collection) return;

  const discoveryTitles = { en: "Discover", fr: "Explorer", de: "Entdecken", es: "Descubre", pt: "Descubra", it: "Scopri", ro: "Descoperă", pl: "Odkrywaj" };
  const featuredBookLabels = { en: "From the shelf", fr: "Dans les rayons", de: "Aus dem Regal", es: "De la biblioteca", pt: "Da estante", it: "Dallo scaffale", ro: "Din bibliotecă", pl: "Z biblioteki" };
  const featuredNextLabels = { en: "Next Book", fr: "Livre suivant", de: "Nächstes Buch", es: "Libro siguiente", pt: "Próximo livro", it: "Libro successivo", ro: "Cartea următoare", pl: "Następna książka" };
  const librarianSectionLabels = {
    en: { kicker: "Find your next book", title: "Ask AI Librarian" },
    fr: { kicker: "Trouvez votre prochaine lecture", title: "Demandez au bibliothécaire IA" },
    de: { kicker: "Finden Sie Ihr nächstes Buch", title: "KI-Bibliothekar fragen" },
    es: { kicker: "Encuentra tu próxima lectura", title: "Pregunta al Bibliotecario IA" },
    pt: { kicker: "Encontre a sua próxima leitura", title: "Pergunte ao Bibliotecário IA" },
    it: { kicker: "Trova la tua prossima lettura", title: "Chiedi al Bibliotecario IA" },
    ro: { kicker: "Găsește următoarea carte", title: "Întreabă Bibliotecarul AI" },
    pl: { kicker: "Znajdź następną książkę", title: "Zapytaj Bibliotekarza AI" },
  };
  const homeLabels = { en: "Home", fr: "Accueil", de: "Startseite", es: "Inicio", pt: "Início", it: "Home", ro: "Acasă", pl: "Strona główna" };
  const createLabels = { en: "Create", fr: "Créer", de: "Erstellen", es: "Crear", pt: "Criar", it: "Crea", ro: "Creează", pl: "Utwórz" };
  const allBooksLabels = { en: "All Books", fr: "Tous les livres", de: "Alle Bücher", es: "Todos los libros", pt: "Todos os livros", it: "Tutti i libri", ro: "Toate cărțile", pl: "Wszystkie książki" };
  const legalFooterLabels = {
    en: { terms: "Terms", privacy: "Privacy", cookies: "Cookies & local storage", notice: "Legal notice", ai: "AI transparency" },
    fr: { terms: "Conditions", privacy: "Confidentialité", cookies: "Cookies et stockage local", notice: "Mentions légales", ai: "Transparence IA" },
    de: { terms: "Nutzungsbedingungen", privacy: "Datenschutz", cookies: "Cookies und lokale Speicherung", notice: "Impressum", ai: "KI-Transparenz" },
    es: { terms: "Condiciones", privacy: "Privacidad", cookies: "Cookies y almacenamiento local", notice: "Aviso legal", ai: "Transparencia de IA" },
    pt: { terms: "Termos", privacy: "Privacidade", cookies: "Cookies e armazenamento local", notice: "Aviso legal", ai: "Transparência da IA" },
    it: { terms: "Termini", privacy: "Privacy", cookies: "Cookie e archiviazione locale", notice: "Note legali", ai: "Trasparenza IA" },
    ro: { terms: "Termeni", privacy: "Confidențialitate", cookies: "Cookies și stocare locală", notice: "Informații legale", ai: "Transparență AI" },
    pl: { terms: "Warunki", privacy: "Prywatność", cookies: "Pliki cookie i pamięć lokalna", notice: "Informacje prawne", ai: "Przejrzystość AI" },
  };

  const librarianMissionPrompt = {
    en: "Ask in your own words and add any interests or goals that matter. The AI Librarian will recommend up to ten books chosen for you.",
    fr: "Posez votre question avec vos propres mots et ajoutez les intérêts ou objectifs qui comptent. Le Bibliothécaire IA vous recommandera jusqu’à dix livres choisis pour vous.",
    de: "Fragen Sie mit eigenen Worten und nennen Sie wichtige Interessen oder Ziele. Der KI-Bibliothekar empfiehlt Ihnen bis zu zehn passende Bücher.",
    es: "Pregunta con tus propias palabras y añade los intereses u objetivos que te importan. El Bibliotecario IA te recomendará hasta diez libros elegidos para ti.",
    pt: "Pergunte com as suas próprias palavras e acrescente os interesses ou objetivos importantes. O Bibliotecário IA recomendará até dez livros escolhidos para si.",
    it: "Fai la domanda con parole tue e aggiungi gli interessi o gli obiettivi che contano. Il Bibliotecario IA ti consiglierà fino a dieci libri scelti per te.",
    ro: "Întreabă în cuvintele tale și adaugă interesele sau obiectivele importante. Bibliotecarul AI îți va recomanda până la zece cărți alese pentru tine.",
    pl: "Zapytaj własnymi słowami i dodaj ważne zainteresowania lub cele. Bibliotekarz AI poleci Ci do dziesięciu dobranych książek.",
  };
  const copy = {
    en: {
      heroKicker: "About",
      heroTitle: "Books for the <em>long tail</em> of thought.",
      heroLead: "ScriptaHub brings together free books that are made to be read slowly, challenged, corrected and taken somewhere new. ScriptaHub combines YouTube’s breadth of discovery with the depth of text: complete books and concise summaries, with audio and video editions planned. Like a new kind of Wikipedia, readers can challenge, improve and extend every edition, while generative AI helps turn useful feedback into better versions. Contributions are judged openly by the value they add, without censorship that can feel arbitrary. Some books make little economic sense for one person to write: an advanced research question, a new idea or a difficult philosophy may have only hundreds or thousands of readers scattered worldwide, making conventional publication and distribution unrealistic. AI can make those books possible as collective works that a community clarifies, challenges and improves; one book can even answer another, with their relationship made visible. Niche thinkers and experts can leave a durable mark and contribute in ways that were previously impractical. That is AI’s value here, beyond the inevitable slop.",
      heroPoints: ["Long-form work for questions that do not fit a feed.", "Niche knowledge, research programmes and speculative worlds.", "A library that improves when readers leave useful traces."],
      missionKicker: "Why this exists", missionTitle: "A public workshop for valuable, unusual books.",
      mission: [
        "ScriptaHub is a platform for content created with generative AI through a research programme on generating intellectually valuable long-form work. It is built for the long tail: distinctive books with few readers, focused niche books, and science fiction that explores different corners of possibility.",
        "The point is to involve a community that can give feedback, propose valuable books and help improve the editions. Access will be free. Contributors whose accepted ideas materially improve a book may be credited in its copyright pages. Instead of asking every reader to pay for an expensive subscription and generate a book alone, the library aims to make niche books discoverable, quality-checked, corrected and strengthened by a community.",
        "ScriptaHub invests in neuro-symbolic technologies for writing and, especially, for checking the quality of generated books. As the collection grows, it will also develop more personal recommendation and value-estimation methods based on interaction history and what a reader explicitly says matters. Those technologies remain private and are not available on this site. You can help now with feedback and ideas for books worth making."
      ],
      discoverKicker: "Find a starting point", discoverTitle: "Discover", search: "Search by keyword", searchEmpty: "No books match that search yet.",
      libraryKicker: "Random books", libraryTitle: "A growing shelf of arguments and worlds.",
      keyword: "Keyword", booksTagged: (count) => `${count} ${count === 1 ? "book" : "books"} tagged`, read: "Read online", short: "Read in 10 min", inLanguage: (label) => `in ${label}`,
    },
    fr: {
      heroKicker: "À propos", heroTitle: "Des livres pour la <em>longue traîne</em> de la pensée.", heroLead: "ScriptaHub réunit des livres gratuits faits pour être lus lentement, discutés, corrigés et emmenés plus loin. ScriptaHub associe l’ampleur de découverte de YouTube à la profondeur du texte : des livres complets et des résumés concis, puis des éditions audio et vidéo à venir. Comme une nouvelle forme de Wikipédia, les lecteurs peuvent discuter, améliorer et prolonger chaque édition, tandis que l’IA générative transforme les retours utiles en meilleures versions. Les contributions sont évaluées ouvertement selon la valeur qu’elles apportent, sans censure pouvant sembler arbitraire. Certains livres n’ont guère de sens économique pour un auteur isolé : une question de recherche avancée, une idée nouvelle ou une philosophie complexe peut ne réunir que quelques centaines ou milliers de lecteurs dispersés dans le monde, rendant l’édition et la distribution classiques irréalistes. L’IA peut rendre ces livres possibles comme œuvres collectives que la communauté clarifie, conteste et améliore ; un livre peut même répondre à un autre, et leur relation devenir visible. Penseurs de niche et experts peuvent laisser une empreinte durable et contribuer de façons autrefois impraticables. C’est ici que réside la valeur de l’IA, au-delà de l’inévitable contenu médiocre.", heroPoints: ["Des textes longs pour les questions qui ne tiennent pas dans un fil.", "Savoirs de niche, programmes de recherche et mondes spéculatifs.", "Une bibliothèque qui s’améliore lorsque les lecteurs laissent des traces utiles."],
      missionKicker: "Pourquoi ce projet", missionTitle: "Un atelier public pour des livres singuliers et précieux.", mission: [
        "ScriptaHub est une plateforme de contenus créés avec l’IA générative dans le cadre d’un programme de recherche sur la production de textes longs à valeur intellectuelle. Elle vise la longue traîne : des livres singuliers à faible lectorat, des ouvrages de niche et de la science-fiction qui explore différentes possibilités.",
        "Le but est d’impliquer une communauté capable de donner des retours, de proposer des livres utiles et d’améliorer les éditions. L’accès sera gratuit. Les contributeurs dont les idées acceptées améliorent réellement un livre pourront être cités dans ses pages de copyright. Plutôt que de demander à chacun de payer un abonnement coûteux pour générer seul son livre, la bibliothèque rend des livres de niche découvrables, contrôlés, corrigés et renforcés par une communauté.",
        "ScriptaHub investit dans des technologies neuro-symboliques d’écriture et surtout de vérification de la qualité des livres générés. À mesure que la collection grandira, nous développerons aussi des recommandations plus personnelles et des méthodes d’estimation de valeur fondées sur l’historique d’interaction et sur ce que le lecteur déclare important. Ces technologies restent privées et ne sont pas disponibles ici. Vous pouvez déjà aider par vos retours et vos idées de livres qui méritent d’exister."
      ],
      discoverKicker: "Trouver un point de départ", discoverTitle: "Explorer", search: "Rechercher par mot-clé", searchEmpty: "Aucun livre ne correspond encore à cette recherche.", libraryKicker: "Livres au hasard", libraryTitle: "Une étagère grandissante d’arguments et de mondes.", keyword: "Mot-clé", booksTagged: (count) => `${count} livre${count > 1 ? "s" : ""} associé${count > 1 ? "s" : ""}`, read: "Lire en ligne", short: "Lire en 10 min", inLanguage: (label) => `en ${label}`,
    },
    de: {
      heroKicker: "Über ScriptaHub", heroTitle: "Bücher für den <em>Long Tail</em> des Denkens.", heroLead: "ScriptaHub versammelt kostenlose Bücher, die langsam gelesen, hinterfragt, korrigiert und weitergedacht werden sollen. ScriptaHub verbindet die Entdeckungsbreite von YouTube mit der Tiefe von Text: vollständige Bücher und prägnante Zusammenfassungen, später auch Audio- und Videoausgaben. Wie bei einer neuen Art Wikipedia können Leser jede Ausgabe hinterfragen, verbessern und erweitern, während generative KI hilfreiches Feedback in bessere Versionen überführt. Beiträge werden transparent nach ihrem Mehrwert beurteilt – ohne Zensur, die willkürlich wirken kann. Manche Bücher ergeben für einen einzelnen Autor wirtschaftlich kaum Sinn: Eine fortgeschrittene Forschungsfrage, eine neue Idee oder eine komplexe Philosophie findet vielleicht nur einige Hundert oder Tausend über die Welt verstreute Leser, sodass herkömmliche Veröffentlichung und Verbreitung unrealistisch sind. KI kann solche Bücher als kollektive Werke ermöglichen, die eine Gemeinschaft klärt, hinterfragt und verbessert; ein Buch kann sogar auf ein anderes antworten und diese Beziehung sichtbar machen. Nischendenker und Fachleute können bleibende Spuren hinterlassen und auf früher kaum mögliche Weise beitragen. Darin liegt hier der Wert der KI – jenseits des unvermeidlichen KI-Einheitsbreis.", heroPoints: ["Langform für Fragen, die nicht in einen Feed passen.", "Nischenwissen, Forschungsprogramme und spekulative Welten.", "Eine Bibliothek, die besser wird, wenn Leser hilfreiche Spuren hinterlassen."],
      missionKicker: "Warum es das gibt", missionTitle: "Eine öffentliche Werkstatt für wertvolle, ungewöhnliche Bücher.", mission: [
        "ScriptaHub ist eine Plattform für mit generativer KI geschaffene Inhalte aus einem Forschungsprogramm zu intellektuell wertvollen Langformtexten. Sie ist für den Long Tail gedacht: unverwechselbare Bücher mit wenigen Lesern, fokussierte Nischenbücher und Science-Fiction für unterschiedliche Möglichkeiten.",
        "Ziel ist eine Gemeinschaft, die Feedback geben, wertvolle Bücher vorschlagen und Ausgaben verbessern kann. Der Zugang bleibt kostenlos. Mitwirkende, deren angenommene Ideen ein Buch wesentlich verbessern, können auf seinen Copyright-Seiten genannt werden. Statt jeden Leser ein teures Abonnement zahlen und allein ein Buch erzeugen zu lassen, macht die Bibliothek Nischenbücher auffindbar, qualitätsgeprüft, korrigiert und durch eine Gemeinschaft stärker.",
        "ScriptaHub investiert in neurosymbolische Technologien für das Schreiben und vor allem für die Qualitätsprüfung generierter Bücher. Mit wachsender Sammlung werden auch persönlichere Empfehlungen und Verfahren zur Wertschätzung entstehen, basierend auf Interaktionsverlauf und ausdrücklich genannten Interessen. Diese Technologien sind privat und auf dieser Website nicht verfügbar. Feedback und Ideen für lohnende Bücher helfen schon jetzt."
      ],
      discoverKicker: "Einen Anfang finden", discoverTitle: "Entdecken", search: "Nach Schlagwort suchen", searchEmpty: "Noch kein Buch passt zu dieser Suche.", libraryKicker: "Zufällige Bücher", libraryTitle: "Ein wachsendes Regal aus Argumenten und Welten.", keyword: "Schlagwort", booksTagged: (count) => `${count} markierte${count === 1 ? "s Buch" : " Bücher"}`, read: "Online lesen", short: "In 10 Min. lesen", inLanguage: (label) => `auf ${label}`,
    },
    es: {
      heroKicker: "Acerca de", heroTitle: "Libros para la <em>larga cola</em> del pensamiento.", heroLead: "ScriptaHub reúne libros gratuitos hechos para leerse despacio, cuestionarse, corregirse y llevarse más lejos. ScriptaHub combina la amplitud de descubrimiento de YouTube con la profundidad del texto: libros completos y resúmenes concisos, y más adelante ediciones de audio y vídeo. Como una nueva clase de Wikipedia, los lectores pueden cuestionar, mejorar y ampliar cada edición, mientras la IA generativa convierte los comentarios útiles en versiones mejores. Las contribuciones se valoran abiertamente por lo que aportan, sin una censura que pueda parecer arbitraria. Algunos libros tienen poco sentido económico para una sola persona: una pregunta de investigación avanzada, una idea nueva o una filosofía compleja quizá solo reúna a cientos o miles de lectores dispersos por el mundo, por lo que publicarla y distribuirla de forma convencional resulta inviable. La IA puede hacer posibles esos libros como obras colectivas que una comunidad aclara, cuestiona y mejora; incluso un libro puede responder a otro y hacer visible su relación. Pensadores de nicho y especialistas pueden dejar una huella duradera y contribuir de maneras antes impracticables. Ahí está el valor de la IA, más allá del inevitable contenido basura.", heroPoints: ["Obras largas para preguntas que no caben en un feed.", "Conocimiento de nicho, programas de investigación y mundos especulativos.", "Una biblioteca que mejora cuando los lectores dejan señales útiles."],
      missionKicker: "Por qué existe", missionTitle: "Un taller público para libros valiosos y poco comunes.", mission: [
        "ScriptaHub es una plataforma de contenidos creados con IA generativa mediante un programa de investigación sobre trabajo intelectual valioso de formato largo. Está pensada para la larga cola: libros singulares con pocos lectores, obras de nicho y ciencia ficción que explora distintas posibilidades.",
        "El objetivo es implicar a una comunidad que pueda aportar comentarios, proponer libros valiosos y mejorar las ediciones. El acceso será gratuito. Las personas cuyas ideas aceptadas mejoren materialmente un libro podrán figurar en sus páginas de copyright. En lugar de pedir a cada lector que pague una suscripción costosa y genere un libro en solitario, la biblioteca busca hacer descubribles libros de nicho, revisados, corregidos y fortalecidos por una comunidad.",
        "ScriptaHub invierte en tecnologías neurosimbólicas para escribir y, sobre todo, verificar la calidad de los libros generados. A medida que crezca la colección, desarrollará recomendaciones más personales y métodos para estimar valor a partir del historial de interacción y de lo que cada lector declara importante. Estas tecnologías son privadas y no están disponibles en el sitio. Ya puedes ayudar con comentarios e ideas de libros que valga la pena crear."
      ],
      discoverKicker: "Encuentra un punto de partida", discoverTitle: "Descubre", search: "Buscar por palabra clave", searchEmpty: "Aún no hay libros que coincidan con esa búsqueda.", libraryKicker: "Libros al azar", libraryTitle: "Un estante creciente de argumentos y mundos.", keyword: "Palabra clave", booksTagged: (count) => `${count} libro${count !== 1 ? "s" : ""} etiquetado${count !== 1 ? "s" : ""}`, read: "Leer en línea", short: "Leer en 10 min", inLanguage: (label) => `en ${label}`,
    },
    pt: {
      heroKicker: "Sobre", heroTitle: "Livros para a <em>cauda longa</em> do pensamento.", heroLead: "ScriptaHub reúne livros gratuitos feitos para serem lidos devagar, questionados, corrigidos e levados adiante. A ScriptaHub combina a amplitude de descoberta do YouTube com a profundidade do texto: livros completos e resumos concisos, com edições em áudio e vídeo previstas para o futuro. Como uma nova forma de Wikipédia, os leitores podem questionar, melhorar e ampliar cada edição, enquanto a IA generativa transforma feedback útil em versões melhores. As contribuições são avaliadas abertamente pelo valor que acrescentam, sem censura que possa parecer arbitrária. Alguns livros fazem pouco sentido econômico para uma única pessoa escrever: uma questão avançada de pesquisa, uma ideia nova ou uma filosofia complexa talvez encontre apenas centenas ou milhares de leitores espalhados pelo mundo, tornando inviáveis a publicação e a distribuição convencionais. A IA pode tornar esses livros possíveis como obras coletivas que uma comunidade esclarece, questiona e melhora; um livro pode até responder a outro, deixando visível a relação entre eles. Pensadores de nicho e especialistas podem deixar uma marca duradoura e contribuir de formas antes impraticáveis. É aí que está o valor da IA, para além do inevitável conteúdo descartável.", heroPoints: ["Textos longos para perguntas que não cabem em um feed.", "Conhecimento de nicho, programas de pesquisa e mundos especulativos.", "Uma biblioteca que melhora quando leitores deixam rastros úteis."],
      missionKicker: "Por que isto existe", missionTitle: "Uma oficina pública para livros valiosos e incomuns.", mission: [
        "ScriptaHub é uma plataforma de conteúdo criado com IA generativa por meio de um programa de pesquisa sobre obras longas de valor intelectual. Ela é feita para a cauda longa: livros distintos com poucos leitores, obras de nicho e ficção científica que explora diferentes possibilidades.",
        "O objetivo é envolver uma comunidade que possa dar feedback, propor livros valiosos e melhorar as edições. O acesso será gratuito. Pessoas cujas ideias aceitas melhorem materialmente um livro poderão ser mencionadas em suas páginas de copyright. Em vez de pedir que cada leitor pague uma assinatura cara e gere sozinho um livro, a biblioteca torna livros de nicho descobríveis, avaliados, corrigidos e fortalecidos por uma comunidade.",
        "ScriptaHub investe em tecnologias neurossimbólicas para escrita e, principalmente, para verificar a qualidade dos livros gerados. Conforme a coleção crescer, desenvolverá recomendações mais pessoais e métodos de estimativa de valor baseados no histórico de interação e no que cada leitor declara importante. Essas tecnologias são privadas e não estão disponíveis no site. Você já pode ajudar com feedback e ideias de livros que valha a pena criar."
      ],
      discoverKicker: "Encontre um ponto de partida", discoverTitle: "Descubra", search: "Buscar por palavra-chave", searchEmpty: "Ainda não há livros para essa busca.", libraryKicker: "Livros aleatórios", libraryTitle: "Uma prateleira crescente de argumentos e mundos.", keyword: "Palavra-chave", booksTagged: (count) => `${count} livro${count !== 1 ? "s" : ""} marcado${count !== 1 ? "s" : ""}`, read: "Ler online", short: "Ler em 10 min", inLanguage: (label) => `em ${label}`,
    },
    it: {
      heroKicker: "Informazioni", heroTitle: "Libri per la <em>coda lunga</em> del pensiero.", heroLead: "ScriptaHub riunisce libri gratuiti fatti per essere letti lentamente, messi in discussione, corretti e portati oltre. ScriptaHub unisce l’ampiezza della scoperta di YouTube alla profondità del testo: libri completi e sintesi concise, con edizioni audio e video previste in futuro. Come una nuova forma di Wikipedia, i lettori possono mettere alla prova, migliorare ed estendere ogni edizione, mentre l’IA generativa trasforma i feedback utili in versioni migliori. I contributi vengono valutati apertamente per il valore che aggiungono, senza una censura che possa sembrare arbitraria. Alcuni libri hanno poco senso economico per un singolo autore: una domanda di ricerca avanzata, un’idea nuova o una filosofia complessa può interessare soltanto centinaia o migliaia di lettori sparsi nel mondo, rendendo irrealistiche pubblicazione e distribuzione tradizionali. L’IA può rendere possibili questi libri come opere collettive che una comunità chiarisce, mette alla prova e migliora; un libro può persino rispondere a un altro, rendendo visibile il loro legame. Pensatori di nicchia ed esperti possono lasciare un’impronta duratura e contribuire in modi prima impraticabili. È questo il valore dell’IA, oltre l’inevitabile contenuto scadente.", heroPoints: ["Opere lunghe per domande che non entrano in un feed.", "Conoscenza di nicchia, programmi di ricerca e mondi speculativi.", "Una biblioteca che migliora quando i lettori lasciano tracce utili."],
      missionKicker: "Perché esiste", missionTitle: "Un laboratorio pubblico per libri preziosi e insoliti.", mission: [
        "ScriptaHub è una piattaforma di contenuti creati con IA generativa attraverso un programma di ricerca sulla produzione di opere lunghe di valore intellettuale. È pensata per la coda lunga: libri distintivi con pochi lettori, testi di nicchia e fantascienza che esplora possibilità diverse.",
        "Lo scopo è coinvolgere una comunità capace di offrire feedback, proporre libri preziosi e migliorare le edizioni. L’accesso sarà gratuito. I contributori le cui idee accettate migliorano materialmente un libro potranno essere citati nelle sue pagine di copyright. Invece di chiedere a ogni lettore di pagare un costoso abbonamento e generare da solo il proprio libro, la biblioteca rende i libri di nicchia scopribili, controllati, corretti e rafforzati dalla comunità.",
        "ScriptaHub investe in tecnologie neuro-simboliche per la scrittura e soprattutto per verificare la qualità dei libri generati. Con la crescita della collezione svilupperà anche raccomandazioni più personali e metodi di stima del valore basati sulla cronologia delle interazioni e su ciò che il lettore dichiara importante. Queste tecnologie restano private e non sono disponibili sul sito. Puoi già aiutare con feedback e idee di libri che meritano di essere creati."
      ],
      discoverKicker: "Trova un punto di partenza", discoverTitle: "Scopri", search: "Cerca per parola chiave", searchEmpty: "Non ci sono ancora libri per questa ricerca.", libraryKicker: "Libri casuali", libraryTitle: "Uno scaffale crescente di argomenti e mondi.", keyword: "Parola chiave", booksTagged: (count) => `${count} libr${count === 1 ? "o" : "i"} associat${count === 1 ? "o" : "i"}`, read: "Leggi online", short: "Leggi in 10 min", inLanguage: (label) => `in ${label}`,
    },
    ro: {
      heroKicker: "Despre", heroTitle: "Cărți pentru <em>coada lungă</em> a gândirii.", heroLead: "ScriptaHub reunește cărți gratuite făcute pentru a fi citite lent, puse sub semnul întrebării, corectate și duse mai departe. ScriptaHub combină varietatea și ușurința descoperirii de pe YouTube cu profunzimea textului: cărți complete și rezumate concise, iar în viitor ediții audio și video. Ca un nou tip de Wikipedia, cititorii pot pune sub semnul întrebării, îmbunătăți și extinde fiecare ediție, iar IA generativă transformă feedbackul valoros în versiuni mai bune. Contribuțiile sunt evaluate deschis după valoarea adăugată, fără o cenzură ce poate părea arbitrară. Unele cărți nu au sens economic pentru un singur autor: o temă avansată de cercetare, o idee nouă sau o filosofie complexă poate avea doar sute ori mii de cititori răspândiți în întreaga lume, ceea ce face nerealiste publicarea și distribuția convenționale. AI-ul poate face posibile aceste cărți ca opere colective pe care comunitatea le clarifică, le pune la încercare și le îmbunătățește; o carte poate chiar răspunde alteia, iar legătura dintre ele poate deveni vizibilă. Gânditorii de nișă și experții își pot lăsa amprenta și pot contribui în moduri care înainte nu erau practice. Aici se află valoarea AI-ului, dincolo de inevitabilul conținut superficial.", heroPoints: ["Conținut lung pentru întrebări care nu încap într-un feed.", "Cunoaștere de nișă, programe de cercetare și lumi speculative.", "O bibliotecă ce devine mai bună când cititorii lasă urme utile."],
      missionKicker: "De ce există", missionTitle: "Un atelier public pentru cărți valoroase și neobișnuite.", mission: [
        "ScriptaHub este o platformă de conținut creat cu IA generativă printr-un program de cercetare privind generarea de conținut lung valoros intelectual. Este construită pentru coada lungă: cărți distincte cu puțini cititori, cărți de nișă și science-fiction care explorează colțuri diferite ale posibilului.",
        "Scopul este implicarea unei comunități care poate oferi feedback, propune cărți valoroase și îmbunătăți edițiile. Accesul va fi gratuit. Contribuitorii ale căror idei acceptate îmbunătățesc substanțial o carte pot fi menționați în paginile ei de copyright. În loc ca fiecare cititor să plătească un abonament scump și să își genereze singur o carte, biblioteca face cărțile de nișă ușor de găsit, verificate calitativ, corectate și întărite de comunitate.",
        "ScriptaHub investește în tehnologii neuro-simbolice pentru scriere și mai ales pentru verificarea calității cărților generate. Pe măsură ce colecția crește, va dezvolta recomandări mai personalizate și metode de estimare a valorii bazate pe istoricul interacțiunilor și pe ceea ce cititorul declară explicit că este important. Aceste tehnologii sunt private și nu sunt disponibile pe site. Ne poți ajuta deja prin feedback și idei de cărți care merită create."
      ],
      discoverKicker: "Găsește un punct de plecare", discoverTitle: "Descoperă", search: "Caută după cuvânt-cheie", searchEmpty: "Încă nu există cărți potrivite pentru această căutare.", libraryKicker: "Cărți aleatorii", libraryTitle: "Un raft în creștere de argumente și lumi.", keyword: "Cuvânt-cheie", booksTagged: (count) => `${count} ${count === 1 ? "carte etichetată" : "cărți etichetate"}`, read: "Citește online", short: "Citește în 10 min", inLanguage: (label) => `în ${label}`,
    },
    pl: {
      heroKicker: "O projekcie", heroTitle: "Książki dla <em>długiego ogona</em> myśli.", heroLead: "ScriptaHub łączy bezpłatne książki stworzone po to, by czytać je powoli, podważać, poprawiać i rozwijać dalej. ScriptaHub łączy zasięg odkrywania znany z YouTube z głębią tekstu: pełne książki i zwięzłe podsumowania, a w przyszłości także wydania audio i wideo. Jak nowy rodzaj Wikipedii, pozwala czytelnikom kwestionować, ulepszać i rozwijać każde wydanie, a generatywna AI przekształca wartościowe opinie w lepsze wersje. Wkład jest oceniany otwarcie według wartości, którą wnosi, bez cenzury mogącej sprawiać wrażenie arbitralnej. Pisanie niektórych książek przez jedną osobę nie ma ekonomicznego sensu: zaawansowane pytanie badawcze, nowa idea lub złożona filozofia może znaleźć zaledwie setki albo tysiące czytelników rozsianych po świecie, przez co tradycyjne wydanie i dystrybucja są nierealne. AI może umożliwić powstawanie takich książek jako dzieł zbiorowych, które społeczność objaśnia, podważa i ulepsza; jedna książka może nawet odpowiadać drugiej, a ich związek staje się widoczny. Niszowi myśliciele i eksperci mogą pozostawić trwały ślad i wnosić wkład w sposób wcześniej niepraktyczny. Na tym polega wartość AI — poza nieuniknioną zalewą miałkich treści.", heroPoints: ["Długa forma dla pytań, które nie mieszczą się w feedzie.", "Wiedza niszowa, programy badawcze i spekulatywne światy.", "Biblioteka, która staje się lepsza, gdy czytelnicy zostawiają użyteczne ślady."],
      missionKicker: "Dlaczego istnieje", missionTitle: "Publiczna pracownia dla wartościowych i niezwykłych książek.", mission: [
        "ScriptaHub to platforma treści tworzonych z generatywną AI w ramach programu badawczego nad wartościową intelektualnie długą formą. Jest przeznaczona dla długiego ogona: wyróżniających się książek z niewielką liczbą czytelników, książek niszowych i science fiction badającego różne możliwości.",
        "Celem jest zaangażowanie społeczności, która może dawać opinie, proponować wartościowe książki i ulepszać wydania. Dostęp będzie bezpłatny. Współtwórcy, których przyjęte pomysły istotnie poprawią książkę, mogą zostać wymienieni na jej stronach copyright. Zamiast wymagać od każdego czytelnika drogiej subskrypcji i samodzielnego generowania książki, biblioteka czyni niszowe książki odkrywalnymi, sprawdzonymi jakościowo, poprawionymi i wzmocnionymi przez społeczność.",
        "ScriptaHub inwestuje w neurosymboliczne technologie pisania, a przede wszystkim w weryfikację jakości generowanych książek. Wraz ze wzrostem kolekcji będą powstawać bardziej osobiste rekomendacje i metody szacowania wartości na podstawie historii interakcji oraz tego, co czytelnik wyraźnie deklaruje jako ważne. Technologie te pozostają prywatne i nie są dostępne na stronie. Już teraz możesz pomóc opiniami i pomysłami na książki warte stworzenia."
      ],
      discoverKicker: "Znajdź punkt wyjścia", discoverTitle: "Odkrywaj", search: "Szukaj po słowie kluczowym", searchEmpty: "Nie ma jeszcze książek pasujących do tego wyszukiwania.", libraryKicker: "Losowe książki", libraryTitle: "Rosnąca półka argumentów i światów.", keyword: "Słowo kluczowe", booksTagged: (count) => `${count} oznaczon${count === 1 ? "a książka" : "ych książek"}`, read: "Czytaj online", short: "Czytaj w 10 min", inLanguage: (label) => `po ${label}`,
    },
  };

  const supported = collection.supportedLanguages.map((item) => item.code);
  const scriptUrl = document.currentScript?.src;
  const siteRootUrl = scriptUrl ? new URL("../", scriptUrl) : new URL("./", location.href);
  const siteScaleKey = "scripta-site-scale-v2";
  const siteThemeKey = "scripta-site-theme";
  const cloudInstruction = {
    en: "drag to rotate · Ctrl-drag to move · scroll to zoom", fr: "glisser pour tourner · Ctrl-glisser pour déplacer · défiler pour zoomer",
    de: "ziehen zum Drehen · Strg-Ziehen zum Verschieben · scrollen zum Zoomen", es: "arrastra para girar · Ctrl-arrastrar para mover · desplázate para ampliar",
    pt: "arraste para girar · Ctrl-arraste para mover · role para ampliar", it: "trascina per ruotare · Ctrl-trascina per spostare · scorri per ingrandire",
    ro: "trage pentru rotire · Ctrl-trage pentru deplasare · derulează pentru zoom", pl: "przeciągnij, aby obrócić · Ctrl-przeciągnij, aby przesunąć · przewiń, aby przybliżyć",
  };
  const cloudPreviewInstruction = {
    en: "click to enlarge", fr: "cliquez pour agrandir", de: "zum Vergrößern klicken", es: "haz clic para ampliar",
    pt: "clique para ampliar", it: "clicca per ingrandire", ro: "apasă pentru mărire", pl: "kliknij, aby powiększyć",
  };
  const cloudCloseLabel = {
    en: "Close keyword cloud", fr: "Fermer le nuage de mots-clés", de: "Schlagwortwolke schließen", es: "Cerrar nube de palabras clave",
    pt: "Fechar nuvem de palavras-chave", it: "Chiudi nuvola di parole chiave", ro: "Închide norul de cuvinte-cheie", pl: "Zamknij chmurę słów kluczowych",
  };
  const homeLoadingLabels = {
    en: "Loading the library…", fr: "Chargement de la bibliothèque…", de: "Bibliothek wird geladen…", es: "Cargando la biblioteca…",
    pt: "A carregar a biblioteca…", it: "Caricamento della biblioteca…", ro: "Se încarcă biblioteca…", pl: "Ładowanie biblioteki…",
  };
  const emptyShelfLabels = {
    en: "The library is loading. Books will appear here when the catalogue is ready.",
    fr: "La bibliothèque se charge. Les livres apparaîtront ici lorsque le catalogue sera prêt.",
    de: "Die Bibliothek wird geladen. Bücher erscheinen hier, sobald der Katalog bereit ist.",
    es: "La biblioteca se está cargando. Los libros aparecerán aquí cuando el catálogo esté listo.",
    pt: "A biblioteca está a carregar. Os livros aparecerão aqui quando o catálogo estiver pronto.",
    it: "La biblioteca si sta caricando. I libri appariranno qui quando il catalogo sarà pronto.",
    ro: "Biblioteca se încarcă. Cărțile vor apărea aici când catalogul este gata.",
    pl: "Biblioteka się ładuje. Książki pojawią się tutaj, gdy katalog będzie gotowy.",
  };
  const featuredBooks = (() => {
    const pool = [...collection.books];
    for (let index = pool.length - 1; index > 0; index -= 1) {
      const swap = Math.floor(Math.random() * (index + 1));
      [pool[index], pool[swap]] = [pool[swap], pool[index]];
    }
    return pool;
  })();
  const missionStripBooks = featuredBooks.filter((book) => Object.values(book.thumbnailUrl || {}).some(Boolean));
  let catalogueRefreshTimer;
  function watchCatalogueChanges() {
    if (catalogueRefreshTimer) return;
    const initialCatalogue = JSON.stringify(collection);
    catalogueRefreshTimer = setInterval(async () => {
      try {
        const response = await fetch(new URL("collection.json", siteRootUrl), { cache: "no-store" });
        if (!response.ok) return;
        const current = await response.json();
        if (Array.isArray(current.books) && JSON.stringify(current) !== initialCatalogue) {
          clearInterval(catalogueRefreshTimer);
          catalogueRefreshTimer = null;
          location.reload();
        }
      } catch { /* Retry on the next check. */ }
    }, collection.books.length ? 60000 : 5000);
  }
  const queryLanguage = () => new URLSearchParams(location.search).get("lang")?.toLowerCase().split("-")[0];
  const browserLanguage = () => (navigator.languages || [navigator.language || "en"])
    .map((item) => String(item).toLowerCase().split("-")[0]).find((item) => supported.includes(item));
  const selectedLanguage = () => {
    const requested = queryLanguage();
    const pageLanguage = document.body.dataset.bookLanguage;
    const stored = localStorage.getItem("scripta-language");
    return [requested, pageLanguage, stored, browserLanguage(), "en"].find((item) => supported.includes(item));
  };
  const headerIcon = name => {
    const shapes = {
      home: '<path d="m3 10 9-7 9 7M5 9v12h5v-7h4v7h5V9"/>',
      books: '<path d="M3 4h4v16H3zM9 4h4v16H9zM15 5l4-1 4 15-4 1z"/>',
      plus: '<path d="M12 5v14M5 12h14"/>',
      account: '<circle cx="12" cy="8" r="3.5"/><path d="M5 21v-2a7 7 0 0 1 14 0v2"/>',
      sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.4 1.4m11.2 11.2L19 19M5 19l1.4-1.4M17.6 6.4 19 5"/>',
      moon: '<path d="M20.5 13a8.5 8.5 0 0 1-9.5-9.5A8.5 8.5 0 1 0 20.5 13Z"/>',
    };
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${shapes[name]}</svg>`;
  };
  function arrangeHeader(tools, language) {
    const header = tools.closest('.site-header');
    header.classList.add('header-unified');
    let navigation = tools.querySelector('.header-navigation');
    if (!navigation) { navigation = document.createElement('nav'); navigation.className = 'header-navigation'; tools.prepend(navigation); }
    navigation.setAttribute('aria-label', homeLabels[language]);
    for (const [selector, icon, label] of [
      ['[data-home-link]', 'home', homeLabels[language]],
      ['[data-all-books-link]', 'books', allBooksLabels[language]],
    ]) {
      const link = tools.querySelector(selector);
      link.innerHTML = headerIcon(icon) + `<span class="sr-only">${label}</span>`;
      link.title = label;
      link.setAttribute('aria-label', label);
      navigation.append(link);
    }
    tools.querySelector('[data-header-librarian]')?.remove();
    let preferences = tools.querySelector('.header-preferences');
    if (!preferences) { preferences = document.createElement('div'); preferences.className = 'header-preferences'; tools.append(preferences); }
    let textSize = preferences.querySelector('.header-text-size');
    if (!textSize) {
      textSize = document.createElement('div'); textSize.className = 'header-text-size';
      const toggle = document.createElement('button'); toggle.type = 'button'; toggle.className = 'header-text-toggle';
      toggle.textContent = 'Aa'; toggle.setAttribute('aria-label', 'Text size'); toggle.title = 'Text size';
      toggle.setAttribute('aria-expanded', 'false');
      const panel = tools.querySelector('.site-scale');
      panel.id ||= `header-text-size-${document.querySelectorAll('.header-text-size').length}`;
      toggle.setAttribute('aria-controls', panel.id);
      toggle.onclick = () => { const open = toggle.getAttribute('aria-expanded') !== 'true'; toggle.setAttribute('aria-expanded', String(open)); textSize.classList.toggle('is-open', open); };
      const close = () => { toggle.setAttribute('aria-expanded', 'false'); textSize.classList.remove('is-open'); };
      document.addEventListener('click', event => { if (!textSize.contains(event.target)) close(); });
      textSize.addEventListener('keydown', event => { if (event.key === 'Escape') { close(); toggle.focus(); } });
      textSize.append(toggle, tools.querySelector('.site-scale')); preferences.append(textSize);
    }
    preferences.append(tools.querySelector('.theme-switcher'), tools.querySelector('.language-picker'));
    let actions = tools.querySelector('.header-actions');
    if (!actions) { actions = document.createElement('div'); actions.className = 'header-actions'; tools.append(actions); }
    const create = tools.querySelector('[data-create-link]');
    create.innerHTML = headerIcon('plus') + `<span>${createLabels[language]}</span>`;
    const account = tools.querySelector('[data-account-link]');
    account.innerHTML = headerIcon('account');
    actions.append(create, account);
    tools.append(navigation, preferences, actions);
  }
  const boundedSiteScale = value => Number.isFinite(Number(value)) ? Math.max(.8, Math.min(1.5, Number(value))) : 1;
  const savedSiteScale = () => {
    try { return boundedSiteScale(localStorage.getItem(siteScaleKey) ?? 1); } catch { return 1; }
  };
  const applySiteScale = (value, persist = false) => {
    const scale = boundedSiteScale(value);
    document.documentElement.style.setProperty("--site-scale", scale.toFixed(2));
    document.documentElement.dataset.largeText = String(scale >= 1.25);
    document.querySelectorAll("[data-site-size]").forEach((node) => { node.textContent = `${Math.round(scale * 100)}%`; });
    document.querySelectorAll("[data-site-smaller]").forEach(node => { node.disabled = scale <= .8; });
    document.querySelectorAll("[data-site-larger]").forEach(node => { node.disabled = scale >= 1.5; });
    if (persist) try { localStorage.setItem(siteScaleKey, scale.toFixed(2)); } catch { /* Storage is optional. */ }
    requestAnimationFrame(() => document.dispatchEvent(new CustomEvent("scriptahub:scalechange", { detail: { scale } })));
  };
  const setupSiteScale = () => {
    applySiteScale(savedSiteScale());
    document.querySelectorAll("[data-site-smaller]").forEach((button) => { button.onclick = () => applySiteScale(savedSiteScale() - .05, true); });
    document.querySelectorAll("[data-site-larger]").forEach((button) => { button.onclick = () => applySiteScale(savedSiteScale() + .05, true); });
    document.querySelectorAll("[data-site-size]").forEach((button) => { button.onclick = () => applySiteScale(1, true); });
  };
  const storedTheme = () => {
    try { const theme=localStorage.getItem(siteThemeKey); return ["light","orange","nord","dark","dark-orange"].includes(theme)?theme:"light"; } catch { return "light"; }
  };
  const ensureThemeToggle = () => {
    document.querySelectorAll(".theme-switcher").forEach((control) => {
      control.removeAttribute("role");
      control.removeAttribute("aria-label");
      if (control.querySelector("[data-theme-toggle]")) return;
      control.innerHTML = '<button type="button" data-theme-toggle></button>';
    });
  };
  const applyTheme = (theme, persist = false) => {
    const selected = ["light","orange","nord","dark","dark-orange"].includes(theme) ? theme : "light";
    document.documentElement.dataset.theme = selected;
    document.querySelectorAll("[data-theme-toggle]").forEach((button) => {
      button.innerHTML = headerIcon(selected.startsWith("dark") ? "moon" : "sun");
      const next={light:"Light Orange",orange:"Light Linen",nord:"Dark Green",dark:"Dark Orange","dark-orange":"Light Green"}[selected];
      button.title = `${{light:"Light Green",orange:"Light Orange",nord:"Light Linen",dark:"Dark Green","dark-orange":"Dark Orange"}[selected]} · Switch to ${next}`;
      button.setAttribute("aria-label", button.title);
      button.removeAttribute("aria-pressed");
      button.dataset.themeCurrent = selected;
    });
    document.querySelectorAll('.brand-icon,link[rel="icon"][type="image/svg+xml"]').forEach(node=>{
      const key=node.tagName==='IMG'?'src':'href';
      if(!node.dataset.baseIcon)node.dataset.baseIcon=node[key];
      node[key]=['orange','nord','dark-orange'].includes(selected)?new URL(`assets/librarian-icon-${selected==='dark-orange'?'orange':selected}.svg`,siteRootUrl).href:node.dataset.baseIcon;
    });
    if (persist) {
      try { localStorage.setItem(siteThemeKey, selected); if(!selected.startsWith("dark"))localStorage.setItem("scripta-site-light-theme",selected);else localStorage.setItem("scripta-site-dark-theme",selected); } catch { /* Storage may be unavailable. */ }
    }
  };
  // Generated headers already carry these elements; runtime-created shells use the same navigation.
  const ensureHeaderBranding = () => {
    for(const header of document.querySelectorAll('.site-header')){
      const wordmark=header.querySelector('.wordmark');
      if(wordmark&&!wordmark.querySelector('.brand-icon')){
        const icon=document.createElement('img');icon.className='brand-icon';icon.alt='';
        icon.src=new URL('assets/librarian-icon.svg',siteRootUrl).href;wordmark.prepend(icon);
      }
      const tools = header.querySelector('.header-tools');
      if (tools && !tools.querySelector('.site-scale')) tools.insertAdjacentHTML('beforeend', '<div class="site-scale" aria-label="Site text size"><button type="button" data-site-smaller aria-label="Decrease site size">A−</button><button type="button" data-site-size aria-label="Reset site size">100%</button><button type="button" data-site-larger aria-label="Increase site size">A+</button></div>');
      if (tools && !tools.querySelector('.theme-switcher')) tools.insertAdjacentHTML('beforeend', '<div class="theme-switcher"><button type="button" data-theme-toggle></button></div>');
      if (tools && !tools.querySelector('.language-picker')) tools.insertAdjacentHTML('beforeend', '<label class="language-picker"><span class="sr-only">Language</span><select data-language-select aria-label="Language"></select></label>');
      const create=header.querySelector('[data-create-link]');
      if(create&&!header.querySelector('[data-home-link]')){
        const home=document.createElement('a');home.className='header-home';home.dataset.homeLink='';
        home.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 10.5 12 3l9 7.5M5.5 9v11h5v-6h3v6h5V9"/></svg><span>Home</span>';
        create.before(home);
      }
    }
  };
  const setupTheme = () => {
    ensureThemeToggle();
    applyTheme(storedTheme());
    document.querySelectorAll("[data-theme-toggle]").forEach((button) => {
      button.addEventListener("click", () => applyTheme({light:"orange",orange:"nord",nord:"dark",dark:"dark-orange","dark-orange":"light"}[document.documentElement.dataset.theme]||"light", true));
    });
  };
  const normalise = (value) => String(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const displayKeyword = (value) => String(value).split(" ").map((word) => word ? word[0].toLocaleUpperCase() + word.slice(1) : word).join(" ");
  const escape = (value) => String(value).replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
  const isBookPage = () => document.body.dataset.bookPage === "true";
  const isAppPage = () => document.body.dataset.appPage === "true";
  const assetPath = (path) => path;
  const keywordSearchHref = (keyword, language) => {
    const params = new URLSearchParams({ lang: language, keyword: keyword.id });
    return `index.html?${params.toString()}`;
  };
  const languageName = (language) => collection.supportedLanguages.find((item) => item.code === language)?.name || language;

  function replaceText(selector, value, htmlValue = false) {
    const node = document.querySelector(selector);
    if (!node) return;
    if (htmlValue) node.innerHTML = value;
    else node.textContent = value;
  }

  function localizeGlobalHeader(language) {
    const accountLabels = { en: 'My account', ro: 'Contul meu', fr: 'Mon compte', de: 'Mein Konto', es: 'Mi cuenta', pt: 'A minha conta', it: 'Il mio account', pl: 'Moje konto' };
    document.querySelectorAll('.site-header .header-tools').forEach(tools => {
      let link = tools.querySelector('[data-account-link]');
      if (!link) {
        link = document.createElement('a');
        link.dataset.accountLink = '';
        link.className = 'header-home header-account';
        link.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="4"></circle><path d="M4 21v-2a8 8 0 0 1 16 0v2"></path></svg>'; 
        tools.append(link);
      }
      const accountLabel = accountLabels[language] || accountLabels.en;
      link.setAttribute('aria-label', accountLabel);
      link.title = accountLabel;
      link.href = new URL(`account/index.html?lang=${language}`, siteRootUrl).href;
    });
    document.querySelectorAll("[data-home-link], .site-header .wordmark").forEach((link) => {
      link.href = new URL(`index.html?lang=${language}`, siteRootUrl).href;
      if (link.hasAttribute("data-home-link")) {
        const label = homeLabels[language] || homeLabels.en;
        link.querySelector("span").textContent = label;
        link.setAttribute("aria-label", label);
        link.title = label;
        if (document.body.dataset.homePage === "true") link.setAttribute("aria-current", "page");
      }
    });
    document.querySelectorAll("[data-create-link]").forEach((link) => {
      link.textContent = createLabels[language];
      link.setAttribute("aria-label", createLabels[language]);
      link.title = createLabels[language];
      const url = new URL(link.getAttribute("href"), location.href);
      url.searchParams.set("lang", language);
      link.href = url.href;
    });
    document.querySelectorAll(".site-header .header-tools").forEach((tools) => {
      let link = tools.querySelector("[data-all-books-link]");
      if (!link) {
        link = document.createElement("a");
        link.className = "header-all-books";
        link.dataset.allBooksLink = "";
        tools.querySelector("[data-create-link]")?.insertAdjacentElement("afterend", link);
      }
      link.textContent = allBooksLabels[language];
      link.href = new URL(`all-books/index.html?lang=${language}`, siteRootUrl).href;
      if (document.body.dataset.allBooksPage === "true") link.setAttribute("aria-current", "page");
    });
    document.querySelectorAll('.site-header .header-tools').forEach(tools => arrangeHeader(tools, language));
    const footerWords = legalFooterLabels[language];
    Object.entries(footerWords).forEach(([key, label]) => {
      document.querySelectorAll(`[data-footer-${key}]`).forEach((link) => { link.textContent = label; });
    });
    document.querySelectorAll("[data-legal-link]").forEach((link) => {
      const url = new URL(link.getAttribute("href"), location.href);
      url.searchParams.set("lang", language);
      link.href = url.href;
    });
  }

  function setupMissionBookTooltips(container) {
    let tooltip = document.querySelector("[data-mission-book-tooltip]");
    if (!tooltip) {
      tooltip = document.createElement("div");
      tooltip.className = "mission-book-tooltip";
      tooltip.dataset.missionBookTooltip = "";
      tooltip.setAttribute("role", "dialog");
      tooltip.hidden = true;
      tooltip.innerHTML = '<strong data-tooltip-title></strong><p data-tooltip-description data-text-show></p><a data-tooltip-link></a>';
      document.body.append(tooltip);
    }
    tooltip.hidden = true;
    if (container.dataset.tooltipBound) return;
    container.dataset.tooltipBound = "true";

    let activeIcon = null;
    let hideTimer = 0;
    const cancelHide = () => {
      if (!hideTimer) return;
      clearTimeout(hideTimer);
      hideTimer = 0;
    };
    const hide = () => {
      cancelHide();
      activeIcon?.classList.remove("has-open-tooltip");
      activeIcon = null;
      tooltip.hidden = true;
      ScriptaBookView.unmount(tooltip);
    };
    const scheduleHide = () => {
      cancelHide();
      hideTimer = setTimeout(hide, 180);
    };
    const place = (icon) => {
      if (tooltip.hidden || !icon?.isConnected) return;
      const padding = 12;
      const gap = 11;
      const anchor = icon.getBoundingClientRect();
      const bounds = tooltip.getBoundingClientRect();
      let left = anchor.left + anchor.width / 2 - bounds.width / 2;
      let top = anchor.top - bounds.height - gap;
      if (top < padding) top = anchor.bottom + gap;
      tooltip.style.left = `${Math.max(padding, Math.min(left, window.innerWidth - bounds.width - padding))}px`;
      tooltip.style.top = `${Math.max(padding, Math.min(top, window.innerHeight - bounds.height - padding))}px`;
    };
    const show = (icon) => {
      if (!icon || !container.contains(icon)) return;
      cancelHide();
      activeIcon?.classList.remove("has-open-tooltip");
      activeIcon = icon;
      activeIcon.classList.add("has-open-tooltip");
      ScriptaBookView.unmount(tooltip);
      tooltip.querySelector("[data-tooltip-title]").textContent = icon.dataset.bookTitle;
      tooltip.querySelector("[data-tooltip-description]").textContent = icon.dataset.bookDescription;
      const link = tooltip.querySelector("[data-tooltip-link]");
      link.textContent = icon.dataset.bookAction;
      link.href = icon.href;
      tooltip.setAttribute("aria-label", icon.dataset.bookTitle);
      tooltip.hidden = false;
      ScriptaBookView.mount(tooltip);
      place(icon);
    };
    container.addEventListener("pointerover", (event) => {
      const icon = event.target.closest("[data-mission-book]");
      if (!icon || icon === activeIcon) return;
      show(icon);
    });
    container.addEventListener("pointerout", (event) => {
      if (!activeIcon || activeIcon.contains(event.relatedTarget) || tooltip.contains(event.relatedTarget)) return;
      scheduleHide();
    });
    container.addEventListener("focusin", (event) => show(event.target.closest("[data-mission-book]")));
    container.addEventListener("focusout", (event) => {
      if (activeIcon?.contains(event.relatedTarget) || tooltip.contains(event.relatedTarget)) return;
      scheduleHide();
    });
    tooltip.addEventListener("pointerenter", cancelHide);
    tooltip.addEventListener("pointerleave", scheduleHide);
    tooltip.addEventListener("focusin", cancelHide);
    tooltip.addEventListener("focusout", (event) => { if (!tooltip.contains(event.relatedTarget)) scheduleHide(); });
    window.addEventListener("blur", hide);
    window.addEventListener("scroll", hide, { passive: true });
    window.addEventListener("resize", () => place(activeIcon), { passive: true });
    document.addEventListener("keydown", (event) => { if (event.key === "Escape") hide(); });
  }

  function missionBookIconMarkup(book, language, index) {
    const data = ScriptaBookView.model(book, language);
    if (!data.thumbnail) return "";
    return `<a class="mission-book-icon" href="${escape(data.href)}" aria-label="${escape(`${data.details}: ${data.title}`)}" data-mission-book data-book-id="${escape(data.id)}" data-book-title="${escape(data.title)}" data-book-description="${escape(data.description)}" data-book-action="${escape(data.details)}" style="--book-tilt:${((index % 7) - 3) * .42}deg"><img src="${escape(data.thumbnail)}" alt="" loading="lazy" decoding="async"></a>`;
  }

  function setupMissionBookStrip(container, language, details) {
    container._disposeMissionStrip?.();
    const pool = [...missionStripBooks];
    if (!pool.length) {
      container._disposeMissionStrip = null;
      container.hidden = true;
      const strip = container.closest(".home-feature-strip");
      strip?.classList.add("is-empty");
      strip?.querySelector("[data-featured-card-link]")?.remove();
      strip?.querySelector("[data-featured-next]")?.remove();
      if (details) details.innerHTML = `<p>${escape(emptyShelfLabels[language])}</p>`;
      return;
    }
    container.hidden = false;
    container.closest(".home-feature-strip")?.classList.remove("is-empty");
    const pending = new Set();
    let poolIndex = 0;
    let slotCount = 0;
    let replacementSlot = 0;
    let visibleBooks = [];
    let disposed = false;
    let featuredShow = null;

    const renderDetails = (book) => {
      if (!details) return;
      [featuredShow] = ScriptaBookView.render(details, book, { variant: "featured", language, kicker: featuredBookLabels[language] });
      const strip = details.closest(".home-feature-strip");
      if (strip) {
        let link = strip.querySelector("[data-featured-card-link]");
        if (!link) {
          link = document.createElement("a");
          link.dataset.featuredCardLink = "";
          link.className = "featured-card-link";
          // Existing title and View Book links provide keyboard navigation.
          link.tabIndex = -1;
          link.setAttribute("aria-hidden", "true");
          strip.append(link);
        }
        link.href = ScriptaBookView.model(book, language).href;
        let next = strip.querySelector("[data-featured-next]");
        if (!next) {
          next = document.createElement("button");
          next.type = "button";
          next.dataset.featuredNext = "";
          next.className = "featured-carousel-next";
          next.innerHTML = '<span aria-hidden="true">›</span>';
          next.addEventListener("click", event => {
            event.preventDefault();
            event.stopPropagation();
            const icon = container.querySelector("[data-mission-book]");
            if (icon && !icon.classList.contains("is-leaving")) replaceIcon(icon);
          });
          strip.append(next);
        }
        next.setAttribute("aria-label", featuredNextLabels[language]);
        next.title = featuredNextLabels[language];
      }
    };

    const syncFeaturedCardHeight = () => {
      if (!details) return;
      ScriptaBookView.alignCover(container, details.parentElement);
    };

    const nextBook = (excluded = new Set()) => {
      for (let attempt = 0; attempt < pool.length; attempt += 1) {
        const book = pool[poolIndex % pool.length];
        poolIndex += 1;
        if (!excluded.has(book.id)) return book;
      }
      return pool[poolIndex++ % pool.length];
    };
    const renderSlots = () => {
      const availableWidth = Math.max(220, container.clientWidth);
      const featuredCover = container.classList.contains("mission-featured-cover");
      const stacked = globalThis.matchMedia?.("(max-width: 860px)").matches;
      const cloud = document.querySelector("[data-keyword-cloud]");
      const missionCopy = document.querySelector("[data-mission-copy]");
      const availableHeight = !stacked && cloud && missionCopy
        ? cloud.getBoundingClientRect().bottom - missionCopy.getBoundingClientRect().bottom - 8
        : 100;
      // Let the covers consume the real vertical room left by the copy. This
      // is especially important at smaller site scales: fewer, legible books
      // are preferable to many tiny icons above a large empty area.
      const coverHeight = featuredCover ? availableWidth * 1.5 : Math.max(96, Math.min(190, availableHeight - 8));
      const coverWidth = coverHeight * 2 / 3;
      container.style.setProperty("--mission-book-height", `${coverHeight.toFixed(1)}px`);
      container.style.setProperty("--mission-book-width", `${coverWidth.toFixed(1)}px`);
      container.style.setProperty("--mission-strip-height", `${(coverHeight + 8).toFixed(1)}px`);
      const desiredCount = featuredCover ? 1 : Math.max(3, Math.floor((availableWidth - 24 + 9) / (coverWidth + 9)));
      if (desiredCount === slotCount && container.firstElementChild) {
        syncFeaturedCardHeight();
        return;
      }
      slotCount = desiredCount;
      document.querySelector("[data-mission-book-tooltip]")?.setAttribute("hidden", "");
      visibleBooks = visibleBooks.slice(0, slotCount);
      const excluded = new Set(visibleBooks.map((book) => book.id));
      while (visibleBooks.length < slotCount) {
        const book = nextBook(excluded);
        visibleBooks.push(book);
        excluded.add(book.id);
      }
      container.innerHTML = `<div class="mission-book-set">${visibleBooks.map((book, index) => missionBookIconMarkup(book, language, index)).join("")}</div>`;
      if (details && visibleBooks[0]) renderDetails(visibleBooks[0]);
      syncFeaturedCardHeight();
    };
    const replaceIcon = (icon) => {
      const slotIndex = [...container.querySelectorAll("[data-mission-book]")].indexOf(icon);
      const visibleIds = new Set([...container.querySelectorAll("[data-book-id]")].map((item) => item.dataset.bookId));
      const replacement = nextBook(visibleIds);
      icon.classList.add("is-leaving");
      details?.classList.add("is-card-leaving");
      const swapTimer = setTimeout(() => {
        pending.delete(swapTimer);
        if (disposed || !icon.isConnected) return;
        const replacementMarkup = document.createElement("template");
        replacementMarkup.innerHTML = missionBookIconMarkup(replacement, language, Math.floor(Math.random() * 7));
        const fresh = replacementMarkup.content.firstElementChild;
        icon.dataset.bookId = fresh.dataset.bookId;
        icon.dataset.bookTitle = fresh.dataset.bookTitle;
        icon.dataset.bookDescription = fresh.dataset.bookDescription;
        icon.dataset.bookAction = fresh.dataset.bookAction;
        icon.href = fresh.href;
        icon.setAttribute("aria-label", fresh.getAttribute("aria-label"));
        icon.style.cssText = fresh.style.cssText;
        icon.querySelector("img").src = fresh.querySelector("img").src;
        icon.classList.remove("is-leaving");
        icon.classList.add("is-entering");
        visibleBooks[slotIndex] = replacement;
        if (details?.isConnected) {
          renderDetails(replacement);
          details.classList.remove("is-card-leaving");
          details.classList.add("is-card-entering");
          const cardTimer = setTimeout(() => {
            pending.delete(cardTimer);
            details.classList.remove("is-card-entering");
          }, 480);
          pending.add(cardTimer);
        }
        const arriveTimer = setTimeout(() => {
          pending.delete(arriveTimer);
          icon.classList.remove("is-entering");
        }, 420);
        pending.add(arriveTimer);
      }, 220);
      pending.add(swapTimer);
    };
    const replaceNext = () => {
      if (disposed || document.hidden || (details && (!featuredShow?.completed || !featuredShow.visible || (details.closest(".home-feature-strip") || details).matches(":hover, :focus-within")))) return;
      const icons = [...container.querySelectorAll("[data-mission-book]")];
      for (let attempt = 0; attempt < icons.length; attempt += 1) {
        const icon = icons[replacementSlot % icons.length];
        replacementSlot = (replacementSlot + 1) % icons.length;
        if (icon.matches(":hover, :focus-within") || icon.classList.contains("has-open-tooltip") || icon.classList.contains("is-leaving")) continue;
        replaceIcon(icon);
        return;
      }
    };

    renderSlots();
    const observer = globalThis.ResizeObserver ? new ResizeObserver(renderSlots) : null;
    observer?.observe(container);
    const missionLayout = container.closest(".discovery-mission");
    if (missionLayout) observer?.observe(missionLayout);
    if (details) observer?.observe(details);
    document.addEventListener("scriptahub:scalechange", renderSlots);
    const interval = setInterval(replaceNext, details ? 250 : 6200);
    container._disposeMissionStrip = () => {
      disposed = true;
      if (details) ScriptaBookView.unmount(details);
      clearInterval(interval);
      pending.forEach(clearTimeout);
      observer?.disconnect();
      document.removeEventListener("scriptahub:scalechange", renderSlots);
    };
    setupMissionBookTooltips(container);
  }

  function setLanguagePicker(language) {
    for (const select of document.querySelectorAll("[data-language-select]")) {
      select.innerHTML = collection.supportedLanguages.map(({ code, name }) => `<option value="${code}"${code === language ? " selected" : ""}>${escape(name)}</option>`).join("");
      select.onchange = () => setLanguage(select.value);
    }
  }

  function setLanguage(language) {
    localStorage.setItem("scripta-language", language);
    const url = new URL(location.href);
    url.searchParams.set("lang", language);
    history.replaceState({}, "", url);
    if (isAppPage()) {
      document.documentElement.lang = language;
      localizeGlobalHeader(language);
      setLanguagePicker(language);
      setupSearch(language);
      document.dispatchEvent(new CustomEvent("scriptahub:language", { detail: { language } }));
      return;
    }
    renderHome(language);
  }

  function bookCard(book, language) {
    return ScriptaBookView.markup(book, { language });
  }

  function renderKeywordSelection(keywordId, language, { updateHistory = false, scroll = false } = {}) {
    const browser = document.querySelector("[data-keyword-browser]");
    if (!browser) return;
    const keyword = keywordId ? collection.keywords[language].find((item) => item.id === keywordId) : null;
    const words = copy[language];
    const results = browser.querySelector("[data-keyword-results]");
    const clear = browser.querySelector("[data-keyword-clear]");

    if (globalThis.textShow) ScriptaBookView.unmount(results);
    if (!keyword) {
      browser.hidden = true;
      results.innerHTML = "";
      document.title = `ScriptaHub · ${words.libraryTitle}`;
      return;
    }

    const matches = collection.books.filter((book) => book.keywordIds.includes(keyword.id));
    const heading = displayKeyword(keyword.label);
    replaceText("[data-keyword-kicker]", words.keyword);
    replaceText("[data-keyword-title]", heading);
    replaceText("[data-keyword-count]", words.booksTagged(matches.length));
    clear.textContent = keywordResultLabels[language].clear;
    results.innerHTML = matches.map((book) => bookCard(book, language)).join("");
    browser.hidden = false;
    ScriptaBookView.mount(results);
    document.title = `${heading} · ScriptaHub`;

    clear.onclick = () => {
      const url = new URL(location.href);
      url.searchParams.delete("keyword");
      history.pushState({}, "", url);
      renderKeywordSelection(null, language);
    };
    if (updateHistory) {
      const url = new URL(location.href);
      url.searchParams.set("lang", language);
      url.searchParams.set("keyword", keyword.id);
      url.searchParams.delete("q");
      history.pushState({}, "", url);
    }
    if (scroll) requestAnimationFrame(() => requestAnimationFrame(() => browser.scrollIntoView({ behavior: "smooth", block: "start" })));
  }

  function setupCardNavigation() {
    if (document.documentElement.dataset.cardNavigationBound) return;
    document.documentElement.dataset.cardNavigationBound = "true";
    document.addEventListener("click", (event) => {
      const animation = event.target.closest("a[data-animation-link]");
      if (animation && event.isTrusted && !event.defaultPrevented && event.button === 0 &&
          !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey &&
          !animation.hasAttribute("download") && (!animation.target || animation.target === "_self") &&
          document.visibilityState === "visible") {
        const destination = new URL(animation.href);
        const film = collection.books.find(book => book.animation &&
          new URL(book.animation.page, siteRootUrl).pathname === destination.pathname);
        if (film && destination.origin === location.origin) {
          try {
            const token = crypto.randomUUID();
            destination.hash = "";
            sessionStorage.setItem("scriptahub:animation-start", JSON.stringify({
              token, href: destination.href, createdAt: Date.now()
            }));
            destination.hash = "start=" + token;
            event.preventDefault();
            location.assign(destination.href);
          } catch { /* Storage restrictions retain ordinary navigation and Play. */ }
          return;
        }
      }
      const card = event.target.closest(".book-card[data-book-url]");
      if (!card || event.defaultPrevented || event.target.closest("a, button, input, select, textarea, label")) return;
      location.assign(card.dataset.bookUrl);
    });
    document.addEventListener("keydown", (event) => {
      if ((event.key !== "Enter" && event.key !== " ") || !event.target.matches(".book-card[data-book-url]")) return;
      event.preventDefault();
      location.assign(event.target.dataset.bookUrl);
    });
  }

  function setupBookHeroAlignment() {
    const hero = document.querySelector(".book-hero");
    const cover = hero?.querySelector(".cover-link");
    const details = hero?.querySelector(".book-details");
    if (!hero || !cover || !details) return;
    const sync = () => ScriptaBookView.alignCover(cover, hero);
    const observer = globalThis.ResizeObserver ? new ResizeObserver(sync) : null;
    observer?.observe(cover);
    window.addEventListener("resize", sync, { passive: true });
    document.addEventListener("scriptahub:scalechange", sync);
    sync();
  }

  function setupCoverPreview(language) {
    const trigger = document.querySelector("[data-cover-preview]");
    if (!trigger) return;
    const dialog = document.createElement("dialog");
    dialog.className = "cover-preview";
    dialog.setAttribute("aria-label", trigger.getAttribute("aria-label"));
    const close = document.createElement("button");
    close.type = "button";
    close.className = "cover-preview-close";
    close.setAttribute("aria-label", cloudCloseLabel[language]);
    close.textContent = "×";
    const artwork = trigger.querySelector("img").cloneNode();
    dialog.append(close, artwork);
    document.body.append(dialog);
    trigger.setAttribute("aria-haspopup", "dialog");
    trigger.addEventListener("click", () => {
      dialog.showModal();
      document.body.classList.add("cover-preview-open");
      close.focus();
    });
    close.addEventListener("click", () => dialog.close());
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) dialog.close();
    });
    dialog.addEventListener("close", () => {
      document.body.classList.remove("cover-preview-open");
      trigger.focus({ preventScroll: true });
    });
  }

  function renderCloud(language) {
    const cloud = document.querySelector("[data-keyword-cloud]");
    if (!cloud) return;
    if (!collection.books.length) { cloud.hidden = true; return; }
    cloud.hidden = false;
    // The landing-page cloud intentionally uses the exact interactive component
    // embedded in every book page.  Keep this small fallback below only for a
    // locally opened page where the component script failed to load.
    const sharedCloud = globalThis.ScriptaKeywordCloud;
    if (sharedCloud?.mount) {
      const visibleTerms = Math.min(320, collection.keywords[language].length);
      const words = collection.keywords[language].slice(0, visibleTerms).map((keyword) => ({
        ...keyword,
        href: keywordSearchHref(keyword, language),
      }));
      sharedCloud.mount(cloud, words, {
        ariaLabel: copy[language].discoverTitle,
        instruction: cloudPreviewInstruction[language],
        modalInstruction: cloudInstruction[language],
        closeLabel: cloudCloseLabel[language],
        showInstruction: false,
        onSelect: (keyword) => renderKeywordSelection(keyword.id, language, { updateHistory: true, scroll: true }),
      });
      return;
    }
    if (cloud._dispose) cloud._dispose();
    const visibleTerms = Math.min(320, collection.keywords[language].length);
    const words = collection.keywords[language].slice(0, visibleTerms).map((keyword) => ({ ...keyword, label: displayKeyword(keyword.label), href: keywordSearchHref(keyword, language) }));
    const maximum = Math.max(...words.map((item) => item.count));
    const priorInstruction = cloud.nextElementSibling;
    if (priorInstruction?.classList.contains("cloud-instruction")) priorInstruction.remove();
    cloud.innerHTML = `<canvas tabindex="0" aria-label="${escape(copy[language].discoverTitle)}"></canvas><nav class="sr-only">${words.map((keyword) => `<a href="${escape(keyword.href)}">${escape(keyword.label)}</a>`).join("")}</nav>`;
    const canvas = cloud.querySelector("canvas");
    const context = canvas.getContext("2d");
    const random = (index, salt) => {
      const value = Math.sin((index + 1) * 127.1 + salt * 311.7) * 43758.5453123;
      return value - Math.floor(value);
    };
    const nodes = words.map((keyword, index) => {
      return { keyword, x: random(index, 1) * 2 - 1, y: random(index, 2) * 2 - 1, z: random(index, 3) * 2 - 1 };
    });
    let rotationX = -.18;
    let rotationY = .45;
    let velocityX = 0;
    let velocityY = .0022;
    let zoom = 1;
    let active = false;
    let dragDistance = 0;
    let lastX = 0;
    let lastY = 0;
    let hits = [];
    let frame = 0;

    const resize = () => {
      const bounds = canvas.getBoundingClientRect();
      const density = Math.min(globalThis.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.round(bounds.width * density));
      canvas.height = Math.max(1, Math.round(bounds.height * density));
      context.setTransform(density, 0, 0, density, 0, 0);
    };
    const rotate = (node) => {
      const cosY = Math.cos(rotationY), sinY = Math.sin(rotationY);
      const cosX = Math.cos(rotationX), sinX = Math.sin(rotationX);
      const x = node.x * cosY - node.z * sinY;
      const z = node.x * sinY + node.z * cosY;
      return { x, y: node.y * cosX - z * sinX, z: node.y * sinX + z * cosX };
    };
    const draw = () => {
      const bounds = canvas.getBoundingClientRect();
      const spreadX = bounds.width * .47 * zoom;
      const spreadY = bounds.height * .43 * zoom;
      const centreX = bounds.width / 2;
      const centreY = bounds.height / 2;
      context.clearRect(0, 0, bounds.width, bounds.height);
      context.save();
      context.translate(centreX, centreY);
      const projected = nodes.map((node) => ({ ...node, point: rotate(node) })).sort((left, right) => left.point.z - right.point.z);
      hits = [];
      projected.forEach((node) => {
        const depth = .44 + (node.point.z + 1) * .34;
        const x = node.point.x * spreadX;
        const y = node.point.y * spreadY;
        const importance = .75 + (node.keyword.count / maximum) * 1.55;
        const size = (8.2 + importance * 3.4) * depth;
        const hue = 128 + Math.round((node.point.z + 1) * 36) + (node.keyword.count % 4) * 13;
        context.globalAlpha = .31 + depth * .67;
        context.font = `${Math.round(size)}px Inter, ui-sans-serif, system-ui, sans-serif`;
        context.textAlign = "center";
        context.textBaseline = "middle";
        context.fillStyle = `hsl(${hue} 76% ${58 + depth * 21}%)`;
        context.shadowColor = `hsla(${hue} 90% 64% / .66)`;
        context.shadowBlur = 11 * depth;
        context.fillText(node.keyword.label, x, y);
        const measured = context.measureText(node.keyword.label).width;
        hits.push({ x: centreX + x, y: centreY + y, width: measured, height: size * 1.38, keyword: node.keyword, depth });
      });
      context.restore();
    };
    const animate = () => {
      if (!active) {
        rotationX += velocityX;
        rotationY += velocityY;
        velocityX *= .94;
        velocityY = Math.abs(velocityY) < .0022 ? .0022 : velocityY * .94;
      }
      draw();
      frame = requestAnimationFrame(animate);
    };
    const pointerPosition = (event) => ({ x: event.clientX, y: event.clientY });
    canvas.addEventListener("pointerdown", (event) => {
      active = true; dragDistance = 0;
      ({ x: lastX, y: lastY } = pointerPosition(event));
      canvas.setPointerCapture(event.pointerId);
    });
    canvas.addEventListener("pointermove", (event) => {
      if (!active) return;
      const point = pointerPosition(event);
      const dx = point.x - lastX, dy = point.y - lastY;
      dragDistance += Math.abs(dx) + Math.abs(dy);
      rotationY += dx * .008; rotationX += dy * .008;
      velocityY = dx * .0012; velocityX = dy * .0012;
      lastX = point.x; lastY = point.y;
    });
    const release = (event) => {
      active = false;
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    };
    canvas.addEventListener("pointerup", release);
    canvas.addEventListener("pointercancel", release);
    canvas.addEventListener("click", (event) => {
      if (dragDistance > 8) return;
      const bounds = canvas.getBoundingClientRect();
      const x = event.clientX - bounds.left, y = event.clientY - bounds.top;
      const hit = hits.filter((item) => Math.abs(x - item.x) <= item.width / 2 && Math.abs(y - item.y) <= item.height / 2).sort((a, b) => b.depth - a.depth)[0];
      if (hit) renderKeywordSelection(hit.keyword.id, language, { updateHistory: true, scroll: true });
    });
    canvas.addEventListener("wheel", (event) => {
      event.preventDefault();
      zoom = Math.max(.7, Math.min(1.55, zoom - Math.sign(event.deltaY) * .08));
    }, { passive: false });
    canvas.addEventListener("keydown", (event) => {
      if (event.key === "ArrowLeft") rotationY -= .14;
      else if (event.key === "ArrowRight") rotationY += .14;
      else if (event.key === "ArrowUp") rotationX -= .14;
      else if (event.key === "ArrowDown") rotationX += .14;
      else if (event.key === "+" || event.key === "=") zoom = Math.min(1.55, zoom + .08);
      else if (event.key === "-") zoom = Math.max(.7, zoom - .08);
      else return;
      event.preventDefault();
    });
    const observer = new ResizeObserver(resize);
    observer.observe(cloud);
    resize(); animate();
    cloud._dispose = () => { cancelAnimationFrame(frame); observer.disconnect(); };
  }

  function searchBooks(query, language) {
    const searchable = (value) => normalise(value || "").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
    const needle = searchable(query);
    if (!needle) return [];
    return collection.books.filter((book) => [...Object.values(book.title), book.sourceId, ...(book.sourceAliases || []), book.subtitle[language], book.shortDescription[language], ...book.keywords[language]].some((value) => searchable(value).includes(needle)));
  }

  function setupSearch(language) {
    const input = document.querySelector("[data-book-search]");
    const suggestions = document.querySelector("[data-search-suggestions]");
    const grid = document.querySelector("[data-book-grid]");
    const results = document.querySelector("[data-search-results]");
    if (!input || !suggestions) return;
    const root = input.dataset.searchRoot ? `${input.dataset.searchRoot.replace(/\/?$/, "/")}` : "";
    const initialQuery = new URL(location.href).searchParams.get("q") || "";
    input.placeholder = copy[language].search;
    const showResults = () => {
      if (!grid || !results) return;
      const matches = searchBooks(input.value, language);
      const active = Boolean(input.value.trim());
      grid.hidden = active;
      globalThis.ScriptaBookView?.unmount(results);
      results.innerHTML = active ? (matches.length ? `<div class="book-grid">${matches.map((book) => bookCard(book, language)).join("")}</div>` : `<p class="search-empty">${escape(copy[language].searchEmpty)}</p>`) : "";
      globalThis.ScriptaBookView?.mount(results);
    };
    const showSuggestions = () => {
      const needle = normalise(input.value.trim());
      if (!needle) { suggestions.innerHTML = ""; suggestions.dataset.open = "false"; return; }
      const words = collection.keywords[language].filter((item) => normalise(item.label).includes(needle)).slice(0, 8);
      suggestions.innerHTML = words.map((item) => `<li><button type="button" data-keyword-id="${escape(item.id)}">${escape(item.label)} <small>(${item.count})</small></button></li>`).join("");
      suggestions.dataset.open = words.length ? "true" : "false";
      suggestions.querySelectorAll("button").forEach((button) => button.addEventListener("click", () => {
        const keyword = collection.keywords[language].find((item) => item.id === button.dataset.keywordId);
        if (!keyword) return;
        if (document.querySelector("[data-keyword-browser]")) renderKeywordSelection(keyword.id, language, { updateHistory: true, scroll: true });
        else location.href = `${root}${keywordSearchHref(keyword, language)}`;
      }));
    };
    const goToSearch = () => {
      const query = input.value.trim();
      if (!query) return;
      const words = [...suggestions.querySelectorAll("button")];
      if (words.length) {
        words[0].click();
        return;
      }
      const params = new URLSearchParams({ lang: language, q: query });
      location.href = `${root}index.html?${params.toString()}`;
    };
    input.oninput = () => { showSuggestions(); showResults(); };
    input.onfocus = () => { if (input.value.trim()) showSuggestions(); };
    input.onkeydown = (event) => {
      if (event.key === "Escape") suggestions.dataset.open = "false";
      if (event.key === "Enter") { event.preventDefault(); goToSearch(); }
    };
    input.onsearch = () => { showSuggestions(); showResults(); };
    if (initialQuery && !input.value) {
      input.value = initialQuery;
      showSuggestions(); showResults();
    }
    if (!input.dataset.searchBound) {
      input.dataset.searchBound = "true";
      document.addEventListener("click", (event) => { if (!event.target.closest(".search-wrap")) suggestions.dataset.open = "false"; });
    }
  }

  function revealHomeWhenReady() {
    const loader = document.querySelector("[data-home-loading]");
    if (!loader || loader.dataset.revealStarted) return;
    loader.dataset.revealStarted = "true";
    const floor = loader.closest(".home-feature-strip");
    const waitForImage = (image) => {
      if (image.complete) return typeof image.decode === "function" ? image.decode().catch(() => {}) : Promise.resolve();
      return new Promise((resolve) => {
        image.addEventListener("load", resolve, { once: true });
        image.addEventListener("error", resolve, { once: true });
      });
    };
    const assets = [...floor.querySelectorAll("img")].map(waitForImage);
    if (document.fonts?.ready) assets.push(document.fonts.ready.catch(() => {}));
    if (document.readyState !== "complete") assets.push(new Promise((resolve) => addEventListener("load", resolve, { once: true })));
    const minimumDisplay = new Promise((resolve) => setTimeout(resolve, 450));
    Promise.all([Promise.allSettled(assets), minimumDisplay])
      .then(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
      .then(() => {
        floor.setAttribute("aria-busy", "false");
        ScriptaBookView.mount(floor);
        loader.classList.add("is-complete");
        setTimeout(() => loader.remove(), 420);
      });
  }

  function renderHome(language) {
    const words = copy[language];
    document.documentElement.lang = language;
    localizeGlobalHeader(language);
    replaceText("[data-home-loading-text]", homeLoadingLabels[language]);
    document.title = `ScriptaHub · ${words.libraryTitle}`;
    replaceText("[data-hero-kicker]", words.heroKicker);
    replaceText("[data-hero-title]", words.heroTitle, true);
    globalThis.ScriptaHomeLibrarian?.localize(language);
    renderCloud(language);
    const missionBooks = document.querySelector("[data-mission-books]");
    const featuredBook = document.querySelector("[data-featured-book]");
    if (missionBooks) setupMissionBookStrip(missionBooks, language, featuredBook);
    watchCatalogueChanges();
    replaceText("[data-discover-kicker]", words.discoverKicker); replaceText("[data-discover-title]", discoveryTitles[language]); replaceText("[data-search-label]", words.search);
    replaceText("[data-library-kicker]", librarianSectionLabels[language].kicker); replaceText("[data-library-title]", librarianSectionLabels[language].title);
    replaceText("[data-library-lead]", librarianMissionPrompt[language]);
    setLanguagePicker(language); setupSearch(language);
    renderKeywordSelection(new URL(location.href).searchParams.get("keyword"), language, { scroll: Boolean(new URL(location.href).searchParams.get("keyword")) });
    revealHomeWhenReady();
  }

  function setupBookReading(language) {
    const book = collection.books.find((item) => item.id === document.body.dataset.bookId);
    const reading = globalThis.ScriptaReading;
    if (!book || !reading) return;
    for (const link of document.querySelectorAll("[data-reading-format]")) {
      const url = reading.readingUrl(book, language, link.dataset.readingFormat, language, siteRootUrl);
      if (url) link.href = url.href;
      else { link.removeAttribute("href"); link.setAttribute("aria-disabled", "true"); }
      link.textContent = link.dataset.readingLabel;
    }
    const pdf = document.querySelector("[data-download-pdf]");
    const pdfPath = book.editions[reading.editionLanguage(book, language, "pdf")]?.pdf;
    if (pdf && pdfPath) pdf.href = new URL(pdfPath, siteRootUrl).href;
  }

  const language = selectedLanguage();
  ensureHeaderBranding();
  setupTheme();
  setupSiteScale();
  setupCardNavigation();
  if (isBookPage()) { ScriptaBookView.page(collection.books.find(book => book.id === document.body.dataset.bookId), language); localizeGlobalHeader(language); setupSearch(language); setupBookHeroAlignment(); setupBookReading(language); setupCoverPreview(language); }
  else if (isAppPage()) { document.documentElement.lang = language; localizeGlobalHeader(language); setLanguagePicker(language); setupSearch(language); if (document.querySelector("[data-all-books]")) watchCatalogueChanges(); }
  else renderHome(language);
  if (!isBookPage() && !isAppPage()) addEventListener("popstate", () => renderKeywordSelection(new URL(location.href).searchParams.get("keyword"), selectedLanguage()));
})();
