# Book dashboard

The authenticated `/account/dashboard.html` page owns My books, Change requests, Tasks and History. Account security remains on `/account/index.html` in UserPersisto. The catalogue and reader remain public.

The manifest declares `routerAccess.entryPath` as the public server entry. Ploinky validates that declaration against the agent's enabled HTTP routes and uses it when the application is selected for the Router root. The embedded account's sign-out link derives its return destination from the deployed application root and retains the current account page separately for Cancel. Agent-port mounts include their auth selector; dedicated hosts retain the Router's host-bound context. Authentication and logout mutation proofs remain Router-owned.

## Ownership and access

The delegated UserPersisto profile supplies `installationAdministratorId`, the identifier persisted when installation setup completed. ScriptaHub never selects the first visitor, an email address or an arbitrary member of the admin role. Catalogue books are registered once with this owner on authenticated requests; missing provider metadata refuses attribution explicitly. Later catalogue refreshes never replace ownership. New books and forks belong to the authenticated creator, and forks retain their source book ID.

The owner can grant or revoke collaborator access by exact account email. The target must first sign in to ScriptaHub so its verified provider ID is known locally. Collaborators can read private book history, proposals and documents and submit changes; they cannot approve proposals, cancel tasks or manage collaborators. Any authenticated reader can propose a change to an imported public book. Proposal authors can inspect their own submission and its documents after access is revoked, but cannot read other private submissions or submit new changes to the private book.

Access events record the acting account and the recipient separately. Edition submission records the book owner as its actor. Display names (or verified account emails when names are empty) are resolved for presentation; authorization continues to use stable provider IDs. Existing events without a recorded recipient remain explicitly unidentified. Repeated access requests that do not change access do not create activity events.

## Changes and tasks

Submission UUIDs are idempotency keys. Immutable HMAC-signed intake records and document SHA-256 hashes remain in the private inbox. Database registration occurs after complete file publication; retrying the same submission recovers database registration if interrupted. Altered replays are rejected. Only approved SQLite tasks are eligible for execution; receipt files are not execution instructions.

The shared browser/server upload policy allows up to eight PDF, DOC or DOCX documents, 50 MB per document and 100 MB total (decimal bytes). The request reader allows an additional bounded 1 MiB for multipart metadata. The server independently validates sizes and document signatures. Returning from the agreement page carries the stored document bytes into the next draft; missing draft files stop submission explicitly. Validation failures allow retry, while successful submissions remain terminal. Browser UUIDs use Web Crypto randomness without requiring `randomUUID`, so they also work on HTTP LAN deployments. This does not relax Ploinky authentication, browser secure-context requirements for other features, or server authorization.

The dashboard follows the existing `scriptahub:language` event for all eight supported languages and preserves form input when language changes. Browser API URLs are resolved relative to the deployed script location, retaining the Ploinky route prefix and current origin without embedding a deployment hostname, IP or port.

An owner submission is accepted immediately. Another user's submission starts `open`; the book owner or any workspace administrator can accept or reject it, including an administrator reviewing their own contribution. Review preserves decisions on individual annotations. Approving an existing-book change does not create a task or increase the book revision. Several requests can therefore be reviewed against the same published revision.

Any authenticated user with access to a book uses **Request a new edition** or **Submit new edition** to queue one edit task containing all approved requests not already queued, running or published. Task membership and immutable request snapshots are written together in an immediate transaction. The client supplies a UUID idempotency key; a retry returns the same edition, even if new approvals arrived meanwhile. At most one queued/running/stopping task is allowed for that book. Later approvals wait for another edition. Failed or cancelled attempts retain their execution history and their approved requests can be included in a new submission.

The executor receives a `requests` array with each request's approved annotations, values, language, base revision and global document indexes. Rejected annotations are not exposed. Private documents are still read from their original HMAC-signed intake records and SHA-256-verified bytes, under the claimed task's executor identity. One edition produces one validated publication package. Revision increases once, only when ScriptaHub records a confirmed publication receipt. Initial book creation remains a separate manuscript/book-proposal task.

Tasks persist their state, timestamps, result and error fields. Approved manuscript tasks can be claimed through the internal MCP service by a configured executor agent. Claiming moves one queued task to running atomically. Owner cancellation changes queued tasks to cancelled, or running tasks to stop_requested. Workers check status between steps and before publication, acknowledge stopped work as cancelled, and record completed or failed results. ScriptaHub also reconciles stop requests on startup and every three seconds, so a failed or absent RoboTeam executor cannot leave an otherwise idle task in Stopping indefinitely. The stop state fences new service operations. Automatic cancellation uses the same atomic finish checks as the executor: it waits for uploading/starting/running/stopping skill jobs and leaves leased, queued or uncertain publications to the publication worker. Confirmed pushes remain completed; cancellation never undoes a published commit. Processing diagnostics remain retained. The existing approval cycle then restores the request, refunds any paid cost idempotently and sends its notification; retry remains blocked until restoration succeeds and its notification is durably queued. Email delivery is retried independently. An AI response already running on the robot may still finish locally, but cannot submit new processing or publication after the stop. The UI does not claim instant process termination.

Librarian feedback without a book remains a received open contribution visible to its author; it does not bypass book approval or enter the executable queue. Existing pre-dashboard inbox records remain intact and are not automatically replayed.

## Persistence and interfaces

`/data/dashboard.sqlite` stores books, known identities, collaborators, immutable change payloads, task state and events. It uses WAL, foreign keys, a five-second busy timeout and immediate transactions. Files remain outside the database; downloads require access checks and hash verification. UserPersisto continues to own identity and credentials.

All routes run through the existing authenticated `/api/*` Router rule and signed method/path/query/body verification:

| Route | Behavior |
| --- | --- |
| `GET /api/dashboard` | Current user's books, contributions, tasks and permitted history |
| `POST /api/submissions` | Multipart intake; accepts owner changes without a task; initial book creation retains its task |
| `POST /api/dashboard/review` | Owner-only accept/reject with annotation decisions; does not queue work |
| `POST /api/dashboard/editions` | Atomic explicit edition request for an accessible book; charges the requester, snapshots approved corrections if present, and requires bookId, submissionId and confirmedCost |
| `POST /api/dashboard/access` | Owner-only collaborator grant/removal |
| `POST /api/dashboard/cancel` | Owner-only cancellation of a queued task or cooperative stop request for running work |
| `GET /api/dashboard/files/:submissionId/:index` | Authorized private document download |

Approving corrections only retains them for a future edition. It never spends points or queues generation. Explicit edition and fork requests capture the configured cost and debit the requester through UserPersisto before becoming claimable. ScriptaHub creates tasks; existing Cron jobs invoke RoboTeam workflows. ScriptaHub owns the final push and collection.json update after the workflow robot confirms readiness and independent final validation passes.

## Verification and activation

Run `npm test` in `scriptahubAgent`. Tests use isolated SQLite databases and multiple synthetic identities to exercise creation, imported ownership, collaborator access, proposal approval/rejection, stale revisions, duplicate decisions, private downloads, cancellation and persistence. Provider tests check the installation-owner metadata without granting the reader administrative capabilities.

Activate both updated UserPersisto and ScriptaHub runtimes; restart UserPersisto before ScriptaHub. No persistent data deletion is required. Browser SSO, visual layout and real RoboTeam execution are separate verification gates; the service protocol and configured workflow must be activated before real execution is tested.

## Service execution through Ploinky

The standard AgentServer exposes these task lifecycle operations as `internal` MCP tools: `scriptahub_task_claim`, `scriptahub_task_status`, `scriptahub_task_document_read`, `scriptahub_task_moderate`, and `scriptahub_task_finish`. AgentServer verifies secure-wire grants; the tool wrapper additionally requires an agent actor/caller/subject match, the expected tool, no browser/delegated user, and an identity listed in `SCRIPTA_EXECUTOR_AGENT_IDS`. The manifest configures `agent:AchillesIDE/roboTeamAgent` by default; installations can explicitly replace the comma-separated canonical identities. Empty or invalid configuration fails closed. No administrator email/password, shared ScriptaHub signing key, private data mount or direct SQLite access is given to robots.

Claim accepts `runId` and optional `taskId`. In one immediate transaction it selects the oldest accepted, queued manuscript and persists `task_executions`, bound to source agent and run ID. The same agent/run recovers the same execution; a terminal execution must not be reprocessed. Other task kinds are left untouched. No eligible task returns `task:null`. Running work is never reclaimed automatically after a crash: an interrupted run needs operator review so a completed push is not silently repeated.

Claim returns form values, identities, original filenames, document indexes and SHA-256 values, never private source paths. The tool also returns the current configured catalogue URLs as task.repositories, loaded and validated before claiming. An empty configured list prevents claiming. For the manuscript workflow, the configured list is the operator-authorized set of publication candidates: the workflow compares the main document and requirements with the collections, resolves the chosen Git repository/branch/content root from real metadata and references, and uses the scriptahub-tasks choose operation to randomly select one of multiple matching candidates without clarification. The selection is preserved across retries; it does not create Git credentials or authorize an unrelated remote. No fixed publication repository or branch is required in the form. Document reads require the owning executor and a running execution, verify the signed intake record against the approved change, reject links and hash mismatches, and return base64 chunks of at most 196608 bytes. The caller assembles and verifies the complete file before use.

The executor's finish operation accepts failed or cancelled, with bounded result/error text. It cannot mark work completed. ScriptaHub completes the task only after confirming the commit pushed by the robot. A cancellation prevents a new push, but cannot undo an accepted remote commit. A publication with an uncertain outcome must be reconciled before terminal failure or cancellation. Exact repeated finish requests return the saved result; conflicting terminal writes fail.

## Robot publication

Configure the Git author name, email and GitHub write credentials on the RoboTeam robot assigned to publication. ScriptaHub Settings contain the catalogue URLs and refresh interval. GitHub blob/raw catalogue URLs determine the authorized remote, branch and content root. ScriptaHub reads the public repository to validate the baseline and confirm the remote commit.

The workflow submits the independently validated inventory and exact package files via the publication tools. The service checks file hashes, book identity, source manuscript, allowed paths, edition history and catalogue schema. It stages the approved Git tree against the current baseline, preserving unrelated catalogue entries. The package limit is 500 files, 50 MB per file and 512 MB total.

The robot fetches the baseline, reads the staged content and verifies the resulting tree hash before creating the commit using its Git identity. ScriptaHub checks the commit's tree and parent before authorizing the push. The robot uses its credential helper for a normal Git push. Only ScriptaHub can complete the task after observing that exact commit on the destination branch or in its history.

Publication inventory, commit identity and the confirmed receipt are persisted for recovery. The same execution can resume an interrupted push using the retained commit. If the branch advanced concurrently, the robot retries against a newly validated tree. ScriptaHub can reconcile an already pushed commit independently. After a push that may have taken effect, reconciliation precedes terminal failure or cancellation.

RoboTeam uses the `scriptahub-tasks` skill in `skills`. Its launcher sends service calls through the callback socket of the RoboTeam task runtime mounted at `/workspace/ploinky-runtime` (context version 3); the RoboTeam controller relays them with its service identity and without user delegation. The launcher downloads only into its current working directory. Add/refresh ScriptaHubAgent on the robot and enable its agent-owned skills. Activate the updated ScriptaHub manifest/MCP configuration through Ploinky, then run the manuscript workflow manually or schedule it through the existing RoboTeam Cron tab. Each run processes at most one task. The service does not create a Cron job or poll the inbox. No automatic task replay, database deletion or sample worker is installed.

## Points and approval cycles

The points feature uses the current account, reservation and approval-cycle schema.

Dashboard → Administration → Settings configures initial credits, contribution rewards, processing costs, and reward expiry and reminders. Initial credits default to zero and apply once on first use of ScriptaHub. Changes to the initial amount apply to new ScriptaHub users. UserPersisto owns the credit balance and ledger. Dashboard → Credits shows the balance, expiring credits, and history. Workspace administrators can look up an account in Administration → Users and grant additional credits with an audited reason.

New manuscripts and book proposals queue immediately, without a pre-generation approval. An attachment is optional for a description-based book proposal. After RoboTeam generation and independent final validation, the workflow robot decides publication readiness; no administrator approval is required before push. Administrators can also inspect and review correction sets for every book in the workspace. Book owners also review corrections. Approval alone never credits correction points. After confirmed publication, each contributor receives one correction reward per book revision, regardless of how many approved sets were included. Only the immutable requests captured in that edition task qualify; later approvals wait for the next edition. The correction reward and validity are captured from Settings when the edition is requested and retained on retry. A failed or unconfirmed publication pays nothing. Reward requests are durably keyed by contributor, book and published revision, so retries and lost UserPersisto responses cannot duplicate awards. A new-book reward is credited after its approved processing completes and publication is confirmed. Equivalent contributions from the same author share a request. Reviews and retries are tied to the current attempt. The edition and fork costs are fixed at confirmation. A funded task is available to the existing RoboTeam schedule only after UserPersisto confirms the debit. A fork pins the source edition content at submission and publishes its source attribution with the derived book.

On failure or cancellation, a managed task stays blocked until processing and any in-flight publication have been resolved. ScriptaHub then reverses the confirmed debit, restores the request and records a dashboard notice and an EmailAgent notification in the same local transaction. A retry is a new attempt on the same request, with a different task ID. A delayed result from an older execution cannot advance the new attempt. Failed email delivery is retried independently. A rejected editorial review is a final decision for that version.

Deploy the updated Router, UserPersisto and ScriptaHub together. ScriptaHub declares UserPersisto in its manifest and sends a stable reference, amount and reason to UserPersisto's `credits_apply` tool. ScriptaHub beta accepts no payments. Users are directed to a platform administrator for additional credits.




## Publication and paid editions

The workflow robot decides when a validated edition is ready to publish. ScriptaHub verifies the package, configured content repository, pinned remote baseline and edition history. The robot commits and pushes, then ScriptaHub confirms the commit and updates collection.json. No human publication approval is required. New books and forks use a configured repository selected by the flow; revised editions retain their existing repository.

An authenticated user with access to a book can explicitly request a paid new edition, independently of correction approval. The requester pays the configured cost; accepting corrections never debits the book owner. Without pending corrections, the task snapshots an explicit revision request. Such a synthetic request does not earn a correction reward. Generation/publication failures retain the blocking restoration/refund/notification cycle before retry is enabled. Initial book retries queue directly.


## Processing input reuse

The final verified manifest chunk acknowledges availableFiles as manifest indexes whose complete bytes are already present in the job workspace. Clients upload only missing files and still verify their immutable local snapshot. This supports retry without resending complete inputs. On successful artifact release, the service can retain verified copies in its private processing-inputs directory, scoped to the exact executor and execution. Workers receive independent copies rather than links to cached data. The cache is bounded to 64 MiB globally, included in processing quota checks, revalidated on startup and reuse, and evicted by age, quota pressure or task completion. Cache failures fall back to normal upload; failed/incomplete job evidence keeps the existing retention and release behavior. Bare runtime doctor commands do not snapshot or transmit task files.


## Book scope throughout processing and publication

Each RoboTeam item handles only its claimed book and, for a fork, its explicitly pinned source. Repository selection reads catalogue metadata, not the contents of other books. Publication packages are sparse: current-book files, its referenced assets and the required catalogue update. Other catalogue entries remain unchanged. A robot-side Git checkout is not required; the helper verifies the remote baseline directly. ScriptaHub Git publication materializes only validated package paths and preserves unrelated indexed files.

The processing helper excludes package/ unless a command addresses the specific current book. Book metadata must match the claim; one book binding is retained for subsequent status/report commands. Only referenced shared assets are added transitively. Unrelated books, global catalogue data, unreferenced assets and Git internals are not processing inputs. The same boundary applies to every result entry. Pending snapshots outside that scope are rejected; the helper does not migrate, cancel or replace previous-version jobs automatically. Invalid validate-book correction/source-override combinations are rejected before admission rather than repeating an expensive failing transfer.


## HTML-first generation

Description/instruction proposals and HTML forks produce complete HTML books without HTML→DOCX→PDF conversion. For description-based proposals, the PDF step prints each published language directly from its staged HTML and registers the download in the catalogue. The native standalone/imported-reader comparison is used with a preserved authored HTML reference and strict zero-new/zero-existing finding acceptance; candidate hashes must match the final package. The final generated-book audit records scope html_layout_integrity, nativeScope edition_layout_regression and existingFindings=0. A supplied PDF manuscript remains the source of PDF fidelity checks. Existing generated intermediary files from earlier attempts stay private and do not become new-job inputs or publication requirements.


### Book cover preferences

New books without a proposed title use a short excerpt from the brief or a label from the manuscript filename in the dashboard. Long excerpts end at a word boundary when possible. When that label is already in use by an unpublished book, ScriptaHub numbers the new label. The publication workflow receives the original submission fields, and dashboard listings use the published catalogue title when it becomes available.

The Create form includes optional multi-select style, color and composition presets (with custom entries), plus a free cover description. Empty selections use automatic art direction based on the actual title, subject, audience and book instructions. The values are stored in the authenticated contribution and passed unchanged to its task. Cover preferences remain separate from content instructions. The new-book flow creates original portrait SVG artwork during packaging, maps the cover and thumbnail to the same local resource, and includes it in the immutable publication inventory. A submitted cover-generation request requires artwork for every published language before push. The flow records its visual brief privately and checks the final cover during independent validation. It uses the current robot model to author vector artwork; no external raster-image provider is configured by this feature.


### Personal points and user administration

The personal Credits tab shows the signed-in user's balance and ledger. Administration contains Settings, Users, Tasks, and Editorial review. Users lists accounts in pages of 25, searches by name or email, and opens account details from a keyboard-accessible list item. Details contain account identity, roles, join date, balance, ledger, and the idempotent credit-award form. Both administrative endpoints enforce administrator access on the server. Tasks lists workspace processing jobs, and Editorial review shows editorial requests across the workspace. The top-level Editorial requests tab covers the user's own requests and books they own or collaborate on. Direct links use `?tab=admin&section=users` (or `settings`, `tasks`, `reviews`). Existing `?tab=users` and `?tab=tasks` links open the corresponding administration subtab.


### Credits during beta

The personal Credits tab shows the balance and ledger and explains how to request additional credits. Requests that need more credits show the shortfall and the same instruction. The deployment runs in beta by default with `SCRIPTA_IS_BETA_VERSION=true`. Only the explicit value `false` selects standard mode. The dashboard receives the release mode from the server. Beta mode hides pricing and checkout and denies requests to those endpoints. Standard mode uses the existing UserPersisto price, Stripe Checkout, and payment status checks.

Administration → Settings contains the initial allocation, contribution rewards, processing costs, and expiration settings in one form with Save and Reset. Reset restores the last saved values locally.

The initial allocation uses the amount set when a verified user is first registered by ScriptaHub. A pending grant retains that amount and the same UserPersisto operation reference until confirmation. Session and dashboard reads stay available while the grant is retried. Initial credits and manual awards do not expire.

#### Deployments that enable purchases

Administration → Settings includes a price and currency per credit alongside the credit rules. UserPersisto owns the saved price, Stripe credentials, and signed webhook configuration. The Credits tab accepts a quantity, displays the total, and opens Stripe Checkout. The server checks the checkout return route and UserPersisto verifies session ownership and settlement before crediting the balance. Pending sessions are checked until they reach a terminal state.

For local Stripe testing, use the same Stripe account and sandbox for the UserPersisto keys and webhook listener. Use the signing secret for that listener. Existing transactions retain their original amount and currency and can be reconciled through UserPersisto.

### Independent books in a batch

Schedule workflow `add-books` (plural). It invokes `create-book` once for each reserved request, with `continueOnChildFailure:true` on its creator. Failed or terminated children retain their error and return to per-book reconciliation. A safe failure is finalized through the ordinary executor finish path. If processing or publication prevents finalization, `batch-defer` durably marks the exact active execution through the existing batch-settle service operation; it does not release the reservation or authorize a retry. `batch-next` skips deferred items and continues the other requests. Closing traversal with `retainActive:true` preserves running/stop_requested reservations. A subsequent batch can reserve new queued requests without stealing deferred work. Recovery uses the original execution and artifact directory. Manual operator pauses are still honored; shared service outages are reported as infrastructure failures. Deploy the task helper, ScriptaHub service and updated RoboTeam runtime together; update existing cron jobs from `add-book` to `add-books`. Existing captured run graphs are unchanged.

### Publication with incomplete requested translations

A validated source edition may publish even when requested translations fail. The immutable final validation includes `translationOutcome` with sourceLanguage, requestedLanguages, publishedLanguages and omitted language/reason entries. ScriptaHub validates complete accounting, requires the source among published languages and checks that the reported published languages match the current book's actual packaged editions. The package never includes incomplete target editions. After confirmed push, task state is completed for the published package and task.result explicitly warns about partial completion and omitted languages. The owner receives a completion warning through EmailAgent, including when a contribution reward is pending. No target failure is silently called a successful translation; existing strict acceptance checks for the source/included editions remain mandatory.

Schema 1 publication packages validate their keyword catalogue before upload through `verify-package` and again in the publisher. Preparation preserves other book entries, aligns the current book’s stable `keywordIds` with each supported catalogue language and rebuilds the global index from catalogue metadata using the task skill’s `combineCollections` implementation. A missing or invalid global index, missing IDs, missing labels and stale membership counts are validation errors with an explicit message. The index supplies search suggestions, subject filtering and keyword-cloud weights. This check does not read other books’ content or require translated book editions. The service and portable task skill each ship their keyword module within their own deployment boundary. A regression check requires these two modules to remain byte-identical. Service startup never imports task helper code from an older runtime image.

Legacy HTTP catalogues use the agent’s book landing page at their existing `editions.<language>.book` URLs when full or short reading resources are declared. A URL used as full or short reading content in any edition always serves the original resource, including when it also names a book landing page. This prevents the reader from receiving the generated landing page instead of the manuscript. The page provides reading links, optional PDF download and book tools from catalogue metadata. Full HTML, summaries, artwork and other legacy resources continue to use their original paths. Books declaring only a standalone landing page retain their existing remote page. Existing snapshots obtain the metadata from their own collection.json and need no migration.


## Parallel processing isolation

Editorial and translation commands use job-specific snapshots: the selected job subtree, its declared source/output and referenced assets. Explicit job/output paths keep the four editorial resources and each translation language/resource separate. Native calls remain serialized by the coordinator and execution lock; semantic workers may write sibling jobs while one native command runs. The addressed job/output and shared source resources stay frozen until that command merges. Returned sibling paths are rejected, and same-job/source conflicts retain the existing blocking journal. The selection is durable across retries and native job-directory cleanup. Previous broad pending snapshots are preserved for explicit reconciliation, never automatically migrated.


## Batch contracts before generation

Editorial and translation workers receive an exact batch-specific contract from the selected native skill before generating JSON. The contract carries only the current batch IDs and the selected skill's enums/schema. The coordinator submits candidate JSON through submit-batch, which validates it before atomic persistence, preserves rejected/accepted existing results, and reports actionable errors. Source and batch digests bind admission to the inspected inputs. General file patching is no longer the prescribed way to write or repair batch results; existing final validation remains mandatory. Both new commands retain the job-specific remote snapshot/merge boundary.


## Shared batch module

The four editorial skills and translate-html import one physical module at skills/scriptahub-tasks/shared/batch-io.mjs. Their descriptors declare the sibling dependency and their adapters retain skill-specific schemas. Image preparation verifies the declared shared sources; installed runtime receipts and robot-side admission both include those sources in the dependent skill fingerprints. Shared code is not regenerated into skill folders. Bundle the common directory once with exported dependent skills.


## Starting and continuing a reserved batch

A saved open batch may contain only cancelled/completed/failed items after an interrupted workflow. On a new batch-start, the task helper closes such an exhausted batch through the strict service API and then reserves the current eligible queue without wasting an empty run. Empty old batches are handled the same way. Active, stop-requested, queued and uncertain-publication reservations remain bound to their existing batch; a lost/refused close reply retains the local identity for recovery. Existing evidence is not deleted or regenerated.

Both add-books and edit-book enter through select-task once and continue through select-next-task. Item-result edges cannot return to the startup selector. Continuation calls only batch-next, so requests arriving during processing wait for the next parent execution. Existing captured workflow graphs are not rewritten; use the updated definitions for new executions.

## Native child-workflow admission

The batch selectors confirm that their child workflow is runnable before reserving or claiming. Add books uses `create-book`; Edit book uses `edit-edition`. Both workflow types isolate per-item failures and continue after terminal confirmation or durable deferral. A pending registered publication is reconciled using its service execution ID, including when no local handoff is present. Workflow routing tests enforce RoboTeam’s 16,000-character limit per task prompt.

### Content moderation

The assigned RoboTeam model reviews the submission and the frozen publication package. The ScriptaHub service prepares the review units, renders documents and artwork in its networkless sandbox, and binds each unit to the execution and package digest. The robot uses its existing model selection, including its existing visual capability. If it cannot inspect a required image, the task is blocked with that reason. See the [moderation policy](skills/scriptahub-tasks/SKILL.md#content-moderation).
