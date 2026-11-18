# Job format

The schema is exact and deliberately unversioned. No legacy shapes are accepted.

## Layout

```text
.marketingsummary-jobs/<source>-<hash>/
  job.json
  context.json
  source-original.html
  chapters.json
  batches/batch-0001.json
  analyses/batch-0001.json
  synthesis.json
  draft.json
  review.json
  candidate.html
  report.json
```

## Batch analysis

Write one `analyses/<batch-name>.json` for every batch:

```json
{
  "batch": "batch-0001.json",
  "chapterId": "chapter-0001",
  "segment": 1,
  "modeSignals": ["nonfiction"],
  "safeHooks": [
    {
      "id": "batch-0001-hook-001",
      "type": "question",
      "statement": "The book asks what ...",
      "sourceUnitIds": ["u000001"]
    }
  ],
  "protectedRevelations": [
    {
      "id": "batch-0001-revelation-001",
      "type": "answer",
      "statement": "The answer ultimately given by the source.",
      "guardTerms": ["distinctive answer phrase"],
      "sourceUnitIds": ["u000002"]
    }
  ],
  "audit": {
    "chapterCovered": true,
    "questionsIdentified": true,
    "revelationsSeparated": true,
    "factsPreserved": true,
    "notes": ""
  }
}
```

`modeSignals` contains one or both of `fiction` and `nonfiction`. Safe-hook types are `premise`, `question`, `stakes`, `approach`, `atmosphere`, `starting-conflict`, and `reader-fit`. Revelation types are `answer`, `conclusion`, `solution`, `recommendation`, `twist`, `resolution`, and `outcome`. Guard terms contain distinctive phrases of at least three words that would disclose the revelation if reproduced. A batch may have no protected revelation, but it must have at least one safe hook.

## Synthesis

After all analyses pass, write:

```json
{
  "mode": "nonfiction",
  "positioning": {
    "headlineAngle": "...",
    "readerPromise": "...",
    "audience": "...",
    "tone": "editorial, persuasive, restrained"
  },
  "selectedHooks": [
    {
      "id": "selected-hook-001",
      "statement": "...",
      "hookIds": ["batch-0001-hook-001"],
      "sourceUnitIds": ["u000001"]
    }
  ],
  "protectedRevelationIds": ["batch-0001-revelation-001"],
  "outline": [
    {
      "id": "section-01",
      "role": "stakes",
      "title": "...",
      "budgetWords": 100,
      "selectedHookIds": ["selected-hook-001"]
    }
  ],
  "chapterCoverage": [
    {"chapterId": "chapter-0001", "hookIds": ["batch-0001-hook-001"]}
  ],
  "audit": {
    "allAnalysesUsed": true,
    "spoilerBoundaryDefined": true,
    "noAnswersSelected": true,
    "notes": ""
  }
}
```

`mode` is `fiction`, `nonfiction`, or `hybrid`. Every protected revelation from every analysis must appear exactly once in `protectedRevelationIds`. Every content chapter appears exactly once in `chapterCoverage`; an empty hook list records deliberate omission from the final copy. Outline roles are `stakes`, `questions`, `approach`, `reader-fit`, and `open-loop`.

## Draft

Write only after synthesis validation succeeds:

```json
{
  "title": "...",
  "dek": "...",
  "sections": [
    {
      "id": "section-01",
      "role": "stakes",
      "heading": "...",
      "paragraphs": [
        {
          "text": "...",
          "selectedHookIds": ["selected-hook-001"],
          "sourceUnitIds": ["u000001"],
          "audit": {
            "factsPreserved": true,
            "noUnsupportedPromise": true,
            "noSpoiler": true
          }
        }
      ]
    }
  ],
  "closing": {
    "text": "...",
    "selectedHookIds": ["selected-hook-001"],
    "sourceUnitIds": ["u000001"],
    "audit": {
      "factsPreserved": true,
      "noUnsupportedPromise": true,
      "noSpoiler": true
    }
  },
  "audit": {
    "sameLanguage": true,
    "salesPageShape": true,
    "subtleClosing": true,
    "notes": ""
  }
}
```

Section IDs, roles, order, and hook use must agree with the outline. Every paragraph and the closing cite selected hooks and source units allowed by those hooks. The complete counted draft must fit the range in `job.json`.

## Independent spoiler review

After reading the complete draft, synthesis, and all protected revelations, write:

```json
{
  "draftSha256": "<sha256 of draft.json bytes>",
  "paragraphs": [
    {
      "location": "hero:title",
      "spoilerRisk": false,
      "matchedRevelationIds": [],
      "notes": ""
    },
    {
      "location": "hero:dek",
      "spoilerRisk": false,
      "matchedRevelationIds": [],
      "notes": ""
    },
    {
      "location": "section-01:p001",
      "spoilerRisk": false,
      "matchedRevelationIds": [],
      "notes": ""
    },
    {
      "location": "closing:p001",
      "spoilerRisk": false,
      "matchedRevelationIds": [],
      "notes": ""
    }
  ],
  "passed": true,
  "answersWithheld": true,
  "twistsWithheld": true,
  "openLoopsPreserved": true,
  "notes": ""
}
```

The title, dek, every visible body paragraph, and the closing must be reviewed exactly once in that order. Any possible semantic leak sets `spoilerRisk` true, names the matched revelations, and makes `passed` false. Revise the draft, then replace the stale review with a new review carrying the new byte-level hash.

The Node.js implementation preserves this job contract. Frozen JSON fixtures record the expected outputs.

Language tags use hyphenated BCP 47 syntax and are normalized by Node.js
`Intl.Locale`. The source language comes from HTML unless explicitly overridden.


## Constrained batch input and submission

Before analyzing or translating a batch, run `scripts/marketingsummary batch-contract JOB --batch batch-NNNN.json`. Read the returned skill-specific JSON Schema, exact batch identity, allowed source-unit IDs, source hash and batch digest together with the actual batch and frozen job context. Pass this contract unchanged to the assigned worker. Do not reuse another skill's enum values or another batch's IDs. The contract is read-only; it does not approve semantic content.

Submit the complete analysis/translation JSON on standard input to `scripts/marketingsummary submit-batch JOB --batch batch-NNNN.json --batch-sha256 SHA`. Use the digest returned by batch-contract. In ScriptaHub, invoke both commands through `scriptahub-tasks exec`; put the serialized candidate JSON in `input` for submit-batch, not in a shell argument. Native calls remain serialized by the coordinator; workers return candidate JSON to it and never patch the analyses/translations files directly.

Submission verifies the source hash, batch digest, exact schema and native analysis rules before saving formatted JSON atomically to that batch's own result path. A rejected submission returns structured errors and its exact contract, exits nonzero and leaves existing bytes unchanged. Correct the candidate in memory and resubmit; never use apply_patch to repair the stored batch. An identical accepted result is idempotent; a different candidate cannot replace an accepted batch by default. For a concrete later review finding, reread batch-contract and supply --replace-sha256 with existing.sha256; a stale digest is rejected, and the replacement must pass every admission check. Analysis acceptance does not replace synthesis, drafting, semantic review, build or independent final validation. Audit flags may be true only after actual review. Translation markup tokens and exact required unit membership are checked before saving; final language/structure checks remain mandatory.


### Shared batch runtime dependency

This skill imports `../../scriptahub-tasks/shared/batch-io.mjs` from its scripts and source modules. Distribute it together with the sibling `scriptahub-tasks/shared/` directory, keeping the `skills/<skill>/` and `skills/scriptahub-tasks/shared/` layout. There are no generated batch-io copies or synchronization step. The skill owns only its `src/batch-schema.mjs` adapter and native vocabulary/validator. Its descriptor declares `dependsOn` and `sourceDependencies`; hosted runtime receipts and RoboTeam source verification include the shared module's hashes. Shared runtime changes require rebuilding the agent image.
