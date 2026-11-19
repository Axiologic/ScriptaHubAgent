# Shared batch module

`batch-io.mjs` is the single implementation of batch contracts, structural admission, atomic JSON persistence and reusable schema builders. It has no service or model dependency; the owning scriptahub-tasks skill already accompanies ScriptaHub workflow execution.

The four editorial skills and translate-html import this module directly. Each skill keeps its own `src/batch-schema.mjs` adapter and supplies `{schemaFor, validate}` to `handleBatch`. The common module never locates a schema by guessing another skill's path.

Distribute the selected skill folders and this shared directory together, retaining their sibling layout:

```text
skills/
  scriptahub-tasks/shared/batch-io.mjs
  short-description/scripts/shortdescription.mjs
  short-description/src/batch-schema.mjs
```

The image copies the skills tree once. Dependent descriptors declare `sourceDependencies: ["scriptahub-tasks/shared"]`; image preparation records those dependencies, and native runtime and RoboTeam processing fingerprints both include every source file under this directory. Missing or mismatched shared sources prevent admission.


## Batch command contract

Each dependent native CLI exposes `batch-contract JOB --batch NAME` and `submit-batch JOB --batch NAME --batch-sha256 SHA`. The first returns the selected skill's exact schema, current batch IDs, source/batch hashes and the existing result hash. Read the actual batch and that contract before generating a candidate. Send the complete JSON candidate on stdin through the host's authorized execution path.

Submission validates source/batch identity, nested schema constraints and the native validator, then atomically saves formatted JSON in the matching result file. Rejections return structured errors and preserve existing bytes; correct the candidate in memory and resubmit. Identical results are idempotent. An evidenced correction to accepted content requires --replace-sha256 with the current existing.sha256; stale replacements are refused. Set audit flags only after actual review. Continue the selected skill's semantic stages, build and independent validation after batch acceptance.
