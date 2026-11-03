# SSRN Papers → CSV

A small browser extension for two kinds of SSRN pages:

- **Author profile pages**, e.g.
  `https://papers.ssrn.com/sol3/cf_dev/AbsByAuth.cfm?per_id=...`
- **Research paper series / journal pages**, e.g.
  `https://www.ssrn.com/index.cfm/en/<series>/`

It adds a floating **"⬇ Export Papers to CSV"** button. Click it and it
scrapes every paper listed on the page and downloads a CSV.

## CSV columns

Title, Authors (with Affiliations), Venue / Publication, Abstract,
Keywords, DOI, Number of Pages, Posted Date, Last Revised Date, Downloads,
Citations, PDF URL, Abstract Page URL, Abstract ID

## Before you export: click SSRN's links yourself

The extension only reads what the page already shows. It sends no requests
to SSRN and clicks nothing on SSRN's page.

On **author profile pages**:
- **Keywords**, the **PDF link** and what SSRN offers for each paper are
  already in the page, so they are read directly.
- **Abstracts** are not. SSRN loads them only when someone clicks **"All
  Abstracts"** above the paper list. Click it yourself (and **"All
  Versions"**, if shown), wait for the abstracts to appear, then export.
- If you export before doing that, or while abstracts are still arriving,
  the extension warns you first. OK exports what the page shows; Cancel
  lets you go back.
- SSRN counts each loaded abstract as an **abstract view**, as it does for
  anyone who clicks the link.

Series pages have no such section, so these fields stay blank there.

## DOI: not collected

The DOI appears only on each paper's own page, and fetching those pages
would be automated requests to SSRN, so the DOI column stays blank.

## Tracking download counts over time

Click **"⬇ Export Papers to CSV"** as usual whenever you want — every time
you do, the extension also quietly records a dated snapshot (Downloads +
Citations) for each paper into its own persistent storage, separate from
the CSV file itself (a browser extension can't read back or append to a
file you've already downloaded, so this is the only reliable way to build
up history across visits).

Click **"📈 Export Download History"** any time to get a CSV of everything
recorded so far — one row per paper *per date you exported*, so you can
track month-over-month growth. Columns: Abstract ID, Title, Authors (with
Affiliations), Venue / Publication, Abstract Page URL, Date Collected,
Downloads, Citations. Re-running this always regenerates the *complete*
history from scratch, so there's nothing to manually merge — just export
on whatever cadence you like (e.g. monthly) and pull the history file
whenever you want to see the trend.

Re-exporting on the same day updates that day's snapshot instead of
creating a duplicate row, so it's safe to run more than once in a day
while testing.

Click **"Reset stored history"** (small link at the bottom of the panel)
to permanently delete all recorded snapshots — useful if you want a clean
slate. This only clears the extension's internal storage; it doesn't
affect any CSV files you've already downloaded.

## Install (Chrome / Edge / Brave)

1. Go to `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and select this `ssrn-csv-exporter` folder.
4. Visit an SSRN author page or research series page.
5. Click the button in the top-right corner of the page.

## Install (Firefox)

Firefox requires signed extensions for permanent installs, but you can load
it temporarily for testing:

1. Go to `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on…**.
3. Select the `manifest.json` file inside this folder.
4. Visit an SSRN author page or research series page and click the button.

(Temporary add-ons are removed when Firefox restarts. For a permanent
install you'd submit it to addons.mozilla.org for signing, or use Firefox
Developer/Nightly with `xpinstall.signatures.required` disabled.)

## Notes & things worth knowing

- **Series/journal pages paginate**: a page like the example above can
  list hundreds of papers across many pages (e.g. "Displaying 1-50 of
  920 papers"). The extension exports whatever page of results you're
  currently viewing — to get everything, page through the results and
  run the export on each page, then combine the CSVs.
- **Sidebar widgets are excluded**: series pages often show "Top
  Downloaded Papers" / "Top Cited Papers" sidebar lists — these are
  automatically excluded, since only the main paginated results list
  (below the "Displaying X-Y of Z papers" line) is exported.
- **Heuristic parsing**: SSRN doesn't publish a stable API for this, and
  its two page templates (classic author pages vs. newer series pages)
  use different markup. The extension tries a precise, class-based
  extractor first (for pages using `.paper-wrap`/`.authors`/
  `.affiliations` markup) and falls back to a generic text-block heuristic
  otherwise. If a field ever comes back empty or wrong, the console
  (`F12`) will log a warning for any paper block that fails to parse.
- **No data leaves your browser**: everything happens client-side; the
  CSV is generated and downloaded locally. The extension makes no requests
  to SSRN at all; it reads the page you are looking at. The download
  history is likewise stored only in your browser's local extension
  storage (`storage` permission) — never uploaded anywhere.
- **History storage is per-browser-profile**: since it uses the browser's
  own extension storage, history recorded in one browser/profile won't
  show up in another. If you use both Chrome and Firefox, treat each as
  tracking its own separate history.

## Files

- `manifest.json` — extension configuration (Manifest V3)
- `scrape-core.js` — all page reading, abstract loading and CSV building;
  shared with the bookmarklet (`../bookmarklet/`), loaded before content.js
- `content.js` — the panel and the download history in extension storage
- `content.css` — styling for the floating button/status panel
