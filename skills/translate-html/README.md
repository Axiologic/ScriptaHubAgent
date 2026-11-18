# translate-html

`translate-html` lets the active LLM translate a complete semantic HTML document while deterministic Node.js tooling protects markup and validates the result. It is independent of the host and translation provider, and requires no separate API key.

## What it preserves

- element order and semantic block counts;
- document declarations and processing instructions, without adding a doctype to sources that lack one;
- headings, paragraphs, lists, tables, captions, and inline emphasis;
- scripts, CSS, reader integration, IDs, classes, styles, and data attributes;
- external links and internal anchors;
- source assets through relative references rather than copies.

Visible text, document metadata, alternative text, and accessibility labels are translated. Program text and content explicitly marked `translate="no"` are not.

## Runtime

Requires Node.js 22 or newer on macOS or Linux. The launcher checks the runtime and bundled resources:

```bash
scripts/translatehtml doctor
```

## Typical workflow

```bash
scripts/translatehtml prepare /books/example/en/index.html --to ro
```

The active LLM reads the returned job, translates and reviews the bootstrap, then translates the remaining approximately 32,000-character batches in parallel before running:

```bash
scripts/translatehtml build /tmp/translatehtml-job-...
```

The translation request authorizes this complete workflow. The skill preflights required
permissions and, only when the host requires elevated access, requests one combined
approval inventory before starting, with reusable launcher/operation scopes. It does
not ask for per-batch consent. Platform-required approvals remain mandatory and cannot
be suppressed by a skill. Progress messages never ask the user to continue.

Jobs use deterministic resumable paths under the document's local
`.translatehtml-jobs/` directory by default, avoiding per-batch external-path permission
prompts. Translation memory removes exact duplicate work and expands repetitive numbered
accessibility labels automatically. An interrupted run exposes every currently ready batch:

```bash
scripts/translatehtml status /books/example/.translatehtml-jobs/...
```

After the bootstrap is reviewed, `status` returns `readyBatches` and
`recommendedParallelBatches`, allowing distinct workers to write distinct translation
files safely. Workers use the reviewed shared context.

For a source under `en/`, the default output is the same filename under `ro/`. References such as `assets/styles.css` are rewritten to `../en/assets/styles.css`; no asset is duplicated.

An existing translation can be checked independently:

```bash
scripts/translatehtml validate /books/example/en/index.html \
  --html /books/example/ro/index.html --to ro
```

The validator combines exact structural invariants with fast unchanged-content, source n-gram overlap, duplicate, resource, length, and Unicode-script heuristics. It does not load a statistical language detector. These checks cannot prove semantic equivalence, so the first two narrative pages receive a separate model review before later batches are translated.

## Development

```bash
node --test tests/*.test.mjs
```

[dependencies.md](dependencies.md) records bundled parser and language-data versions,
licenses and update steps.

Language tags use hyphenated BCP 47 syntax and are normalized by Node.js
`Intl.Locale`. The source language comes from HTML unless explicitly overridden.

## Existing-book correction

Complete maintenance reviews and corrects the whole affected translated chapter for
each English change, in every existing language. The same rule covers English
humanisation and global typography changes. Preserve faithful passages and canonical
paths; do not rerun full-book translation. See references/repair.md for chapter evidence,
localized patching and host-managed promotion.

Use `scripts/translatehtml repair --report REPORT_JSON` for localized fixes to an existing audited book. The active LLM proposes exact replacements; `--patches FILE --output NEW_HTML` creates a separate candidate and requires revalidation. No missing translations or whole chapters are generated. See [repair contract](references/repair.md).


## Constrained batch input and submission

Before analyzing or translating a batch, run `scripts/translatehtml batch-contract JOB --batch batch-NNNN.json`. Read the returned skill-specific JSON Schema, exact batch identity, allowed source-unit IDs, source hash and batch digest together with the actual batch and frozen job context. Pass this contract unchanged to the assigned worker. Do not reuse another skill's enum values or another batch's IDs. The contract is read-only; it does not approve semantic content.

Submit the complete analysis/translation JSON on standard input to `scripts/translatehtml submit-batch JOB --batch batch-NNNN.json --batch-sha256 SHA`. Use the digest returned by batch-contract. In ScriptaHub, invoke both commands through `scriptahub-tasks exec`; put the serialized candidate JSON in `input` for submit-batch, not in a shell argument. Native calls remain serialized by the coordinator; workers return candidate JSON to it and never patch the analyses/translations files directly.

Submission verifies the source hash, batch digest, exact schema and native analysis rules before saving formatted JSON atomically to that batch's own result path. A rejected submission returns structured errors and its exact contract, exits nonzero and leaves existing bytes unchanged. Correct the candidate in memory and resubmit; never use apply_patch to repair the stored batch. An identical accepted result is idempotent; a different candidate cannot replace an accepted batch by default. For a concrete later review finding, reread batch-contract and supply --replace-sha256 with existing.sha256; a stale digest is rejected, and the replacement must pass every admission check. Analysis acceptance does not replace synthesis, drafting, semantic review, build or independent final validation. Audit flags may be true only after actual review. Translation markup tokens and exact required unit membership are checked before saving; final language/structure checks remain mandatory.


### Shared batch runtime dependency

This skill imports `../../scriptahub-tasks/shared/batch-io.mjs` from its scripts and source modules. Distribute it together with the sibling `scriptahub-tasks/shared/` directory, keeping the `skills/<skill>/` and `skills/scriptahub-tasks/shared/` layout. There are no generated batch-io copies or synchronization step. The skill owns only its `src/batch-schema.mjs` adapter and native vocabulary/validator. Its descriptor declares `dependsOn` and `sourceDependencies`; hosted runtime receipts and RoboTeam source verification include the shared module's hashes. Shared runtime changes require rebuilding the agent image.
