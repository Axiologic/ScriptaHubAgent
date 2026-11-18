# Job format

The schema is exact and unversioned.

## Layout

```text
.shortdescription-jobs/<source>-<hash>/
  job.json
  context.json
  chapters.json
  source-original.html
  batches/batch-0001.json
  analyses/batch-0001.json
  draft.json
  review.json
  candidate.html
```

The whole directory is removed after a successful build.

## Batch analysis

Write one matching file under `analyses/` for every batch:

```json
{
  "batch": "batch-0001.json",
  "chapterId": "chapter-0001",
  "segment": 1,
  "modeSignals": ["nonfiction"],
  "themes": [
    {
      "id": "batch-0001-theme-001",
      "type": "subject",
      "statement": "The document examines ...",
      "sourceUnitIds": ["u000001"]
    }
  ],
  "protectedRevelations": [
    {
      "id": "batch-0001-revelation-001",
      "type": "solution",
      "statement": "The solution supplied by the source.",
      "guardTerms": ["distinctive solution phrase"],
      "sourceUnitIds": ["u000002"]
    }
  ],
  "audit": {
    "chapterCovered": true,
    "themeIdentified": true,
    "revelationsSeparated": true,
    "factsPreserved": true,
    "notes": ""
  }
}
```

`modeSignals` contains one or both of `fiction` and `nonfiction`. Theme types are `subject`, `scope`, `context`, `question`, `tension`, `premise`, `setting`, `character`, and `starting-conflict`. Revelation types are `answer`, `solution`, `conclusion`, `recommendation`, `verdict`, `twist`, `identity`, `resolution`, `outcome`, `fate`, and `ending`. Every guard phrase has at least three words. A batch needs at least one theme; its revelation list may be empty.

## Draft

After all analyses pass, write:

```json
{
  "mode": "nonfiction",
  "sentences": [
    {
      "index": 1,
      "text": "One complete thematic sentence.",
      "themeIds": ["batch-0001-theme-001"],
      "sourceUnitIds": ["u000001"]
    }
  ],
  "protectedRevelationIds": ["batch-0001-revelation-001"],
  "chapterCoverage": [
    {"chapterId": "chapter-0001", "themeIds": ["batch-0001-theme-001"]}
  ],
  "audit": {
    "sameLanguage": true,
    "themeOnly": true,
    "noSolutions": true,
    "noSpoilers": true,
    "neutralTone": true,
    "notes": ""
  }
}
```

Provide 4–6 sentences. Each `text` is exactly one grammatical sentence ending in `.`, `?`, or `!`. Every sentence cites valid themes and source units supported by those themes. Register every protected revelation exactly once. Every content chapter appears exactly once in `chapterCoverage`; an empty theme list records deliberate omission from the compact output.

## Independent semantic review

Read the complete draft and every protected revelation, then write:

```json
{
  "draftSha256": "<sha256 of draft.json bytes>",
  "sentences": [
    {
      "index": 1,
      "solutionRisk": false,
      "spoilerRisk": false,
      "matchedRevelationIds": [],
      "notes": ""
    }
  ],
  "passed": true,
  "solutionsWithheld": true,
  "conclusionsWithheld": true,
  "spoilersWithheld": true,
  "notes": ""
}
```

Review every draft sentence exactly once and in order. Any possible disclosure sets the applicable risk to true, lists matching revelation IDs, and makes `passed` false. Revise the draft and replace the stale review before building.

## Runtime compatibility

The Node.js implementation preserves this job contract. Frozen JSON fixtures preserve
the expected reference outputs.


## Constrained batch input and submission

Before analyzing or translating a batch, run `scripts/shortdescription batch-contract JOB --batch batch-NNNN.json`. Read the returned skill-specific JSON Schema, exact batch identity, allowed source-unit IDs, source hash and batch digest together with the actual batch and frozen job context. Pass this contract unchanged to the assigned worker. Do not reuse another skill's enum values or another batch's IDs. The contract is read-only; it does not approve semantic content.

Submit the complete analysis/translation JSON on standard input to `scripts/shortdescription submit-batch JOB --batch batch-NNNN.json --batch-sha256 SHA`. Use the digest returned by batch-contract. In ScriptaHub, invoke both commands through `scriptahub-tasks exec`; put the serialized candidate JSON in `input` for submit-batch, not in a shell argument. Native calls remain serialized by the coordinator; workers return candidate JSON to it and never patch the analyses/translations files directly.

Submission verifies the source hash, batch digest, exact schema and native analysis rules before saving formatted JSON atomically to that batch's own result path. A rejected submission returns structured errors and its exact contract, exits nonzero and leaves existing bytes unchanged. Correct the candidate in memory and resubmit; never use apply_patch to repair the stored batch. An identical accepted result is idempotent; a different candidate cannot replace an accepted batch by default. For a concrete later review finding, reread batch-contract and supply --replace-sha256 with existing.sha256; a stale digest is rejected, and the replacement must pass every admission check. Analysis acceptance does not replace synthesis, drafting, semantic review, build or independent final validation. Audit flags may be true only after actual review. Translation markup tokens and exact required unit membership are checked before saving; final language/structure checks remain mandatory.


### Shared batch runtime dependency

This skill imports `../../scriptahub-tasks/shared/batch-io.mjs` from its scripts and source modules. Distribute it together with the sibling `scriptahub-tasks/shared/` directory, keeping the `skills/<skill>/` and `skills/scriptahub-tasks/shared/` layout. There are no generated batch-io copies or synchronization step. The skill owns only its `src/batch-schema.mjs` adapter and native vocabulary/validator. Its descriptor declares `dependsOn` and `sourceDependencies`; hosted runtime receipts and RoboTeam source verification include the shared module's hashes. Shared runtime changes require rebuilding the agent image.
