# Job format

The schema is exact and deliberately unversioned. No legacy shapes are accepted.

## Layout

```text
.comprehensivesummary-jobs/<source>-<minutes>min-<hash>/
  job.json
  context.json
  source-original.html
  chapters.json
  batches/batch-0001.json
  analyses/batch-0001.json
  synthesis.json
  draft.json
  candidate.html
  report.json
```

## Chapter analysis

`chapters.json` retains excluded copyright sections and their unit IDs with
`included: false` and `exclusionReason: "legal-or-metadata"`. Explicit
`doc-copyright` roles or exact `source-copyright` section classes classify long
production notes as non-content too. Excluded sections receive no analysis batch.

For each `batches/<name>.json`, write `analyses/<name>.json`:

```json
{
  "batch": "batch-0001.json",
  "chapterId": "chapter-0001",
  "segment": 1,
  "thesis": "...",
  "role": "...",
  "ideas": [
    {
      "id": "batch-0001-idea-001",
      "statement": "...",
      "centrality": 0.8,
      "originality": 0.6,
      "recurrenceCandidate": "short semantic key",
      "sourceUnitIds": ["u000001"]
    }
  ],
  "evidenceAndExamples": [
    {"statement": "...", "sourceUnitIds": ["u000002"]}
  ],
  "objectionsAndQualifications": [
    {"statement": "...", "sourceUnitIds": ["u000003"]}
  ],
  "audit": {
    "chapterCovered": true,
    "meaningPreserved": true,
    "factsPreserved": true,
    "notes": ""
  }
}
```

IDs must belong to the assigned batch, scores are between 0 and 1, and all audit booleans are true. A split chapter produces one analysis per segment and is unified during synthesis.

## Cross-book synthesis

After all analyses are valid, write `synthesis.json`:

```json
{
  "centralMessage": "...",
  "clusters": [
    {
      "id": "cluster-001",
      "label": "...",
      "synthesis": "...",
      "centrality": 0.9,
      "recurrence": 0.7,
      "originality": 0.6,
      "score": 0.8,
      "selected": true,
      "chapterIds": ["chapter-0001"],
      "sourceUnitIds": ["u000001"],
      "ideaIds": ["batch-0001-idea-001"]
    }
  ],
  "outline": [
    {
      "id": "section-01",
      "title": "...",
      "purpose": "...",
      "budgetWords": 350,
      "clusterIds": ["cluster-001"]
    }
  ],
  "chapterCoverage": [
    {"chapterId": "chapter-0001", "clusterIds": ["cluster-001"]}
  ],
  "audit": {
    "allAnalysesUsed": true,
    "centralMessageCovered": true,
    "redundancyMerged": true,
    "notes": ""
  }
}
```

`score` equals `0.50 × centrality + 0.25 × recurrence + 0.25 × originality`, within rounding tolerance. Every content chapter appears once in `chapterCoverage`; an empty `clusterIds` list explicitly records an analyzed chapter omitted from a short final summary.

## Draft

Write `draft.json` only after synthesis passes:

```json
{
  "title": "...",
  "dek": "...",
  "sections": [
    {
      "id": "section-01",
      "heading": "...",
      "paragraphs": [
        {
          "text": "...",
          "clusterIds": ["cluster-001"],
          "sourceUnitIds": ["u000001"],
          "audit": {
            "meaningPreserved": true,
            "factsPreserved": true,
            "noUnsupportedClaim": true
          }
        }
      ]
    }
  ],
  "conclusion": [
    {
      "text": "...",
      "clusterIds": ["cluster-001"],
      "sourceUnitIds": ["u000001"],
      "audit": {
        "meaningPreserved": true,
        "factsPreserved": true,
        "noUnsupportedClaim": true
      }
    }
  ],
  "audit": {
    "sameLanguage": true,
    "centralMessagePreserved": true,
    "coherentEssay": true,
    "notes": ""
  }
}
```

Section IDs must match the synthesis outline. Every paragraph needs selected cluster IDs and valid source-unit IDs. All booleans are mandatory and true. Adjust the draft until its counted words fall within the range recorded in `job.json`.

The built HTML keeps word-budget and estimated-duration values in the validation report and hidden metadata only. It must not render those internal metrics as reader-facing content.

## Runtime

The Node.js implementation uses the command arguments and JSON shapes documented
here. Reference fixtures in tests/fixtures verify preparation, state transitions
and generated artifacts.

Language tags use hyphenated BCP 47 syntax and are normalized by Node.js
`Intl.Locale`. The source language comes from HTML unless explicitly overridden.


## Constrained batch input and submission

Before analyzing or translating a batch, run `scripts/comprehensivesummary batch-contract JOB --batch batch-NNNN.json`. Read the returned skill-specific JSON Schema, exact batch identity, allowed source-unit IDs, source hash and batch digest together with the actual batch and frozen job context. Pass this contract unchanged to the assigned worker. Do not reuse another skill's enum values or another batch's IDs. The contract is read-only; it does not approve semantic content.

Submit the complete analysis/translation JSON on standard input to `scripts/comprehensivesummary submit-batch JOB --batch batch-NNNN.json --batch-sha256 SHA`. Use the digest returned by batch-contract. In ScriptaHub, invoke both commands through `scriptahub-tasks exec`; put the serialized candidate JSON in `input` for submit-batch, not in a shell argument. Native calls remain serialized by the coordinator; workers return candidate JSON to it and never patch the analyses/translations files directly.

Submission verifies the source hash, batch digest, exact schema and native analysis rules before saving formatted JSON atomically to that batch's own result path. A rejected submission returns structured errors and its exact contract, exits nonzero and leaves existing bytes unchanged. Correct the candidate in memory and resubmit; never use apply_patch to repair the stored batch. An identical accepted result is idempotent; a different candidate cannot replace an accepted batch by default. For a concrete later review finding, reread batch-contract and supply --replace-sha256 with existing.sha256; a stale digest is rejected, and the replacement must pass every admission check. Analysis acceptance does not replace synthesis, drafting, semantic review, build or independent final validation. Audit flags may be true only after actual review. Translation markup tokens and exact required unit membership are checked before saving; final language/structure checks remain mandatory.


### Shared batch runtime dependency

This skill imports `../../scriptahub-tasks/shared/batch-io.mjs` from its scripts and source modules. Distribute it together with the sibling `scriptahub-tasks/shared/` directory, keeping the `skills/<skill>/` and `skills/scriptahub-tasks/shared/` layout. There are no generated batch-io copies or synchronization step. The skill owns only its `src/batch-schema.mjs` adapter and native vocabulary/validator. Its descriptor declares `dependsOn` and `sourceDependencies`; hosted runtime receipts and RoboTeam source verification include the shared module's hashes. Shared runtime changes require rebuilding the agent image.
