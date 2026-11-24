---
name: book-pdf
description: Export final semantic ScriptaHub book HTML to a downloadable PDF. Preserve the reader HTML and put a rights notice in the PDF footer.
---

Run the ScriptaHub task helper with skill `book-pdf` and args `["export", "INPUT.html", "--output", "book.pdf", "--language", "LANG"]` using paths inside the current task. Use the full staged reader in that language. The isolated runtime prints with Chromium and returns the SHA-256 of the HTML and PDF. It has no editorial or translation step. The footer identifies the edition and attributes rights to their holders without changing the licence.

The exporter checks that the PDF contains the full reader's text and the rights notice before saving. It keeps short compounds together with their original hyphens and allows extraction to split a longer word across physical lines. For a local command use Node.js 22+, `VALIDATEBOOK_CHROMIUM` pointing to Chromium, and Poppler `pdftotext`. This skill reuses the browser and document readiness helpers from `validate-book`.
