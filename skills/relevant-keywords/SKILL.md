---
name: relevant-keywords
description: Read every content batch of an HTML book with the active LLM, consolidate fundamental multilingual keywords and publish a comma-separated relevantKeywords.txt with deterministic source and JSON validation.
---

## ScriptaHub deployment

This skill is owned by ScriptaHubAgent. In a ScriptaHub RoboTeam workflow, invoke its CLI with `scriptahub-tasks exec`, passing the claimed `executionId`, returned `taskDirectory`, canonical skill name, CLI `args` array and optional `input`. ScriptaHub runs the CLI in its isolated service runtime through authenticated MCP. Preflight checks that runtime before a claim. Do not install or repair dependencies during a manuscript run. The standalone CLI instructions below also apply when using this portable skill outside ScriptaHub.


# Relevant keywords

Use this skill to identify the fundamental concepts of an HTML book. Keep keywords in the document language and preserve the input file. Node.js >=22 and the bundled HTML parser run the commands.

## Workflow

1. Run `<skill-directory>/scripts/relevantkeywords analyze INPUT.html --count 20`. Optional flags are `--language TAG`, `--synonyms FILE` and `--job-dir DIR`. The returned JSON identifies the job directory and output.
2. Read job.json and context.json. Language comes from the explicit option or the HTML lang attribute. If absent, identify it from the content and set context.json language to a BCP 47 tag. Use context notes for book-wide terminology decisions.
3. Read every file under batches/. Each contains units with stable id and text fields. Analyze the complete batch using the active LLM. Identify essential concepts, merge equivalent expressions, omit incidental names and generic terms, and cite the units that support each keyword. Read neighboring batches when an inline fragment needs context.
4. Read batch-contract for the assigned batch, then save each result through submit-batch using its batch digest; the command owns the matching analyses/ file. The exact shape is `{"reviewed":true,"keywords":[{"keyword":"concept","unitIds":["u000001"]}]}`. An individual batch may have no useful keywords. Mark reviewed only after reading it completely.
5. Run `<skill-directory>/scripts/relevantkeywords status JOB` and finish all remaining batches. Read all analyses together, rank concepts by importance to the whole book and consolidate semantic duplicates.
6. Write selection.json with the same result shape. Select between one and the requested number of keywords. Preserve priority order, use the document language, and cite supporting source IDs. Review every selected term for relevance and synonym overlap. Do not add unsupported concepts to fill the count.
7. Run `<skill-directory>/scripts/relevantkeywords build JOB`. Deliver the returned output only after successful validation.

## Contracts

The output is UTF-8 relevantKeywords.txt beside the source, containing keywords separated by comma and space, followed by a newline. Build returns output, count and keywords. The default count is 20, with a supported range of 1 to 1000. Terms cannot contain commas or line breaks. Configured synonyms are applied and duplicate canonical forms are removed.

Jobs live in .relevantkeywords-jobs/ beside the source unless overridden. They hold a source snapshot, source hash, context, batches, analyses and selection. Repeating analyze with the same source and settings resumes its job. Source changes invalidate it. Keep progress files intact while working.

Node checks completion, source identity, cited IDs, language configuration and output shape. Semantic relevance, language quality and conceptual equivalence require LLM review. Results may vary between LLM runs. See references/synonyms-format.md and dependencies.md.


## Constrained batch input and submission

Before analyzing or translating a batch, run `scripts/relevantkeywords batch-contract JOB --batch batch-NNNN.json`. Read the returned skill-specific JSON Schema, exact batch identity, allowed source-unit IDs, source hash and batch digest together with the actual batch and frozen job context. Pass this contract unchanged to the assigned worker. Do not reuse another skill's enum values or another batch's IDs. The contract is read-only; it does not approve semantic content.

Submit the complete analysis/translation JSON on standard input to `scripts/relevantkeywords submit-batch JOB --batch batch-NNNN.json --batch-sha256 SHA`. Use the digest returned by batch-contract. In ScriptaHub, invoke both commands through `scriptahub-tasks exec`; put the serialized candidate JSON in `input` for submit-batch, not in a shell argument. Native calls remain serialized by the coordinator; workers return candidate JSON to it and never patch the analyses/translations files directly.

Submission verifies the source hash, batch digest, exact schema and native analysis rules before saving formatted JSON atomically to that batch's own result path. A rejected submission returns structured errors and its exact contract, exits nonzero and leaves existing bytes unchanged. Correct the candidate in memory and resubmit; never use apply_patch to repair the stored batch. An identical accepted result is idempotent; a different candidate cannot replace an accepted batch by default. For a concrete later review finding, reread batch-contract and supply --replace-sha256 with existing.sha256; a stale digest is rejected, and the replacement must pass every admission check. Analysis acceptance does not replace synthesis, drafting, semantic review, build or independent final validation. Audit flags may be true only after actual review. Translation markup tokens and exact required unit membership are checked before saving; final language/structure checks remain mandatory.


### Shared batch runtime dependency

This skill imports `../../scriptahub-tasks/shared/batch-io.mjs` from its scripts and source modules. Distribute it together with the sibling `scriptahub-tasks/shared/` directory, keeping the `skills/<skill>/` and `skills/scriptahub-tasks/shared/` layout. There are no generated batch-io copies or synchronization step. The skill owns only its `src/batch-schema.mjs` adapter and native vocabulary/validator. Its descriptor declares `dependsOn` and `sourceDependencies`; hosted runtime receipts and RoboTeam source verification include the shared module's hashes. Shared runtime changes require rebuilding the agent image.
