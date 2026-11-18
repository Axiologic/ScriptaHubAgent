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

There are no generated copies or synchronization commands. The image copies the skills tree once. Dependent descriptors declare `sourceDependencies: ["scriptahub-tasks/shared"]`; image preparation records those dependencies, and native runtime and RoboTeam processing fingerprints both include every source file under this directory. Missing or mismatched shared sources prevent admission.
