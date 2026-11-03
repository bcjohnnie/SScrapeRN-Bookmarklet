# SScrapeRN bookmarklet

The bookmarklet build: `build.mjs` bundles `../extension/scrape-core.js` with
`src/sscrapern.js` into one `javascript:` link and writes:

- `dist/install.html`: the install page, with the drag-to-bookmarks button
  and the instructions. This is the file `../docs/index.html` is copied from.
- `dist/sscrapern.bookmarklet.txt`: the same code as plain text.
- `test-build/sscrapern.test.js`: a test build that skips the SSRN host
  check and captures downloads instead of saving them. Never ship it.

The build fails if test-only code leaks into the shipped build, or if the
code contains `fetch(`, `XMLHttpRequest` or `sendBeacon`.

## History as a file

A bookmarklet has no storage of its own, so download history is a CSV that
the user keeps:
- **First time:** "First time? Start a history file".
- **After that:** "Add today's counts to my history file…", then pick the
  newest `…_ssrn_download_history_<date>.csv`.

The bookmarklet reads that file and adds today's Downloads and Citations for
the papers on the page. It then saves the result under today's date.
- Running it twice on one day replaces that day's rows.
- One file can follow many author and series pages.
- Dates that a spreadsheet rewrote as `8/18/2026` are read back as ISO.
- A history CSV exported from the extension is accepted too.

## Profile archive

**Archive this profile…** writes `<chosen folder>/ssrn_author_<per_id>_<name>/`:
- `papers_<date>.csv` and `papers_<date>.json`: the papers, including what
  SSRN offers for each ("Free paper", "No PDF file" or "Fee paper").
- `profile_<date>.html`: the page as displayed, with scripts removed.
- `download-checklist.html`: every paper, marked To download, Saved, Sold
  by SSRN or No PDF on SSRN. It is static HTML with no scripts, and its
  Content Security Policy blocks every load.
- `manifest_<date>.csv`: the same list as a spreadsheet.
- An empty `pdfs/` folder, and `README.txt`.

**Check downloaded PDFs…** matches the PDFs in `pdfs/` (or in the archive
folder itself) to papers by the SSRN ID in the file name. It then rewrites
the checklist and the manifest. It never moves or renames files.

Choosing a folder needs Chrome or Edge. Other browsers save the files to
Downloads instead.

## Tests

See the top-level README.
