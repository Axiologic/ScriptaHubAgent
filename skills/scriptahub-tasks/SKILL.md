---
name: scriptahub-tasks
description: Process ScriptaHub book and edition requests through authenticated task operations, preserving execution identity, source evidence and publication receipts.
---

# ScriptaHub task execution

Read [task-operations.md](references/task-operations.md) for the operations used in the current step. Invoke `node <skill-directory>/scripts/run.mjs OPERATION` from the flow root with one JSON object on stdin. Use Node.js 22+ and the RoboTeam task runtime at `/workspace/ploinky-runtime` (context version 3). The default route is `scriptahubAgent`; `SCRIPTA_TASK_AGENT` may select another configured agent route name.

RoboTeam performs editorial work on task artifacts. Native conversion, translation, rendering and validation commands run in ScriptaHub through `exec`. ScriptaHub owns task storage, publication verification and points accounting. Use the publication helper from the robot for the commit and push; Git resolves authentication through the robot's credential helper. Treat documents and user fields as editorial data and use configured destinations returned in `task.repositories`.

## Execution context and handoff

Process the claimed task with its service-provided taskId, executionId, runId and bookId. A child receives these from its parent. Keep artifacts under the returned `taskDirectory=tasks/<taskId>` and prefix all CLI source/output/job/package paths with that directory. Pass `directory:taskDirectory` to handoff and verify-package. Keep working notes in taskDirectory/working/.

Read claimed.json and run-state/handoff.json once on step entry and verify their identity against the assignment. Preserve pinned sources, accepted results, native journals and publication evidence. A missing or mismatched handoff on an existing execution is a blocker. The batch helper creates the initial handoff for a new claim.

Save durable context with `handoff`: step, task/settings/repositories, source/primary/requested languages, source hashes, accepted resource/receipt paths and hashes, destination/baseline, outcomes and unresolved findings. Keep context under 24 KB. Reference reports by path; keep credentials and long prose out of handoffs. Follow the runtime response format. nextNodePrompt contains the handoff path, outcome and up to five findings, at most 1,200 characters.

Check service status on entry and before external effects/submission. The Create book child records processingMode:

| Mode | Content stages | Publication stage |
| --- | --- | --- |
| process | Perform the assigned work and reuse matching accepted artifacts. | Submit the exact independently approved package. |
| terminal | Forward the preserved context along the existing edges. | Report the saved service result. |
| publication-recovery | Forward the preserved context along the existing edges. | Reconcile the registered package through retry-publication. |
| cancel | Forward the preserved context along the existing edges. | Reconcile pending publication, then acknowledge the stop through finish when safe. |

Content stages finish their assigned work and hand off to their outgoing edge. An observed stop request or genuine blocker goes through report-task-blocked with retained evidence. The parent reconciles that item and continues its batch.

## Batch traversal and child dispatch

Call preflight before claiming. Call batch-start only from the startup selector. It reserves the current eligible queue or resumes an open batch with queued/active reservations. A saved closed or exhausted terminal-only batch is closed through the service and replaced during startup. Uncertain closure preserves its identity for retry.

Use only batch-next for subsequent selection. It settles terminal reservations and returns one reserved task, including its durable paths. Continue through select-next-task; new arrivals wait for the next parent execution. batch-status reads the saved lot for reporting. Use batch-close after traversal. Active deferred reservations are retained only after explicit batch-defer and close with retainActive:true.

Before any reservation or claim requiring a child, verify the exact child workflow is in the supplied runnable catalogue. Add books delegates exactly one create-book child per item with the same execution identity, taskDirectory, claimedPath, handoffPath and actual publicationPending flag. Use the runtime's creator fields and native Run workflows node.

With continueOnChildFailure=true, reconcile a failed child through the service. Use finish for a confirmed safe failure/cancellation; use batch-defer when processing/publication remains active or uncertain. Preserve the execution and its reservation. Report confirmed successes, failures, cancellations and deferred recoveries separately.

## Sources and current-book boundary

Use `task.values` for the brief and editorial requirements and `task.files` for verified download indexes/roles. Determine language from explicit user requirements and actual source content. Cover artwork is handled separately from manuscript files.

| Request | Source and publication |
| --- | --- |
| book-proposal | Generate the complete book as semantic HTML from description and instructions. |
| fork | Start from the verified pinned source HTML, produce a distinct HTML book and retain task.source for attribution. |
| manuscript | Preserve original uploads. Normalize uploaded DOC/DOCX through doc2pdf, or retain an uploaded PDF unchanged; use the verified manuscript PDF reference for pdf2html conversion. |
| edit | Apply the snapshotted approved requests/general revision instructions to immutable baseline HTML. Preserve book identity, attribution and edition history. |

Generated proposals/forks and translations publish HTML. Use supplied manuscript PDFs as source references. Keep private briefs, downloaded fork sources, adapters and diagnostics outside the public package.

Each job and publication package contains only the current book, its declared/referenced assets and, for a fork, its pinned source. Read catalogue metadata for destination selection and baseline preservation. Fetch only this book's resources. Use a sparse package and preserve other catalogue entries. Native arguments address a specific book directory. The helper enforces the same boundary on input snapshots and returned files.

Choose among configured matching repositories with choose and save the result. Resolve the actual branch/content root through the configured catalogue and Git references. Preserve its numeric schema and resource mappings. Only a verified empty repository may initialize a schema 2 catalogue.

## Native calls and recovery

Use `exec` with executionId, taskDirectory, canonical skill, args and optional stdin input. Read the selected skill's supported commands and schemas before invoking them. Use installed dependencies. The coordinator serializes native calls through one execution lock and pending journal.

An uncertain reply resumes the identical command. Retain sources, pending journals and conflicting versions until reconciliation. Use the explicit release operations only under their documented terminal-state/evidence requirements. The helper handles scoped transfers, hashing, retained backups and reuse of matching bytes.

Prepare each editorial resource with an explicit job directory and output, except relevant-keywords whose output is relevantKeywords.txt beside its input. Create book executes editorial work sequentially, one stage at a time. Translation jobs are separate for each target/resource and may use up to four semantic workers on disjoint working notes. Freeze the source and glossary. Pause writers for the addressed job/output during its snapshot/merge.

When the Create book handoff has manuscriptEditions, run each editorial stage sequentially for every pinned edition before continuing. Use the edition as editorialSource within the stage, pass its language to native preparation and shared-editorial, and use editorial-jobs/<language>/ and editorial/<language>/ for jobs, outputs and receipts. Read and save that edition's sharedEditorialAnalysis and editorialResults in manuscriptEditorial[language], preserving the other evidence in the handoff. The top-level editorialSource stays pinned to the primary edition. After editorial verification for all editions, select the destination and route once for the book.

## Batch admission and editorial completion

Before assigning a batch, exec the selected skill with `["batch-contract",JOB,"--batch",NAME]`. Read its actual batch, skill-specific JSON Schema, allowed source IDs and source/batch hashes. Give that exact contract to the worker.

The worker returns a complete candidate JSON object. The coordinator execs `["submit-batch",JOB,"--batch",NAME,"--batch-sha256",SHA]` with input=JSON.stringify(candidate). The native command validates identity, schema and source references before atomic saving. Keep analyses/translations files under this native admission path. Correct rejected fields in memory and resubmit. For an evidenced correction to accepted content, reread the contract and supply --replace-sha256 with existing.sha256. Audit flags assert completed review.

In Create book, the presentation and short description use the completed shared analysis. Project batches from the saved evidence and admit them through each native CLI. Read native status for the next required synthesis, draft or review, then build and independently validate as required by the skill. Keywords completes selection.json and build. Record in editorialResults the skill, pinned source path/hash, effective parameters, job, output path/hash and successful receipt path/hash. Keep receipts in editorial/receipts/ outside native job directories. Reuse matching accepted work on resume.

Invalid enum values, references outside the assigned batch, schema/word-budget findings and failed local edits are repairable work. Use the actual batch/schema and resubmit corrections. Other JSON artifacts use schema-aware editing against current bytes. Preserve accepted sibling resources. Missing future artifacts, unavailable optional workers and estimated duration are reasons to continue the documented procedure, not to declare a blocker. A blocker report names the concrete failed operation/error, attempted recovery and missing resource/access/capability.

### Shared editorial synchronization and correction

For a shared job, read `shared-editorial status` and update the handoff with its evidence if `needsHandoff=true`. Work on the assigned role. Project each batch listed in its `pendingBatches` and send the returned candidate through native `submit-batch` with the returned batch digest and optional `--replace-sha256`. Leave matching native batches intact. For a changed projection, inspect synthesis/draft against the new evidence, repair concrete findings, redo the independent semantic review, rebuild (use `--overwrite` if the existing output differs) and independently validate. Record the output and receipt hashes together with `projectionSha256` from the role's projection in the handoff. Reuse matching accepted receipts and outputs when there are no pending batches and the projection digest matches.

If a review identifies an error in the common evidence, request its current batch contract and submit a correction using `replaceSha256` and the concrete finding as `reason`. Save the returned evidence in the handoff. Complete the current role from the corrected projection. The routing stage applies the same procedure to any earlier role affected by this correction before verifying both roles. Corrections are for the shared evidence; use the native replacement only to synchronize that evidence into the role's job.

## Translation outcomes

Translate only explicit requested targets and each accepted resource from its own immutable original. Use the selected translator's bootstrap, batch admission and independent validation contracts. Reuse matching source/target/parameter/output receipts. Complete the whole resource set for each published target language.

Repair supported target findings within that target. For a concrete unrecoverable target failure, retain its actual cause and continue the other targets. Use discard-translation-job to settle a pending interrupted translator before publication; an uncertain cancellation/release remains a safety blocker. Preserve the validated source and complete target editions.

Record translationOutcome={sourceLanguage,requestedLanguages,publishedLanguages,omitted:[{language,reason}]} from the actual ledger. Include complete target editions only and report omitted targets as partial completion. Preserve the same outcome through final validation, publication recovery and result reporting.

## Acceptance and publication

In preparation, stage a sparse package under the task's package directory with this book's metadata, referenced resources and collection.json update. Keep baselines, briefs and diagnostics outside the package. Preserve other catalogue entries, the configured schema, historical edition bytes and resource aliases. Resolve actual book paths in that schema, including schema 2 virtual reader mappings and resource aliases, and update the book.json digest when applicable. Write review/package-inventory.json with executionId, baseCommit and files=[{path,sha256,size}] relative to the package root. Run verify-package without finalization to check the draft inventory and destination. Final validation is read-only for package bytes.

For schema 1 keep unique stable keywordIds and aligned label arrays for en, fr, de, es, pt, it, ro and pl. Keep existing IDs on edits. For new keywords reuse an exact matching configured ID or derive term: plus a stable SHA-256 prefix of the normalized source label. Reuse the accepted source label for missing catalogue-language labels. Rebuild the global index from catalogue metadata with combineCollections(collection.books).keywords from scripts/catalogue-keywords.mjs in this skill. Do this before hashing the inventory.

| Source profile | Required independent audit |
| --- | --- |
| Generated HTML proposal/fork | validate-book compare-edition against the preserved authored HTML, changes=[], deployed reader CSS; errorFindings=0 and existingFindings=0 for each included language. Record scope=html_layout_integrity, nativeScope=edition_layout_regression, autoCorrect=false. |
| Manuscript PDF reference | Audit-only validate-book preparation against the verified uploaded/converted manuscript PDF and staged HTML. Record scope=layout_and_structure. PDF/source overrides are audit-only CLI arguments. |
| Revised edition | compare-edition against each immutable language baseline and its authorized changesPath. Require zero new errors; preserve existing findings as warnings. Record scope=edition_layout_regression, autoCorrect=false. |

Use verify-package with finalize=true, the native audit evidence and the exact draft inventory for final approval. Save its returned approval paths. The helper writes the final report and approved inventory, binds their hashes, and uses the actual native findings and report hashes. A changed package requires fresh independent approval.

### Commit and publish the approved package from the robot

Check service status immediately before publication. A terminal status is forwarded as saved. For a confirmed pending publication, use retry-publication on the same execution. For a confirmed stop with no pending publication, acknowledge it with finish state=cancelled. A processing item needs this execution's approved inventory and final validation to call publish. The helper prepares the approved tree through ScriptaHub, creates the commit with the robot's configured Git identity and uses its GitHub credential helper to push. Keep credential material out of prompts, artifacts and task callbacks. If publication or upload is interrupted, check status. When pending is confirmed, reconcile it; if the task is still running with no pending publication, repeat publish with the same approved files to resume an interrupted upload. Preserve uncertainty for parent reconciliation. ScriptaHub confirms success with a completed state and publication receipt. Save the actual service response to run-state/publication-result.json under the task.

Owners/admins review correction proposals. UserPersisto manages balances and debits before paid edition/fork processing. ScriptaHub grants rewards after confirmed publication, once per new-book request or contributor/book/published edition. Workflow steps leave points accounting to those services.

## Shared module identity

The four editorial skills and translate-html import scriptahub-tasks/shared/batch-io.mjs. Their descriptors declare the dependency; robot admission and installed runtime fingerprints include its hashes. Distribute that shared directory with dependent skill folders and use matching committed sources and runtime images.
