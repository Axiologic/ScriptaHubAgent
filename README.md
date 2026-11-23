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

RoboTeam commits and pushes the independently validated book using the assigned robot’s Git identity and GitHub credentials. ScriptaHub checks the configured destination and confirms the remote commit before completing the task. See [robot publication](DASHBOARD.md#robot-publication) for authorization, transfers, cancellation and recovery. Reload the agent’s MCP configuration and the robot’s updated skill before a new run.

When adding MCP tools, restart the Router with `ploinky restart router` as well: its persisted tool-policy defaults are registered at Router boot. Restarting only `scriptahubAgent` does not register new tool names. Existing administrator policy entries remain authoritative. Package transfer and publication tools are internal service calls.


### Publication access

In RoboTeam, configure Git credentials on the robot assigned to the publication step. Set its Git author name and email, and give its GitHub credential write permission on the configured public content repositories. ScriptaHub Settings contain catalogue URLs and the refresh interval.


### Manuscript workflow

The RoboTeam workflow definition belongs to this agent: [`flows/add-books.json`](flows/add-books.json). RoboTeam's existing workspace discovery reads `<repository>/flows/`; no separate `scripta-flow` repository or duplicate definition is needed. The parent workflow ID is `add-books`, derived from its filename. Cron jobs must select `add-books`. The service taskType remains `add-book`; it names the request kind, not the workflow. It reserves and traverses the batch through RoboTeam’s native Run workflows node. Each item invokes [`flows/create-book.json`](flows/create-book.json), workflow ID `create-book`, with the claimed execution identity and durable task directory. The child never claims another task and ends after the single-book result. The parent confirms the service state before selecting another item. The creator enables continueOnChildFailure so failed/terminated children go to per-item reconciliation rather than failing the whole batch. Manual pauses remain blocking. The child must be called by the parent, not scheduled separately. Existing runs retain their captured graph; new runs read the current definition.

The Create form can submit a description and optional editorial instructions without an attachment. For these proposals, RoboTeam writes a private generation brief, generates the full book in HTML without DOCX/PDF conversion. Generated books and forks use strict native HTML/reader integrity checks; a supplied PDF manuscript remains the authoritative source for PDF-to-HTML checks. With an attachment, the workflow continues from the uploaded manuscript. The same `add-books` schedule picks up both kinds of task and runs them through the existing editorial and publication checks.

## Agent-owned skill runtime

All thirteen skills, including document conversion, editorial processing, validation, presentation creation and theatrical audio, belong to `skills/`; see [the catalogue](SKILLS.md). Installed npm packages, native libraries, models, Python environments and caches are not source files and are not committed.

Two images carry this work. Their Dockerfiles and publishing workflows live in `container-image-builds`.

| Image | Contents | Dockerfile |
| --- | --- | --- |
| `docker.io/assistos/scriptahub-assets` (multi-architecture, `FROM scratch`) | Only downloaded model and native files: the Docling models, the native PDF engine, its notices, the Eigen archive and the Kokoro, Qwen and Piper models. Each file is checked by SHA-256 against inventories committed here. | `container-image-builds/images/scriptahub-assets/Dockerfile` |
| `docker.io/assistos/scriptahub-agent:runtime` | ScriptaHub service and the installed skill dependencies (node_modules, Python environments, native files, models, notices), with verified assets. It also keeps a transition copy of the skill source, `source.json` and the legacy source labels so a deployment can roll back to older service code; the sandbox never executes that copy. | `container-image-builds/images/scriptahub-agent/Dockerfile` |

The agent image uses the digest-pinned assets image and verifies its native and model inventories before copying. The service hosts the skill runtime, which runs skills from the deployed checkout, not from the image (see below). RoboTeam uses its normal runtime and calls the service through authenticated MCP; it does not need the ScriptaHub native dependencies. The helper records each job before upload and checks downloaded hashes before merging results into the selected task directory. Reconcile a pending job before starting a different command.

`edit-book` remains the scheduled batch workflow for editions and delegates each request to [`edit-edition`](flows/edit-edition.json). The child applies the approved snapshot, prepares the sparse package, independently audits each affected language with `validate-book compare-edition`, then submits the approved inventory. Existing layout findings are warnings; new regressions block the whole edition. A failed or deferred edition is reconciled separately so the batch can process its other items. Both create and edit bind approval to the exact inventory and resume an interrupted upload with the same approved files.

### Repository source and external build inputs

The repository keeps authored skill code, dependency manifests/lockfiles, immutable asset references and checksum inventories. Upstream Rust sources under `external/docling-source/`, copied notices under `external/native/licenses/`, installed libraries, native binaries and model downloads are ignored by Git and excluded from the image build context. They must not be force-added to a commit.

The assets image build compiles the Docling addon on AMD64 in a pinned Rust stage and takes the checksum-verified ARM64 addon from the inventory; the agent build uses the verified assets. Its complete notice set, including the Docling license, is restored from the pinned source and checked against `deployment/native-notices.json`. An optional developer rebuild with `build-native.mjs` requires obtaining the matching external Docling workspace separately; that local checkout remains ignored.

Runtime source fingerprints exclude these external source/notice trees. Do not edit installed receipts to bypass the deployment checks. No publication credential or installed runtime belongs in Git.

#### Skill source mount and dependency fingerprint

Skills run from a service-private, hash-verified snapshot of the deployed ScriptaHubAgent checkout. The service finds the checkout through the global-mode workspace bind by matching its own `/code` directory, copies the skill sources into the snapshot and verifies their hashes. The sandbox binds the snapshot read-only at `/opt/scriptahub/runtime` and binds the image's installed dependencies (node_modules, Python environments, native files, models, notices) read-only at the same paths. A skill source or `SKILL.md` change therefore needs a restart or redeploy of the checkout, not an image rebuild. The manifest must stay in global mode; the discovery was checked for a top-level Podman bind on the Mac and on apparatus, and is not verified inside Ploinky Box.

The image must still match the checkout's dependencies. The dependency fingerprint is a SHA-256 over the header `scriptahub-dependency-fingerprint-v1` and one `<git blob id> <path>` line per file of the committed list [`scriptahubAgent/deployment/dependency-inputs.txt`](scriptahubAgent/deployment/dependency-inputs.txt), in list order (v1 definition in `dependency-fingerprint.mjs`). Print it with:

```
node scriptahubAgent/deployment/dependency-fingerprint.mjs .
```

Rebuild and publish the agent image only when this fingerprint changes. The image records the value in `/opt/scriptahub/runtime/dependencies.json` and in the label `io.assistos.scriptahub.dependency-fingerprint`. Preflight fails with a message to rebuild the image when the value differs from the checkout's, and with "predates mounted skill sources" when the image has no such receipt. Do not edit the receipt or the label to pass these checks.

The per-skill `sourceDigest` check (HTTP 409) now confirms that what RoboTeam hashed is what the agent executes. On deployments both read the same workspace checkout, so executed skill code is no longer tied to a published image revision. To compare a deployment with a commit, recompute the preflight receipt's `sourceDigests` with `skillSource()` from a clean checkout of the deployed commit.

Any edit to the checkout changes the runtime identity. Jobs prepared before the edit get 409 at start, and preflight answers 503 while a job is running until it ends.

Create book runs the editorial stages in sequence. It builds and validates the comprehensive summary, completes keyword selection, saves a common analysis of safe hooks, themes and protected revelations in `tasks/<taskId>/editorial/shared-analysis.json`, then drafts and validates the presentation and short description individually from that analysis. Each stage uses the same pinned full HTML. Completed analysis batches and validated artifacts are reused on resume when their hashes and evidence match. Requested translations follow the editorial checks and consume the accepted resources. Existing runs retain their captured graph. Deploy the workflow and task helper together for new runs.

Parent/child publication recovery: `create-book` checks the existing service state on entry. A terminal execution returns its saved outcome; an existing pending publication resumes publication without book regeneration. Both flows use the same working directory and each request retains `tasks/<taskId>`. Only the parent owns batch-start/next/close/defer. When one child fails or cannot run, the parent records a service failure when safe, otherwise durably defers that item. It then processes the remaining books. Closing traversal with retainActive preserves active deferred reservations and execution identity, so uncertain publication/processing is not retried or claimed by another batch. A later batch can reserve new requests. The summary reports failed and deferred books separately from confirmed publications. Manual pauses and shared infrastructure failures remain explicit operator conditions.

`create-book` has one linear success path: read request → prepare/generate → editorial assets → prepare package/cover → independent validation → publish → single-book result. There are no recovery/failure shortcuts to Publish and no backward validation edge. The only conditional branch after editorial assets visits Translate resources for explicit nonempty target languages, otherwise it goes directly to package preparation. A real content/validation failure stops only the child; add-books finalizes or defers that item and continues the batch. Entry status selects an explicit process/terminal/publication-recovery/cancel mode. Non-processing modes pass existing context through the content steps without regeneration, repeated acceptance checks or invented approval; Publish alone reconciles the already registered publication or cancellation. Normal publication still requires the exact independent validation evidence.

Translation is a separate conditional step. Only explicit user-requested target languages enable it; UI/catalogue languages and a primary/source-language mismatch alone do not. Editorial output creation consumes the full original book; translation then consumes the accepted book, summary, presentation, short description, keywords and reader-facing metadata as separate source resources. Each resource is translated, never regenerated from the translated book. Native translate-html handles HTML directly without PDF generation; text keywords/metadata use private escaped HTML adapters with stable field mapping and verified extraction. The package/audit require complete validated resource sets for the source and only successful target editions; failed targets are omitted and reported, never published as partial files. With no request, the graph bypasses translation and creates no translation manifests/jobs/files.

Requested translations are independent optional outputs. For a generated book requested in EN/RO/ES, EN is authored once, then RO and ES consume the original book/editorial resource set independently and may run concurrently within the four-worker limit. Target-only failures do not fail the book: publish EN and any complete validated target editions. The final validation carries a checked translationOutcome listing requested/published/omitted languages and real reasons. ScriptaHub binds that report to actual packaged languages and retains a partial-completion warning in the task result and completion email even when a contribution reward is also issued. Outstanding translation jobs must be safely cancelled/retained/released before publication; source-integrity failures and shared infrastructure outages are never hidden as success.


## Shared batch runtime

The editorial and translation skills import one [batch admission module](skills/scriptahub-tasks/shared/batch-io.mjs). Distribute the selected skill folders alongside `skills/scriptahub-tasks/shared/`; no generated copies or synchronization command are required. Each skill retains its schema adapter and declares its shared source dependency. Image preparation and processing admission include that dependency in source fingerprints.
