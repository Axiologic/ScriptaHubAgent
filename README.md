# ScriptaHubAgent

Agent Ploinky pentru catalogul și cititorul ScriptaHub. Shell-ul din `scriptahubAgent/site/` provine din [Axiologic/ScriptaHub](https://github.com/Axiologic/ScriptaHub) la `445a2ceabc0a63835e5abd1b287289e85e3c56aa`; catalogul și cărțile sunt încărcate prin HTTP din sursele din `scriptahubAgent/sources.json`. Agentul nu clonează repo-urile și nu descarcă anticipat conținutul cărților. [ARCHITECTURE.md](ARCHITECTURE.md) descrie traseele complete și limitele implementării.

## Configurarea surselor

În Explorer, autentificat ca administrator, deschide **Settings → ScriptaHub → Configure** (sau Configure din lista agenților). Fiecare repository apare separat, cu nume, URL și butoane **Edit** și **Delete**. **Add repository** adaugă o sursă nouă; editarea poate fi încheiată cu **Done** sau anulată cu **Cancel**. Poți schimba și intervalul de actualizare în secunde. Toate modificările se aplică prin **Save changes**. Sunt acceptate URL-uri raw și linkuri GitHub `/blob/`. La Save, agentul validează cataloagele, metadatele și unicitatea cărților înainte să salveze; o eroare păstrează configurația anterioară. Modificările se aplică automat, fără restart.

Setările salvate din Configure sunt persistente în `/data/sources.json` și au prioritate față de `scriptahubAgent/sources.json`, care rămâne configurația inițială. În workspace-ul local, fișierul persistent este `.data/scriptahubAgent/sources.json`. Dacă Configure nu apare după actualizarea agentului, reîncarcă pagina Explorer.

La prima instalare a acestei funcții într-un workspace deja pornit, rulează `ploinky restart` din workspace: Routerul înregistrează la pornire permisiunile noilor tool-uri MCP. Un restart numai al agentului nu este suficient pentru această înregistrare și poate lăsa Configure cu mesajul „Access denied”. Schimbările ulterioare ale surselor din Configure nu necesită restart.

Sursele active sunt URL-uri directe către `collection.json`, descrise în [CONTENT-REPOSITORY.md](CONTENT-REPOSITORY.md). De exemplu:

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

Fiecare intrare este URL-ul direct al unui fișier JSON. Este acceptat și linkul GitHub copiat din browser, de exemplu `https://github.com/Axiologic/scriptaBooks-1/blob/master/collection.json`; agentul îl convertește în URL raw. Ramura rămâne cea scrisă în adresă. Căile relative din catalog se rezolvă față de acel URL, conform regulilor HTTP obișnuite. ID-urile și rutele cărților trebuie să fie unice între surse.

La `npm start`, agentul servește imediat ultimul snapshot bun (sau un catalog inițial gol), verifică sursele la pornire și apoi la intervalul `syncIntervalSeconds` din configurația activă (implicit 60 de secunde, număr întreg, minimum 1 secundă). De exemplu, `"syncIntervalSeconds": 300` verifică la fiecare 5 minute. Setarea din Configure se aplică automat. Variabila de mediu `SCRIPTA_SYNC_INTERVAL_MS`, dacă este definită, are prioritate și exprimă intervalul în milisecunde (minimum 1000 ms). Agentul cere indexul prin HTTP, cu ETag când sursa îl oferă; pentru schema 2 încarcă și metadatele cărților noi sau modificate și verifică hashurile lor. Dacă metadatele s-au schimbat, validează structura și rutele, reface `collection.json`/`collection.js` și activează atomic noul catalog și maparea URL-urilor. O sincronizare eșuată păstrează catalogul anterior. Publisherul trebuie să actualizeze `collection.json` la adăugarea, eliminarea sau modificarea metadatelor unei cărți; un fișier nou neînregistrat în catalog nu este descoperit automat. Paginile Home și All Books deja deschise verifică și reîncarcă lista când aceasta se schimbă.

Pentru schema 2, agentul randează paginile de prezentare din metadate și păstrează URL-urile originale. Conținutul brut, PDF-urile, imaginile și celelalte resurse ale cărților sunt servite prin rutele locale `books/...`, încărcate la cerere din URL-ul public. Nu sunt copiate în snapshot. Resursele relative și cititorul ScriptaHub își păstrează rutele, iar PDF-urile pot folosi cereri Range dacă serverul sursă le acceptă. Fișierele indisponibile răspund cu 404/502; validarea catalogului nu certifică existența sau conținutul fiecărui fișier. Catalogul rămâne disponibil la o cădere a sursei, dar lectura necesită acces la sursa HTTP. Pe ramuri mobile, fișierele urmează conținutul publicat pe acea ramură; pentru o ediție imuabilă, URL-ul catalogului poate indica un commit.

## Editare locală în Explorer

Din workspace-ul Ploinky, deschide [Explorer local](http://127.0.0.1:8080/explorer/index.html) și autentifică-te. Arborele de fișiere include ambele directoare locale:

- `ScriptaHub/` este checkout-ul public original și referința pentru interfață. Agentul citește catalogul și cărțile prin HTTP, din sursa configurată în `sources.json`.
- `ScriptaHubAgent/scriptahubAgent/site/` este interfața adaptată pentru autentificare și taskuri. Editează aici `assets/workflow.js`, `assets/workflow-bridge.js`, HTML, CSS și celelalte fișiere pe care vrei să le vezi în [ScriptaHub local](http://127.0.0.1:8080/base-agent-additional-server/scriptahubAgent/3002/).

În profilul Ploinky local, `SCRIPTA_DEV_LIVE=1` servește aceste fișiere direct din checkout. Salvează în Explorer și reîncarcă pagina. Catalogul generat și maparea surselor rămân din snapshotul validat, iar conținutul cărților vine prin HTTP la cerere. Pentru o instanță care trebuie să servească interfața exclusiv din snapshot, setează `SCRIPTA_DEV_LIVE=0`.

Pentru verificare locală cu o configurație proprie:

```sh
cd scriptahubAgent
SCRIPTA_CONFIG=/cale/absolută/sources.json SCRIPTA_DATA_DIR=/cale/absolută/date npm start
```

`GET /health`, `/index.html`, `/collection.json` și rutele `books/...` sunt servite pe portul 3002. Manifestul folosește SSO Ploinky cu UserPersisto, ca Bizanso: cititorul este public, iar formularele Create, Fork, Suggest, traducere și feedback sunt accesibile doar utilizatorilor autentificați. `GET /api/session` arată identitatea contului folosit pentru contribuție.

## Navigație

Antetul folosește pictograme uniforme pentru Home și All Books, Create ca acțiune principală, preferințele grupate și contul la final. Pe ecrane înguste, setările dimensiunii textului se deschid din controlul Aa; se închid prin Escape sau click în afară. Dimensiunea poate fi ajustată între 80% și 150%, cu pas de 5%; procentul afișat resetează la 100%. Dimensiunea, tema și limba se salvează pentru vizitele următoare.

## Contul meu

Legătura „Contul meu” este disponibilă în antetul site-ului și în cititor. Pagina `account/index.html` cere autentificare Ploinky și integrează panoul My Account al UserPersisto într-un iframe, ca în Bizanso. Identitatea, setările de autentificare și securitate și deconectarea sunt afișate direct în panoul UserPersisto, fără controale duplicate în pagina ScriptaHub. ScriptaHub nu gestionează parole sau metode de autentificare proprii.

## Contribuții și taskuri

Formularele existente `Create`, `Fork`, `Suggest an Edit`, animație și traducere își păstrează structura, dar cer doar informațiile contribuției: documente, titlu și instrucțiuni pentru Create; schimbarea propusă și sursele pentru Suggest. Nu mai cer nume, email de răspuns sau URL promoțional. Serverul verifică cererea semnată de Router, citește profilul activ UserPersisto prin delegare și păstrează ID-ul și adresa contului; datele de contact introduse într-un payload sunt respinse. Fișierele selectate sunt ținute local în IndexedDB până la acceptarea acordului, apoi sunt încărcate în `POST /api/submissions`. Serverul verifică tipul și limita fișierului și stochează conținutul sub `/data/inbox/<submissionId>`. Formularul Librarian Feedback folosește același mecanism.

Fiecare formular acceptat creează exact un record `record.json` cu `state: pending` și `task: { schemaVersion: 1, id, type }`; tipul este `scriptahub.<kind>`. Recordul conține datele formularului, identitatea contului, numele și SHA-256 ale fișierelor, iar fișierele sunt în același director privat. `submissionId` este cheia idempotentă: retrimiterea identică returnează aceeași chitanță, iar o retrimitere diferită cu același ID este respinsă. `GET /api/submissions/<id>` este accesibil doar proprietarului. Un cron job extern poate citi taskurile `pending` din inbox și poate gestiona flow-uri RoboTeam, aprobări umane, publicare și rezultatul final. ScriptaHub nu pornește sau urmărește flow-uri.

EmailAgent trimite aici numai confirmarea depunerii către adresa din cont. Workerul reia notificările ratate după restart și ține un marker local pentru a evita repetarea obișnuită. Cron jobs care iau decizia editorială trimit separat prin EmailAgent notificările de aprobare, respingere și rezultat; ScriptaHub nu deduce aceste decizii din starea unui flow. Recordul este semnat cu secretul agentului, astfel încât contactul și taskul să nu poată fi schimbate în tăcere. Mesajele nu includ conținutul manuscrisului sau al sugestiei.

## Stadiu și limitări

Implementate: shell-ul separat, sincronizarea și compunerea catalogului din repo-uri, servirea rutelor, SSO UserPersisto și profilul delegat, upload-ul autentificat, taskul durabil și confirmarea prin EmailAgent. Verificate: testele locale pentru catalog, rollback, HTTP, upload, idempotency și notificarea de primire.

Primele 10 cărți sunt publicate în [scriptaBooks-1](https://github.com/Axiologic/scriptaBooks-1), în schema 2 cu resurse deduplicate și randare în agent. Configurația curentă încarcă 20 de cărți din două URL-uri de catalog: 10 în schema 2 din `scriptaBooks-1` și alte 10, cu structura originală în schema 1, din [scriptaBooks-legacy](https://github.com/Axiologic/scriptaBooks-legacy). Manifestele repo-urilor descriu cărțile și resursele; nu sunt necesare excluderi sau liste de ID-uri în agent. ScriptaHub original rămâne nemodificat.

Nerealizate încă: cron jobul consumator și testul E2E SSO/EmailAgent într-un Box Ploinky. Cron jobul trebuie să deduplice după `task.id`, să proceseze doar taskurile verificate din inbox și să trimită evenimentele de aprobare/respingere prin EmailAgent. EmailAgent nu oferă cheie idempotentă pentru mesaje, deci o oprire exact între trimitere și salvarea stării poate produce o confirmare duplicată. Nu s-a procesat niciun task pe cărți reale și nu s-a trimis niciun email real.

## Verificare

```sh
cd scriptahubAgent
npm test
node --check server.mjs
node --check sync.mjs
node --check submissions.mjs
node --check site/assets/workflow-bridge.js
```
