# short-description

Creates a neutral 4–6 sentence thematic description from marketingSummary, comprehensiveSummary, or other semantic HTML, without revealing answers, solutions, conclusions, recommendations, or spoilers.

```sh
scripts/shortdescription doctor
scripts/shortdescription prepare /path/to/index.html
scripts/shortdescription status /path/to/.shortdescription-jobs/index-.../
scripts/shortdescription build /path/to/.shortdescription-jobs/index-.../
scripts/shortdescription validate /path/to/index.html --html /path/to/shortDescription.html
```

The output is a standalone `shortDescription.html` with one paragraph of 4–6 sentences in the source language. The source remains unchanged. Successful builds remove their intermediate job directory.

## Node.js runtime

Requires Node.js 22 or newer. Use ECMAScript modules in .mjs files, explicit
relative imports, node: built-ins, async/await and node --test. Keep all owned
resources inside this skill. Document necessary dependency exceptions in
[dependencies.md](dependencies.md). Check prerequisites before outputs are created.
Never install dependencies during startup.

Node.js runs the skill and its tests. The HTML parser is bundled.
Run `node --test tests/equivalence.test.mjs`. Frozen JSON fixtures preserve
the original outputs; see tests/fixtures/README.md for provenance.

## Equivalence checks

Run `node --test tests/equivalence.test.mjs`. Acceptance requires zero skipped
tests. Comparisons use frozen expectations.

The compared fixtures preserve prepared JSON, job states, generated HTML bytes,
validation reports and source immutability. Doctor reports Node.js and htmlparser2
versions. Parser equivalence on
every malformed HTML document is not established by this finite fixture set.


## Constrained batch input and submission

Before analyzing or translating a batch, run `scripts/shortdescription batch-contract JOB --batch batch-NNNN.json`. Read the returned skill-specific JSON Schema, exact batch identity, allowed source-unit IDs, source hash and batch digest together with the actual batch and frozen job context. Pass this contract unchanged to the assigned worker. Do not reuse another skill's enum values or another batch's IDs. The contract is read-only; it does not approve semantic content.

Submit the complete analysis/translation JSON on standard input to `scripts/shortdescription submit-batch JOB --batch batch-NNNN.json --batch-sha256 SHA`. Use the digest returned by batch-contract. In ScriptaHub, invoke both commands through `scriptahub-tasks exec`; put the serialized candidate JSON in `input` for submit-batch, not in a shell argument. Native calls remain serialized by the coordinator; workers return candidate JSON to it and never patch the analyses/translations files directly.

Submission verifies the source hash, batch digest, exact schema and native analysis rules before saving formatted JSON atomically to that batch's own result path. A rejected submission returns structured errors and its exact contract, exits nonzero and leaves existing bytes unchanged. Correct the candidate in memory and resubmit; never use apply_patch to repair the stored batch. An identical accepted result is idempotent; a different candidate cannot replace an accepted batch by default. For a concrete later review finding, reread batch-contract and supply --replace-sha256 with existing.sha256; a stale digest is rejected, and the replacement must pass every admission check. Analysis acceptance does not replace synthesis, drafting, semantic review, build or independent final validation. Audit flags may be true only after actual review. Translation markup tokens and exact required unit membership are checked before saving; final language/structure checks remain mandatory.


### Shared batch runtime dependency

This skill imports `../../scriptahub-tasks/shared/batch-io.mjs` from its scripts and source modules. Distribute it together with the sibling `scriptahub-tasks/shared/` directory, keeping the `skills/<skill>/` and `skills/scriptahub-tasks/shared/` layout. There are no generated batch-io copies or synchronization step. The skill owns only its `src/batch-schema.mjs` adapter and native vocabulary/validator. Its descriptor declares `dependsOn` and `sourceDependencies`; hosted runtime receipts and RoboTeam source verification include the shared module's hashes. Shared runtime changes require rebuilding the agent image.
