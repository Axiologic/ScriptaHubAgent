# Translation job format

`prepare` creates a deterministic local directory under `.translatehtml-jobs/` and prints
its path. The directory remains inside the document workspace so batch writes do not
trigger external-path permission prompts. It contains:

- `job.json`: immutable paths, languages, source hash, output policy, ordered batch names,
  32,000-character batching policy, translation-memory metrics, parallel limit, and
  structural baseline;
- `template.html`: a source snapshot with temporary unit locators;
- `bootstrap.json`: the document outline, representative source samples, and IDs from the first two narrative pages;
- `context.json`: a template the active LLM must complete before translating non-bootstrap batches;
- `batches/batch-NNNN.json`: ordered translation units with protected markup tokens;
- `translations/batch-NNNN.json`: files written by the active LLM workflow with the exact batch and unit IDs.

Every model-translated unit has this form:

```json
{"id": "u000001", "translation": "Text with unchanged ⟦OPEN:T0001⟧markup⟦CLOSE:T0001⟧."}
```

The translation must contain the exact placeholder multiset from `source`. `build` rejects missing, duplicated, unknown, or improperly nested placeholders.

Doctype and XML declarations outside prose remain in `template.html` without unit
IDs. Processing instructions and comments inside prose are protected values, restored
as markup rather than escaped visible text. Older jobs that extracted declarations as
text require fresh preparation. Do not reuse their shifted IDs without checking the
complete source and protection data.

Units carrying `reuseOf` or `reuseTemplateOf` are omitted from translation output. The
former reuses an exact, markup-aware canonical translation. The latter reuses a canonical
human-facing numeric label and replaces its preserved number deterministically. `build`
resolves both forms before validation.

The bootstrap batch is the only ready batch initially. Once it is translated and
`context.json` is reviewed, `status` exposes all incomplete batches in `readyBatches` and
caps simultaneous work with `recommendedParallelBatches`. Parallel workers read the same
frozen context and each writes only its assigned `translations/batch-NNNN.json`.

`context.json` must set `bootstrapReviewed` to `true` and contain a concise `documentProfile` plus a `glossary` array before `build` can publish.

## Runtime

The Node.js implementation uses the command arguments and JSON shapes documented
here. Reference fixtures in tests/fixtures verify preparation, state transitions
and generated artifacts.

Language tags use hyphenated BCP 47 syntax and are normalized by Node.js
`Intl.Locale`. The source language comes from HTML unless explicitly overridden.


## Constrained batch input and submission

Before analyzing or translating a batch, run `scripts/translatehtml batch-contract JOB --batch batch-NNNN.json`. Read the returned skill-specific JSON Schema, exact batch identity, allowed source-unit IDs, source hash and batch digest together with the actual batch and frozen job context. Pass this contract unchanged to the assigned worker. Do not reuse another skill's enum values or another batch's IDs. The contract is read-only; it does not approve semantic content.

Submit the complete analysis/translation JSON on standard input to `scripts/translatehtml submit-batch JOB --batch batch-NNNN.json --batch-sha256 SHA`. Use the digest returned by batch-contract. In ScriptaHub, invoke both commands through `scriptahub-tasks exec`; put the serialized candidate JSON in `input` for submit-batch, not in a shell argument. Native calls remain serialized by the coordinator; workers return candidate JSON to it and never patch the analyses/translations files directly.

Submission verifies the source hash, batch digest, exact schema and native analysis rules before saving formatted JSON atomically to that batch's own result path. A rejected submission returns structured errors and its exact contract, exits nonzero and leaves existing bytes unchanged. Correct the candidate in memory and resubmit; never use apply_patch to repair the stored batch. An identical accepted result is idempotent; a different candidate cannot replace an accepted batch by default. For a concrete later review finding, reread batch-contract and supply --replace-sha256 with existing.sha256; a stale digest is rejected, and the replacement must pass every admission check. Analysis acceptance does not replace synthesis, drafting, semantic review, build or independent final validation. Audit flags may be true only after actual review. Translation markup tokens and exact required unit membership are checked before saving; final language/structure checks remain mandatory.


### Shared batch runtime dependency

This skill imports `../../scriptahub-tasks/shared/batch-io.mjs` from its scripts and source modules. Distribute it together with the sibling `scriptahub-tasks/shared/` directory, keeping the `skills/<skill>/` and `skills/scriptahub-tasks/shared/` layout. There are no generated batch-io copies or synchronization step. The skill owns only its `src/batch-schema.mjs` adapter and native vocabulary/validator. Its descriptor declares `dependsOn` and `sourceDependencies`; hosted runtime receipts and RoboTeam source verification include the shared module's hashes. Shared runtime changes require rebuilding the agent image.
