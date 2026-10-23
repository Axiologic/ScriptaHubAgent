(() => {
  "use strict";
  const host = document.querySelector("[data-all-books]");
  const collection = globalThis.SCRIPTA_COLLECTION;
  if (!host || !collection) return;

  const shelves = [
    ["ai-technology", "AI and technology", "AI și tehnologie"],
    ["science-learning", "Science and learning", "Știință și învățare"],
    ["philosophy", "Philosophy and meaning", "Filosofie și sens"],
    ["society", "Society and culture", "Societate și cultură"],
    ["politics", "Politics and institutions", "Politică și instituții"],
    ["history", "History and biography", "Istorie și biografii"],
    ["economy", "Economy and work", "Economie și muncă"],
    ["classics", "Literary classics", "Clasici literari"],
    ["literary-guides", "Books about books", "Cărți despre cărți"],
    ["science-fiction", "Science fiction", "Science-fiction"],
    ["literary-fiction", "Fiction, fantasy and horror", "Ficțiune, fantasy și horror"],
  ];
  const shelfTranslations = {
    fr: ["IA et technologie", "Sciences et apprentissage", "Philosophie et sens", "Société et culture", "Politique et institutions", "Histoire et biographies", "Économie et travail", "Classiques littéraires", "Livres sur les livres", "Science-fiction", "Fiction, fantastique et horreur"],
    de: ["KI und Technologie", "Wissenschaft und Lernen", "Philosophie und Sinn", "Gesellschaft und Kultur", "Politik und Institutionen", "Geschichte und Biografien", "Wirtschaft und Arbeit", "Literarische Klassiker", "Bücher über Bücher", "Science-Fiction", "Fiktion, Fantasy und Horror"],
    es: ["IA y tecnología", "Ciencia y aprendizaje", "Filosofía y sentido", "Sociedad y cultura", "Política e instituciones", "Historia y biografías", "Economía y trabajo", "Clásicos literarios", "Libros sobre libros", "Ciencia ficción", "Ficción, fantasía y terror"],
    pt: ["IA e tecnologia", "Ciência e aprendizagem", "Filosofia e sentido", "Sociedade e cultura", "Política e instituições", "História e biografias", "Economia e trabalho", "Clássicos literários", "Livros sobre livros", "Ficção científica", "Ficção, fantasia e terror"],
    it: ["IA e tecnologia", "Scienza e apprendimento", "Filosofia e significato", "Società e cultura", "Politica e istituzioni", "Storia e biografie", "Economia e lavoro", "Classici letterari", "Libri sui libri", "Fantascienza", "Narrativa, fantasy e horror"],
    pl: ["AI i technologia", "Nauka i edukacja", "Filozofia i znaczenie", "Społeczeństwo i kultura", "Polityka i instytucje", "Historia i biografie", "Gospodarka i praca", "Klasyka literatury", "Książki o książkach", "Fantastyka naukowa", "Proza, fantasy i horror"],
  };
  const ui = {
    en: ["All Books", "Browse the complete library by subject. Every book appears in one shelf; use search to find a title or idea across all shelves.", "Search books, subjects or ideas", "books across", "shelves", "No books match your search.", "Categories"],
    fr: ["Tous les livres", "Parcourez toute la bibliothèque par sujet. Chaque livre figure dans un rayon ; cherchez un titre ou une idée dans tous les rayons.", "Rechercher un livre, un sujet ou une idée", "livres dans", "rayons", "Aucun livre ne correspond à cette recherche.", "Catégories"],
    de: ["Alle Bücher", "Entdecken Sie die gesamte Bibliothek nach Themen. Jedes Buch steht in einem Regal; die Suche erfasst alle Regale.", "Bücher, Themen oder Ideen suchen", "Bücher in", "Regalen", "Keine Bücher gefunden.", "Kategorien"],
    es: ["Todos los libros", "Explora toda la biblioteca por temas. Cada libro aparece en una sección; la búsqueda abarca todas.", "Buscar libros, temas o ideas", "libros en", "secciones", "No hay libros que coincidan.", "Categorías"],
    pt: ["Todos os livros", "Explore toda a biblioteca por assunto. Cada livro aparece numa secção; a pesquisa abrange todas.", "Pesquisar livros, temas ou ideias", "livros em", "secções", "Nenhum livro corresponde à pesquisa.", "Categorias"],
    it: ["Tutti i libri", "Esplora tutta la biblioteca per argomento. Ogni libro compare in una sezione; la ricerca le comprende tutte.", "Cerca libri, argomenti o idee", "libri in", "sezioni", "Nessun libro corrisponde alla ricerca.", "Categorie"],
    ro: ["Toate cărțile", "Răsfoiește întreaga bibliotecă pe teme. Fiecare carte are un raft; căutarea acoperă toate rafturile.", "Caută cărți, subiecte sau idei", "cărți în", "rafturi", "Nicio carte nu corespunde căutării.", "Categorii"],
    pl: ["Wszystkie książki", "Przeglądaj całą bibliotekę według tematów. Każda książka należy do jednej kategorii; wyszukiwarka obejmuje wszystkie.", "Szukaj książek, tematów lub pomysłów", "książek w", "kategoriach", "Brak pasujących książek.", "Kategorie"],
  };
  const escape = value => String(value ?? "").replace(/[&<>"']/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));
  const normalise = value => String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase();
  const local = (value, language) => value?.[language] || value?.en || "";
  const label = (shelf, language) => shelfTranslations[language]?.[shelves.indexOf(shelf)] || (language === "ro" ? shelf[2] : shelf[1]);

  // Use the book's authored category and group first; titles only resolve broad subgenres.
  function shelfFor(book) {
    const title = normalise(book.title?.en);
    const category = normalise(book.category);
    const group = book.group;
    if (group === "fiction") {
      if (/quick guide to notorious conspiracy theories/.test(title)) return "society";
      if (/alice|catcher in the rye|moby dick or the whale$|^oliver twist$|^peter pan$|^pride and prejudice$|robinson crusoe|white fang|wuthering heights|yellow wallpaper|call of the wild|enchanted april|ferdinand count fathom|the lost world$/.test(title)) return "classics";
      if (/oriven and origaya|science and wisdom of limits|warhammer 40,000|asimov.s foundation|cyberpunk 2077|three.body problem|^sg 1 universe$|^star trek universe$|^star wars universe$|^the expanse universe/.test(title)) return "science-fiction";
      if (/guide|explor|navigat|unveil|revealing|discovering|journey.*(hobbit|gatsby|alchemist)|hidden|wisdom of|impact on|take on|unbound|world of|universe|vision of|mysteries of|dilemma|freedom: jane|chaos$|glimpse into|george orwell.s 1984|grimms fairy tales|shadows and lights.*two cities|metamorphoses of don quixote|price of freedom in les miserables|unlocking markus/.test(title)) return "literary-guides";
      if (/science fiction|human & philosophical sf|political & social sf/.test(category) || /star trek|star wars|warhammer|foundation|three.body|expanse|cyberpunk|altered carbon|matrix|sg 1|robots|galactic|mars|solips|substrate|omnis|oriven|dystopia/.test(title)) return "science-fiction";
      return "literary-fiction";
    }
    if (/einstein|newton|darwin|tesla|edison|leonardo|steve jobs|elon musk|frederick douglass|holocaust|ancient civilisations|ancient civilizations|war and peace/.test(title)) return "history";
    if (/100 dangerous questions|anti-idiocracy|beauty: the anatomy|ecology of predation|enthusiasm: the missing energy|^memes for 2030$|history and future of social technologies|the necessary mask/.test(title)) return "society";
    if (/exploring formal logic/.test(title)) return "science-learning";
    if (/^revocable nobility$/.test(title)) return "politics";
    if (/the animal that prays|the messiah factory|the ultimate sense of life/.test(title)) return "philosophy";
    if (/the book sends no notifications|^one more try$|^eden before mars$|^eden was a jungle$|^is there light at the end of the tunnel|the voluptuous apocalypse/.test(title)) return "society";
    if (category === "ai systems & infrastructure") return "ai-technology";
    if (group === "philosophy") return "philosophy";
    if (/technology|artificial intelligence/.test(category) && group !== "business") return "ai-technology";
    if (category === "economics" || group === "business") return "economy";
    if (group === "technology") return "ai-technology";
    if (group === "science" || /science|research|education/.test(category)) return "science-learning";
    if (/capitalism|market|money|finance|bank|bitcoin|currency|scarcity|salary|servitude|economic|business|entrepreneur/.test(title)) return "economy";
    if (/government|institution|power|rule|control|contract|strategist|masters|state|politic|predator|civilization|civilisation|rights|freedom|liberty|permission|responsibility|nobility/.test(title + " " + category)) return "politics";
    if (/\bai\b|artificial intelligence|digital|internet|machine|agent|\bagi\b/.test(title)) return "ai-technology";
    if (/learning|grades|curious kids|logic|mathematics|equations|astronom|alien|planetary sky/.test(title)) return "science-learning";
    return "society";
  }

  const assigned = collection.books.map(book => ({book, shelf: shelfFor(book)}));
  function render(language) {
    const words = ui[language] || ui.en;
    document.title = `${words[0]} · ScriptaHub`;
    document.documentElement.lang = language;
    const prior = host.querySelector("input")?.value || "";
    host.innerHTML = `<header class="library-heading"><h1>${escape(words[0])}</h1><p>${escape(words[1])}</p></header><div class="library-controls"><input class="library-search" type="search" aria-label="${escape(words[2])}" placeholder="${escape(words[2])}" value="${escape(prior)}"><details class="library-category-picker"${matchMedia("(max-width: 600px)").matches ? "" : " open"}><summary>${escape(words[6])}</summary><nav class="library-categories" aria-label="${escape(words[6])}"></nav></details></div><p class="library-count" aria-live="polite"></p><div class="library-sections"></div>`;
    const input = host.querySelector("input");
    const categories = host.querySelector(".library-categories");
    categories.addEventListener("click", event => { if (event.target.closest("a") && matchMedia("(max-width: 600px)").matches) categories.closest("details").open = false; });
    const sections = host.querySelector(".library-sections");
    const count = host.querySelector(".library-count");
    const draw = () => {
      const needle = normalise(input.value.trim());
      const matching = assigned.filter(({book, shelf}) => !needle || normalise([local(book.title, language), ...Object.values(book.title || {}), local(book.subtitle, language), local(book.shortDescription, language), ...(book.keywords?.[language] || []), label(shelves.find(item => item[0] === shelf), language)].join(" ")).includes(needle));
      const activeShelves = shelves.map(shelf => ({shelf, books: matching.filter(item => item.shelf === shelf[0]).map(item => item.book).sort((a, b) => local(a.title, language).localeCompare(local(b.title, language), language))})).filter(item => item.books.length);
      categories.innerHTML = activeShelves.map(({shelf, books}) => `<a href="#${shelf[0]}">${escape(label(shelf, language))}<small>${books.length}</small></a>`).join("");
      count.textContent = `${matching.length} ${words[3]} ${activeShelves.length} ${words[4]}`;
      sections.innerHTML = activeShelves.length ? activeShelves.map(({shelf, books}) => `<section class="library-section" id="${shelf[0]}"><h2>${escape(label(shelf, language))}</h2><div class="library-list">${books.map(book => {
        const path = book.editions?.[language]?.book || book.editions?.en?.book;
        const href = new URL(`../${path}?lang=${language}`, location.href).href;
        const thumbnail = new URL(`../${local(book.thumbnailUrl, language)}`, location.href).href;
        return `<article class="library-item"><a href="${escape(href)}" tabindex="-1" aria-hidden="true"><img src="${escape(thumbnail)}" alt="" loading="lazy"></a><div><h3><a href="${escape(href)}">${escape(local(book.title, language))}</a></h3><p>${escape(local(book.subtitle, language) || book.category)}</p></div></article>`;
      }).join("")}</div></section>`).join("") : `<p class="library-empty">${escape(words[5])}</p>`;
    };
    input.addEventListener("input", draw);
    draw();
  }
  const language = () => ui[document.documentElement.lang] ? document.documentElement.lang : "en";
  document.addEventListener("scriptahub:language", event => render(event.detail.language));
  render(language());
})();
