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

Dashboardul din `account/dashboard.html` gestionează cărțile proprii, colaboratorii, propunerile, taskurile și istoricul. SQLite din `/data/dashboard.sqlite` este sursa stărilor; inboxul păstrează documentele și dovada semnată a contribuției, nu este o coadă de execuție. Cărțile din catalog aparțin administratorului inițial al instalării, identificat explicit de UserPersisto, iar cărțile create și fork-urile aparțin creatorului. Vezi [DASHBOARD.md](DASHBOARD.md) pentru contractul complet.

Crearea unei cărți sau o modificare trimisă de proprietar creează un task `queued`. O contribuție a altui utilizator creează o propunere `open`, fără task. Numai proprietarul o poate accepta sau respinge. Acceptarea și taskul sunt salvate în aceeași tranzacție, fără duplicate; aprobarea unei propuneri bazate pe o revizie depășită este refuzată. Proprietarul poate adăuga colaboratori după email, dacă acel cont s-a autentificat deja în ScriptaHub. Colaboratorii pot vedea spațiul cărții și propune modificări, dar nu pot aproba, acorda acces sau anula taskurile proprietarului.

Taskurile din coadă pot fi anulate, iar pentru cele în execuție proprietarul poate solicita oprirea cooperativă. Workflow-ul RoboTeam poate prelua manuscrise aprobate prin operațiile MCP interne ScriptaHub, cu identitate de serviciu Ploinky; robotul nu primește acces la SQLite sau datele private. Vezi DASHBOARD.md pentru configurare și protocol. Acceptarea unei modificări nu modifică automat cartea publicată. Contribuțiile din inbox create înaintea dashboardului rămân intacte și nu sunt reexecutate sau transformate automat în taskuri noi.

EmailAgent trimite aici numai confirmarea depunerii către adresa din cont, după înregistrarea contribuției în SQLite. Workerul reia notificările ratate după restart și ține un marker local pentru a evita repetarea obișnuită. Proprietarul ia decizia editorială în dashboard; notificările email de aprobare, respingere și rezultat nu sunt încă implementate. Recordul este semnat cu secretul agentului, astfel încât proveniența și documentele contribuției să nu poată fi schimbate în tăcere. Mesajele nu includ conținutul manuscrisului sau al sugestiei.

## Stadiu și limitări

Implementate: shell-ul separat, sincronizarea și compunerea catalogului din repo-uri, servirea rutelor, SSO UserPersisto și profilul delegat, upload-ul autentificat, taskul durabil și confirmarea prin EmailAgent. Verificate: testele locale pentru catalog, rollback, HTTP, upload, idempotency și notificarea de primire.

Primele 10 cărți sunt publicate în [scriptaBooks-1](https://github.com/Axiologic/scriptaBooks-1), în schema 2 cu resurse deduplicate și randare în agent. Configurația curentă încarcă 20 de cărți din două URL-uri de catalog: 10 în schema 2 din `scriptaBooks-1` și alte 10, cu structura originală în schema 1, din [scriptaBooks-legacy](https://github.com/Axiologic/scriptaBooks-legacy). Manifestele repo-urilor descriu cărțile și resursele; nu sunt necesare excluderi sau liste de ID-uri în agent. ScriptaHub original rămâne nemodificat.

Protocolul de execuție MCP este implementat și testat automat; activarea manifestului și testarea unei publicări reale prin workflow într-un Box Ploinky rămân verificări de deployment distincte. Testul E2E SSO/EmailAgent într-un Box Ploinky rămâne de executat. EmailAgent nu oferă cheie idempotentă pentru mesaje, deci o oprire exact între trimitere și salvarea stării poate produce o confirmare duplicată. Nu s-a procesat niciun task pe cărți reale și nu s-a trimis niciun email real.

## Verificare

```sh
cd scriptahubAgent
npm test
node --check server.mjs
node --check sync.mjs
node --check submissions.mjs
node --check site/assets/workflow-bridge.js
```

## Summary reading time

Comprehensive summaries have a fixed target reading time of **10 minutes**. This is not configurable in settings, task instructions or the workflow. ScriptaHub supplies `processingSettings.summaryReadingMinutes` when claiming a manuscript, separately from task-authored values.

Manuscript publication belongs to `scriptahubAgent`, not to the RoboTeam robot. Configure **ScriptaHub Settings → Manuscript publication** by connecting GitHub or saving a token through the existing Git authentication flow; new tasks require readable publication access. The workflow submits the exact independently validated package, and ScriptaHub alone commits, pushes to a configured GitHub catalogue and marks the task completed. See [service-owned publication](DASHBOARD.md#service-owned-manuscript-publication) for authorization, transfer limits, cancellation and interrupted-publication recovery. Restart the agent through Ploinky after changing its manifest/MCP tools; reload the updated workflow and robot skill before a new run. No credentials are bundled in the repository.

When adding MCP tools, restart the Router with `ploinky restart router` as well: its persisted tool-policy defaults are registered at Router boot. Restarting only `scriptahubAgent` does not register new tool names. Existing administrator policy entries remain authoritative. Publication authentication is administrator-only; package transfer and publication tools are internal service calls.


### Publication access

Configure Git author identity and GitHub sign-in or a personal access token in **ScriptaHub Settings → Publication**. ScriptaHub owns authentication, encrypted private storage and Git publication; it does not require DPUAgent or GitAgent. `SCRIPTA_GITHUB_CLIENT_ID` optionally selects the deployment's GitHub OAuth app, with device flow enabled. Public catalogue URLs and refresh settings stay separate from credentials. Back up `.data/scriptahubAgent/private/publication/` including its key. Existing DPU-backed access is not imported: reconnect once in ScriptaHub Settings after deploying this refactor. See [DASHBOARD.md](DASHBOARD.md) for publication authorization and recovery rules.


### Manuscript workflow

The RoboTeam workflow definition belongs to this agent: [`scriptahubAgent/flows/add-book.json`](scriptahubAgent/flows/add-book.json). RoboTeam's existing workspace discovery reads `<repository>/<agent>/flows/`; no separate `scripta-flow` repository or duplicate definition is needed. The workflow ID is `add-book`, derived from its filename. Schedules must select that workflow ID. Existing runs retain their captured graph; new runs read the current definition.

## Agent-owned skill runtime

All thirteen skills, including document conversion, editorial processing, validation, presentation creation and theatrical audio, belong to `scriptahubAgent/skills/`; see [the catalogue](SKILLS.md). Installed npm packages, native libraries, models, Python environments and caches are not source files and are not committed.

Build the dedicated runtime image with the ScriptaHubAgent repository as context and `container-image-builds/images/scriptahub-agent/Dockerfile` as the Dockerfile. It installs locked npm packages, the declared native PDF/model assets (verified by SHA-256), Poppler, QPDF, LibreOffice, Ghostscript, Chromium, FFmpeg and the configured CPU audio environments. Cloud narration providers still require their own authorized account credentials; the deployment does not fabricate accounts or silently select another provider.

The manifest selects `docker.io/assistos/scriptahub-agent:runtime`. Before local deployment, build that tag in the same Podman image store used by Ploinky's agents (inside the Box when using a Box). A local build does not publish the image: a different server needs the image built there or a separately published, verified image. Changing the manifest does not switch an already running agent from isolated to global mode; use Ploinky's supported enable lifecycle while preserving its data.

The current verified PDF native assets support Linux ARM64. Other architectures are refused until matching native assets and runtime proof are provided. The same Linux image runs on an ARM64 Linux host or the Linux Podman VM on Apple Silicon.

Ploinky starts this agent in `global` mode. Startup compares every deployed skill source against the image's captured source manifest and refuses a mismatched or missing runtime. No manuscript execution installs or repairs dependencies. Rebuild the image after changing skill sources.

Skills execute locally in the robot through its existing ALA sandbox and skill mounts. No `skillExecution` graph extension, private socket or `agentExec` permission is used. The ScriptaHub task helper calls the installed local CLI, checks the platform and source hashes, and preserves process output and exit status. Service calls remain limited to authenticated task/document access and publication.

The robot also needs the libraries and system tools; the application image does not expose its installed filesystem to another container. Build the robot profile from this repository:

```sh
podman build --layers -f scriptahubAgent/deployment/Dockerfile.robot -t scriptahub-robot:local .
```

Use the Podman image store managed by the deployment (inside the Box when applicable). The profile extends the existing RoboTeam runtime, preserves its Podman contract, reuses downloaded model/native assets from the matching ScriptaHub image, installs its own platform-compatible libraries at build time and runs all configured runtime checks. Build ScriptaHub first; use `--build-arg SCRIPTA_RUNTIME_IMAGE=<verified image>` to select its exact prepared image. Python environments and system executables are never copied between the Debian application image and the Fedora robot image. It does not start or modify a live agent. For local adoption, tag the verified image as the existing `docker.io/assistos/roboteam-agent:runtime` in that same image store, then run `ploinky restart roboTeamAgent`. This changes the local runtime image, not the agent source or registry image. Keep the upstream base image ID before retagging and supply it as `--build-arg ROBOTEAM_BASE_IMAGE=<image ID>` on subsequent builds. Publishing an image and restarting a running agent are separate deployment operations. Keep the source revision identical between the robot image and the deployed ScriptaHub skill catalogue. Rebuild both prepared images after changing skill sources; source mismatch is an error, never permission to install packages during a workflow.

`edit-book` validates approved suggestions with `validate-book compare-edition`: an immutable original HTML edition is compared with the edited HTML in standalone and ScriptaHub reader layouts. It blocks new content loss, overwritten images, overlap, clipping, hidden content and broken resources. Existing layout findings are reported separately; historical PDF fidelity and untouched translations are outside this edit check. Publication of an edit requires this specific regression-check scope and zero new errors. The runtime includes the deployed reader stylesheet and startup verifies that it matches the application.

### Repository source and external build inputs

The repository keeps authored skill code, dependency manifests/lockfiles, immutable asset references and checksum inventories. Upstream Rust sources under `external/docling-source/`, copied notices under `external/native/licenses/`, installed libraries, native binaries and model downloads are ignored by Git and excluded from the image build context. They must not be force-added to a commit.

The normal application/robot image build downloads the already compiled, pinned PDF engine; it does not compile Docling. Its complete notice set, including the Docling license, is restored from the pinned source and checked against `deployment/native-notices.json` during image preparation. An optional developer rebuild with `build-native.mjs` requires obtaining the matching external Docling workspace separately; that local checkout remains ignored.

Runtime source fingerprints exclude these external source/notice trees. Rebuild both prepared images after adopting this packaging change so their captured source inventories match a clean checkout; do not edit installed receipts to bypass the deployment checks. No publication credential or installed runtime belongs in Git.
