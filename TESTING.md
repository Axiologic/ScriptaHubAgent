# ScriptaHub release tests

Run from the ScriptaHubAgent repository. Node 24 and Git are required. No npm install is needed for the deterministic gate.

## Local commands

Portable service tests (macOS or Linux):

```sh
node tools/test-release.mjs --suite core
```

Complete service and task-runtime gate on Linux:

```sh
node tools/test-release.mjs --repeat 2
```

From macOS, use the existing local Ploinky Box. The repository must be mounted at the same absolute path inside the Box. Find its name with `podman ps`:

```sh
node tools/test-release.mjs --box ploinky-box-workspace-aefdee8bfc78 --repeat 2
```

`--suite runtime` runs the task helper tests alone. These require Linux `/proc` and `flock`. `--repeat 5` is useful after concurrency changes. Repetition increases the chance of detecting timing failures; it does not prove absence of races.

Each run prints a temporary report directory. `--output /tmp/scriptahub-tests-RUN` selects a directory; use a new one per invocation. With `--box`, this directory is **inside the Box**. Copy it out with `podman cp BOX:/tmp/scriptahub-tests-RUN ./test-results` if required. JUnit XML contains assertions and failures; `manifest.json` records the runtime, test file hashes, elapsed times and exit codes. Any failed or timed-out test makes the gate fail. A failed group does not suppress the other group. There is no retry that turns an initially failed test into a passing result.

The runner discovers all `*.test.mjs` files in the service and task helper test directories. Existing regression tests are included, even when they expose a current defect. Four files run concurrently. Each file has a one-minute external deadline; a process group that does not exit is killed, without suppressing the remaining files. Each file has its own log and JUnit output.

Processing admission checks actual free space even for small test fixtures. The runner requires at least 6 GiB available on the temporary filesystem; on Linux it tries `/var/tmp` if `/tmp` is a smaller tmpfs. Test work directories are removed after the run. This does not allocate 6 GiB of fixture data or change the service's storage limits.

## What is exercised

| Boundary | Evidence |
| --- | --- |
| Authenticated form → queue → registered package → Git publication → catalogue → legacy landing → reader resources | `book-journey.test.mjs` uses HTTP requests, SQLite, real temporary bare Git repositories and exact resource bytes; English and Romanian-only books |
| Duplicate form and publication operations | Journey test checks one task, one Git push and an identical durable publication receipt |
| Publication loss, contention and reconciliation | `publication.test.mjs` injects Git transport failures and verifies remote evidence before completion |
| Approval, credit debit, cancellation, refund and contribution rewards | `approval-cycles.test.mjs`, `points-ledger.test.mjs`, `edition-tasks.test.mjs`; ledger/service adapters are controlled fixtures |
| One failed book must not stop the batch | `task-batches.test.mjs` and `workflow-routing.test.mjs` |
| Editorial jobs and translation jobs must not change each other's files | Runtime `remote.test.mjs`, `job-input-scope.test.mjs`, `book-input-scope.test.mjs` |
| Partial translations and source language availability | `translation-outcome.test.mjs`, publication and snapshot tests |
| Flow paths, runtime tool contracts, deployed skills | `workflow-routing.test.mjs`, `mcp-runtime-schema.test.mjs`, `skills-deployment.test.mjs` |

The new journey uses fixed AI output and a test identity supplied through the server's existing authentication test hook. It does **not** execute an AI model, the RoboTeam scheduler, Stripe, UserPersisto over the network, browser JavaScript or the Ploinky Router. It verifies the service boundaries beneath those integrations. A successful HTTP response alone is insufficient: the test follows both reader links and compares served content with the package pushed to Git.

## Browser check

There is a separate existing Playwright gate for desktop/mobile layouts, cover visibility, legacy URLs and reader JavaScript:

```sh
PLAYWRIGHT_MODULE=/absolute/path/to/playwright-core/index.mjs \
CHROMIUM_EXECUTABLE=/absolute/path/to/chromium \
SCRIPTA_CONTENT_REPOSITORY=/absolute/path/to/scriptaBooks-1 \
node scriptahubAgent/tests/content-v2.browser.mjs
```

This requires the expected content fixture and a local Chromium installation. It is not silently skipped or counted as passed by the deterministic gate.

## Real workflow acceptance before deployment

A deterministic green result cannot certify model behaviour or the installed runtime. Run a canary in a dedicated Ploinky workspace with a test user, a disposable content repository and the candidate agent image/skills. Do not use the live queued books for this check.

1. Submit three small books: description only; an attached PDF; and an original in Romanian with requested Polish/Spanish translations.
2. Run the installed `add-books` workflow. Record parent/child flow IDs, task/execution IDs and image revision. Observe actual terminal phase transitions, not just the human report text.
3. Make one book fail and one translation fail in this disposable environment. Confirm that other books publish and that a failed translation is reported while the validated source remains publishable.
4. Stop a task during processing; restart the test agents during another task. Verify settlement/recovery of the same execution and absence of duplicate publication or charges.
5. Verify the remote commit and publication receipt; open the landing, full reader, summary, cover and requested available languages through the real Router. Check that the full reader contains the book rather than its summary.
6. Repeat the same approved correction/publication request and payment event. Verify one reward per contributor/edition, one purchase credit and a nonnegative balance. Use Stripe test mode.

These live checks currently require an operator and are **not implemented as an automatic AI acceptance runner**. In particular, model latency, stale phase UI, generated cover/TOC quality and image/runtime compatibility need their own live evidence. Keep this distinct from the automated gate when reporting readiness.

## CI

`.github/workflows/test-scriptahub.yml` runs both deterministic groups twice on Linux for pushes and pull requests, and retains JUnit/manifest artifacts. Configure the `regression` status as a required branch check in GitHub to block merging on failure; merely adding the workflow does not change branch protection. Deployment requires an agent image whose dependency fingerprint equals the checkout's; skill source changes run from the checkout without an image rebuild.
