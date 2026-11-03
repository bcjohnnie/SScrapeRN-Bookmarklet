// Build dist/install.html (drag-to-bookmarks link) and dist/sscrapern.bookmarklet.txt from
// ../extension/scrape-core.js + src/sscrapern.js.
// Usage: node build.mjs
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { minify } from 'terser';
import { createHash } from 'node:crypto';

// The scraping core is shared with the extension; one function wraps both
// files so SScrapeRNCore never becomes a page global (a second click on the
// bookmark would otherwise fail with "already declared").
const core = await readFile(new URL('../extension/scrape-core.js', import.meta.url), 'utf8');
const main = await readFile(new URL('./src/sscrapern.js', import.meta.url), 'utf8');
const src = `(function () {\n${core}\n${main}\n})();\n`;
// The build label shown in the panel header: date plus a hash of the source, so
// two builds on one day are told apart and a stale bookmark is easy to spot.
const version = new Date().toISOString().slice(0, 10);
const buildLabel = `${version} · ${createHash('sha256').update(src).digest('hex').slice(0, 7)}`;
// SSCR_TEST=false strips the host check bypass and the test hooks from the shipped bookmarklet.
const build = test => minify(src, {
  compress: { global_defs: { SSCR_TEST: test, SSCR_BUILD: buildLabel } }, mangle: true, format: { comments: false },
});
const { code } = await build(false);
if (code.includes('__sscrTest') || code.includes('__sscrDownloads')) throw new Error('test hook leaked into the shipped build');
// The tool must make no requests to SSRN.
if (/\bfetch\s*\(|XMLHttpRequest|sendBeacon/.test(code)) throw new Error('a network request found its way into the bookmarklet');
const { code: testCode } = await build(true);
const bookmarklet = 'javascript:' + encodeURIComponent(code);
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>SScrapeRN — install</title>
<style>
  body{font:16px/1.5 system-ui,sans-serif;max-width:720px;margin:40px auto;padding:0 16px;color:#222}
  .bm{display:inline-block;padding:8px 14px;background:#8b1a2b;color:#fff;border-radius:6px;text-decoration:none;font-weight:600}
  textarea{width:100%;height:90px;font:11px monospace}
  code{background:#f2f2f2;padding:1px 4px}
</style></head><body>
<h1>SScrapeRN: SSRN papers to CSV</h1>
<p>Build ${buildLabel} (shown in the panel's header). Nothing to install: this is a bookmark that runs on an SSRN page.</p>
<h2>1. Add the bookmark</h2>
<p>Show your bookmarks bar (<code>Ctrl+Shift+B</code> on Windows, <code>Cmd+Shift+B</code> on Mac), then
<b>drag this button onto it</b>:</p>
<p><a class="bm" href="${esc(bookmarklet)}">SScrapeRN</a></p>
<h2>What the panel does</h2>
<p>SScrapeRN only reads what an SSRN page already shows. It sends no requests to SSRN and clicks nothing on SSRN's
page, so it does nothing a person reading the page doesn't. The panel offers, in order:</p>
<ul>
  <li><b>Archive this profile… (recommended)</b>: a whole folder with the papers (CSV and JSON), a copy of the page,
      a README and a <b>checklist for downloading the PDFs yourself</b>. Use this to preserve a profile.</li>
  <li><b>Download papers CSV</b>: just the spreadsheet of every paper on the page, straight to Downloads.</li>
  <li><b>Download tracking (optional)</b>: one spreadsheet you keep that records each paper's download and citation
      counts every time you run it.</li>
</ul>
<h2>2. Before you click anything in the panel</h2>
<ol>
  <li>Open an SSRN <b>author page</b> (<code>papers.ssrn.com/sol3/cf_dev/AbsByAuth.cfm?per_id=…</code>)
      or a <b>research paper series page</b> (<code>www.ssrn.com/index.cfm/en/…</code>).</li>
  <li>Above the paper list, click SSRN's <b>All Versions</b> (if it's there) and <b>All Abstracts</b>. Wait until the
      abstracts show under the papers. (SSRN counts these as abstract views, as it does for anyone who clicks them.)
      If you skip either, the panel warns you before saving anything.</li>
  <li>Click the bookmark. A panel opens at the top right.</li>
</ol>
<h2>3. Archive this profile (recommended)</h2>
<p>Click <b>Archive this profile…</b> and choose a folder (Chrome or Edge; other browsers save the files to
Downloads). It writes a folder named <code>ssrn_author_&lt;id&gt;_&lt;name&gt;</code> with:</p>
<ul>
  <li>the papers as CSV and JSON (abstracts, keywords, links, co-author profile links);</li>
  <li>a copy of the page, and a README saying when it was captured;</li>
  <li><code>download-checklist.html</code>: every paper, linked to its SSRN page, marked <b>To download</b>, <b>Saved</b>,
      <b>Sold by SSRN</b> or <b>No PDF on SSRN</b>;</li>
  <li>an empty <code>pdfs</code> folder for the PDFs you download.</li>
</ul>
<p><b>Downloading the PDFs is up to you, by hand.</b> Open the checklist, click each title marked To download, click
SSRN's <b>Download This Paper</b>, and save the PDF into the archive's <code>pdfs</code> folder. Keep the file name
SSRN gives it: it contains the paper's ID, which is how files are matched to papers. Go at your own pace, and
consider asking the authors first: SSRN counts each one as a download of that paper.</p>
<p>Then, from any SSRN page, click the bookmark, click <b>Check downloaded PDFs…</b> and pick the archive folder. The
checklist and <code>manifest_&lt;date&gt;.csv</code> are rewritten to show which papers have a PDF and which are still to
download. Check as often as you like; it reads only your folder.</p>
<p>Archiving the same profile again later (into the same place) refreshes the metadata and keeps the PDFs already
saved.</p>
<h2>4. Papers list (CSV only)</h2>
<p>Click <b>Download papers CSV</b> for just the spreadsheet, saved straight to Downloads. It has the same columns as
the archive's papers file. Keywords, PDF links and what SSRN offers for each paper (free PDF, no PDF, or sold) are
read from the page. <b>DOIs</b> aren't included: SSRN shows them only on each paper's own page. Series pages show 50
papers at a time: export each page and combine the files.</p>
<h2>5. Download tracking (optional)</h2>
<p>This builds one spreadsheet of each paper's download and citation counts over time: a row per paper per date you
run it. It lives in a file you keep; nothing is stored in the browser. (The archive already records today's counts,
so you only need this to follow them over months.)</p>
<ol>
  <li><b>The first time</b>, click <b>First time? Start a history file</b>. It saves
      <code>…_ssrn_download_history_&lt;date&gt;.csv</code> with today's counts.</li>
  <li><b>Each later time</b> (monthly, say), click <b>Add today's counts to my history file…</b> and pick the newest
      of those files. It saves a new copy, named with today's date, holding everything from before plus today's counts.
      Keep the newest copy; the older ones can be deleted.</li>
</ol>
<p>One history file can follow several authors: pick the same file on each author's page. Running it twice on the same
day replaces that day's counts rather than adding a second row. A history file exported from the SScrapeRN browser
extension can be picked too.</p>
<h2>If the bookmark does nothing</h2>
<p>Copy the code below, open the SSRN page, press <code>F12</code> (or <code>Cmd+Option+J</code> on Mac),
choose <b>Console</b>, paste and press Enter. Chrome may ask you to type <code>allow pasting</code> first.</p>
<textarea readonly onclick="this.select()">${esc(code)}</textarea>
</body></html>
`;

await mkdir(new URL('./dist/', import.meta.url), { recursive: true });
await writeFile(new URL('./dist/install.html', import.meta.url), html);
await writeFile(new URL('./dist/sscrapern.bookmarklet.txt', import.meta.url), bookmarklet + '\n');
// For testing only: skips the host check, takes the history file from window.__sscrTestHistoryFile,
// and captures downloads in window.__sscrDownloads. Never ship.
await mkdir(new URL('./test-build/', import.meta.url), { recursive: true });
await writeFile(new URL('./test-build/sscrapern.test.js', import.meta.url), testCode + '\n');
console.log(`built ${buildLabel}: ${code.length} chars minified, ${bookmarklet.length} chars as bookmarklet`);
