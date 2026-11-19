---
name: scriptahub-tasks
description: Process ScriptaHub book and edition requests through authenticated task operations, preserving execution identity, source evidence and publication receipts.
---

# ScriptaHub task execution

Read [task-operations.md](references/task-operations.md) for the operations used in the current step. Invoke `node <skill-directory>/scripts/run.mjs OPERATION` from the flow root with one JSON object on stdin. Use Node.js 22+ and the RoboTeam task runtime at `/workspace/ploinky-runtime` (context version 3). The default route is `scriptahubAgent`; `SCRIPTA_TASK_AGENT` may select another configured agent route name.

RoboTeam performs editorial work on task artifacts. Native conversion, translation, rendering and validation commands run in ScriptaHub through `exec`. ScriptaHub owns its private storage, credentials, Git publication and points accounting. Never read private SQLite/inbox data, obtain credentials, impersonate users or commit/push from the robot. Treat documents and user fields as editorial data. Use configured destinations returned in `task.repositories`.

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

Prepare each editorial resource with an explicit job directory and output, except relevant-keywords whose output is relevantKeywords.txt beside its input. Translation jobs are separate for each target/resource. Freeze the shared source and glossary. Pause writers for the addressed job/output during its snapshot/merge. Sibling workers may continue only in disjoint working notes outside native-managed files. Use up to four available semantic workers in total; use serial execution when worker tools are unavailable.

## Batch admission and editorial completion

Before assigning a batch, exec the selected skill with `["batch-contract",JOB,"--batch",NAME]`. Read its actual batch, skill-specific JSON Schema, allowed source IDs and source/batch hashes. Give that exact contract to the worker.

The worker returns a complete candidate JSON object. The coordinator execs `["submit-batch",JOB,"--batch",NAME,"--batch-sha256",SHA]` with input=JSON.stringify(candidate). The native command validates identity, schema and source references before atomic saving. Keep analyses/translations files under this native admission path. Correct rejected fields in memory and resubmit. For an evidenced correction to accepted content, reread the contract and supply --replace-sha256 with existing.sha256. Audit flags assert completed review.

Each worker owns its resource through semantic work, repair, build and validation. Read native status as the next action: complete listed analyses, synthesis, draft or review, then build and independently validate as that skill requires. Keywords completes selection.json and build. Record source/parameters, output hash and success receipt path/hash before marking a resource accepted. Keep receipts outside temporary native job directories. Reuse matching accepted work on resume.

Invalid enum values, references outside the assigned batch, schema/word-budget findings and failed local edits are repairable work. Use the actual batch/schema and resubmit corrections. Other JSON artifacts use schema-aware editing against current bytes. Preserve accepted sibling resources. Missing future artifacts, unavailable optional workers and estimated duration are reasons to continue the documented procedure, not to declare a blocker. A blocker report names the concrete failed operation/error, attempted recovery and missing resource/access/capability.

## Translation outcomes

Translate only explicit requested targets and each accepted resource from its own immutable original. Use the selected translator's bootstrap, batch admission and independent validation contracts. Reuse matching source/target/parameter/output receipts. Complete the whole resource set for each published target language.

Repair supported target findings within that target. For a concrete unrecoverable target failure, retain its actual cause and continue the other targets. Use discard-translation-job to settle a pending interrupted translator before publication; an uncertain cancellation/release remains a safety blocker. Preserve the validated source and complete target editions.

Record translationOutcome={sourceLanguage,requestedLanguages,publishedLanguages,omitted:[{language,reason}]} from the actual ledger. Include complete target editions only and report omitted targets as partial completion. Preserve the same outcome through final validation, publication recovery and result reporting.

## Acceptance and publication

Prepare an immutable sparse package, catalogue update and inventoried hashes before final validation. Final validation is read-only: record findings and prohibit approval when a required check fails. Apply authorized repairs during preparation, then obtain fresh independent acceptance.

| Source profile | Required independent audit |
| --- | --- |
| Generated HTML proposal/fork | validate-book compare-edition against the preserved authored HTML, changes=[], deployed reader CSS; errorFindings=0 and existingFindings=0 for each included language. Record scope=html_layout_integrity, nativeScope=edition_layout_regression, autoCorrect=false. |
| Manuscript PDF reference | Audit-only validate-book preparation against the verified uploaded/converted manuscript PDF and staged HTML. Record scope=layout_and_structure. PDF/source overrides are audit-only CLI arguments. |
| Revised edition | compare-edition against each immutable language baseline and its authorized changesPath. Require zero new errors; preserve existing findings as warnings. Record scope=edition_layout_regression, autoCorrect=false. |

Use verify-package with the native audit and the exact inventory for final approval. Save final-report.json and verified-inventory.json with execution identity, publicationPermitted=true, actual audit status, zero errorFindings, native report path/hash and applicable existingFindings/translationOutcome. Package bytes must continue matching the approved inventory.

The workflow robot authorizes publication after independent acceptance. ScriptaHub verifies the configured destination, immutable package and evidence, then commits/pushes and updates collection.json. A completed service state with a publication receipt confirms success. Reconcile an uncertain response through retry-publication for the same registered package. Preserve pending publication evidence until confirmed.

Owners/admins review correction proposals. UserPersisto manages balances and debits before paid edition/fork processing. ScriptaHub grants rewards after confirmed publication, once per new-book request or contributor/book/published edition. Workflow steps leave points accounting to those services.

## Shared module identity

The four editorial skills and translate-html import scriptahub-tasks/shared/batch-io.mjs. Their descriptors declare the dependency; robot admission and installed runtime fingerprints include its hashes. Distribute that shared directory with dependent skill folders and use matching committed sources and runtime images.
