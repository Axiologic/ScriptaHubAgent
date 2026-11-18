# Relevant keywords design

The CLI extracts visible prose from the semantic content root, removes navigation and reference sections, assigns stable unit IDs and groups text into batches of approximately 32,000 characters. Job identity combines the source path, source hash and extracted-unit hash with the requested count, language and synonym configuration.

The active LLM analyzes every batch, then consolidates concepts across the complete book. Analyses and final selection cite source unit IDs. Node checks review flags, source hashes, term shapes, citation membership and count bounds, applies explicit synonym groups and publishes the final text atomically.

Language uses the command option, then HTML lang, then agent-reviewed context. Semantic keyword equivalence remains a review responsibility. The output contract is a comma-separated UTF-8 text file and build JSON containing output, count and keywords.


## Constrained batch input and submission

Before analyzing or translating a batch, run `scripts/relevantkeywords batch-contract JOB --batch batch-NNNN.json`. Read the returned skill-specific JSON Schema, exact batch identity, allowed source-unit IDs, source hash and batch digest together with the actual batch and frozen job context. Pass this contract unchanged to the assigned worker. Do not reuse another skill's enum values or another batch's IDs. The contract is read-only; it does not approve semantic content.

Submit the complete analysis/translation JSON on standard input to `scripts/relevantkeywords submit-batch JOB --batch batch-NNNN.json --batch-sha256 SHA`. Use the digest returned by batch-contract. In ScriptaHub, invoke both commands through `scriptahub-tasks exec`; put the serialized candidate JSON in `input` for submit-batch, not in a shell argument. Native calls remain serialized by the coordinator; workers return candidate JSON to it and never patch the analyses/translations files directly.

Submission verifies the source hash, batch digest, exact schema and native analysis rules before saving formatted JSON atomically to that batch's own result path. A rejected submission returns structured errors and its exact contract, exits nonzero and leaves existing bytes unchanged. Correct the candidate in memory and resubmit; never use apply_patch to repair the stored batch. An identical accepted result is idempotent; a different candidate cannot replace an accepted batch by default. For a concrete later review finding, reread batch-contract and supply --replace-sha256 with existing.sha256; a stale digest is rejected, and the replacement must pass every admission check. Analysis acceptance does not replace synthesis, drafting, semantic review, build or independent final validation. Audit flags may be true only after actual review. Translation markup tokens and exact required unit membership are checked before saving; final language/structure checks remain mandatory.


### Shared batch runtime dependency

This skill imports `../../scriptahub-tasks/shared/batch-io.mjs` from its scripts and source modules. Distribute it together with the sibling `scriptahub-tasks/shared/` directory, keeping the `skills/<skill>/` and `skills/scriptahub-tasks/shared/` layout. There are no generated batch-io copies or synchronization step. The skill owns only its `src/batch-schema.mjs` adapter and native vocabulary/validator. Its descriptor declares `dependsOn` and `sourceDependencies`; hosted runtime receipts and RoboTeam source verification include the shared module's hashes. Shared runtime changes require rebuilding the agent image.
