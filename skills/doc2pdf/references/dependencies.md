# Runtime setup

Use Node.js >=22, LibreOffice Writer, QPDF >=11.4 and Poppler utilities pdftotext, pdffonts and pdftoppm. Balanced and compact also require Ghostscript.

On Linux and macOS, QPDF needs writable temporary storage for private stdout and stderr captures. The default limit is 256 MiB per stream; monitoring can overshoot between checks. The coordinator allows five seconds beyond the requested timeout for helper startup and cleanup.

Run scripts/doc2pdf doctor before conversion. PATH and common platform directories are searched. SCRIPTA_SOFFICE, SCRIPTA_QPDF, SCRIPTA_PDFTOTEXT, SCRIPTA_PDFFONTS, SCRIPTA_PDFTOPPM and SCRIPTA_GS can select explicit executables.

Run install-deps to review native package-manager commands. Run install-deps --yes only when installation is authorized. Automatic installation supports macOS Homebrew and Linux apt-get or dnf. See [the dependency record](../dependencies.md) for versions, licenses and update steps.
