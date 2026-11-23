# ScriptaHub processing skills

The repository owns all thirteen skills in the root `skills/` directory. Workflow definitions live in root `flows/`; the service implementation remains in `scriptahubAgent/`.

The catalogue contains `comprehensive-summary`, `doc2pdf`, `html2doc`, `humanise-html`, `marketing-summary`, `pdf2html`, `relevant-keywords`, `scriptahub-tasks`, `shf-presentation-creator`, `short-description`, `theatrical-audio`, `translate-html` and `validate-book`. Each skill documents its commands and dependencies in its own folder.

Installed npm packages, Python environments, native tools, model weights and caches belong to the ScriptaHub agent runtime and assets image, not Git. Skill sources and `SKILL.md` files run from the deployed checkout, so updating the checkout is enough; they need no image rebuild. Rebuild and publish the agent image only when the dependency fingerprint changes (see the README). RoboTeam selects source skills and invokes their processing through ScriptaHub's authenticated MCP tools.


The four editorial skills and translate-html depend on the common module under `scriptahub-tasks/shared/`. Bundle that sibling directory when exporting those skills. Their descriptor sourceDependencies are included in hosted and RoboTeam source fingerprints. batch-schema.mjs remains a small adapter specific to each skill; batch-io.mjs exists only once.
