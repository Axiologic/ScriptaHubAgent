(() => {
  "use strict";

  const siteRoot = new URL("../", document.currentScript.src);
  const collection = globalThis.SCRIPTA_COLLECTION;
  const root = document.querySelector("[data-workflow-content]");
  if (!collection || !root) return;

  const text = {
    en: {
      createKicker: "Create with the community", createTitle: "Propose a book worth making.",       files: "Source documents", prompt: "Instructions for the book", promptHint: "Audience, purpose, scope, structure, viewpoints to include, quality criteria…", titles: "Proposed titles", titlesHint: "One or several possible titles", propose: "Propose book", createSubject: "ScriptaHub book proposal",
      contractTitle: "Contribution agreement", contractIntro: "Before proposing a book, you agree to these submission terms:", contractItems: ["You own the intellectual-property rights in everything you submit, have permission to submit it, or it is public-domain or compatibly licensed material.", "You give ScriptaHub a worldwide, non-exclusive permission to review, store, edit, translate, combine and adapt the submission to evaluate and create book editions.", "Any part incorporated into a published edition may be released under Creative Commons Attribution 4.0 (CC BY 4.0), which permits sharing and adaptation, including commercially, with attribution.", "You will not submit confidential, unlawfully obtained, privacy-violating or infringing material. You remain responsible for the submission and keep ownership of your original material."], contractAccept: "I have read and accept this contribution agreement.", contractLink: "Read the CC BY 4.0 licence summary",
      feedbackKicker: "Improve this edition", feedbackTitle: "Suggest a valuable change.", feedbackLead: "Point to a stylistic, editorial, factual or conceptual improvement. Be specific enough that editors can evaluate and incorporate it.", promise: "Suggestions considered valuable by AI-assisted checks and human reviewers can be incorporated into the next edition. Material contributors may be credited in the book; acceptance and credit are editorial decisions, not automatic promises.", kind: "Type of contribution", kinds: ["Editorial structure", "Writing style", "Factual correction", "Argument or viewpoint", "Accessibility", "Other"], feedback: "Your proposed change or feedback", feedbackHint: "Quote or identify the passage when possible, explain the issue and propose a better version.", sources: "Sources or supporting context", sourcesHint: "Links, citations, examples or reasoning", send: "Send feedback", feedbackSubject: "ScriptaHub edition feedback", missingBook: "The book context is missing or invalid. Open this page from a book page so the proposal can be linked to the correct edition.",
      editionsKicker: "Publication history", editionsTitle: "Editions", editionsLead: "Publication dates, change logs and durable PDF downloads for every published edition.", current: "Current", published: "Published", changes: "What changed", download: "Download PDF", back: "View Book", noPdf: "No PDF was published for this edition.", loadError: "The edition history could not be loaded.",
    },
    fr: {
      createKicker: "Créer avec la communauté", createTitle: "Proposez un livre qui mérite d’exister.",       files: "Documents sources", prompt: "Instructions pour le livre", promptHint: "Public, objectif, périmètre, structure, points de vue, critères de qualité…", titles: "Titres proposés", titlesHint: "Un ou plusieurs titres possibles", propose: "Proposer le livre", createSubject: "Proposition de livre ScriptaHub",
      contractTitle: "Accord de contribution", contractIntro: "Avant de proposer un livre, vous acceptez les conditions suivantes :", contractItems: ["Vous détenez les droits de propriété intellectuelle sur tout élément envoyé, avez l’autorisation de l’envoyer, ou il appartient au domaine public ou dispose d’une licence compatible.", "Vous accordez à ScriptaHub une autorisation mondiale et non exclusive d’examiner, conserver, modifier, traduire, combiner et adapter l’envoi afin d’évaluer et de créer des éditions.", "Toute partie intégrée à une édition publiée pourra être diffusée sous licence Creative Commons Attribution 4.0 (CC BY 4.0), qui autorise partage et adaptation, y compris commerciale, avec attribution.", "Vous n’enverrez aucun contenu confidentiel, obtenu illégalement, portant atteinte à la vie privée ou aux droits d’autrui. Vous restez responsable de l’envoi et propriétaire de votre contenu original."], contractAccept: "J’ai lu et j’accepte cet accord de contribution.", contractLink: "Lire le résumé de la licence CC BY 4.0",
      feedbackKicker: "Améliorer cette édition", feedbackTitle: "Proposez une modification utile.", feedbackLead: "Signalez une amélioration stylistique, éditoriale, factuelle ou conceptuelle, assez précise pour être évaluée et intégrée.", promise: "Les suggestions jugées utiles par les vérifications assistées par IA et les relecteurs humains pourront entrer dans la prochaine édition. Les contributions substantielles peuvent être créditées ; acceptation et crédit relèvent du choix éditorial.", kind: "Type de contribution", kinds: ["Structure éditoriale", "Style d’écriture", "Correction factuelle", "Argument ou point de vue", "Accessibilité", "Autre"], feedback: "Modification ou retour proposé", feedbackHint: "Citez ou localisez le passage, expliquez le problème et proposez une meilleure version.", sources: "Sources ou contexte", sourcesHint: "Liens, références, exemples ou raisonnement", send: "Envoyer le retour", feedbackSubject: "Retour sur une édition ScriptaHub", missingBook: "Le contexte du livre manque ou n’est pas valide. Ouvrez cette page depuis une page de livre.",
      editionsKicker: "Historique de publication", editionsTitle: "Éditions", editionsLead: "Dates, journaux des modifications et PDF durables de chaque édition publiée.", current: "Actuelle", published: "Publiée le", changes: "Modifications", download: "Télécharger le PDF", back: "Voir le livre", noPdf: "Aucun PDF n’a été publié pour cette édition.", loadError: "Impossible de charger l’historique des éditions.",
    },
    de: {
      createKicker: "Mit der Gemeinschaft erstellen", createTitle: "Ein Buch vorschlagen, das sich lohnt.",       files: "Quelldokumente", prompt: "Anweisungen für das Buch", promptHint: "Zielgruppe, Zweck, Umfang, Struktur, Perspektiven, Qualitätskriterien…", titles: "Titelvorschläge", titlesHint: "Ein oder mehrere mögliche Titel", propose: "Buch vorschlagen", createSubject: "ScriptaHub-Buchvorschlag",
      contractTitle: "Vereinbarung für Beiträge", contractIntro: "Bevor Sie ein Buch vorschlagen, stimmen Sie diesen Bedingungen zu:", contractItems: ["Sie besitzen die Rechte an allem Eingereichten, dürfen es einreichen oder das Material ist gemeinfrei beziehungsweise kompatibel lizenziert.", "Sie erteilen ScriptaHub eine weltweite, nicht ausschließliche Erlaubnis, die Einreichung zur Prüfung und Erstellung von Buchausgaben zu prüfen, zu speichern, zu bearbeiten, zu übersetzen, zu kombinieren und anzupassen.", "Jeder in eine veröffentlichte Ausgabe übernommene Teil darf unter Creative Commons Namensnennung 4.0 (CC BY 4.0) erscheinen; dies erlaubt Teilen und Bearbeiten, auch kommerziell, bei Namensnennung.", "Sie reichen keine vertraulichen, rechtswidrig beschafften, persönlichkeits- oder rechtsverletzenden Inhalte ein. Sie bleiben verantwortlich und behalten das Eigentum an Ihrem Originalmaterial."], contractAccept: "Ich habe diese Vereinbarung gelesen und akzeptiere sie.", contractLink: "Zusammenfassung von CC BY 4.0 lesen",
      feedbackKicker: "Diese Ausgabe verbessern", feedbackTitle: "Eine wertvolle Änderung vorschlagen.", feedbackLead: "Beschreiben Sie eine stilistische, redaktionelle, sachliche oder konzeptionelle Verbesserung so genau, dass sie geprüft und eingearbeitet werden kann.", promise: "Vorschläge, die KI-gestützte Prüfungen und menschliche Gutachter für wertvoll halten, können in die nächste Ausgabe einfließen. Wesentliche Mitwirkende können genannt werden; Annahme und Nennung sind redaktionelle Entscheidungen.", kind: "Art des Beitrags", kinds: ["Redaktionelle Struktur", "Schreibstil", "Sachliche Korrektur", "Argument oder Perspektive", "Barrierefreiheit", "Sonstiges"], feedback: "Vorgeschlagene Änderung oder Rückmeldung", feedbackHint: "Nennen Sie möglichst die Stelle, erklären Sie das Problem und schlagen Sie eine bessere Fassung vor.", sources: "Quellen oder Kontext", sourcesHint: "Links, Zitate, Beispiele oder Begründung", send: "Feedback senden", feedbackSubject: "Feedback zu einer ScriptaHub-Ausgabe", missingBook: "Der Buchkontext fehlt oder ist ungültig. Öffnen Sie diese Seite von einer Buchseite aus.",
      editionsKicker: "Publikationsverlauf", editionsTitle: "Ausgaben", editionsLead: "Daten, Änderungsprotokolle und dauerhafte PDF-Downloads aller veröffentlichten Ausgaben.", current: "Aktuell", published: "Veröffentlicht", changes: "Änderungen", download: "PDF herunterladen", back: "Buch ansehen", noPdf: "Für diese Ausgabe wurde kein PDF veröffentlicht.", loadError: "Der Ausgabenverlauf konnte nicht geladen werden.",
    },
    es: {
      createKicker: "Crear con la comunidad", createTitle: "Propón un libro que merezca existir.",       files: "Documentos fuente", prompt: "Instrucciones para el libro", promptHint: "Público, objetivo, alcance, estructura, perspectivas, criterios de calidad…", titles: "Títulos propuestos", titlesHint: "Uno o varios títulos posibles", propose: "Proponer libro", createSubject: "Propuesta de libro para ScriptaHub",
      contractTitle: "Acuerdo de contribución", contractIntro: "Antes de proponer un libro, aceptas estas condiciones:", contractItems: ["Posees los derechos de propiedad intelectual de todo lo enviado, tienes permiso para enviarlo o es material de dominio público o con licencia compatible.", "Concedes a ScriptaHub un permiso mundial y no exclusivo para revisar, almacenar, editar, traducir, combinar y adaptar el envío con el fin de evaluarlo y crear ediciones.", "Cualquier parte incorporada a una edición publicada podrá difundirse bajo Creative Commons Atribución 4.0 (CC BY 4.0), que permite compartir y adaptar, incluso comercialmente, con atribución.", "No enviarás material confidencial, obtenido ilegalmente, que vulnere la privacidad o infrinja derechos. Sigues siendo responsable y conservas la propiedad de tu material original."], contractAccept: "He leído y acepto este acuerdo de contribución.", contractLink: "Leer el resumen de CC BY 4.0",
      feedbackKicker: "Mejorar esta edición", feedbackTitle: "Propón un cambio valioso.", feedbackLead: "Señala una mejora de estilo, editorial, factual o conceptual con suficiente precisión para evaluarla e incorporarla.", promise: "Las sugerencias que las comprobaciones asistidas por IA y los revisores humanos consideren valiosas podrán incorporarse a la próxima edición. Las contribuciones sustanciales pueden acreditarse; aceptación y crédito son decisiones editoriales.", kind: "Tipo de contribución", kinds: ["Estructura editorial", "Estilo de escritura", "Corrección factual", "Argumento o perspectiva", "Accesibilidad", "Otro"], feedback: "Cambio o comentario propuesto", feedbackHint: "Identifica el pasaje, explica el problema y propone una versión mejor cuando sea posible.", sources: "Fuentes o contexto", sourcesHint: "Enlaces, citas, ejemplos o razonamiento", send: "Enviar comentarios", feedbackSubject: "Comentarios sobre una edición de ScriptaHub", missingBook: "Falta el contexto del libro o no es válido. Abre esta página desde la página de un libro.",
      editionsKicker: "Historial de publicación", editionsTitle: "Ediciones", editionsLead: "Fechas, registros de cambios y descargas PDF duraderas de cada edición publicada.", current: "Actual", published: "Publicada", changes: "Cambios", download: "Descargar PDF", back: "Ver libro", noPdf: "No se publicó un PDF para esta edición.", loadError: "No se pudo cargar el historial de ediciones.",
    },
    pt: {
      createKicker: "Criar com a comunidade", createTitle: "Proponha um livro que valha a pena.",       files: "Documentos de origem", prompt: "Instruções para o livro", promptHint: "Público, objetivo, escopo, estrutura, perspectivas, critérios de qualidade…", titles: "Títulos propostos", titlesHint: "Um ou vários títulos possíveis", propose: "Propor livro", createSubject: "Proposta de livro ScriptaHub",
      contractTitle: "Acordo de contribuição", contractIntro: "Antes de propor um livro, você aceita estas condições:", contractItems: ["Você possui os direitos de propriedade intelectual de tudo o que envia, tem permissão para enviar ou o material é de domínio público ou tem licença compatível.", "Você concede ao ScriptaHub uma permissão mundial e não exclusiva para revisar, armazenar, editar, traduzir, combinar e adaptar o envio a fim de avaliá-lo e criar edições.", "Qualquer parte incorporada a uma edição publicada poderá ser lançada sob Creative Commons Atribuição 4.0 (CC BY 4.0), que permite partilha e adaptação, inclusive comercial, com atribuição.", "Você não enviará material confidencial, obtido ilegalmente, que viole privacidade ou direitos. Continua responsável e mantém a propriedade do material original."], contractAccept: "Li e aceito este acordo de contribuição.", contractLink: "Ler o resumo da CC BY 4.0",
      feedbackKicker: "Melhorar esta edição", feedbackTitle: "Sugira uma mudança valiosa.", feedbackLead: "Indique uma melhoria de estilo, editorial, factual ou conceitual com precisão suficiente para ser avaliada e incorporada.", promise: "Sugestões consideradas valiosas por verificações assistidas por IA e revisores humanos podem entrar na próxima edição. Contribuições substanciais podem receber crédito; aceitação e crédito são decisões editoriais.", kind: "Tipo de contribuição", kinds: ["Estrutura editorial", "Estilo de escrita", "Correção factual", "Argumento ou perspectiva", "Acessibilidade", "Outro"], feedback: "Mudança ou feedback proposto", feedbackHint: "Identifique a passagem, explique o problema e proponha uma versão melhor quando possível.", sources: "Fontes ou contexto", sourcesHint: "Links, citações, exemplos ou raciocínio", send: "Enviar feedback", feedbackSubject: "Feedback sobre edição ScriptaHub", missingBook: "O contexto do livro está ausente ou é inválido. Abra esta página a partir de uma página de livro.",
      editionsKicker: "Histórico de publicação", editionsTitle: "Edições", editionsLead: "Datas, registros de alterações e PDFs duradouros de todas as edições publicadas.", current: "Atual", published: "Publicada", changes: "Alterações", download: "Baixar PDF", back: "Ver livro", noPdf: "Nenhum PDF foi publicado para esta edição.", loadError: "Não foi possível carregar o histórico de edições.",
    },
    it: {
      createKicker: "Creare con la comunità", createTitle: "Proponi un libro che valga la pena creare.",       files: "Documenti sorgente", prompt: "Istruzioni per il libro", promptHint: "Pubblico, obiettivo, ambito, struttura, punti di vista, criteri di qualità…", titles: "Titoli proposti", titlesHint: "Uno o più titoli possibili", propose: "Proponi il libro", createSubject: "Proposta di libro ScriptaHub",
      contractTitle: "Accordo di contribuzione", contractIntro: "Prima di proporre un libro, accetti queste condizioni:", contractItems: ["Possiedi i diritti di proprietà intellettuale su tutto ciò che invii, hai il permesso di inviarlo oppure il materiale è di pubblico dominio o con licenza compatibile.", "Concedi a ScriptaHub un permesso mondiale e non esclusivo per esaminare, conservare, modificare, tradurre, combinare e adattare l’invio al fine di valutarlo e creare edizioni.", "Ogni parte incorporata in un’edizione pubblicata potrà essere distribuita con licenza Creative Commons Attribuzione 4.0 (CC BY 4.0), che consente condivisione e adattamento, anche commerciale, con attribuzione.", "Non invierai materiali riservati, ottenuti illegalmente, lesivi della privacy o dei diritti altrui. Resti responsabile e conservi la proprietà del materiale originale."], contractAccept: "Ho letto e accetto questo accordo di contribuzione.", contractLink: "Leggi il riepilogo della CC BY 4.0",
      feedbackKicker: "Migliora questa edizione", feedbackTitle: "Proponi una modifica utile.", feedbackLead: "Indica un miglioramento stilistico, editoriale, fattuale o concettuale con precisione sufficiente per valutarlo e integrarlo.", promise: "I suggerimenti ritenuti validi dai controlli assistiti dall’IA e dai revisori umani potranno entrare nella prossima edizione. I contributi sostanziali possono essere accreditati; accettazione e credito sono decisioni editoriali.", kind: "Tipo di contributo", kinds: ["Struttura editoriale", "Stile di scrittura", "Correzione fattuale", "Argomento o punto di vista", "Accessibilità", "Altro"], feedback: "Modifica o feedback proposto", feedbackHint: "Individua il passaggio, spiega il problema e proponi una versione migliore quando possibile.", sources: "Fonti o contesto", sourcesHint: "Link, citazioni, esempi o ragionamento", send: "Invia feedback", feedbackSubject: "Feedback su un’edizione ScriptaHub", missingBook: "Il contesto del libro manca o non è valido. Apri questa pagina dalla pagina di un libro.",
      editionsKicker: "Cronologia di pubblicazione", editionsTitle: "Edizioni", editionsLead: "Date, registri delle modifiche e PDF permanenti di ogni edizione pubblicata.", current: "Attuale", published: "Pubblicata", changes: "Modifiche", download: "Scarica PDF", back: "Vedi il libro", noPdf: "Nessun PDF è stato pubblicato per questa edizione.", loadError: "Impossibile caricare la cronologia delle edizioni.",
    },
    ro: {
      createKicker: "Creează împreună cu comunitatea", createTitle: "Propune o carte care merită creată.",       files: "Documente-sursă", prompt: "Indicații pentru carte", promptHint: "Public, scop, domeniu, structură, perspective de inclus, criterii de calitate…", titles: "Titluri propuse", titlesHint: "Unul sau mai multe titluri posibile", propose: "Propune cartea", createSubject: "Propunere de carte ScriptaHub",
      contractTitle: "Acord de contribuție", contractIntro: "Înainte să propui o carte, accepți următoarele condiții:", contractItems: ["Deții drepturile de proprietate intelectuală pentru tot ce trimiți, ai permisiunea de a trimite materialul sau acesta este în domeniul public ori are o licență compatibilă.", "Acorzi ScriptaHub o permisiune neexclusivă, valabilă la nivel mondial, de a analiza, stoca, edita, traduce, combina și adapta contribuția pentru evaluare și crearea edițiilor.", "Orice parte încorporată într-o ediție publicată poate fi distribuită sub Creative Commons Atribuire 4.0 (CC BY 4.0), licență care permite distribuirea și adaptarea, inclusiv comercială, cu atribuire.", "Nu vei trimite materiale confidențiale, obținute ilegal, care încalcă viața privată sau drepturile altora. Rămâi responsabil pentru contribuție și păstrezi proprietatea materialului original."], contractAccept: "Am citit și accept acest acord de contribuție.", contractLink: "Citește rezumatul licenței CC BY 4.0",
      feedbackKicker: "Îmbunătățește ediția", feedbackTitle: "Propune o modificare valoroasă.", feedbackLead: "Semnalează o îmbunătățire de stil, editorială, factuală sau conceptuală suficient de precisă pentru a putea fi evaluată și încorporată.", promise: "Sugestiile considerate valoroase de verificările asistate de AI și de reviewerii umani pot fi încorporate în ediția următoare. Contribuitorii substanțiali pot fi menționați; acceptarea și creditarea sunt decizii editoriale, nu promisiuni automate.", kind: "Tipul contribuției", kinds: ["Structură editorială", "Stil de scriere", "Corecție factuală", "Argument sau perspectivă", "Accesibilitate", "Altceva"], feedback: "Modificarea sau feedbackul propus", feedbackHint: "Indică pasajul când este posibil, explică problema și propune o versiune mai bună.", sources: "Surse sau context ajutător", sourcesHint: "Linkuri, citări, exemple sau argumente", send: "Trimite feedbackul", feedbackSubject: "Feedback pentru o ediție ScriptaHub", missingBook: "Contextul cărții lipsește sau nu este valid. Deschide această pagină din pagina cărții, ca propunerea să fie asociată ediției corecte.",
      editionsKicker: "Istoric de publicare", editionsTitle: "Ediții", editionsLead: "Datele publicării, jurnalele schimbărilor și PDF-urile păstrate pentru fiecare ediție publicată.", current: "Curentă", published: "Publicată", changes: "Ce s-a schimbat", download: "Descarcă PDF", back: "Vezi cartea", noPdf: "Această ediție nu are un PDF publicat.", loadError: "Istoricul edițiilor nu a putut fi încărcat.",
    },
    pl: {
      createKicker: "Twórz ze społecznością", createTitle: "Zaproponuj książkę wartą stworzenia.",       files: "Dokumenty źródłowe", prompt: "Wytyczne do książki", promptHint: "Odbiorcy, cel, zakres, struktura, perspektywy, kryteria jakości…", titles: "Proponowane tytuły", titlesHint: "Jeden lub kilka możliwych tytułów", propose: "Zaproponuj książkę", createSubject: "Propozycja książki ScriptaHub",
      contractTitle: "Umowa dotycząca wkładu", contractIntro: "Przed zaproponowaniem książki akceptujesz następujące warunki:", contractItems: ["Posiadasz prawa własności intelektualnej do wszystkiego, co przesyłasz, masz zgodę na przesłanie albo materiał jest w domenie publicznej lub ma zgodną licencję.", "Udzielasz ScriptaHub ogólnoświatowej, niewyłącznej zgody na przeglądanie, przechowywanie, redagowanie, tłumaczenie, łączenie i adaptowanie zgłoszenia w celu oceny i tworzenia wydań.", "Każda część włączona do opublikowanego wydania może zostać udostępniona na licencji Creative Commons Uznanie autorstwa 4.0 (CC BY 4.0), która pozwala dzielić się i adaptować, także komercyjnie, z podaniem autorstwa.", "Nie prześlesz materiałów poufnych, uzyskanych nielegalnie, naruszających prywatność lub cudze prawa. Odpowiadasz za zgłoszenie i zachowujesz własność oryginalnego materiału."], contractAccept: "Przeczytałem(-am) i akceptuję tę umowę.", contractLink: "Przeczytaj podsumowanie CC BY 4.0",
      feedbackKicker: "Ulepsz to wydanie", feedbackTitle: "Zaproponuj wartościową zmianę.", feedbackLead: "Opisz poprawkę stylistyczną, redakcyjną, rzeczową lub koncepcyjną na tyle dokładnie, aby można ją było ocenić i włączyć.", promise: "Sugestie uznane za wartościowe przez kontrole wspomagane AI i ludzkich recenzentów mogą trafić do kolejnego wydania. Istotni współtwórcy mogą zostać wymienieni; przyjęcie i uznanie autorstwa to decyzje redakcyjne.", kind: "Rodzaj wkładu", kinds: ["Struktura redakcyjna", "Styl pisania", "Korekta faktów", "Argument lub perspektywa", "Dostępność", "Inne"], feedback: "Proponowana zmiana lub opinia", feedbackHint: "Wskaż fragment, wyjaśnij problem i w miarę możliwości zaproponuj lepszą wersję.", sources: "Źródła lub kontekst", sourcesHint: "Linki, cytowania, przykłady lub uzasadnienie", send: "Wyślij opinię", feedbackSubject: "Opinia o wydaniu ScriptaHub", missingBook: "Brakuje kontekstu książki lub jest on nieprawidłowy. Otwórz tę stronę ze strony książki.",
      editionsKicker: "Historia publikacji", editionsTitle: "Wydania", editionsLead: "Daty, rejestry zmian i trwałe pliki PDF wszystkich opublikowanych wydań.", current: "Aktualne", published: "Opublikowano", changes: "Zmiany", download: "Pobierz PDF", back: "Zobacz książkę", noPdf: "Dla tego wydania nie opublikowano pliku PDF.", loadError: "Nie udało się wczytać historii wydań.",
    },
  };

  const contractIntros = {
    en: "Before submitting a contribution, you agree to these terms:",
    fr: "Avant d’envoyer une contribution, vous acceptez les conditions suivantes :",
    de: "Bevor Sie einen Beitrag senden, stimmen Sie diesen Bedingungen zu:",
    es: "Antes de enviar una contribución, aceptas estas condiciones:",
    pt: "Antes de enviar uma contribuição, você aceita estas condições:",
    it: "Prima di inviare un contributo, accetti queste condizioni:",
    ro: "Înainte să trimiți o contribuție, accepți următoarele condiții:",
    pl: "Przed wysłaniem wkładu akceptujesz następujące warunki:",
  };
  Object.entries(contractIntros).forEach(([code, intro]) => { text[code].contractIntro = intro; });

  const agreementSteps = {
    en: ["Next", "Back to contribution", "Submit contribution", "Complete a contribution form before continuing.", "Your draft could not be saved in this tab; allow session storage and try again.", "I declare, on my own responsibility, that I hold the intellectual-property rights needed to submit this material and grant the permissions below, or that I am authorised to do so by the rights holder, public-domain status or a compatible licence."],
    fr: ["Suivant", "Retour à la contribution", "Envoyer la contribution", "Remplissez un formulaire de contribution avant de continuer.", "Votre brouillon n’a pas pu être enregistré dans cet onglet ; autorisez le stockage de session et réessayez.", "Je déclare sous ma propre responsabilité détenir les droits de propriété intellectuelle nécessaires pour soumettre ces éléments et accorder les autorisations ci-dessous, ou y être autorisé par le titulaire des droits, le domaine public ou une licence compatible."],
    de: ["Weiter", "Zurück zum Beitrag", "Beitrag senden", "Füllen Sie zuerst ein Beitragsformular aus.", "Der Entwurf konnte in diesem Tab nicht gespeichert werden; erlauben Sie Sitzungsspeicher und versuchen Sie es erneut.", "Ich erkläre in eigener Verantwortung, dass ich die erforderlichen geistigen Eigentumsrechte besitze, um dieses Material einzureichen und die folgenden Nutzungsrechte zu gewähren, oder dazu vom Rechteinhaber, aufgrund der Gemeinfreiheit oder einer kompatiblen Lizenz berechtigt bin."],
    es: ["Siguiente", "Volver a la contribución", "Enviar contribución", "Completa un formulario de contribución antes de continuar.", "No se pudo guardar el borrador en esta pestaña; permite el almacenamiento de sesión e inténtalo de nuevo.", "Declaro bajo mi propia responsabilidad que poseo los derechos de propiedad intelectual necesarios para enviar este material y conceder los permisos siguientes, o que estoy autorizado por el titular, el dominio público o una licencia compatible."],
    pt: ["Seguinte", "Voltar à contribuição", "Enviar contribuição", "Preencha um formulário de contribuição antes de continuar.", "Não foi possível guardar o rascunho nesta aba; permita o armazenamento de sessão e tente novamente.", "Declaro sob minha própria responsabilidade que detenho os direitos de propriedade intelectual necessários para enviar este material e conceder as permissões abaixo, ou que estou autorizado pelo titular dos direitos, pelo domínio público ou por uma licença compatível."],
    it: ["Avanti", "Torna al contributo", "Invia il contributo", "Compila un modulo di contribuzione prima di continuare.", "Impossibile salvare la bozza in questa scheda; consenti l’archiviazione di sessione e riprova.", "Dichiaro sotto la mia responsabilità di detenere i diritti di proprietà intellettuale necessari per inviare questo materiale e concedere le autorizzazioni seguenti, oppure di essere autorizzato dal titolare dei diritti, dal pubblico dominio o da una licenza compatibile."],
    ro: ["Înainte", "Înapoi la contribuție", "Trimite contribuția", "Completează un formular de contribuție înainte de a continua.", "Ciorna nu a putut fi salvată în această filă; permite stocarea de sesiune și încearcă din nou.", "Declar pe propria răspundere că dețin drepturile de proprietate intelectuală necesare pentru a trimite aceste materiale și a acorda permisiunile de mai jos sau că sunt autorizat să fac acest lucru de titularul drepturilor, de statutul de domeniu public ori de o licență compatibilă."],
    pl: ["Dalej", "Wróć do wkładu", "Wyślij zgłoszenie", "Najpierw wypełnij formularz wkładu.", "Nie udało się zapisać szkicu w tej karcie; zezwól na pamięć sesji i spróbuj ponownie.", "Oświadczam na własną odpowiedzialność, że posiadam prawa własności intelektualnej niezbędne do przesłania tych materiałów i udzielenia poniższych zezwoleń lub jestem do tego uprawniony przez właściciela praw, status domeny publicznej albo zgodną licencję."],
  };
  Object.entries(agreementSteps).forEach(([code, words]) => { text[code].contractItems[0] = words[5]; });

  const createFieldLabels = {
    en: { title: "Proposed title", titleHint: "A working title (optional)", chooseFiles: "Choose attachments", filesHint: "Attach a manuscript or reference material to support your proposal (optional)." },
    fr: { title: "Titre proposé", titleHint: "Un titre de travail (facultatif)", chooseFiles: "Choisir les pièces jointes", filesHint: "Joignez un manuscrit ou des documents de référence à votre proposition (facultatif)." },
    de: { title: "Vorgeschlagener Titel", titleHint: "Ein Arbeitstitel (optional)", chooseFiles: "Anhänge auswählen", filesHint: "Fügen Sie ein Manuskript oder Referenzmaterial hinzu (optional)." },
    es: { title: "Título propuesto", titleHint: "Un título provisional (opcional)", chooseFiles: "Elegir adjuntos", filesHint: "Adjunta un manuscrito o material de referencia a tu propuesta (opcional)." },
    pt: { title: "Título proposto", titleHint: "Um título provisório (opcional)", chooseFiles: "Escolher anexos", filesHint: "Anexe um manuscrito ou material de referência à proposta (opcional)." },
    it: { title: "Titolo proposto", titleHint: "Un titolo provvisorio (facoltativo)", chooseFiles: "Scegli allegati", filesHint: "Allega un manoscritto o materiale di riferimento alla proposta (facoltativo)." },
    ro: { title: "Titlu propus", titleHint: "Un titlu de lucru (opțional)", chooseFiles: "Alege atașamente", filesHint: "Atașează un manuscris sau materiale de referință pentru propunerea ta (opțional)." },
    pl: { title: "Proponowany tytuł", titleHint: "Tytuł roboczy (opcjonalnie)", chooseFiles: "Wybierz załączniki", filesHint: "Dodaj rękopis lub materiały źródłowe do propozycji (opcjonalnie)." },
  };

  const escape = (value) => String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
  const params = () => new URLSearchParams(location.search);
  const language = () => collection.supportedLanguages.some((item) => item.code === document.documentElement.lang) ? document.documentElement.lang : "en";
  const activeBook = () => collection.books.find((book) => document.body.dataset.animationBook ? book.id === document.body.dataset.animationBook : book.directory === params().get("book"));
  const field = (label, name, type = "text", wide = false, placeholder = "", required = false, extraClass = "") => `<label class="form-field${wide ? " form-field-wide" : ""}${extraClass ? ` ${extraClass}` : ""}"><span>${escape(label)}</span><input type="${type}" name="${name}" placeholder="${escape(placeholder)}"${required ? " required" : ""}></label>`;
  const textarea = (label, name, placeholder, required = false, extraClass = "") => `<label class="form-field form-field-wide${extraClass ? ` ${extraClass}` : ""}"><span>${escape(label)}</span><textarea name="${name}" placeholder="${escape(placeholder)}"${required ? " required" : ""}></textarea></label>`;
  const pageHero = (kicker, title, lead = "") => `<section class="workflow-hero"><div><p class="eyebrow">${escape(kicker)}</p><h1 title="${escape(title)}">${escape(title)}</h1></div>${lead ? `<p class="lead">${escape(lead)}</p>` : ""}</section>`;
  const backLabels = { en: "Back to book", fr: "Retour au livre", de: "Zurück zum Buch", es: "Volver al libro", pt: "Voltar ao livro", it: "Torna al libro", ro: "Înapoi la carte", pl: "Powrót do książki" };
  const backToBook = (book, lang) => book ? `<nav class="workflow-back"><a class="button button-quiet" href="${escape(new URL(book.editions[lang].book, siteRoot).href)}?lang=${lang}">${escape(backLabels[lang])}</a></nav>` : "";
  const agreementCard = (words) => `<aside class="workflow-context contribution-agreement"><p class="eyebrow">ScriptaHub</p><h2>${escape(words.contractTitle)}</h2><p>${escape(words.contractIntro)}</p><ol>${words.contractItems.map((item) => `<li>${escape(item)}</li>`).join("")}</ol><a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener">${escape(words.contractLink)}</a><label class="contract-accept"><input type="checkbox" data-contract-accept><span>${escape(words.contractAccept)}</span></label></aside>`;
  const bookContext = (book, lang, words) => {
    if (!book) return `<aside class="workflow-context"><p>${escape(words.missingBook)}</p></aside>`;
    return ScriptaBookView.markup(book, {variant: "context", language: lang, actionLabel: words.back});
  };
  const compactBookContext = (book, lang, words, showDescription = true) => {
    if (!book) return `<aside class="workflow-context"><p>${escape(words.missingBook)}</p></aside>`;
    return ScriptaBookView.markup(book, {variant: "compact-context", language: lang, actionLabel: words.back, showDescription});
  };

  const draftPrefix = "scripta-contribution-draft:";
  function readDraft() {
    try {
      const draft = JSON.parse(sessionStorage.getItem(draftPrefix + params().get("draft")));
      if (!draft || typeof draft.subject !== "string" || !Array.isArray(draft.lines) || !Array.isArray(draft.files) || !draft.values || typeof draft.values !== "object") return null;
      const back = new URL(draft.returnUrl);
      if (back.origin !== siteRoot.origin || !back.pathname.startsWith(siteRoot.pathname) || Date.now() - draft.createdAt > 86400000) return null;
      return draft;
    } catch { return null; }
  }
  function restoreDraft(form) {
    const draft = readDraft();
    if (!draft) return;
    const back = new URL(draft.returnUrl);
    if (back.pathname !== location.pathname || back.searchParams.get("book") !== params().get("book")) return;
    for (const [name, value] of Object.entries(draft.values)) {
      const input = form.elements.namedItem(name);
      if (input && input.type !== "file") input.value = value;
    }
    form._draftFiles = draft.files;
  }
  async function beginAgreement(subject, lines, lang, form, files = []) {
    let id;
    try { id = await globalThis.ScriptaContributionBridge.newSubmissionId(); }
    catch (error) { root.querySelector('[data-workflow-status]').textContent = error.message; return; }
    const back = new URL(location.href); back.searchParams.set("draft", id);
    const values = Object.fromEntries([...new FormData(form)].filter(([, value]) => typeof value === "string"));
    const draft = {subject, lines, values, files, returnUrl: back.href, createdAt: Date.now()};
    try {
      await globalThis.ScriptaContributionBridge.saveDraftFiles(id, [...(form.elements.documents?.files || [])], params().get('draft'), files);
      sessionStorage.setItem(draftPrefix + id, JSON.stringify(draft));
    }
    catch (error) { root.querySelector("[data-workflow-status]").textContent = error.message || agreementSteps[lang][4]; return; }
    const target = new URL("agreement/index.html", siteRoot);
    target.searchParams.set("lang", lang); target.searchParams.set("draft", id);
    history.replaceState(history.state, "", back);
    location.href = target.href;
  }
  function renderAgreement(lang) {
    const words = text[lang], steps = agreementSteps[lang], draft = readDraft();
    document.title = `${words.contractTitle} · ScriptaHub`;
    root.innerHTML = `${pageHero("ScriptaHub", words.contractTitle)}${draft ? `<nav class="workflow-back"><a class="button button-quiet" href="${escape(draft.returnUrl)}">${escape(steps[1])}</a></nav>` : ""}<section class="agreement-page">${agreementCard(words)}${draft ? `<form data-agreement-form><button class="workflow-submit" type="submit" disabled>${escape(steps[2])}</button><p class="workflow-note">${escape(ScriptaContributionBridge.note(lang))}</p>${draft.files.length ? `<ul class="agreement-files">${draft.files.map(file => `<li>${escape(file)}</li>`).join("")}</ul>` : ""}<p data-workflow-status aria-live="polite"></p></form>` : `<p>${escape(steps[3])}</p>`}</section>`;
    root.querySelector(".contribution-agreement h2").remove();
    root.querySelector(".contribution-agreement .eyebrow").remove();
    if (!draft) { root.querySelector(".contract-accept").remove(); return; }
    const form = root.querySelector("[data-agreement-form]"), checkbox = root.querySelector("[data-contract-accept]");
    checkbox.addEventListener("change", () => { const button = form.querySelector("button"); button.disabled = !checkbox.checked || button.dataset.submissionComplete === 'true'; });
    form.addEventListener("submit", event => {
      event.preventDefault();
      if (!checkbox.checked) return;
      const submit = new CustomEvent("scriptahub:contribution-submit", {cancelable: true, detail: {draft, agreementVersion: "2026-09-10", declaration: words.contractItems[0]}});
      document.dispatchEvent(submit);
    });
  }

  const proposalLabels = {
    en: ["Propose a derived book", "Build on this book with a new direction, audience or perspective.", "What should the derived book retain, change or add?", "Describe the new purpose, audience, scope and relationship to the source book.", "Suggest an animation", "This book has no animation yet. Help shape its introduction.", "Improve this presentation", "What would make this book introduction clearer or more compelling?", "Your suggestion", "Suggest the opening, distinctive ideas, visual approach or changes to a scene; include a timestamp if useful."],
    ro: ["Propune o carte derivată", "Pornește de la această carte cu o nouă direcție, perspectivă sau un alt public.", "Ce ar trebui păstrat, schimbat sau adăugat?", "Descrie scopul, publicul, conținutul și legătura cu această carte.", "Propune o animație", "Această carte nu are încă o animație. Ajută la conturarea prezentării.", "Îmbunătățește prezentarea", "Cum ar putea această introducere să fie mai clară sau mai convingătoare?", "Sugestia ta", "Propune deschiderea, ideile distinctive, stilul vizual sau modificarea unei scene; indică momentul dacă este util."],
    fr: ["Proposer un livre dérivé", "Développez ce livre pour un nouveau public, une autre direction ou perspective.", "Que faut-il conserver, modifier ou ajouter ?", "Décrivez l’objectif, le public, le périmètre et le lien avec le livre source.", "Proposer une animation", "Ce livre n’a pas encore d’animation. Aidez à concevoir son introduction.", "Améliorer cette présentation", "Comment rendre cette introduction plus claire ou plus convaincante ?", "Votre suggestion", "Proposez une ouverture, des idées distinctives, une approche visuelle ou une modification de scène ; précisez le moment si utile."],
    de: ["Ein abgeleitetes Buch vorschlagen", "Entwickeln Sie dieses Buch für eine neue Zielgruppe, Richtung oder Perspektive weiter.", "Was soll erhalten, geändert oder ergänzt werden?", "Beschreiben Sie Zweck, Zielgruppe, Umfang und Bezug zum Ausgangsbuch.", "Eine Animation vorschlagen", "Dieses Buch hat noch keine Animation. Gestalten Sie seine Einführung mit.", "Diese Präsentation verbessern", "Wie könnte diese Bucheinführung klarer oder überzeugender werden?", "Ihr Vorschlag", "Schlagen Sie einen Einstieg, besondere Ideen, eine Bildsprache oder Szenenänderungen vor; nennen Sie bei Bedarf einen Zeitpunkt."],
    es: ["Proponer un libro derivado", "Desarrolla este libro con otra dirección, público o perspectiva.", "¿Qué debería conservar, cambiar o añadir?", "Describe el propósito, público, alcance y relación con el libro original.", "Proponer una animación", "Este libro aún no tiene animación. Ayuda a diseñar su introducción.", "Mejorar esta presentación", "¿Cómo podría esta introducción ser más clara o convincente?", "Tu sugerencia", "Propón la apertura, ideas distintivas, enfoque visual o cambios en una escena; indica el momento si resulta útil."],
    pt: ["Propor um livro derivado", "Desenvolva este livro para outro público, direção ou perspectiva.", "O que deve ser mantido, alterado ou acrescentado?", "Descreva o objetivo, público, âmbito e relação com o livro original.", "Propor uma animação", "Este livro ainda não tem animação. Ajude a criar a sua introdução.", "Melhorar esta apresentação", "Como tornar esta introdução mais clara ou convincente?", "A sua sugestão", "Sugira a abertura, ideias distintivas, abordagem visual ou alterações numa cena; indique o momento se for útil."],
    it: ["Proponi un libro derivato", "Sviluppa questo libro per un nuovo pubblico, una direzione o una prospettiva diversa.", "Cosa dovrebbe conservare, cambiare o aggiungere?", "Descrivi scopo, pubblico, ambito e rapporto con il libro di origine.", "Proponi un’animazione", "Questo libro non ha ancora un’animazione. Aiuta a idearne l’introduzione.", "Migliora questa presentazione", "Come rendere questa introduzione più chiara o convincente?", "Il tuo suggerimento", "Proponi l’apertura, idee distintive, stile visivo o modifiche a una scena; indica il momento se utile."],
    pl: ["Zaproponuj książkę pochodną", "Rozwiń tę książkę dla nowych odbiorców, w nowym kierunku lub z innej perspektywy.", "Co należy zachować, zmienić lub dodać?", "Opisz cel, odbiorców, zakres i związek z książką źródłową.", "Zaproponuj animację", "Ta książka nie ma jeszcze animacji. Pomóż zaplanować jej wprowadzenie.", "Ulepsz tę prezentację", "Jak uczynić to wprowadzenie jaśniejszym lub bardziej przekonującym?", "Twoja sugestia", "Zaproponuj początek, wyróżniające idee, oprawę wizualną lub zmiany sceny; w razie potrzeby podaj czas."],
  };

  function renderCreate(lang, fork = false) {
    const book = fork ? activeBook() : null;
    const labels = proposalLabels[lang];
    const words = fork ? {...text[lang], createTitle: labels[0], createKicker: "Fork", prompt: labels[2], promptHint: labels[3], createSubject: "ScriptaHub derived book proposal"} : text[lang];
    if (fork && !book) { root.innerHTML = pageHero("Fork", words.missingBook); return; }
    const fields = createFieldLabels[lang];
    document.title = `${words.createTitle} · ScriptaHub`;

    root.innerHTML = `${fork ? backToBook(book, lang) : ""}${pageHero(words.createKicker, words.createTitle, fork ? labels[1] : "")}${fork ? `<div class="fork-source">${compactBookContext(book, lang, words, false)}</div>` : ""}<section class="workflow-layout create-workflow-layout"><form class="workflow-form create-workflow-form" data-workflow-form><div class="form-grid create-form-grid">
      ${field(fields.title, "titles", "text", false, fields.titleHint, false, "create-title-field")}
      ${textarea(words.prompt, "prompt", words.promptHint, true, "create-instructions-field")}
      <label class="form-file-field"><input class="form-file-input" type="file" name="documents" multiple aria-label="${escape(words.files)}"><span class="form-file-picker"><strong>${escape(words.files)}</strong><span class="form-file-hint">${escape(fields.filesHint)}</span><span class="form-file-button"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M8.5 12.8 14 7.3a3.2 3.2 0 0 1 4.5 4.5l-7.1 7.1a5 5 0 0 1-7.1-7.1l7.5-7.5"/></svg>${escape(fields.chooseFiles)}</span><span class="form-file-selection" data-file-selection aria-live="polite"></span></span></label>
      </div><div class="create-form-footer"><p class="workflow-note">${escape(ScriptaContributionBridge.note(lang))}</p><button class="workflow-submit" type="submit">${escape(agreementSteps[lang][0])}<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 12h16m-6-6 6 6-6 6"/></svg></button></div><p class="workflow-status" data-workflow-status aria-live="polite"></p></form></section>`;
    const form = root.querySelector("form");
    restoreDraft(form);
    const documents = form.elements.documents;
    const fileSelection = form.querySelector("[data-file-selection]");
    const updateFileSelection = () => {
      const names = documents.files.length ? [...documents.files].map((file) => file.name) : (form._draftFiles || []);
      fileSelection.replaceChildren();
      if (!names.length) return;
      const list = document.createElement("ul");
      names.forEach((name) => {
        const item = document.createElement("li");
        item.textContent = name;
        item.title = name;
        list.append(item);
      });
      fileSelection.append(list);
    };
    documents.addEventListener("change", () => { form._draftFiles = []; updateFileSelection(); });
    updateFileSelection();

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      if (!form.reportValidity()) return;
      const data = new FormData(form);
      const files = form.elements.documents.files.length ? [...form.elements.documents.files].map((file) => file.name) : (form._draftFiles || []);
      const lines = [
        ...(fork ? [`Source book ID: ${book.id}`, `Source book: ${book.title.en}`, `Source directory: ${book.directory}`, `Source edition: ${book.currentEdition || book.animation?.edition || "Current published edition"}`, ""] : []),
        `Selected documents: ${files.join(", ") || "None"}`, "", "PROPOSED TITLE", data.get("titles") || "", "", "BOOK INSTRUCTIONS", data.get("prompt") || "", "", `Interface language: ${lang}`,
      ];
      beginAgreement(words.createSubject, lines, lang, form, files);
    });
  }

  function renderFeedback(lang, animation = false) {
    const labels = proposalLabels[lang];
    const existing = Boolean(activeBook()?.animation);
    const words = animation ? {...text[lang], feedbackTitle: labels[existing ? 6 : 4], feedbackKicker: "Animation", promise: labels[existing ? 7 : 5], feedback: labels[8], feedbackHint: labels[9], feedbackSubject: existing ? "ScriptaHub animation improvement" : "ScriptaHub animation proposal"} : text[lang];
    const book = activeBook();
    if (!document.body.dataset.animationBook) document.title = `${words.feedbackTitle} · ScriptaHub`;
    const embedded = Boolean(document.body.dataset.animationBook);
    const side = embedded || animation ? "" : `<div class="workflow-aside-stack">${compactBookContext(book, lang, words)}</div>`;
    const animationContext = animation && book ? ScriptaBookView.markup(book, {variant: "compact-context", language: lang, showCategory: true, expandDescription: true}) : "";
    root.classList.toggle("animation-contribution", animation);
    root.innerHTML = `${embedded ? `<h2>${escape(words.feedbackTitle)}</h2>` : backToBook(book, lang) + pageHero(words.feedbackKicker, words.feedbackTitle)}<section class="workflow-layout"><form class="workflow-form" data-workflow-form>${animationContext ? `<div class="animation-book-reminder">${animationContext}</div>` : ""}<p class="workflow-message${animation ? " animation-contribution-question" : ""}">${escape(words.promise)}</p><div class="form-grid">
      ${animation ? "" : `<label class="form-field form-field-wide"><span>${escape(words.kind)}</span><select name="kind">${words.kinds.map((kind) => `<option>${escape(kind)}</option>`).join("")}</select></label>`}${textarea(words.feedback, "feedback", words.feedbackHint, true)}${textarea(words.sources, "sources", words.sourcesHint)}</div><button class="workflow-submit" type="submit"${book ? "" : " disabled"}>${escape(agreementSteps[lang][0])}</button><p class="workflow-note">${escape(ScriptaContributionBridge.note(lang))}</p><p class="workflow-status" data-workflow-status aria-live="polite"></p></form>${side}</section>`;
    const form = root.querySelector("form");
    restoreDraft(form);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      if (!book || !form.reportValidity()) return;
      const data = new FormData(form);
      const lines = [
        `Book ID: ${book.id}`, `Book: ${book.title[lang] || book.title.en}`, `Book directory: ${book.directory}`, `Edition language: ${lang}`, `Contribution type: ${animation ? (existing ? "Animation improvement" : "Animation proposal") : data.get("kind") || ""}`, ...(animation ? [`Animation source edition: ${book.animation?.edition || "Not yet produced"}`, `Animation file: ${book.animation?.shf || "None"}`] : []),
        "PROPOSED CHANGE / FEEDBACK", data.get("feedback") || "", "", "SOURCES / CONTEXT", data.get("sources") || "",
      ];
      beginAgreement(`${words.feedbackSubject}: ${book.title[lang] || book.title.en}`, lines, lang, form);
    });
  }

  async function renderEditions(lang) {
    const words = text[lang];
    const book = activeBook();
    document.title = `${words.editionsTitle} · ScriptaHub`;
    if (!book) {
      root.innerHTML = `${pageHero(words.editionsKicker, words.editionsTitle, words.editionsLead)}<p class="workflow-message">${escape(words.missingBook)}</p>`;
      return;
    }
    root.innerHTML = `${backToBook(book, lang)}${pageHero(words.editionsKicker, `${words.editionsTitle}: ${book.title[lang] || book.title.en}`, words.editionsLead)}<section class="workflow-layout"><div class="editions-list" data-editions-list><p class="workflow-message">…</p></div>${bookContext(book, lang, words)}</section>`;
    try {
      const response = await fetch(`../${book.directory}/editions.json`);
      if (!response.ok) throw new Error(String(response.status));
      const history = await response.json();
      const list = root.querySelector("[data-editions-list]");
      list.innerHTML = [...history.editions].sort((a, b) => Number(b.number) - Number(a.number)).map((edition) => {
        const preparing = edition.status === "preparing";
        const current = preparing ? `<span class="publication-status">${escape(globalThis.ScriptaReading.preparationLabels[lang])}</span>` : edition.id === history.currentEdition ? `<span class="edition-date">${escape(words.current)}</span>` : "";
        const label = edition.label?.[lang] || edition.label?.en || `Edition ${edition.number}`;
        const changes = edition.changes?.[lang] || edition.changes?.en || "";
        const date = preparing ? "" : edition.datePrecision === "year" ? edition.publishedAt.slice(0, 4) : new Intl.DateTimeFormat(lang, { dateStyle: "long" }).format(new Date(`${edition.publishedAt}T12:00:00`));
        const downloads = Object.entries(edition.pdf || {}).map(([code, path]) => `<a href="../${escape(book.directory)}/${escape(path)}" download="${escape(globalThis.ScriptaReading.pdfDownloadName(book.title.en, edition.number))}">${escape(words.download)} · ${escape(collection.supportedLanguages.find((item) => item.code === code)?.name || code)}</a>`).join("");
        const readingWords = globalThis.ScriptaReading.labels[lang];
        const readers = Object.entries(edition.readers || {}).flatMap(([code, formats]) => Object.entries(formats).map(([format, path]) => `<a href="../${escape(book.directory)}/${escape(path)}">${escape(format === "shortContent" ? readingWords.short : readingWords.full)} · ${escape(collection.supportedLanguages.find((item) => item.code === code)?.name || code)}</a>`)).join("");
        const coverPath = edition.covers?.[lang] || edition.covers?.en;
        const cover = coverPath ? `<img class="edition-history-cover" src="../${escape(book.directory)}/${escape(coverPath)}" alt="${escape(`${book.title[lang] || book.title.en} · ${label}`)}" loading="lazy">` : "";
        return `<article class="edition-card${cover ? "" : " edition-card-no-cover"}">${cover}<div class="edition-card-details"><div class="edition-card-meta">${current}${date ? `<time class="edition-date" datetime="${escape(edition.publishedAt)}">${escape(date)}</time>` : ""}</div><h2>${escape(label)}</h2><p class="edition-changes"><strong>${escape(words.changes)}:</strong> ${escape(changes)}</p><div class="edition-downloads">${downloads || `<span class="workflow-note">${escape(words.noPdf)}</span>`}${readers}</div></div></article>`;
      }).join("");
    } catch {
      root.querySelector("[data-editions-list]").innerHTML = `<p class="workflow-message">${escape(words.loadError)}</p>`;
    }
  }

  const contributorLabels = {en:"Contributors",ro:"Contribuitori",fr:"Contributeurs",de:"Mitwirkende",es:"Colaboradores",pt:"Colaboradores",it:"Collaboratori",pl:"Współtwórcy"};
  const contributionLink = (name, href) => {
    try { const url = new URL(href); if (!["https:", "http:"].includes(url.protocol)) return escape(name); return `<a href="${escape(url.href)}" rel="noopener noreferrer">${escape(name)}</a>`; }
    catch { return escape(name); }
  };
  function contributionDescription(value) {
    return (Array.isArray(value) ? value : [value || ""]).map(part => typeof part === "string" ? escape(part) : contributionLink(part.label, part.url)).join("");
  }
  const contributorColumns = {en:["Author","Contribution"],ro:["Autor","Contribuție"],fr:["Auteur","Contribution"],de:["Autor","Beitrag"],es:["Autor","Contribución"],pt:["Autor","Contribuição"],it:["Autore","Contributo"],pl:["Autor","Wkład"]};
  function renderContributors(lang) {
    const book = activeBook(), words = text[lang], title = contributorLabels[lang];
    document.title = `${title} · ${book?.title?.[lang] || book?.title?.en || "ScriptaHub"}`;
    if (!book) { root.innerHTML = `${pageHero("ScriptaHub", title)}<p class="workflow-message">${escape(words.missingBook)}</p>`; return; }
    const releases = [...(book.contributions || [])].sort((a,b) => Number(b.number) - Number(a.number));
    const columns = contributorColumns[lang];
    root.innerHTML = `${backToBook(book, lang)}${pageHero("ScriptaHub", title)}<p class="contributors-book-title">${escape(book.title[lang] || book.title.en)}</p><section class="contributors-list">${releases.map(release => `<table class="contribution-edition" data-contribution-edition="${escape(release.edition)}"><caption>${escape(release.label?.[lang] || release.label?.en || release.edition)}</caption><thead><tr><th scope="col">${escape(columns[0])}</th><th scope="col">${escape(columns[1])}</th></tr></thead><tbody>${release.entries.map(entry => `<tr class="contributor-entry"><th scope="row">${contributionLink(entry.name, entry.url)}</th><td><p>${contributionDescription(entry.description?.[lang] || entry.description?.en)}</p></td></tr>`).join("")}</tbody></table>`).join("")}</section>`;
  }

  function renderTranslation(lang) {
    const reading = globalThis.ScriptaReading;
    const words = reading.labels[lang];
    const book = activeBook();
    document.title = `${words.title} · ScriptaHub`;
    if (!book) {
      root.innerHTML = `${pageHero("ScriptaHub", words.title, words.lead)}<p class="workflow-message">${escape(words.missing)}</p><a class="button" href="../index.html?lang=${lang}">ScriptaHub</a>`;
      return;
    }
    const target = reading.locale(params().get("target") || lang);
    const format = reading.formatName(params().get("format"));
    root.innerHTML = `${backToBook(book, lang)}${pageHero("ScriptaHub", words.title, words.lead)}<section class="workflow-layout"><form class="workflow-form" data-translation-form><div class="form-grid"><label class="form-field"><span>${escape(words.target)}</span><select name="target">${collection.supportedLanguages.map(({ code, name }) => `<option value="${code}"${code === target ? " selected" : ""}>${escape(name)}</option>`).join("")}</select></label><label class="form-field"><span>${escape(words.format)}</span><select name="format"><option value="read"${format === "read" ? " selected" : ""}>${escape(words.full)}</option><option value="short"${format === "short" ? " selected" : ""}>${escape(words.short)}</option></select></label>${textarea(words.note, "note", "")}</div><div data-translation-available hidden><p>${escape(words.available)}</p><a class="button" data-translation-read>${escape(words.read)}</a></div><button class="workflow-submit" type="submit">${escape(agreementSteps[lang][0])}</button><p class="workflow-note" data-translation-mail-note>${escape(ScriptaContributionBridge.note(lang))}</p><p class="workflow-status" data-workflow-status aria-live="polite"></p></form>${bookContext(book, lang, { ...text[lang], back: words.back })}</section>`;
    const form = root.querySelector("[data-translation-form]");
    restoreDraft(form);
    const update = () => {
      const data = new FormData(form);
      const selected = data.get("target");
      const selectedFormat = data.get("format");
      const present = reading.available(book, selected, selectedFormat);
      form.querySelector("[data-translation-available]").hidden = !present;
      form.querySelector('[type="submit"]').hidden = present;
      form.querySelector("[data-translation-mail-note]").hidden = present;
      const availableUrl = present ? reading.readingUrl(book, selected, selectedFormat, lang, new URL("../", location.href)) : null;
      if (availableUrl) form.querySelector("[data-translation-read]").href = availableUrl.href;
      else form.querySelector("[data-translation-read]").removeAttribute("href");
      const url = new URL(location.href);
      url.searchParams.set("target", selected);
      url.searchParams.set("format", selectedFormat);
      history.replaceState({}, "", url);
    };
    form.querySelectorAll("select").forEach((select) => select.addEventListener("change", update));
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      if (!form.reportValidity()) return;
      const data = new FormData(form);
      if (reading.available(book, data.get("target"), data.get("format"))) { update(); return; }
      beginAgreement(`ScriptaHub translation request: ${book.title.en}`, [`Book ID: ${book.id}`, `Target language: ${data.get("target")}`, `Reading format: ${data.get("format")}`, `Source edition: ${book.currentEdition || "current"}`, `Note: ${data.get("note") || ""}`], lang, form);
    });
    update();
  }

  function render(lang = language()) {
    const page = document.body.dataset.workflowPage;
    document.body.toggleAttribute("data-book-workflow", ["feedback","editions","contributors","translate","fork","animation-request","agreement"].includes(page));
    if (page === "agreement") renderAgreement(lang);
    else if (page === "animation-request" || document.body.dataset.animationBook) renderFeedback(lang, true);
    else if (page === "contributors") renderContributors(lang);
    else if (page === "fork") renderCreate(lang, true);
    else if (page === "translate") renderTranslation(lang);
    else if (page === "create") renderCreate(lang);
    else if (page === "feedback") renderFeedback(lang);
    else renderEditions(lang);
  }

  document.addEventListener("scriptahub:language", (event) => render(event.detail.language));
  render();
})();
