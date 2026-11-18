# Design specification

## Purpose

Create a coherent summary essay that covers a book's message rather than concatenating chapter abstracts. The source is semantic HTML. The active LLM analyzes each chapter, discovers semantic recurrence and distinctive ideas, then writes a same-language synthesis for an educated general reader.

## Pipeline

1. `prepare` snapshots the source, extracts content-bearing semantic units, classifies structural/non-content chapters, and creates chapter-segment batches no larger than approximately 32,000 characters.
2. Up to four batches are analyzed concurrently. Every content chapter receives a thesis, role, sourced ideas, evidence/examples, objections, and qualifications.
3. One synthesis clusters related ideas across the complete set of analyses. Ranking is 50% centrality, 25% recurrence, and 25% originality, with redundant clusters merged rather than repeated.
4. A draft turns the selected clusters into one thematic essay. When the requested duration is short, message coverage wins over chapter-by-chapter visibility. Every paragraph cites internal cluster and source-unit IDs.
5. `build` validates the exact schemas and evidence graph, renders a responsive standalone HTML document, appends a collapsible chapter/idea map, validates again, and publishes atomically.

## Reading budget

The default speed is 200 words per minute. The target is `minutes × wordsPerMinute`; build accepts 90–110% of that count. All reader-facing text inside the main summary article counts, including headings and the title. Word-count and estimated-duration metrics are retained only in the technical report and hidden document metadata; the HTML must not render a reading-time badge or similar user-facing statistics. The collapsible source map does not count. Requested lower bounds at or above the extracted source word count are rejected because the result would not be a summary.

## Safety and quality

The source is immutable. All content chapters must be analyzed even when the final essay omits low-priority material. Sparse title-only sections without substantial prose are recorded as structural rather than treated as chapters. Any number, date, percentage, URL, email, or DOI used in the essay must exist in the source. Final claims retain source-unit references, but semantic faithfulness still relies partly on LLM review and is reported as such.

The output contains no copied scripts or application behavior from the source. It is a new, self-contained semantic document with embedded CSS, stable hidden metadata, a unified thematic essay, and a separate source map. Internal budget metrics are never displayed to readers. Failed validation retains a candidate inside the job and never publishes it.

## Coding style and runtime

For direct section/article boundaries, an explicit `doc-copyright` role or exact
`source-copyright` class classifies the whole region as legal/metadata. Keep its
units and exclusion reason in chapter evidence but do not create an analysis
batch. Do not infer this exclusion from prose mentioning copyright or partial
class names. Existing prepared evidence is not rewritten after this correction.

Write executable modules as .mjs ECMAScript modules with explicit relative imports,
node: imports for built-ins and async/await. Keep functions focused and all skill
resources inside this folder. Resolve resources with import.meta.url. Node.js 22
or newer runs commands and the node:test suite. Bundled dependency exceptions,
licenses and update procedures are recorded in dependencies.md.

Preserve command arguments, JSON schemas and ownership checks. Doctor reports
Node.js and htmlparser2 versions. Tests compare reference fixtures and exercise
publication safeguards, language handling and portable startup.

Language tags use hyphenated BCP 47 syntax and are normalized by Node.js
`Intl.Locale`. The source language comes from HTML unless explicitly overridden.


## Constrained batch input and submission

Before analyzing or translating a batch, run `scripts/comprehensivesummary batch-contract JOB --batch batch-NNNN.json`. Read the returned skill-specific JSON Schema, exact batch identity, allowed source-unit IDs, source hash and batch digest together with the actual batch and frozen job context. Pass this contract unchanged to the assigned worker. Do not reuse another skill's enum values or another batch's IDs. The contract is read-only; it does not approve semantic content.

Submit the complete analysis/translation JSON on standard input to `scripts/comprehensivesummary submit-batch JOB --batch batch-NNNN.json --batch-sha256 SHA`. Use the digest returned by batch-contract. In ScriptaHub, invoke both commands through `scriptahub-tasks exec`; put the serialized candidate JSON in `input` for submit-batch, not in a shell argument. Native calls remain serialized by the coordinator; workers return candidate JSON to it and never patch the analyses/translations files directly.

Submission verifies the source hash, batch digest, exact schema and native analysis rules before saving formatted JSON atomically to that batch's own result path. A rejected submission returns structured errors and its exact contract, exits nonzero and leaves existing bytes unchanged. Correct the candidate in memory and resubmit; never use apply_patch to repair the stored batch. An identical accepted result is idempotent; a different candidate cannot replace an accepted batch by default. For a concrete later review finding, reread batch-contract and supply --replace-sha256 with existing.sha256; a stale digest is rejected, and the replacement must pass every admission check. Analysis acceptance does not replace synthesis, drafting, semantic review, build or independent final validation. Audit flags may be true only after actual review. Translation markup tokens and exact required unit membership are checked before saving; final language/structure checks remain mandatory.


### Shared batch runtime dependency

This skill imports `../../scriptahub-tasks/shared/batch-io.mjs` from its scripts and source modules. Distribute it together with the sibling `scriptahub-tasks/shared/` directory, keeping the `skills/<skill>/` and `skills/scriptahub-tasks/shared/` layout. There are no generated batch-io copies or synchronization step. The skill owns only its `src/batch-schema.mjs` adapter and native vocabulary/validator. Its descriptor declares `dependsOn` and `sourceDependencies`; hosted runtime receipts and RoboTeam source verification include the shared module's hashes. Shared runtime changes require rebuilding the agent image.
