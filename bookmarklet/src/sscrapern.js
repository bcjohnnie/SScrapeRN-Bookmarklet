// SScrapeRN — SSRN papers -> CSV, bookmarklet version.
// Run on:
//   - https://papers.ssrn.com/sol3/cf_dev/AbsByAuth.cfm?per_id=... (author profile pages)
//   - https://www.ssrn.com/index.cfm/en/<series>/ (research paper series / journal pages)
//
// Same scraping as the extension in ../extension/content.js. The one real
// difference is download history: a bookmarklet has no extension storage, so
// the history lives in a CSV file the user keeps. Each run reads the previous
// history file (picked by the user), adds today's Downloads/Citations for the
// papers on this page, and downloads the merged file under a new date.
//
// It reads only what the page already shows: no requests to SSRN, and no
// clicks on SSRN's page.
/* global SSCR_TEST, SSCR_BUILD, SScrapeRNCore */
(function () {
  'use strict';
  if (window.__sscrapern) { window.__sscrapern.show(); return; }

  const TEST = typeof SSCR_TEST !== 'undefined' && SSCR_TEST;

  // Shared with the extension: ../../extension/scrape-core.js, bundled in
  // ahead of this file by build.mjs.
  const {
    CSV_HEADERS, pdfLinkFor, configure, collectPapers, scrapeListPage, waitForAnchors,
    readinessWarnings, csvEscape, buildCsv, guessAuthorName, todayDateStamp, safeFilename
  } = SScrapeRNCore;

  const IS_AUTHOR_PAGE =
    location.hostname === 'papers.ssrn.com' && /\/AbsByAuth\.cfm/i.test(location.pathname);
  const IS_SERIES_PAGE =
    location.hostname === 'www.ssrn.com' && /^\/index\.cfm\/en\//i.test(location.pathname);
  if (!TEST && !IS_AUTHOR_PAGE && !IS_SERIES_PAGE) {
    window.alert(
      'SScrapeRN runs on an SSRN author page (papers.ssrn.com/…/AbsByAuth.cfm?per_id=…) ' +
        'or a research paper series page (www.ssrn.com/index.cfm/en/…). Open one of those, then click the bookmark again.'
    );
    return;
  }

  // ---------- History file ----------

  // Identical to the extension's history CSV, so a history file exported from
  // the extension can be picked here and carried on.
  const HISTORY_CSV_HEADERS = [
    'Abstract ID',
    'Title',
    'Authors (with Affiliations)',
    'Venue / Publication',
    'Abstract Page URL',
    'Date Collected',
    'Downloads',
    'Citations'
  ];

  // ---------- UI ----------

  const STYLE = `
#sscr-panel{position:fixed;top:90px;right:20px;z-index:2147483647;background:#fff;color:#222;
  border:1px solid #d0d0d0;border-radius:8px;box-shadow:0 4px 14px rgba(0,0,0,.15);padding:12px 14px;
  font:13px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;width:270px;text-align:left;
  max-height:calc(100vh - 110px);overflow:auto}
#sscr-panel *{box-sizing:border-box;text-align:left}
#sscr-panel .sscr-head{font-weight:700;margin:0 0 4px;font-size:14px}
#sscr-panel .sscr-build{font-weight:400;font-size:10.5px;color:#888}
#sscr-panel .sscr-x{position:absolute;top:4px;right:8px;border:0;background:none;font-size:18px;cursor:pointer;color:#666;padding:0}
#sscr-panel .sscr-sec{border-top:1px solid #e4e4e4;margin-top:10px;padding-top:8px}
#sscr-panel .sscr-sec-title{font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:#555}
#sscr-panel .sscr-desc{font-size:11.5px;color:#555;margin-top:2px}
#sscr-panel .sscr-btn{display:block;width:100%;margin-top:6px;border:none;border-radius:6px;padding:8px 12px;
  font-size:13px;font-weight:600;cursor:pointer;color:#fff;background:#8b1a2b}
#sscr-panel .sscr-btn.sscr-arch{background:#2f5d3a}
#sscr-panel .sscr-btn.sscr-hist{background:#3b5b7a}
#sscr-panel .sscr-steps{margin-top:4px;padding:7px 9px;background:#fdf3e7;border:1px solid #f0dcb8;border-radius:6px;font-size:11.5px;color:#5a4316}
#sscr-panel .sscr-steps ol{margin:3px 0 0 16px;padding:0}
#sscr-panel .sscr-btn:hover:not(:disabled){filter:brightness(.9)}
#sscr-panel .sscr-btn:disabled{background:#b0b0b0;cursor:default}
#sscr-panel .sscr-link{display:block;margin-top:5px;font-size:11.5px;color:#3b5b7a;text-decoration:underline;cursor:pointer;background:none;border:0;padding:0}
#sscr-panel .sscr-link:disabled{color:#aaa;cursor:default}
#sscr-panel .sscr-small{margin-top:4px;font-size:11px;color:#888}
#sscr-panel .sscr-status{margin-top:10px;padding-top:8px;border-top:1px solid #e4e4e4;color:#333}`;

  let panel;
  const buttons = [];

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text) e.textContent = text;
    return e;
  }

  // One labelled section: a heading, a one-line description, then its controls.
  function section(title, desc) {
    const sec = el('div', 'sscr-sec');
    sec.appendChild(el('div', 'sscr-sec-title', title));
    sec.appendChild(el('div', 'sscr-desc', desc));
    panel.appendChild(sec);
    return sec;
  }

  function injectPanel() {
    panel = el('div');
    panel.id = 'sscr-panel';
    const style = el('style');
    style.textContent = STYLE;
    panel.appendChild(style);

    const close = el('button', 'sscr-x', '×');
    close.title = 'Close';
    close.addEventListener('click', () => { panel.style.display = 'none'; });
    panel.appendChild(close);

    const head = el('div', 'sscr-head', 'SScrapeRN');
    head.appendChild(el('span', 'sscr-build', ` · ${typeof SSCR_BUILD !== 'undefined' ? SSCR_BUILD : 'dev'}`));
    head.title = 'Build date and code fingerprint; compare with the install page to check the bookmark is current.';
    panel.appendChild(head);

    // The user clicks SSRN's own links; the tool never does.
    const steps = el('div', 'sscr-steps');
    steps.appendChild(el('b', '', 'First, on SSRN\'s page:'));
    const ol = el('ol');
    ol.appendChild(el('li', '', 'Above the paper list, click "All Versions" (if shown) and "All Abstracts".'));
    ol.appendChild(el('li', '', 'Wait until the abstracts appear under the papers.'));
    steps.appendChild(ol);
    panel.appendChild(steps);

    // 1. Archive (recommended): a folder with the metadata and a checklist for PDFs.
    const archSec = section('Archive', 'A folder with the papers (CSV and JSON), a copy of this page and a ' +
      'checklist for downloading the PDFs yourself.');
    const archiveBtn = el('button', 'sscr-btn sscr-arch', '📦 Archive this profile… (recommended)');
    archiveBtn.addEventListener('click', onArchiveClick);
    archSec.appendChild(archiveBtn);
    const checkLink = el('button', 'sscr-link', 'Check downloaded PDFs…');
    checkLink.title = 'Pick an archive folder; the PDFs saved in it are matched to its papers and the checklist is updated.';
    checkLink.addEventListener('click', onCheckClick);
    archSec.appendChild(checkLink);

    // 2. Papers list: one CSV, straight to Downloads.
    const listSec = section('Papers list (CSV only)', 'Just the spreadsheet of every paper on this page, saved to Downloads.');
    const exportBtn = el('button', 'sscr-btn', '⬇ Download papers CSV');
    exportBtn.addEventListener('click', onExportClick);
    listSec.appendChild(exportBtn);

    // 3. Download tracking: a history CSV the user keeps.
    const histSec = section('Download tracking (optional)', 'One spreadsheet you keep, recording each paper\'s download ' +
      'and citation counts every time you run it, so you can see them grow.');
    const newHistoryLink = el('button', 'sscr-link', 'First time? Start a history file');
    newHistoryLink.addEventListener('click', () => onHistoryClick(false));
    const historyBtn = el('button', 'sscr-btn sscr-hist', '📈 Add today\'s counts to my history file…');
    historyBtn.title = 'Pick the newest history CSV it saved last time; a new dated copy with today\'s counts added is downloaded.';
    historyBtn.addEventListener('click', () => onHistoryClick(true));
    histSec.appendChild(historyBtn);
    histSec.appendChild(newHistoryLink);
    histSec.appendChild(el('div', 'sscr-small', 'Each run saves a new dated copy. Next time, pick the newest one.'));

    buttons.push(exportBtn, archiveBtn, checkLink, historyBtn, newHistoryLink);

    panel.appendChild(el('div', 'sscr-status'));
    document.body.appendChild(panel);
    configure({ onStatus: setStatus, ignoreWithin: panel });

    setStatus('Checking for papers…');
    waitForAnchors(25000, (seconds) => {
      setStatus(`Waiting for the paper list to load… (${seconds}s)`);
    }).then((anchors) => {
      if (anchors.length > 0) {
        setStatus(`Ready — found ${anchors.length} paper link(s) on this page.`);
      } else {
        setStatus('No papers detected yet. Click Export to try scanning again.');
      }
    });
  }

  function setStatus(text) {
    const s = panel && panel.querySelector('.sscr-status');
    if (s) s.textContent = text;
  }

  function setButtonsEnabled(enabled) {
    for (const b of buttons) b.disabled = !enabled;
  }

  // RFC 4180 reader: quoted fields may hold the delimiter, doubled quotes and
  // line breaks (a spreadsheet re-save can introduce them). Strips a leading BOM.
  function parseCsv(text, delimiter) {
    const delim = delimiter || ',';
    const rows = [];
    let row = [];
    let field = '';
    let inQuotes = false;
    let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;
    for (; i < text.length; i++) {
      const c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; } else { inQuotes = false; }
        } else {
          field += c;
        }
      } else if (c === '"') {
        inQuotes = true;
      } else if (c === delim) {
        row.push(field); field = '';
      } else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(field); field = '';
        rows.push(row); row = [];
      } else {
        field += c;
      }
    }
    if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }
    return rows.filter((r) => r.some((f) => f.trim() !== ''));
  }

  // Excel in many European locales saves CSV with ';' (or a tab). Pick
  // whichever of the three is most common in the header line.
  function sniffDelimiter(text) {
    const header = text.replace(/^\uFEFF/, '').split(/\r?\n/, 1)[0] || '';
    let best = ',';
    let bestCount = -1;
    for (const d of [',', ';', '\t']) {
      const n = header.split(d).length - 1;
      if (n > bestCount) { best = d; bestCount = n; }
    }
    return best;
  }

  // Whether this browser's locale writes dates day-first (31/12/2000).
  // Excel re-saves dates in the system locale, which usually matches.
  const LOCALE_DAY_FIRST = (() => {
    try {
      const parts = new Intl.DateTimeFormat().formatToParts(new Date(2000, 11, 31));
      return parts.findIndex((p) => p.type === 'day') < parts.findIndex((p) => p.type === 'month');
    } catch {
      return false;
    }
  })();

  // Spreadsheets like to rewrite 2026-08-18 as 8/18/2026 or 18/08/2026 on
  // re-save. Returns an ISO date, or '' if the text can't be read as one.
  // A part over 12 settles the order; otherwise the locale decides.
  function normalizeDate(s, dayFirst) {
    const t = (s || '').trim();
    const iso = (y, m, d) => {
      const mm = Number(m);
      const dd = Number(d);
      if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return '';
      return `${y}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
    };
    const ymd = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (ymd) return iso(ymd[1], ymd[2], ymd[3]);
    const slash = t.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{2}|\d{4})$/);
    if (slash) {
      const y = slash[3].length === 2 ? '20' + slash[3] : slash[3];
      const a = Number(slash[1]);
      const b = Number(slash[2]);
      let df = dayFirst === undefined ? LOCALE_DAY_FIRST : dayFirst;
      if (a > 12) df = true;
      else if (b > 12) df = false;
      return df ? iso(y, slash[2], slash[1]) : iso(y, slash[1], slash[2]);
    }
    return '';
  }

  // Returns {rows, badDates} or throws with a message meant for the user.
  function readHistoryCsv(text) {
    const table = parseCsv(text, sniffDelimiter(text));
    if (table.length === 0) return { rows: [], badDates: 0 };
    const header = table[0].map((h) => h.trim());
    const missing = ['Abstract ID', 'Date Collected', 'Downloads'].filter((h) => !header.includes(h));
    if (missing.length > 0) {
      throw new Error(
        `That file isn't a download-history CSV (no ${missing.join(', ')} column). ` +
          'Pick a file named …_ssrn_download_history_<date>.csv.'
      );
    }
    let badDates = 0;
    const rows = table.slice(1).map((cells) => {
      const r = {};
      for (const h of HISTORY_CSV_HEADERS) {
        const idx = header.indexOf(h);
        r[h] = idx === -1 ? '' : (cells[idx] || '').trim().replace(/^'(?=[=+\-@])/, '');
      }
      const raw = r['Date Collected'];
      r['Date Collected'] = normalizeDate(raw);
      if (!r['Date Collected'] && r['Abstract ID']) {
        badDates++;
        r['Date Collected'] = raw; // keep what was there; the status line reports it
      }
      return r;
    });
    return { rows: rows.filter((r) => r['Abstract ID']), badDates };
  }

  // Adds today's snapshot for every paper that has a Downloads count. A
  // re-run on the same day replaces that day's row rather than adding one.
  // Each paper's title/authors/venue/URL are refreshed on all of its rows,
  // as the extension did with its stored record.
  function mergeHistory(oldRows, entries, today) {
    const byKey = new Map();
    for (const r of oldRows) byKey.set(r['Abstract ID'] + '|' + r['Date Collected'], r);
    const latest = new Map();
    let added = 0;
    let replaced = 0;
    let skipped = 0;
    for (const e of entries) {
      const id = e['Abstract ID'];
      if (!id || !e.Downloads) { skipped++; continue; }
      const meta = {
        Title: e.Title,
        'Authors (with Affiliations)': e['Authors (with Affiliations)'],
        'Venue / Publication': e['Venue / Publication'],
        'Abstract Page URL': e['Abstract Page URL']
      };
      latest.set(id, meta);
      const key = id + '|' + today;
      if (byKey.has(key)) replaced++; else added++;
      byKey.set(key, Object.assign({ 'Abstract ID': id, 'Date Collected': today }, meta, {
        Downloads: e.Downloads,
        Citations: e.Citations || ''
      }));
    }
    const rows = Array.from(byKey.values());
    for (const r of rows) {
      const meta = latest.get(r['Abstract ID']);
      if (!meta) continue;
      for (const [k, v] of Object.entries(meta)) if (v) r[k] = v;
    }
    const num = (s) => (/^\d+$/.test(s) ? Number(s) : NaN);
    rows.sort((a, b) => {
      const ia = a['Abstract ID'];
      const ib = b['Abstract ID'];
      if (ia !== ib) {
        const na = num(ia);
        const nb = num(ib);
        if (!isNaN(na) && !isNaN(nb)) return na - nb;
        return ia < ib ? -1 : 1;
      }
      return a['Date Collected'] < b['Date Collected'] ? -1 : a['Date Collected'] > b['Date Collected'] ? 1 : 0;
    });
    const papers = new Set(rows.map((r) => r['Abstract ID'])).size;
    return { rows, added, replaced, skipped, papers };
  }

  // ---------- Files ----------

  function downloadCsv(csvText, filename) {
    saveBlob(filename, csvTextBlob(csvText), csvText);
  }

  // Excel's default "CSV" on Windows is Windows-1252, not UTF-8; "Unicode
  // Text" is UTF-16. Decoding those as UTF-8 would turn every accented
  // letter into U+FFFD, permanently, for papers not on the current page.
  function decodeHistoryBytes(buf) {
    const b = new Uint8Array(buf);
    if (b[0] === 0xff && b[1] === 0xfe) return new TextDecoder('utf-16le').decode(b);
    if (b[0] === 0xfe && b[1] === 0xff) return new TextDecoder('utf-16be').decode(b);
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(b);
    } catch {
      return new TextDecoder('windows-1252').decode(b);
    }
  }

  // Resolves to {name, text}, or null if the user cancels.
  function pickHistoryFile() {
    if (TEST && window.__sscrTestHistoryFile !== undefined) {
      return Promise.resolve(window.__sscrTestHistoryFile);
    }
    return new Promise((resolve, reject) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.csv,text/csv';
      input.style.display = 'none';
      let settled = false;
      let changed = false;
      const finish = (v) => {
        if (settled) return;
        settled = true;
        window.removeEventListener('focus', onFocus);
        input.remove();
        resolve(v);
      };
      input.addEventListener('change', () => {
        changed = true;
        const file = input.files && input.files[0];
        if (!file) { finish(null); return; }
        file.arrayBuffer().then((buf) => finish({ name: file.name, text: decodeHistoryBytes(buf) }), (e) => {
          settled = true;
          input.remove();
          reject(e);
        });
      });
      input.addEventListener('cancel', () => finish(null));
      // Browsers without the 'cancel' event (Safari before 16.4, older
      // Chromium): the window regains focus when the dialog closes; if no
      // file arrived shortly after, treat it as a cancel.
      function onFocus() {
        setTimeout(() => { if (!changed) finish(null); }, 1500);
      }
      document.body.appendChild(input);
      input.click();
      setTimeout(() => window.addEventListener('focus', onFocus), 0);
    });
  }

  // Keep the picked file's name and change only its date, so one history
  // keeps one name even when it collects several author and series pages.
  // Browsers add " (1)" to repeated downloads; drop that too.
  function historyFilename(pickedName) {
    const m = pickedName && pickedName.match(/^(.+?)_ssrn_download_history_\d{4}-\d{2}-\d{2}/i);
    const stem = m ? m[1] : safeFilename(guessAuthorName());
    return `${stem}_ssrn_download_history_${todayDateStamp()}.csv`;
  }

  // ---------- Profile archive ----------
  // A folder per profile:
  //   papers_<date>.csv/.json   the papers, as read from the page
  //   profile_<date>.html       the page as displayed, scripts removed
  //   download-checklist.html   every paper, linked to its SSRN page, marked
  //                             saved or still to download
  //   manifest_<date>.csv       the same, one row per paper
  //   pdfs/                     where the user saves the PDFs they download
  //   README.txt
  // The tool downloads nothing from SSRN (SSRN's Terms of Use bar automated
  // queries). The user downloads each PDF by hand; "Check
  // downloaded PDFs…" pairs the files with the papers by the abstract id in
  // SSRN's own file names (SSRN_ID<id>_code….pdf, SSRN-id<id>.pdf).

  // The papers CSV, identical from "Download papers CSV" and the archive.
  const PAPERS_CSV_HEADERS = CSV_HEADERS.concat(['SSRN Offers', 'Author Profile URLs']);
  const papersCsvRows = (entries) => entries.map((e) => Object.assign({}, e, {
    'SSRN Offers': e._ssrnOffers || '',
    'Author Profile URLs': (e._authorProfileUrls || []).join('; ')
  }));
  const MANIFEST_HEADERS = ['Abstract ID', 'Title', 'SSRN Offers', 'Status', 'PDF File', 'Abstract Page URL', 'PDF URL', 'Note'];
  const CHECKLIST = 'download-checklist.html';

  function archiveName() {
    const perId = (location.search.match(/per_id=(\d+)/) || [])[1];
    if (perId) return `ssrn_author_${perId}_${safeFilename(guessAuthorName())}`;
    if (IS_SERIES_PAGE) {
      const seg = location.pathname.split('/').filter(Boolean).pop() || 'series';
      return `ssrn_series_${safeFilename(seg)}`;
    }
    return `ssrn_${safeFilename(guessAuthorName())}`;
  }

  // text: kept alongside the blob in test captures, so checks can read CSVs.
  function saveBlob(filename, blob, text) {
    if (TEST) {
      (window.__sscrDownloads = window.__sscrDownloads || []).push({ filename, blob, text });
      return;
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  const isPdfName = (n) => /\.pdf$/i.test(n);

  // The archive is <picked>/<name>/, or the picked folder itself when its name
  // is already <name> (picking the archive folder to update it must not nest
  // a second copy inside it).
  function folderTarget(dir) {
    const writeTo = async (d, fileName, blob) => {
      const w = await (await d.getFileHandle(fileName, { create: true })).createWritable();
      await w.write(blob);
      await w.close();
    };
    return {
      kind: 'folder',
      label: dir.name,
      write: (fileName, blob) => writeTo(dir, fileName, blob),
      async readText(fileName) {
        try {
          return await (await (await dir.getFileHandle(fileName)).getFile()).text();
        } catch {
          return '';
        }
      },
      async ensurePdfsFolder() { await dir.getDirectoryHandle('pdfs', { create: true }); },
      // Non-empty PDFs in pdfs/ and, in case they were saved one level up,
      // in the archive folder itself.
      async listPdfs() {
        const out = [];
        const scan = async (d, prefix) => {
          for await (const [n, h] of d.entries()) {
            if (h.kind === 'file' && isPdfName(n) && (await h.getFile()).size > 0) out.push({ name: n, path: prefix + n });
          }
        };
        await scan(dir, '');
        try {
          await scan(await dir.getDirectoryHandle('pdfs'), 'pdfs/');
        } catch {
          // no pdfs/ folder
        }
        return out;
      },
      // The newest papers_<date>.json, or null if this isn't an archive folder.
      async latestPapers() {
        let best = '';
        for await (const [n, h] of dir.entries()) {
          if (h.kind === 'file' && /^papers_\d{4}-\d{2}-\d{2}\.json$/.test(n) && n > best) best = n;
        }
        if (!best) return null;
        try {
          return JSON.parse(await this.readText(best));
        } catch {
          return null;
        }
      }
    };
  }

  // Where a folder can't be chosen, the browser's Downloads folder, with the
  // archive name as a filename prefix. Checking PDFs needs a folder.
  function downloadsTarget(name) {
    return {
      kind: 'downloads',
      label: name,
      async write(fileName, blob) { saveBlob(`${name}_${fileName}`, blob); },
      async readText() { return ''; },
      async ensurePdfsFolder() {},
      async listPdfs() { return []; }
    };
  }

  async function pickFolder() {
    if (TEST && window.__sscrTestDir) return window.__sscrTestDir;
    return window.showDirectoryPicker({ mode: 'readwrite', id: 'sscrapern' });
  }

  // Called first in the click handler: the folder dialog needs the click.
  async function pickArchiveTarget(name) {
    if ((TEST && window.__sscrTestDir) || window.showDirectoryPicker) {
      const root = await pickFolder();
      return folderTarget(root.name === name ? root : await root.getDirectoryHandle(name, { create: true }));
    }
    if (!window.confirm('This browser can\'t save into a chosen folder, so the archive files will go to your ' +
      'Downloads folder instead (you may be asked to allow several downloads). Checking downloaded PDFs ' +
      'against the papers needs Chrome or Edge. Continue?')) {
      throw new DOMException('Cancelled', 'AbortError');
    }
    return downloadsTarget(name);
  }

  // The page as displayed, inert: no panel, scripts, frames, refreshes,
  // inline handlers or javascript: links, and a Content-Security-Policy that
  // stops the saved file loading anything (no scripts, styles, images or
  // tracking pixels from SSRN or anyone else) when it is opened later. Inline
  // styles still apply. A <base> keeps its links pointing at SSRN.
  function pageSnapshot() {
    const root = document.documentElement.cloneNode(true);
    root.querySelectorAll('#sscr-panel, script, noscript, iframe, frame, object, embed, meta[http-equiv]')
      .forEach((n) => n.remove());
    for (const n of root.querySelectorAll('*')) {
      for (const a of Array.from(n.attributes)) {
        if (/^on/i.test(a.name)) n.removeAttribute(a.name);
        else if (/^(href|src|action|formaction)$/i.test(a.name) && /^\s*javascript:/i.test(a.value)) n.removeAttribute(a.name);
      }
    }
    let head = root.querySelector('head');
    if (!head) {
      head = document.createElement('head');
      root.insertBefore(head, root.firstChild);
    }
    const base = document.createElement('base');
    base.href = location.href;
    head.insertBefore(base, head.firstChild);
    const csp = document.createElement('meta');
    csp.setAttribute('http-equiv', 'Content-Security-Policy');
    csp.setAttribute('content', "default-src 'none'; style-src 'unsafe-inline'; img-src data:");
    head.insertBefore(csp, head.firstChild);
    return '<!doctype html>\n' + root.outerHTML;
  }

  const csvTextBlob = (text) => new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' });
  const csvBlob = (rows, headers) => csvTextBlob(buildCsv(rows, headers));

  // The JSON is also what "Check downloaded PDFs…" reads back, so it carries
  // everything the checklist needs.
  function papersJson(entries, capturedAt) {
    return {
      source_url: location.href,
      page_heading: guessAuthorName(),
      captured_at_utc: capturedAt,
      tool: 'SScrapeRN bookmarklet',
      papers: entries.map((e) => {
        const p = {};
        for (const h of CSV_HEADERS) p[h] = e[h] || '';
        p['SSRN Offers'] = e._ssrnOffers || '';
        p['Author Profile URLs'] = e._authorProfileUrls || [];
        return p;
      })
    };
  }

  async function writeMetadata(target, json, entries, date) {
    await target.write(`papers_${date}.csv`, csvBlob(papersCsvRows(entries), PAPERS_CSV_HEADERS));
    await target.write(`papers_${date}.json`,
      new Blob([JSON.stringify(json, null, 2)], { type: 'application/json' }));
    await target.write(`profile_${date}.html`, new Blob([pageSnapshot()], { type: 'text/html;charset=utf-8' }));
  }

  // The abstract id in a file name: SSRN's own names put it after "ID"/"id"
  // (SSRN_ID1234567_code123456.pdf, SSRN-id1234567.pdf); otherwise any run of
  // digits that is one of the papers' ids (1234567.pdf).
  function idInFileName(name, ids) {
    const m = name.match(/id[-_]?(\d+)/i);
    if (m && ids.has(m[1])) return m[1];
    return (name.match(/\d+/g) || []).find((d) => ids.has(d)) || '';
  }

  // One manifest row per paper, in page order, plus the files that matched
  // no paper.
  function pairPdfs(papers, files) {
    const ids = new Set(papers.map((p) => p['Abstract ID']).filter(Boolean));
    const byId = new Map();
    const unmatched = [];
    for (const f of files) {
      const id = idInFileName(f.name, ids);
      if (!id) { unmatched.push(f.path); continue; }
      if (!byId.has(id)) byId.set(id, []);
      byId.get(id).push(f.path);
    }
    const rows = papers.map((p) => {
      const id = p['Abstract ID'];
      const got = byId.get(id) || [];
      const offers = p['SSRN Offers'] || '';
      const status = got.length ? 'saved'
        : offers === 'Fee paper' ? 'sold_by_ssrn'
          : offers === 'No PDF file' ? 'no_pdf_on_ssrn' : 'to_download';
      return {
        'Abstract ID': id,
        Title: p.Title,
        'SSRN Offers': offers,
        Status: status,
        'PDF File': got[0] || '',
        'Abstract Page URL': p['Abstract Page URL'] || '',
        'PDF URL': p['PDF URL'] || '',
        Note: got.length > 1 ? `also matched: ${got.slice(1).join(', ')}` : ''
      };
    });
    const counts = {};
    for (const r of rows) counts[r.Status] = (counts[r.Status] || 0) + 1;
    return { rows, unmatched, counts };
  }

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const webLink = (u) => (/^https?:\/\//i.test(u || '') ? u : '');
  const STATUS_LABEL = {
    saved: 'Saved',
    to_download: 'To download',
    sold_by_ssrn: 'Sold by SSRN',
    no_pdf_on_ssrn: 'No PDF on SSRN'
  };

  // A static page: no scripts, and a CSP that stops it loading anything.
  function checklistHtml(json, pairing, checkedAt) {
    const c = pairing.counts;
    const rows = pairing.rows.map((r, i) => {
      const page = webLink(r['Abstract Page URL']);
      const pdf = webLink(r['PDF URL']);
      return `<tr class="${esc(r.Status)}"><td>${i + 1}</td><td>${esc(STATUS_LABEL[r.Status] || r.Status)}</td>` +
        `<td>${page ? `<a href="${esc(page)}" target="_blank" rel="noopener noreferrer">${esc(r.Title)}</a>` : esc(r.Title)}</td>` +
        `<td>${pdf && r.Status === 'to_download' ? `<a href="${esc(pdf)}" target="_blank" rel="noopener noreferrer">PDF</a>` : ''}</td>` +
        `<td>${esc(r['Abstract ID'])}</td><td>${esc(r['PDF File'])}</td></tr>`;
    }).join('\n');
    const unmatched = pairing.unmatched.length
      ? `<p><b>PDFs that match no paper here</b> (their names have none of these papers' IDs): ${pairing.unmatched.map(esc).join(', ')}</p>`
      : '';
    return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<title>Download checklist: ${esc(json.page_heading)}</title>
<style>body{font:14px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;max-width:1000px;margin:24px auto;padding:0 16px;color:#222}
table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid #ddd;padding:5px 6px;text-align:left;vertical-align:top}
tr.saved td:nth-child(2){color:#2f5d3a;font-weight:600}tr.to_download td:nth-child(2){color:#8b1a2b;font-weight:600}
tr.sold_by_ssrn,tr.no_pdf_on_ssrn{color:#888}ol li{margin:3px 0}</style></head>
<body>
<h1>Download checklist: ${esc(json.page_heading)}</h1>
<p>Source: <a href="${esc(webLink(json.source_url))}" target="_blank" rel="noopener noreferrer">${esc(json.source_url)}</a>.
Papers captured ${esc(json.captured_at_utc)}; PDFs last checked ${esc(checkedAt)}.</p>
<p><b>${c.saved || 0} saved, ${c.to_download || 0} to download</b>; ${c.sold_by_ssrn || 0} sold by SSRN and
${c.no_pdf_on_ssrn || 0} with no PDF on SSRN (nothing to download for those).</p>
<ol>
<li>Click a title marked <b>To download</b>. It opens the paper's page on SSRN.</li>
<li>Click SSRN's <b>Download This Paper</b> and save the PDF into the <b>pdfs</b> folder inside this archive folder.
Keep the name SSRN gives the file: it contains the paper's ID, which is how files are matched to papers.</li>
<li>Whenever you like, open any SSRN page, click the SScrapeRN bookmark, then <b>Check downloaded PDFs…</b>,
and pick this archive folder. This page is rewritten to show what's saved.</li>
</ol>
<p>Go at your own pace. SSRN counts each of these as a download of that paper.</p>
${unmatched}
<table><thead><tr><th>#</th><th>Status</th><th>Title (opens SSRN)</th><th>Direct link</th><th>SSRN ID</th><th>Saved as</th></tr></thead>
<tbody>
${rows}
</tbody></table>
</body></html>
`;
  }

  async function writeChecklist(target, json, date) {
    const pairing = pairPdfs(json.papers, await target.listPdfs());
    await target.write(`manifest_${date}.csv`, csvBlob(pairing.rows, MANIFEST_HEADERS));
    await target.write(CHECKLIST, new Blob([checklistHtml(json, pairing, isoNow())], { type: 'text/html;charset=utf-8' }));
    return pairing;
  }

  const isoNow = () => new Date().toISOString().replace(/\.\d+Z$/, 'Z');

  function pairingSummary(p) {
    const c = p.counts;
    let s = `PDFs: ${c.saved || 0} saved, ${c.to_download || 0} to download`;
    if (c.sold_by_ssrn) s += `, ${c.sold_by_ssrn} sold by SSRN`;
    if (c.no_pdf_on_ssrn) s += `, ${c.no_pdf_on_ssrn} with no PDF on SSRN`;
    s += '.';
    if (p.unmatched.length) s += ` ${p.unmatched.length} PDF file(s) match no paper (see the checklist).`;
    return s;
  }

  function readmeText(info) {
    return [
      'SSRN profile archive',
      '',
      `Source page:    ${location.href}`,
      `Page heading:   ${guessAuthorName()}`,
      `Captured (UTC): ${info.capturedAt}`,
      'Made with:      SScrapeRN bookmarklet',
      '',
      `Papers: ${info.entries.length}.${info.note}`,
      info.pairing ? pairingSummary(info.pairing) : '',
      '',
      'Files',
      `  papers_${info.date}.csv     one row per paper: metadata, abstract, keywords, links, what SSRN offers, co-author profile links`,
      `  papers_${info.date}.json    the same, as JSON, with the capture details`,
      `  profile_${info.date}.html   the profile page as displayed (scripts removed; links still point at SSRN)`,
      `  ${CHECKLIST}   every paper, linked to its SSRN page, marked saved or to download`,
      `  manifest_<date>.csv        the same as a spreadsheet, rewritten by each check`,
      '  pdfs/                      save the PDFs you download here',
      '',
      'SScrapeRN reads only what the page already shows and downloads nothing from SSRN.',
      'Download the PDFs yourself from the checklist, keeping SSRN\'s file names, then use',
      '"Check downloaded PDFs..." in the bookmarklet to update the checklist.',
      'Statuses: saved, to_download, sold_by_ssrn (a "Fee paper"), no_pdf_on_ssrn (SSRN shows "No PDF file").'
    ].join('\r\n') + '\r\n';
  }

  // Shared by the papers list and the archive: warn when SSRN's links
  // haven't been clicked, or the abstracts are still arriving.
  // One confirm per link that needs attention; any Cancel stops.
  function readyOrConfirmed() {
    return readinessWarnings().every((w) => window.confirm(w.text +
      `\n\nOK: continue anyway.\nCancel: go back and click "${w.link}" first.`));
  }
  const NOT_READY = 'Nothing saved. Click SSRN\'s "All Versions" (if shown) and "All Abstracts" above the paper list, ' +
    'wait for the abstracts to appear, then try again.';

  async function onArchiveClick() {
    if (!readyOrConfirmed()) { setStatus(NOT_READY); return; }
    const name = archiveName();
    setButtonsEnabled(false);
    let target;
    try {
      target = await pickArchiveTarget(name); // first: the folder dialog needs this click
    } catch (e) {
      setStatus(e && e.name === 'AbortError' ? 'No folder chosen; nothing was saved.' : 'Couldn\'t open a folder: ' + (e && e.message));
      setButtonsEnabled(true);
      return;
    }
    try {
      const capturedAt = isoNow();
      const date = todayDateStamp();
      const { entries, note } = await collectPapers();
      if (entries.length === 0) {
        setStatus('No papers found on this page, so nothing was archived.');
        return;
      }
      setStatus('Saving the papers, a copy of the page and the download checklist…');
      const json = papersJson(entries, capturedAt);
      await writeMetadata(target, json, entries, date);
      await target.ensurePdfsFolder();
      const pairing = await writeChecklist(target, json, date);
      await target.write('README.txt', new Blob([readmeText({ capturedAt, date, entries, note, pairing })], { type: 'text/plain' }));

      const where = target.kind === 'folder' ? `folder "${target.label}"` : 'your Downloads folder';
      setStatus(`Archive saved to ${where}: ${entries.length} papers.${note} ${pairingSummary(pairing)} ` +
        `Next: open ${CHECKLIST} in that folder and download the PDFs into its pdfs folder.`);
    } catch (e) {
      console.error('SScrapeRN: archive failed', e);
      setStatus('The archive failed part-way: ' + ((e && e.message) || e) + '. Files already written are kept.');
    } finally {
      setButtonsEnabled(true);
    }
  }

  // Pair the PDFs saved so far with an archive's papers and rewrite its
  // checklist and manifest. Reads the archive's own papers JSON, so it works
  // from any SSRN page and asks SSRN for nothing.
  async function onCheckClick() {
    if (!(TEST && window.__sscrTestDir) && !window.showDirectoryPicker) {
      setStatus('Checking PDFs needs Chrome or Edge, which can open a folder.');
      return;
    }
    setButtonsEnabled(false);
    try {
      setStatus('Pick the archive folder (ssrn_author_…)…');
      let dir;
      try {
        dir = await pickFolder();
      } catch (e) {
        setStatus(e && e.name === 'AbortError' ? 'No folder chosen; nothing changed.' : 'Couldn\'t open the folder: ' + (e && e.message));
        return;
      }
      let target = folderTarget(dir);
      let json = await target.latestPapers();
      if (!json) {
        // The parent folder was picked: look for this page's archive inside it.
        try {
          target = folderTarget(await dir.getDirectoryHandle(archiveName()));
          json = await target.latestPapers();
        } catch {
          // not there either
        }
      }
      if (!json || !Array.isArray(json.papers)) {
        setStatus('That folder isn\'t an SScrapeRN archive (no papers_<date>.json in it). Pick the ssrn_author_… folder itself.');
        return;
      }
      const pairing = await writeChecklist(target, json, todayDateStamp());
      setStatus(`Checked "${target.label}": ${pairingSummary(pairing)} ${CHECKLIST} is updated.`);
    } catch (e) {
      console.error('SScrapeRN: check failed', e);
      setStatus('Checking the PDFs failed: ' + ((e && e.message) || e) + '.');
    } finally {
      setButtonsEnabled(true);
    }
  }

  // ---------- Main flow ----------

  async function onExportClick() {
    if (!readyOrConfirmed()) { setStatus(NOT_READY); return; }
    setButtonsEnabled(false);
    try {
      const { entries, note } = await collectPapers();
      if (entries.length === 0) {
        setStatus('No papers found. Open the console (F12) for diagnostics.');
        return;
      }
      const filename = `${safeFilename(guessAuthorName())}_ssrn_papers_${todayDateStamp()}.csv`;
      downloadCsv(buildCsv(papersCsvRows(entries), PAPERS_CSV_HEADERS), filename);
      setStatus(`Done! Downloaded ${entries.length} papers to ${filename}.${note} ` +
        'To follow download counts over time, use "Add today\'s counts to my history file…".');
    } catch (e) {
      console.error('SScrapeRN: export failed', e);
      setStatus('Error scanning page. See console for details.');
    } finally {
      setButtonsEnabled(true);
    }
  }

  async function onHistoryClick(usePreviousFile) {
    setButtonsEnabled(false);
    try {
      let previous = null;
      let oldRows = [];
      let badDates = 0;
      if (usePreviousFile) {
        setStatus('Pick your most recent download-history CSV…');
        previous = await pickHistoryFile();
        if (!previous) {
          setStatus('No file picked; nothing changed.');
          return;
        }
        const read = readHistoryCsv(previous.text);
        oldRows = read.rows;
        badDates = read.badDates;
      }

      // Always scan afresh: series pages can page through results without
      // a reload, so an earlier scan may be of a different page.
      setStatus('Scanning page for papers…');
      const entries = await scrapeListPage();
      if (entries.length === 0) {
        setStatus('No papers found on this page, so there is nothing to add.');
        return;
      }

      const today = todayDateStamp();
      const merged = mergeHistory(oldRows, entries, today);
      if (merged.added + merged.replaced === 0) {
        setStatus('None of the papers on this page show a download count, so nothing was added.');
        return;
      }
      const filename = historyFilename(previous && previous.name);
      downloadCsv(buildCsv(merged.rows, HISTORY_CSV_HEADERS), filename);

      const parts = [`Added today's counts for ${merged.added + merged.replaced} paper(s)`];
      if (merged.replaced) parts.push(`${merged.replaced} replaced an earlier run today`);
      if (merged.skipped) parts.push(`${merged.skipped} had no download count`);
      if (badDates) parts.push(`${badDates} earlier row(s) have a date that couldn't be read and were kept as they were`);
      setStatus(
        `${parts.join('; ')}. Saved ${filename}: ${merged.rows.length} rows, ${merged.papers} paper(s). ` +
          'Keep this file — pick it next time.'
      );
    } catch (e) {
      console.error('SScrapeRN: history update failed', e);
      setStatus(e && e.message ? e.message : 'Error updating the history file. See console for details.');
    } finally {
      setButtonsEnabled(true);
    }
  }

  // ---------- Init ----------

  injectPanel();
  window.__sscrapern = { show() { panel.style.display = ''; } };
  if (TEST) {
    Object.assign(window.__sscrapern, { parseCsv, sniffDelimiter, csvEscape, decodeHistoryBytes, archiveName, pdfLinkFor, readHistoryCsv, mergeHistory, normalizeDate, historyFilename, scrapeListPage, idInFileName, pairPdfs, readinessWarnings });
  }
})();
