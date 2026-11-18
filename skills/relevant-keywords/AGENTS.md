# Repository guidance

Use Node.js >=22 ECMAScript modules, relative imports and Node's built-in test runner. Keep the HTML parser, notices and dependency records inside this skill.

The active LLM reads every source batch and consolidates the final keywords. Node validates source identity, JSON schemas, citations, counts and configured synonyms. Preserve source HTML byte-for-byte and replace relevantKeywords.txt atomically only after complete review.

Keep documentation, schemas, code, tests and comments in English. Update SKILL.md, README.md, DS.md, skill.json and tests together when behavior changes. Run node --test tests/*.test.mjs and scripts/relevantkeywords doctor before delivery.


## Shared module dependency

Batch admission and common schema builders live in `skills/scriptahub-tasks/shared/batch-io.mjs`. Import that module directly; do not copy or generate a batch-io.mjs inside this skill. Keep the skill-specific adapter here. Distribution must include the declared sibling shared dependency; this rule supersedes the former all-resources-inside-one-folder requirement for batch admission.
