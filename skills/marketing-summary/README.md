# marketing-summary

`marketing-summary` converts a comprehensive summary or another semantic HTML document into a concise editorial sales page. It explains the book's questions and stakes while explicitly withholding nonfiction answers and fiction spoilers.

```sh
scripts/marketingsummary doctor
scripts/marketingsummary prepare /path/to/book.html
scripts/marketingsummary status /path/to/.marketingsummary-jobs/book-.../
scripts/marketingsummary build /path/to/.marketingsummary-jobs/book-.../
scripts/marketingsummary validate /path/to/book.html --html /path/to/book.marketing.html
```

The active LLM performs chapter analysis, safe-hook selection, drafting, and a separate semantic spoiler review. Deterministic code enforces exact schemas, evidence links, adaptive length, factual tokens, immutable input, and output safety. The generated page never displays technical metrics, source maps, source-unit IDs, or spoiler-review data.

## Node.js runtime

Requires Node.js 22 or newer. Use .mjs ECMAScript modules, explicit relative
imports, node: built-ins, async/await and node --test. Keep every owned resource
inside this skill. [dependencies.md](dependencies.md) records bundled parser and
language-data exceptions. Startup checks prerequisites and never installs them.

Run tests with Node.js:
`node --test tests/equivalence.test.mjs`. Frozen reference fixtures preserve
preparation, workflow states, exact HTML output and language normalization.
See tests/fixtures/README.md for provenance. Acceptance requires zero skipped tests.

Job JSON and command arguments are preserved. Doctor retains its behavioral
metadata and reports the Node.js and htmlparser2 versions.

Language tags use hyphenated BCP 47 syntax and are normalized by Node.js
`Intl.Locale`. The source language comes from HTML unless explicitly overridden.


## Constrained batch input and submission

Before analyzing or translating a batch, run `scripts/marketingsummary batch-contract JOB --batch batch-NNNN.json`. Read the returned skill-specific JSON Schema, exact batch identity, allowed source-unit IDs, source hash and batch digest together with the actual batch and frozen job context. Pass this contract unchanged to the assigned worker. Do not reuse another skill's enum values or another batch's IDs. The contract is read-only; it does not approve semantic content.

Submit the complete analysis/translation JSON on standard input to `scripts/marketingsummary submit-batch JOB --batch batch-NNNN.json --batch-sha256 SHA`. Use the digest returned by batch-contract. In ScriptaHub, invoke both commands through `scriptahub-tasks exec`; put the serialized candidate JSON in `input` for submit-batch, not in a shell argument. Native calls remain serialized by the coordinator; workers return candidate JSON to it and never patch the analyses/translations files directly.

Submission verifies the source hash, batch digest, exact schema and native analysis rules before saving formatted JSON atomically to that batch's own result path. A rejected submission returns structured errors and its exact contract, exits nonzero and leaves existing bytes unchanged. Correct the candidate in memory and resubmit; never use apply_patch to repair the stored batch. An identical accepted result is idempotent; a different candidate cannot replace an accepted batch by default. For a concrete later review finding, reread batch-contract and supply --replace-sha256 with existing.sha256; a stale digest is rejected, and the replacement must pass every admission check. Analysis acceptance does not replace synthesis, drafting, semantic review, build or independent final validation. Audit flags may be true only after actual review. Translation markup tokens and exact required unit membership are checked before saving; final language/structure checks remain mandatory.


### Shared batch runtime dependency

This skill imports `../../scriptahub-tasks/shared/batch-io.mjs` from its scripts and source modules. Distribute it together with the sibling `scriptahub-tasks/shared/` directory, keeping the `skills/<skill>/` and `skills/scriptahub-tasks/shared/` layout. There are no generated batch-io copies or synchronization step. The skill owns only its `src/batch-schema.mjs` adapter and native vocabulary/validator. Its descriptor declares `dependsOn` and `sourceDependencies`; hosted runtime receipts and RoboTeam source verification include the shared module's hashes. Shared runtime changes require rebuilding the agent image.
