# Axiologic Reader resources

The reader is opened at `/reader/` and receives its edition in the query string. It selects the most adaptable available source in this order: **HTML**, **EPUB**, then **PDF**. An audio file is offered alongside the reading edition whenever one is available.

## Preferred convention

Keep source and generated files in their language directories, with the same basename:

```text
content/RO/Four_Realities_RO.pdf
content/RO/Four_Realities_RO.epub
content/htmls/RO/Four_Realities_RO.html
content/RO/Four_Realities_RO.mp3
```

Book pages pass the generated HTML URL explicitly because it lives under `content/htmls/`. The reader can still infer `.epub`, `.m4a`, `.mp3` and `.ogg` alternatives from the PDF URL. Every file must be served from the same origin.

For files whose names differ, use explicit parameters (all URLs must be URL-encoded):

```text
/reader/?id=four-realities-ro&title=Patru%20Realit%C4%83%C8%9Bi&html=https%3A%2F%2Fexample.com%2Fbook.html&epub=https%3A%2F%2Fexample.com%2Fbook.epub&pdf=https%3A%2F%2Fexample.com%2Fbook.pdf&audio=https%3A%2F%2Fexample.com%2Fbook.m4a
```

`id` is the durable identity used for saved reading progress. Use a distinct id for every language and edition, for example `four-realities-ro-2026`.

The reader stores only position and display preferences in browser `localStorage`: PDF page, EPUB CFI, HTML scroll percentage, audio time, type size and theme. It never uploads reading history.

## ScriptaHubAgent interface

The reader uses the same five themes as the site and stores the selected theme under the shared site preference. Navigation uses consistent SVG icons, with account access last. Reader text size ranges from 80% to 150% in 5% steps; the percentage button resets it to 100%. Reader text preferences remain separate from catalog text preferences. Controls wrap on narrow screens so pagination and text settings remain accessible. `reader-ui.css` styles the reader interface without modifying the published book files.
