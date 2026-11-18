---
name: marketing-summary
description: Turn a comprehensive summary or another semantic HTML document into a concise, same-language editorial sales page that builds curiosity by explaining the book's questions, stakes, distinctive approach, and reader fit without revealing answers, conclusions, twists, resolutions, or outcomes. Use chapter-aware approximately 32k-character batches, explicit safe-hook and protected-revelation ledgers, adaptive 250–650-word output, an independent semantic spoiler review, and the active LLM. Do not use for direct PDF, DOCX, plain-text, Markdown, translation, fabricated endorsements, or aggressive ad copy.
---

## ScriptaHub deployment

This skill is owned by ScriptaHubAgent. In a ScriptaHub RoboTeam workflow, invoke its CLI with `scriptahub-tasks exec`, passing the claimed `executionId`, returned `taskDirectory`, canonical skill name, CLI `args` array and optional `input`. ScriptaHub runs the CLI in its isolated service runtime through authenticated MCP. Preflight checks that runtime before a claim. Do not install or repair dependencies during a manuscript run. The standalone CLI instructions below also apply when using this portable skill outside ScriptaHub.


# Marketing Summary

Use this skill when the user wants persuasive editorial copy for a book or document while withholding its answers and spoilers. Input must be `.html` or `.htm`. A `comprehensiveSummary` output is supported directly; its visible essay is extracted while its source map and technical metadata are ignored. Convert other formats with the appropriate skill first.

## Required workflow

1. Run `scripts/marketingsummary doctor`.
2. Run `scripts/marketingsummary prepare INPUT`. Pass `--language`, `--output`, or `--job-dir` only when necessary. Keep the returned job path.
3. Read all of `context.json`, `chapters.json`, and every ready batch. Analyze up to `recommendedParallelAnalyses` batches concurrently. Use batch-contract before generation and submit-batch to save the exact analysis schema in [references/job-format.md](references/job-format.md), explicitly separating safe hooks from protected revelations. Never ask for per-batch confirmation.
4. Repeat `status` until `synthesis_required`. Read every analysis and write `synthesis.json`. Detect `fiction`, `nonfiction`, or `hybrid`; select only safe hooks; register every protected revelation; and create a sales-page outline within the adaptive budget.
5. When `status` returns `draft_required`, write `draft.json` as concise editorial sales copy. Explain the central questions, tension, stakes, approach, and reader fit without giving the answers. End with a subtle open loop, not a direct purchase command.
6. When `status` returns `review_required`, compare every draft paragraph against every protected revelation and write `review.json`. If any answer, conclusion, recommendation, twist, resolution, or outcome leaks, revise only the affected draft text and repeat the review without asking the user.
7. Continue until `ready_to_build`, then run `scripts/marketingsummary build JOB` followed independently by `scripts/marketingsummary validate SOURCE --html OUTPUT`. Repair rejected artifacts and retry automatically.

## Editorial rules

- Write in the source language for a general educated reader.
- Use a text-first sales-page shape: headline, dek, stakes, central questions, distinctive approach, reader fit, and a subtle invitation created through an unresolved tension.
- For nonfiction, reveal subject, premise, method, tensions, and why the questions matter; withhold conclusions, verdicts, solutions, prescriptions, and final recommendations.
- For fiction, reveal only the initial setup, atmosphere, characters, and starting conflict; withhold twists, hidden identities, major revelations, relationship outcomes, character fates, and the ending.
- In hybrid work, apply the stricter rule to each claim or plot element.
- Do not add buttons, prices, testimonials, ratings, invented benefits, purchase links, or unsupported author claims.
- If the source lacks enough safe material, fail explicitly rather than inventing copy or exposing a protected revelation.

## Size and source rules

- The length is automatic and has no user-facing length option: sources up to 5,000 words produce 250–300 words; 5,001–20,000 produce 375–475; longer sources produce 550–650.
- Keep batches chapter-aligned and near 32,000 model characters; split only between semantic units.
- Analyze every content chapter. Exclude navigation, scripts, styles, legal boilerplate, page labels, visible source maps, and unannotated bibliography material while recording exclusions.
- Every hook and final paragraph must cite valid internal source-unit IDs. Never invent facts, names, dates, numbers, URLs, DOI values, or examples.
- The original file is immutable. The result is a new self-contained HTML page.

## Completion standard

Deliver only after all content batches are analyzed, every protected revelation is registered, every visible paragraph passes the independent spoiler review, the adaptive word range is met, and build plus independent validation pass. Keep metrics, source IDs, spoiler ledgers, and validation details in the job and report only; never render them in the user-facing page or handoff.

## Runtime

Use scripts/marketingsummary with Node.js 22 or newer. All runtime dependencies
are local to this folder. Commands never install packages. See dependencies.md.

Language tags use hyphenated BCP 47 syntax and are normalized by Node.js
`Intl.Locale`. The source language comes from HTML unless explicitly overridden.


## Constrained batch input and submission

Before analyzing or translating a batch, run `scripts/marketingsummary batch-contract JOB --batch batch-NNNN.json`. Read the returned skill-specific JSON Schema, exact batch identity, allowed source-unit IDs, source hash and batch digest together with the actual batch and frozen job context. Pass this contract unchanged to the assigned worker. Do not reuse another skill's enum values or another batch's IDs. The contract is read-only; it does not approve semantic content.

Submit the complete analysis/translation JSON on standard input to `scripts/marketingsummary submit-batch JOB --batch batch-NNNN.json --batch-sha256 SHA`. Use the digest returned by batch-contract. In ScriptaHub, invoke both commands through `scriptahub-tasks exec`; put the serialized candidate JSON in `input` for submit-batch, not in a shell argument. Native calls remain serialized by the coordinator; workers return candidate JSON to it and never patch the analyses/translations files directly.

Submission verifies the source hash, batch digest, exact schema and native analysis rules before saving formatted JSON atomically to that batch's own result path. A rejected submission returns structured errors and its exact contract, exits nonzero and leaves existing bytes unchanged. Correct the candidate in memory and resubmit; never use apply_patch to repair the stored batch. An identical accepted result is idempotent; a different candidate cannot replace an accepted batch by default. For a concrete later review finding, reread batch-contract and supply --replace-sha256 with existing.sha256; a stale digest is rejected, and the replacement must pass every admission check. Analysis acceptance does not replace synthesis, drafting, semantic review, build or independent final validation. Audit flags may be true only after actual review. Translation markup tokens and exact required unit membership are checked before saving; final language/structure checks remain mandatory.


### Shared batch runtime dependency

This skill imports `../../scriptahub-tasks/shared/batch-io.mjs` from its scripts and source modules. Distribute it together with the sibling `scriptahub-tasks/shared/` directory, keeping the `skills/<skill>/` and `skills/scriptahub-tasks/shared/` layout. There are no generated batch-io copies or synchronization step. The skill owns only its `src/batch-schema.mjs` adapter and native vocabulary/validator. Its descriptor declares `dependsOn` and `sourceDependencies`; hosted runtime receipts and RoboTeam source verification include the shared module's hashes. Shared runtime changes require rebuilding the agent image.
