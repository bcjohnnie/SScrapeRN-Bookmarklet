# SScrapeRN: SSRN papers to CSV

A bookmarklet that saves the paper list on an SSRN author page or
research-paper series page as a spreadsheet. On an author page it can also
set up an archive folder for that author.

**[Install it here](https://bcjohnnie.github.io/SScrapeRN-Bookmarklet/)**: drag the
button to your bookmarks bar. There's nothing else to install. Choosing an
archive folder needs Chrome or Edge; other browsers save to Downloads.

## What it does

Open an SSRN author page, click SSRN's own **All Versions** (if shown) and
**All Abstracts** links, wait for the abstracts to load, then click the
bookmark. A panel offers:

1. **Archive this profile (recommended).** Makes a folder for the author
   containing:
   - the paper list as CSV and JSON;
   - a copy of the page;
   - a download checklist that links each paper to its SSRN page;
   - an empty `pdfs/` folder.

   You download the PDFs from SSRN yourself and save them in `pdfs/`.
   **Check downloaded PDFs** then matches each file to its paper by the
   SSRN ID in the file name, and updates the checklist.
2. **Papers list (CSV only).** Just the spreadsheet.
3. **Download tracking (optional).** Adds today's download and citation
   counts to a history CSV that you keep.

The spreadsheet has these columns: title, authors with affiliations, venue,
abstract, keywords, pages, posted and revised dates, downloads, citations,
PDF link, abstract page link, and SSRN ID.

## What it doesn't do

- **It sends no requests to SSRN.** It reads only what the page in front
  of you already shows. The build fails if a network call appears in the
  code.
- **It clicks nothing on SSRN's page.** You click SSRN's links yourself. If
  you skip one, the panel warns you before saving.
- **It downloads no PDFs.** Downloading is left to you, through SSRN's own
  Download button.
- **It sends your data nowhere.** Files are saved only to your computer,
  and only where you choose. It loads no outside code.

SScrapeRN is not affiliated with SSRN or Elsevier. Use it in line with
SSRN's terms of use.

## Repository layout

| Path | What |
|---|---|
| `docs/` | The install page, served by GitHub Pages. Generated: don't edit by hand |
| `bookmarklet/src/sscrapern.js` | The panel, archive and history code |
| `extension/scrape-core.js` | The page-reading and CSV code, bundled into the bookmarklet |
| `extension/` | The same tool as a browser extension (Manifest V3). Not published to any store; load the folder unpacked |
| `bookmarklet/test/` | Test pages that model SSRN's markup |

## Build and test

You need Node.js 20 or later.

```bash
cd bookmarklet
npm install
node build.mjs
```

This writes `bookmarklet/dist/install.html`. Copy it to `docs/index.html`
to publish it.

To run the tests, serve the repository root and open each test page:

```bash
python3 -m http.server 8741
```

- http://localhost:8741/bookmarklet/test/author.html
- http://localhost:8741/bookmarklet/test/series.html
- http://localhost:8741/bookmarklet/test/extension-author.html

The page title changes to PASS or FAIL, and the results appear at the top
of the page.

The lint step:

```bash
bookmarklet/node_modules/.bin/eslint --config bookmarklet/eslint.config.mjs \
  extension/scrape-core.js extension/content.js bookmarklet/src/sscrapern.js
```

## License

MIT. See `LICENSE`.
