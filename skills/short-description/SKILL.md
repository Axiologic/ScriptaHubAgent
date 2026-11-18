---
name: short-description
description: Create a same-language standalone HTML description of an HTML book or document in 4–6 sentences, describing only its subject, scope, central questions, and thematic tensions while withholding nonfiction answers, solutions, conclusions, recommendations, and fiction spoilers. Accept marketingSummary, comprehensiveSummary, or other semantic HTML; use chapter-aware batches, source-unit evidence, a protected-revelation ledger, and an independent semantic review with the active LLM.
---

## ScriptaHub deployment

This skill is owned by ScriptaHubAgent. In a ScriptaHub RoboTeam workflow, invoke its CLI with `scriptahub-tasks exec`, passing the claimed `executionId`, returned `taskDirectory`, canonical skill name, CLI `args` array and optional `input`. ScriptaHub runs the CLI in its isolated service runtime through authenticated MCP. Preflight checks that runtime before a claim. Do not install or repair dependencies during a manuscript run. The standalone CLI instructions below also apply when using this portable skill outside ScriptaHub.


# Short Description

Use this skill for a compact thematic description, not a summary of conclusions and not sales copy. Input must be `.html` or `.htm`. Output is `shortDescription.html` beside the source unless `--output` is supplied.

## Required workflow

1. Run `scripts/shortdescription doctor`.
2. Run `scripts/shortdescription prepare INPUT` and retain the returned job path.
3. Read `context.json`, `chapters.json`, and every ready batch. Analyze up to `recommendedParallelAnalyses` batches concurrently; obtain batch-contract before generation and save candidates through submit-batch using the exact schema from [references/job-format.md](references/job-format.md). Separate safe themes from protected revelations.
4. Repeat `status` until `draft_required`. Read all valid analyses and write `draft.json` with 4–6 individually sourced sentences.
5. When `review_required`, independently compare every sentence with every protected revelation and write `review.json`. Revise and repeat if any answer, solution, conclusion, recommendation, twist, resolution, or outcome leaks.
6. At `ready_to_build`, run `build JOB`, then independently run `validate SOURCE --html OUTPUT`. Repair failures without asking for per-batch confirmation.

## Editorial rules

- Write in the source language for a general reader, in a neutral and informative tone.
- Describe only the subject, scope, context, central questions, and thematic tensions.
- Do not explain what solution, answer, verdict, conclusion, prescription, or recommendation the work provides.
- For fiction, reveal only premise, setting, initial characters, and starting conflict; withhold twists, hidden identities, outcomes, fates, and ending.
- Do not use sales language, calls to action, reader promises, praise, ratings, testimonials, or invented facts.
- The visible output is exactly one paragraph containing 4–6 sentences. It has no visible heading.

## Source and output rules

- Prefer `article[data-marketing-summary]` for marketingSummary input and `article[data-summary-body]` for comprehensiveSummary input. Otherwise use the primary semantic content container.
- Exclude scripts, styles, navigation, source maps, bibliographies, references, legal boilerplate, hidden content, and page labels.
- Keep batches chapter-aligned and near 32,000 characters. Analyze every content chapter.
- Preserve the source byte-for-byte. Successful completion leaves only the requested HTML artifact; job files are removed after build.

## Completion standard

Deliver only after all batches are analyzed, every protected revelation is registered, each sentence passes independent semantic review, the source remains unchanged, and build plus independent validation pass.

## Runtime

Use `scripts/shortdescription` with Node.js 22 or newer. The HTML parser is bundled
inside this skill.
See [dependencies.md](dependencies.md).


## Constrained batch input and submission

Before analyzing or translating a batch, run `scripts/shortdescription batch-contract JOB --batch batch-NNNN.json`. Read the returned skill-specific JSON Schema, exact batch identity, allowed source-unit IDs, source hash and batch digest together with the actual batch and frozen job context. Pass this contract unchanged to the assigned worker. Do not reuse another skill's enum values or another batch's IDs. The contract is read-only; it does not approve semantic content.

Submit the complete analysis/translation JSON on standard input to `scripts/shortdescription submit-batch JOB --batch batch-NNNN.json --batch-sha256 SHA`. Use the digest returned by batch-contract. In ScriptaHub, invoke both commands through `scriptahub-tasks exec`; put the serialized candidate JSON in `input` for submit-batch, not in a shell argument. Native calls remain serialized by the coordinator; workers return candidate JSON to it and never patch the analyses/translations files directly.

Submission verifies the source hash, batch digest, exact schema and native analysis rules before saving formatted JSON atomically to that batch's own result path. A rejected submission returns structured errors and its exact contract, exits nonzero and leaves existing bytes unchanged. Correct the candidate in memory and resubmit; never use apply_patch to repair the stored batch. An identical accepted result is idempotent; a different candidate cannot replace an accepted batch by default. For a concrete later review finding, reread batch-contract and supply --replace-sha256 with existing.sha256; a stale digest is rejected, and the replacement must pass every admission check. Analysis acceptance does not replace synthesis, drafting, semantic review, build or independent final validation. Audit flags may be true only after actual review. Translation markup tokens and exact required unit membership are checked before saving; final language/structure checks remain mandatory.


### Shared batch runtime dependency

This skill imports `../../scriptahub-tasks/shared/batch-io.mjs` from its scripts and source modules. Distribute it together with the sibling `scriptahub-tasks/shared/` directory, keeping the `skills/<skill>/` and `skills/scriptahub-tasks/shared/` layout. There are no generated batch-io copies or synchronization step. The skill owns only its `src/batch-schema.mjs` adapter and native vocabulary/validator. Its descriptor declares `dependsOn` and `sourceDependencies`; hosted runtime receipts and RoboTeam source verification include the shared module's hashes. Shared runtime changes require rebuilding the agent image.
