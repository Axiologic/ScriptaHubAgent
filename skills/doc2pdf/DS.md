# DOC/DOCX to PDF design

The Node.js coordinator accepts local DOC and DOCX files, checks their container signatures and validates DOCX XML and ZIP checksums. LibreOffice Writer runs with a fresh profile and macro security level 3. All commands use explicit arguments and timeouts.

On Linux and macOS, a skill-local helper runs QPDF with private temporary files for stdout and stderr while the coordinator waits synchronously. Each stream has a monitored limit; disk use can overshoot between checks. Timeout and parent loss terminate and reap QPDF before cleanup when the helper is alive. A parent killed before helper startup or after helper exit, or a helper killed directly, can leave capture files behind. The worker's temporary filesystem and PID namespace bound those cases. Windows retains the synchronous subprocess path.

The raw LibreOffice PDF is the reference. Fidelity uses QPDF stream compression, object streams, linearization and metadata updates. Balanced and compact use Ghostscript image recompression at 300 and 150 DPI, respectively, followed by QPDF packaging. A candidate that fails quality gates is replaced by a validated fidelity candidate.

Poppler extracts text and fonts and renders every page at 96 DPI. QPDF inventories page geometry, links and outlines. QA checks text coverage, token order, page counts and dimensions, annotations, outline counts, blank pages, embedded fonts, text overflow and normalized pixel differences. Requested source fonts and source hyperlink counts produce advisory findings where the renderer cannot reproduce them exactly.

Publication is atomic and requires an ownership marker when overwriting. Optional --keep-qa-artifacts retains PDFs, RGB PPM page rasters and qa.json in a hidden sibling directory. Native installation is an explicit operation, separate from conversion. install-deps returns reviewable package-manager commands; --yes executes them after authorization.
