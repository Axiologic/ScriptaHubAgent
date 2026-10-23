# Repo-uri de conținut pentru ScriptaHub

Un repo de cărți publică numai metadatele și fișierele cărților. Aplicația Ploinky, catalogul compus, formularele și cititorul comun sunt în ScriptaHubAgent. Agentul citește resursele publicate prin HTTP și nu execută Git, clone sau checkout pentru aceste surse.

## Formatul recomandat: schema 2

Repo-ul [scriptaBooks-1](https://github.com/Axiologic/scriptaBooks-1) conține primele 10 cărți migrate. Structura lui este:

```text
collection.json
books/
  metacult/
    book.json
    en/
      full.html
      summary.html
      book.pdf
      Metacult.assets/
    assets/
      cover.webp
      cover-source.png
      thumbnail.webp
    animation/
      metacult-introduction.shf
  affective-calculus/
    book.json
    en/
      full.html
      summary.html
    ro/
      full.html
      summary.html
assets/shared/                   Fișiere comune între cărți diferite, când există
```

Fiecare carte are un director cu nume lizibil, derivat din titlu. Textul, rezumatele, traducerile și PDF-urile stau lângă metadatele ei. Asseturile comune limbilor și edițiilor unei cărți se păstrează o singură dată în directorul acelei cărți. Fișierele identice folosite de cărți diferite pot sta în `assets/shared/`, cu nume descriptive.

Indexul are `schemaVersion: 2`, `bookCount` și `books`. Un element conține `title`, `id`, `path` (de exemplu `books/metacult/book.json`) și `sha256` (amprenta fișierului de metadate). ID-urile și hashurile rămân câmpuri tehnice în JSON, fără să fie folosite ca nume de directoare sau fișiere brute.

O carte poate avea ediții numai în română sau în orice altă limbă acceptată; engleza nu este obligatorie. Randarea și lectura aleg limba cerută dacă formatul există, apoi engleza dacă este disponibilă, apoi prima limbă care oferă acel format. Selectorul de interfață poate rămâne în limba cerută. Legătura înapoi folosește o pagină existentă, iar PDF-ul cititorului urmează limba textului. Fiecare carte trebuie să aibă cel puțin o ediție cu pagină `book`.

Fiecare `book.json` conține:

- `id`: identitatea stabilă păstrată din ScriptaHub;
- `contentDirectory`: directorul fizic al cărții, de exemplu `books/metacult`;
- `legacyDirectory`: ruta publică originală;
- `metadata`: manifestul original, inclusiv traducerile disponibile;
- `history`: istoricul edițiilor;
- `resources`: maparea căilor vechi către fișierele actuale, relative la rădăcina repo-ului;
- `resourceChecksums`: hashurile fișierelor brute, pentru verificarea înainte de publicare;
- `provenance`: sursa și amprentele inițiale.

Exemple: `en/full_content.html` indică `books/metacult/en/full.html`; `en/cover.webp` și `ro/cover.webp` pot indica același `books/metacult/assets/cover.webp`. Un fișier fizic poate avea mai multe aliasuri, fără copii duplicate. Manifestul și istoricul păstrează căile originale, rezolvate de agent prin `resources`.

Agentul generează paginile `<limbă>/book.html`, pagina Animation și manifestele din metadate. Cititorul, formularele, navigația, CSS-ul și scripturile comune sunt în agent. HTML-ul brut poate păstra formatarea proprie documentului. URL-uri precum `/books/metacult/bk-96a7b4595ce6486c/en/book.html?lang=en` rămân funcționale. Este acceptată și ruta `/books/<bk-id>/...`.

Agentul verifică indexul și metadatele noi sau modificate prin SHA-256. Metadatele deja verificate sunt reutilizate în memorie. Textele și asseturile se cer prin HTTP la acces; agentul nu descarcă anticipat toate fișierele pentru verificarea hashurilor. Structura anterioară, cu fișiere numite după hash, rămâne acceptată pentru compatibilitate.

Utilitarele din ScriptaHubAgent:

```sh
python3 tools/content_repository.py migrate --source /cale/ScriptaHub/docs --output /cale/repo-nou --ids bk-id1,bk-id2 --commit <commit-sursă>
python3 tools/content_repository.py organize --root /cale/repo-cu-structura-veche
python3 tools/content_repository.py check --root /cale/repo-nou
```

`migrate` citește sursa și scrie într-un director nou, în structura lizibilă. `organize` convertește structura anterioară în același repo, păstrând conținutul și toate aliasurile vechi. `check` verifică metadatele, resursele și istoricul înainte de publicare. La editarea manuală se actualizează `resourceChecksums`, apoi amprenta `book.json` din index, în același push cu fișierele schimbate.

## Compatibilitate: schema 1

Sursele existente, inclusiv ScriptaHub original, rămân acceptate fără modificări. Pentru acestea agentul transmite paginile deja publicate.

### Structura publicată

```text
collection.json
books/
  <slug>/<bk-id>/
    manifest.json
    editions.json
    en/
      book.html
      full_content.html
      short_content.html
      book.pdf
      cover.webp
      thumbnail.webp
      assets/
    ro/
      book.html
      full_content.html
      short_content.html
      cover.webp
      thumbnail.webp
    <alte-limbi>/
      ...
```

`<slug>` poate avea mai multe segmente, ca în ScriptaHub existent. `<bk-id>` este stabil și are forma `bk-` urmată de litere mici sau cifre. Fișierele și directoarele pot varia dacă rutele din catalog sunt actualizate; toate resursele unei cărți trebuie să rămână sub propriul `books/.../<bk-id>/`. Imaginile, fonturile și CSS-ul conținutului folosesc URL-uri relative către fișiere publicate în același arbore.

`book.html` este pagina publicată de prezentare a cărții, compatibilă cu stilurile și scripturile comune ale agentului. `full_content.html` și `short_content.html` sunt documentele semantice încărcate de cititorul comun. Repo-ul nu trebuie să includă o copie a aplicației, directoarele globale `assets/`, `reader/`, formularele sau serverul agentului. Paginile de prezentare păstrează legăturile relative către aceste resurse ale agentului, ca în exportul ScriptaHub existent.

Manifestul, istoricul edițiilor, fișierele PDF și traducerile sunt publicate numai când există; catalogul nu trebuie să anunțe un fișier care nu a fost încă publicat. Paginile Editions și Contributors au nevoie de metadatele aferente când sunt folosite. Agentul nu regenerează conținut lipsă.

### Catalogul schemei 1

Se păstrează schema `collection.json` din ScriptaHub: obiect cu `schemaVersion: 1`, `bookCount` și `books`. `bookCount` trebuie să corespundă numărului de elemente din `books`. Fiecare carte folosește:

- `id` stabil și `directory`, de exemplu `books/example/bk-example`;
- metadatele afișate de interfață: `title`, `subtitle`, `shortDescription`, `category`, `group` și celelalte câmpuri existente;
- `keywordIds` și `keywords` pentru `en`, `fr`, `de`, `es`, `pt`, `it`, `ro`, `pl`, cu același număr de valori și aceeași ordine a ID-urilor în fiecare limbă;
- `editions.<limbă>.book` pentru pagina de prezentare și câmpurile `fullContent`, `shortContent`, `pdf`, `cover`, `thumbnail`, `sourceCover` pentru resursele disponibile;
- `coverUrl` și `thumbnailUrl` pe limbi, după schema existentă.

Rutele sunt relative la directorul care conține `collection.json`, nu la directorul unei ediții. De exemplu: `books/example/bk-example/en/full_content.html`. ID-urile și rutele trebuie să fie unice în toate sursele configurate. Metadatele și paginile de prezentare urmează limbile interfeței existente; un câmp `fullContent` sau `shortContent` se adaugă numai pentru o traducere disponibilă.

## Configurarea agentului

Forma recomandată este o listă de URL-uri către fișierul `collection.json`:

```json
{
  "schemaVersion": 1,
  "syncIntervalSeconds": 60,
  "repositories": [
    "https://raw.githubusercontent.com/Axiologic/scriptaBooks-1/master/collection.json",
    "https://raw.githubusercontent.com/Axiologic/scriptaBooks-legacy/master/collection.json"
  ]
}
```

Directorul care conține catalogul devine baza căilor relative către metadate și resurse. De exemplu, pentru `https://books.example.org/published/collection.json`, baza este `https://books.example.org/published/`. Catalogul poate descrie fie structura originală (schema 1), fie cărțile cu nume lizibile (schema 2).

Fiecare sursă este un URL direct care returnează JSON. Este acceptat și linkul GitHub copiat din browser, de exemplu `https://github.com/Axiologic/scriptaBooks-1/blob/master/collection.json`; agentul îl convertește în URL raw. Ramura rămâne cea scrisă în adresă. Căile relative se rezolvă față de acest URL. O eroare HTTP sau un catalog invalid păstrează catalogul activ.

## Publicare și actualizări

Flow-ul de publicare generează fișierele și actualizează `collection.json` în același push. Agentul verifică catalogul la intervalul `syncIntervalSeconds`; ETag evită retransmiterea catalogului când serverul răspunde cu 304. Modificarea listei sau metadatelor activează un nou catalog compus. Adăugarea unui director care nu este în catalog nu adaugă automat cartea în interfață.

La lectură, agentul transmite prin HTTP numai fișierele cerute. Acestea nu sunt păstrate în snapshot și depind de disponibilitatea serverului sursă. Pe ramuri mobile, fișierele urmează ramura publicată; pentru conținut fix, URL-ul catalogului poate indica un commit. Validarea catalogului verifică structura și rutele, fără să descarce sau să certifice anticipat toate fișierele cărții.

## Configurația curentă

Agentul încarcă 20 de cărți: 10 din `scriptaBooks-1` (schema 2) și alte 10 din `scriptaBooks-legacy` (schema 1, cu directoarele și fișierele originale). Rădăcina repo-ului legacy corespunde directorului publicat `docs/` din ScriptaHub; catalogul este filtrat la cele 10 cărți, iar fișierele cărților sunt identice cu originalul. `sources.json` păstrează URL-urile directe ale cataloagelor și intervalul de verificare. Cărțile și căile resurselor sunt descrise de manifestele din repo. ScriptaHub original rămâne nemodificat și nu este o sursă activă.

Agentul respinge ID-urile sau rutele duplicate între sursele active.
