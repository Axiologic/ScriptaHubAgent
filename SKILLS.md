# ScriptaHub processing skills

The repository owns all thirteen skills in the root `skills/` directory. Workflow definitions live in root `flows/`; the service implementation remains in `scriptahubAgent/`.

The catalogue contains `comprehensive-summary`, `doc2pdf`, `html2doc`, `humanise-html`, `marketing-summary`, `pdf2html`, `relevant-keywords`, `scriptahub-tasks`, `shf-presentation-creator`, `short-description`, `theatrical-audio`, `translate-html` and `validate-book`. Each skill documents its commands and dependencies in its own folder.

Installed npm packages, Python environments, downloaded native tools, model weights and caches belong to prepared runtime images, not Git. Application and robot Dockerfiles copy `skills/` from the repository build context; their installed runtime keeps its internal `skills/` path. Moving source folders does not move installed dependencies. Rebuild and verify the matching images before deploying these sources.
