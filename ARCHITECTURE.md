# ScriptaHubAgent: arhitectură și contract

## Sursa analizată

Shell-ul provine din [Axiologic/ScriptaHub](https://github.com/Axiologic/ScriptaHub), commit `445a2ceabc0a63835e5abd1b287289e85e3c56aa`. ScriptaHub servește pagini statice din `docs/`, catalogul `collection.js`, cititorul și cărțile la `books/<titlu>/bk-<id>/`. Formularul original termina în `mailto:` și păstra numai numele fișierelor selectate; nu încărca manuscrisul. Agentul păstrează rutele și aspectul, iar conținutul cărților vine prin HTTP din sursele publice configurate în `sources.json`, fără clone sau checkout Git. Structura unui repo de conținut este descrisă în [CONTENT-REPOSITORY.md](CONTENT-REPOSITORY.md).

Sincronizarea periodică cere `collection.json` și, pentru schema 2, metadatele cărților noi sau modificate, folosind ETag pentru răspunsuri neschimbate, validează metadatele și activează atomic catalogul compus și `remote-books.json` din directorul privat al snapshotului. În schema 2, paginile de prezentare și Animation sunt generate în agent, iar manifestul și istoricul sunt servite din `book.json`. Maparea `resources` trimite URL-urile vechi la fișierele cu nume lizibile din directorul fiecărei cărți și la asseturile comune. SHA-256 rămâne în metadate pentru verificare. În schema 1, paginile publicate rămân transmise de la sursă. Fiecare rută `books/...` este mapată la sursa ei; serverul descarcă și transmite fișierul cerut fără să-l copieze în snapshot. Resursele relative rămân pe aceeași origine cu cititorul. HEAD și Range sunt transmise sursei, iar formularul Animation primește adaptorul de contribuții autentificate. O eroare de catalog păstrează snapshotul anterior; o eroare a unui fișier cerut la lectură răspunde cu 404/502. Metadatele sunt validate la sincronizare, iar existența fișierelor se verifică la acces. Publisherul actualizează catalogul la schimbarea listei sau metadatelor; fișierele servite din ramuri mobile pot evolua independent de catalog.

## Limita agentului

```text
Browser → Router SSO → ScriptaHubAgent → /data/inbox/<submissionId>/record.json
                                  └──────→ /data/inbox/<submissionId>/<fișiere>

Cron job extern → taskuri pending → RoboTeam/flow-uri/skilluri/aprobare/publicare
                              └────→ EmailAgent pentru decizie și rezultat
```

Cititorul este public. Create, Fork, Suggest, traducerea, cererea de animație și Librarian Feedback cer cont UserPersisto activ. Routerul semnează identitatea și deleagă `identity:read`; serverul ia numele afișat și adresa de email din profil, nu din formular. Documentele trec prin IndexedDB în pagina de acord, apoi printr-un upload multipart autentificat. Acceptă DOC, DOCX și PDF, cu limite de număr și mărime, verificarea semnăturii de fișier și SHA-256. Numele original este numai metadată.

Un formular valid creează un record semnat, cu `state: pending` și `task: { schemaVersion: 1, id, type }`. `id` este UUID-ul depunerii și cheia de deduplicare; `type` este `scriptahub.manuscript`, `scriptahub.book-proposal`, `scriptahub.fork`, `scriptahub.edit`, `scriptahub.animation`, `scriptahub.translation` sau `scriptahub.librarian-feedback`. `metadata` păstrează câmpurile formularului, limba și identificatorul cărții, când există. `files` păstrează nume, dimensiune implicită prin fișier și SHA-256. Fișierele sunt în același director privat. Scrierea `record.json` încheie publicarea taskului; cron jobul ignoră directoarele fără record valid. Retrimiterea identică întoarce aceeași chitanță; o retrimitere diferită cu același ID primește 409. `GET /api/submissions/<id>` cere proprietarul contului.

ScriptaHub nu alege skilluri, nu instalează grafuri, nu lansează RoboFlow și nu urmărește starea lui. Cron jobul consumator decide maparea tipului de task la flow, gestionează human in the loop pentru sugestii și publică rezultatele validate în repo-urile de carte. Contractul lui trebuie să păstreze proveniența, să evite suprascrierea edițiilor și să trateze `task.id` idempotent. Pentru notificările de aprobare, respingere și rezultat, consumatorul folosește EmailAgent și adresa contului din record; nu acceptă email din inputul utilizatorului.

ScriptaHub trimite prin EmailAgent doar confirmarea de primire. Un worker citește recordurile verificate și reia confirmările care nu au marker în `notification-state.json`. Trimiterea și scrierea markerului nu sunt o tranzacție atomică, deci un crash între ele poate dubla mesajul. Datele de contact și taskul sunt acoperite de HMAC-ul recordului.

## Verificare și lucrări separate

Testele locale acoperă compunerea catalogului, rollback-ul unei surse invalide, upload-ul autentificat, idempotency, protecția contactului și confirmarea. Mai sunt necesare în mediul Ploinky: un test SSO real, o trimitere EmailAgent reală, cron jobul consumator, integrarea lui cu RoboTeam și continuarea migrării cărților în repo-uri publice dedicate. Primele 10 cărți sunt deja în `scriptaBooks-1`; sursa ScriptaHub rămâne nemodificată. URL-urile de repo și destinațiile de publicare sunt configurația operatorului.
