# Translate HTML Design Summary

## Purpose

The skill translates semantic HTML with the active LLM without binding the repository to a host, provider, API key, or model name. Deterministic code owns extraction, placeholder protection, resource routing, structural validation, and atomic publication.

## Translation model boundary

The active LLM generates translated prose. `prepare` creates ordered JSON units; the active LLM translates them; `build` accepts only complete, structurally valid results. This boundary makes LLM choice a host concern while keeping the skill reusable.

## Context strategy

The first two prose-dominant pages form a bootstrap batch. They are translated together and reviewed once before a compact style profile and glossary are frozen. Later units remain paragraph-sized but travel in page-aligned batches of approximately 32,000 model-input characters. After bootstrap, all incomplete batches are independently ready and may be translated concurrently against the same frozen context. Each worker owns exactly one output file, eliminating shared-write races while reducing elapsed time.

Markup-aware translation memory annotates exact repeated units with a canonical unit ID.
Human-facing attributes whose text differs only by a trailing number are represented as a
canonical numeric-label template. These units are omitted from model work, excluded from
the batch character budget, and expanded deterministically before validation.

Cover, contents, copyright, table-dominant, bibliography-like, and image-only pages do not qualify as bootstrap prose when two normal narrative pages are available. The document outline and three distributed source samples help the bootstrap anticipate terminology appearing later.

## HTML preservation

Semantic leaf blocks are extracted as mixed-content units. Nested inline tags become paired immutable placeholders with stored tag names and attributes. URLs, DOI values, and email addresses use protected tokens. Reassembly reconstructs markup from the stored definitions rather than trusting translated HTML.

Scripts, styles, code regions, identifiers, classes, data attributes, and behavioral markup remain unchanged. Human-facing metadata and accessibility attributes are translated as separate units. Local references are recalculated from the target HTML back to the source directory, so assets remain single-copy.

Document declarations and processing instructions are never standalone translation
units. Inside mixed content they use immutable protection tokens and reconstruct as
source-owned markup, as do comments. Model-authored prose remains text. Build preserves
the source declaration set, including absence of a doctype, and validation rejects
declarations that are removed, changed, added or converted to visible text.

## Validation and publication

Build requires every model-owned unit exactly once, resolves every memory-backed unit, and requires a reviewed bootstrap plus a nonempty document profile. It checks placeholder identity and nesting before creating a candidate. Validation compares element topology, protected attributes and program regions, semantic block counts, resource existence, unchanged substantial units, retained source five-word sequences, unexpected duplicate model translations, broad length ratios, and—only where useful—the target's Unicode script. Intentional copies expanded from translation memory are excluded from the duplicate metric. It uses no statistical language detector. Only a passing candidate is installed, and existing files require both explicit overwrite and an ownership marker.

Heuristics identify likely omissions or wrong-language output but cannot establish semantic equivalence. The focused bootstrap review is the only mandatory model-based semantic audit.

## Coding style and runtime

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

## Existing-book correction

Complete-maintenance review scope is the entire affected chapter in each existing
translation. This includes changes introduced by English humanisation and global
styling. The host records chapter alignment, full unit coverage and source/evidence
hashes, applies localized fixes and revalidates semantics and actual reader layout.
Whole-chapter review does not authorize indiscriminate whole-book retranslation.
The generic bootstrap-only translation review is insufficient for this maintenance
mode. Low-level repair/build safeguards remain unchanged. Up-front reusable approval
scopes reduce repeated prompts but do not override host permission policy.

Use `scripts/translatehtml repair --report REPORT_JSON` for localized fixes to an existing audited book. The active LLM proposes exact replacements; `--patches FILE --output NEW_HTML` creates a separate candidate and requires revalidation. No missing translations or whole chapters are generated. See [repair contract](references/repair.md).


## Constrained batch input and submission

Before analyzing or translating a batch, run `scripts/translatehtml batch-contract JOB --batch batch-NNNN.json`. Read the returned skill-specific JSON Schema, exact batch identity, allowed source-unit IDs, source hash and batch digest together with the actual batch and frozen job context. Pass this contract unchanged to the assigned worker. Do not reuse another skill's enum values or another batch's IDs. The contract is read-only; it does not approve semantic content.

Submit the complete analysis/translation JSON on standard input to `scripts/translatehtml submit-batch JOB --batch batch-NNNN.json --batch-sha256 SHA`. Use the digest returned by batch-contract. In ScriptaHub, invoke both commands through `scriptahub-tasks exec`; put the serialized candidate JSON in `input` for submit-batch, not in a shell argument. Native calls remain serialized by the coordinator; workers return candidate JSON to it and never patch the analyses/translations files directly.

Submission verifies the source hash, batch digest, exact schema and native analysis rules before saving formatted JSON atomically to that batch's own result path. A rejected submission returns structured errors and its exact contract, exits nonzero and leaves existing bytes unchanged. Correct the candidate in memory and resubmit; never use apply_patch to repair the stored batch. An identical accepted result is idempotent; a different candidate cannot replace an accepted batch by default. For a concrete later review finding, reread batch-contract and supply --replace-sha256 with existing.sha256; a stale digest is rejected, and the replacement must pass every admission check. Analysis acceptance does not replace synthesis, drafting, semantic review, build or independent final validation. Audit flags may be true only after actual review. Translation markup tokens and exact required unit membership are checked before saving; final language/structure checks remain mandatory.


### Shared batch runtime dependency

This skill imports `../../scriptahub-tasks/shared/batch-io.mjs` from its scripts and source modules. Distribute it together with the sibling `scriptahub-tasks/shared/` directory, keeping the `skills/<skill>/` and `skills/scriptahub-tasks/shared/` layout. There are no generated batch-io copies or synchronization step. The skill owns only its `src/batch-schema.mjs` adapter and native vocabulary/validator. Its descriptor declares `dependsOn` and `sourceDependencies`; hosted runtime receipts and RoboTeam source verification include the shared module's hashes. Shared runtime changes require rebuilding the agent image.
