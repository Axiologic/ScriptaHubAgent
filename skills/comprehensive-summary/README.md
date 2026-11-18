# comprehensive-summary

`comprehensive-summary` turns a book-length semantic HTML document into a source-traceable, unified summary essay sized by reading time. It analyzes every content chapter, ranks ideas by centrality, recurrence, and originality, and uses the active LLM for language-sensitive judgment without depending on a particular provider or model.

```sh
scripts/comprehensivesummary doctor
scripts/comprehensivesummary prepare /path/to/index.html --minutes 15
scripts/comprehensivesummary status /path/to/.comprehensivesummary-jobs/index-15min-.../
scripts/comprehensivesummary build /path/to/.comprehensivesummary-jobs/index-15min-.../
scripts/comprehensivesummary validate /path/to/index.html --html /path/to/index.summary-15min.html
```

The default reading rate is 200 words per minute and the accepted final range is ±10%. The main essay alone is measured; the collapsible source map is excluded. Word-count and reading-time metrics remain in the technical report and hidden metadata rather than appearing in the reader-facing page. Output stays in the source language, and the original HTML is never modified.

## Node.js runtime

Explicit `doc-copyright` roles and `source-copyright` section classes are recorded
as non-content, including long author/production notes within those boundaries.
Ordinary narrative copyright mentions remain content.

Requires Node.js 22 or newer. The POSIX launcher runs on macOS and Linux:

```sh
scripts/comprehensivesummary doctor
node --test tests/*.test.mjs
```

The skill includes its HTML parser.
[dependencies.md](dependencies.md) records versions, licenses and update steps.
Startup checks the runtime and bundled resources before creating job files.

Language tags use hyphenated BCP 47 syntax and are normalized by Node.js
`Intl.Locale`. The source language comes from HTML unless explicitly overridden.


## Constrained batch input and submission

Before analyzing or translating a batch, run `scripts/comprehensivesummary batch-contract JOB --batch batch-NNNN.json`. Read the returned skill-specific JSON Schema, exact batch identity, allowed source-unit IDs, source hash and batch digest together with the actual batch and frozen job context. Pass this contract unchanged to the assigned worker. Do not reuse another skill's enum values or another batch's IDs. The contract is read-only; it does not approve semantic content.

Submit the complete analysis/translation JSON on standard input to `scripts/comprehensivesummary submit-batch JOB --batch batch-NNNN.json --batch-sha256 SHA`. Use the digest returned by batch-contract. In ScriptaHub, invoke both commands through `scriptahub-tasks exec`; put the serialized candidate JSON in `input` for submit-batch, not in a shell argument. Native calls remain serialized by the coordinator; workers return candidate JSON to it and never patch the analyses/translations files directly.

Submission verifies the source hash, batch digest, exact schema and native analysis rules before saving formatted JSON atomically to that batch's own result path. A rejected submission returns structured errors and its exact contract, exits nonzero and leaves existing bytes unchanged. Correct the candidate in memory and resubmit; never use apply_patch to repair the stored batch. An identical accepted result is idempotent; a different candidate cannot replace an accepted batch by default. For a concrete later review finding, reread batch-contract and supply --replace-sha256 with existing.sha256; a stale digest is rejected, and the replacement must pass every admission check. Analysis acceptance does not replace synthesis, drafting, semantic review, build or independent final validation. Audit flags may be true only after actual review. Translation markup tokens and exact required unit membership are checked before saving; final language/structure checks remain mandatory.


### Shared batch runtime dependency

This skill imports `../../scriptahub-tasks/shared/batch-io.mjs` from its scripts and source modules. Distribute it together with the sibling `scriptahub-tasks/shared/` directory, keeping the `skills/<skill>/` and `skills/scriptahub-tasks/shared/` layout. There are no generated batch-io copies or synchronization step. The skill owns only its `src/batch-schema.mjs` adapter and native vocabulary/validator. Its descriptor declares `dependsOn` and `sourceDependencies`; hosted runtime receipts and RoboTeam source verification include the shared module's hashes. Shared runtime changes require rebuilding the agent image.
