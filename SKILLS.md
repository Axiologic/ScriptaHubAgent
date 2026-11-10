# ScriptaHub processing skills

The repository owns all thirteen skills in the root `skills/` directory. Workflow definitions live in root `flows/`; the service implementation remains in `scriptahubAgent/`.

The catalogue contains `comprehensive-summary`, `doc2pdf`, `html2doc`, `humanise-html`, `marketing-summary`, `pdf2html`, `relevant-keywords`, `scriptahub-tasks`, `shf-presentation-creator`, `short-description`, `theatrical-audio`, `translate-html` and `validate-book`. Each skill documents its commands and dependencies in its own folder.

Installed npm packages, Python environments, native tools, model weights and caches belong to the ScriptaHub agent runtime and assets image, not Git. Rebuild and verify the agent image when skill sources or dependencies change. RoboTeam selects source skills and invokes their processing through ScriptaHub's authenticated MCP tools.
