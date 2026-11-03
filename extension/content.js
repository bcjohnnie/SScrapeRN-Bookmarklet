// SSRN Papers -> CSV (SScrapeRN), extension UI and stored download history.
// Runs on:
//   - https://papers.ssrn.com/sol3/cf_dev/AbsByAuth.cfm* (author profile pages)
//   - https://www.ssrn.com/index.cfm/en/* (research paper series / journal pages)
//
// All page reading and CSV building are in scrape-core.js (loaded first, see manifest.json), shared with the
// bookmarklet. This file holds only the panel and the history kept in
// extension storage.

/* global SScrapeRNCore */
(function () {
  'use strict';

  const {
    configure, collectPapers, waitForAnchors, readinessWarnings,
    buildCsv, guessAuthorName, todayDateStamp, safeFilename
  } = SScrapeRNCore;

  // ---------- UI ----------

  function injectPanel() {
    if (document.getElementById('ssrn-csv-exporter-panel')) return;

    const panel = document.createElement('div');
    panel.id = 'ssrn-csv-exporter-panel';

    // The tool clicks nothing on SSRN's page and makes no requests to SSRN:
    // the user clicks SSRN's own links first.
    const steps = document.createElement('div');
    steps.id = 'ssrn-csv-exporter-steps';
    steps.textContent =
      'First, above the paper list, click SSRN\'s "All Versions" (if shown) and "All Abstracts", ' +
      'and wait for the abstracts to appear. Then export.';
    panel.appendChild(steps);

    const exportBtn = document.createElement('button');
    exportBtn.id = 'ssrn-csv-exporter-btn';
    exportBtn.textContent = '⬇ Export Papers to CSV';
    panel.appendChild(exportBtn);

    const historyBtn = document.createElement('button');
    historyBtn.id = 'ssrn-csv-exporter-history-btn';
    historyBtn.textContent = '📈 Export Download History';
    panel.appendChild(historyBtn);

    const status = document.createElement('div');
    status.id = 'ssrn-csv-exporter-status';
    panel.appendChild(status);

    const resetLink = document.createElement('a');
    resetLink.id = 'ssrn-csv-exporter-reset-link';
    resetLink.href = '#';
    resetLink.textContent = 'Reset stored history';
    panel.appendChild(resetLink);

    document.body.appendChild(panel);
    configure({ onStatus: setStatus, ignoreWithin: panel });

    exportBtn.addEventListener('click', onExportClick);
    historyBtn.addEventListener('click', onExportHistoryClick);
    resetLink.addEventListener('click', (e) => {
      e.preventDefault();
      onResetHistoryClick();
    });

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
    const el = document.getElementById('ssrn-csv-exporter-status');
    if (el) el.textContent = text;
  }

  function setButtonEnabled(enabled) {
    const btn = document.getElementById('ssrn-csv-exporter-btn');
    const historyBtn = document.getElementById('ssrn-csv-exporter-history-btn');
    if (btn) btn.disabled = !enabled;
    if (historyBtn) historyBtn.disabled = !enabled;
  }

  // ---------- Download history tracking (persistent across runs) ----------
  // Each paper's Downloads/Citations count is snapshotted (with today's
  // date) into the extension's own storage every time you export — kept
  // separate from the CSV file itself, since a browser extension can't
  // read back or append to a file you've already downloaded. Re-running
  // "Export Download History" always regenerates the FULL history from
  // everything recorded so far, so nothing needs to be manually merged.

  const HISTORY_KEY_PREFIX = 'paper:';

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

  // Firefox's promise-based `browser.storage` rejects a trailing callback
  // argument, so use it with promises; Chrome's `chrome.storage` gets a
  // callback (it also returns promises in MV3, but lastError only reaches
  // the callback).
  function storageCall(method, arg) {
    if (typeof browser !== 'undefined' && browser.storage && browser.storage.local) {
      return browser.storage.local[method](arg);
    }
    return new Promise((resolve, reject) => {
      chrome.storage.local[method](arg, (result) => {
        const err = chrome.runtime && chrome.runtime.lastError;
        if (err) reject(new Error(err.message || String(err)));
        else resolve(result);
      });
    });
  }

  const storageGetAll = () => storageCall('get', null).then((items) => items || {});
  const storageSet = (items) => storageCall('set', items);
  const storageRemove = (keys) => storageCall('remove', keys);

  // Records today's Downloads/Citations snapshot for each entry that has a
  // usable download count. Safe to call every export — re-running on the
  // same day updates today's snapshot rather than creating a duplicate.
  async function recordDownloadHistory(entries) {
    const today = todayDateStamp();
    const toStore = {};

    // If this read fails, stop: writing without the stored snapshots would
    // replace each paper's history with today's snapshot alone.
    const existingAll = await storageGetAll();

    for (const entry of entries) {
      const abstractId = entry['Abstract ID'];
      if (!abstractId || !entry.Downloads) continue; // nothing usable to record

      const key = HISTORY_KEY_PREFIX + abstractId;
      const existing = existingAll[key];

      const record = existing || {
        title: entry.Title,
        authors: entry['Authors (with Affiliations)'],
        venue: entry['Venue / Publication'],
        abstractPageUrl: entry['Abstract Page URL'],
        snapshots: []
      };

      // Keep metadata fresh in case it changed since last time.
      record.title = entry.Title || record.title;
      record.authors = entry['Authors (with Affiliations)'] || record.authors;
      record.venue = entry['Venue / Publication'] || record.venue;
      record.abstractPageUrl = entry['Abstract Page URL'] || record.abstractPageUrl;

      const existingTodayIdx = record.snapshots.findIndex((s) => s.date === today);
      const snapshot = { date: today, downloads: entry.Downloads, citations: entry.Citations || '' };
      if (existingTodayIdx !== -1) {
        record.snapshots[existingTodayIdx] = snapshot;
      } else {
        record.snapshots.push(snapshot);
      }

      toStore[key] = record;
    }

    if (Object.keys(toStore).length > 0) {
      await storageSet(toStore);
    }
    return Object.keys(toStore).length;
  }

  async function buildHistoryRows() {
    const all = await storageGetAll();
    const rows = [];
    for (const key of Object.keys(all)) {
      if (!key.startsWith(HISTORY_KEY_PREFIX)) continue;
      const abstractId = key.slice(HISTORY_KEY_PREFIX.length);
      const record = all[key];
      for (const snap of record.snapshots || []) {
        rows.push({
          'Abstract ID': abstractId,
          Title: record.title || '',
          'Authors (with Affiliations)': record.authors || '',
          'Venue / Publication': record.venue || '',
          'Abstract Page URL': record.abstractPageUrl || '',
          'Date Collected': snap.date,
          Downloads: snap.downloads,
          Citations: snap.citations || ''
        });
      }
    }
    rows.sort((a, b) => {
      if (a['Abstract ID'] !== b['Abstract ID']) {
        return a['Abstract ID'] < b['Abstract ID'] ? -1 : 1;
      }
      return a['Date Collected'] < b['Date Collected'] ? -1 : 1;
    });
    return rows;
  }

  async function clearDownloadHistory() {
    const all = await storageGetAll();
    const keys = Object.keys(all).filter((k) => k.startsWith(HISTORY_KEY_PREFIX));
    if (keys.length > 0) {
      await storageRemove(keys);
    }
    return keys.length;
  }

  // ---------- CSV building + download ----------

  function downloadCsv(csvText, filename) {
    const blob = new Blob(['\uFEFF' + csvText], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  // ---------- Main flow ----------

  // Warn before a scan when SSRN's links haven't been clicked (or the
  // abstracts are still arriving). OK exports what the page shows now.
  // One confirm per link that needs attention; any Cancel stops.
  function readyOrConfirmed() {
    return readinessWarnings().every((w) => window.confirm(w.text +
      `\n\nOK: export anyway.\nCancel: go back and click "${w.link}" first.`));
  }

  async function onExportClick() {
    if (!readyOrConfirmed()) {
      setStatus('Nothing exported. Click SSRN\'s "All Versions" (if shown) and "All Abstracts" above the paper list, wait for the abstracts, then export.');
      return;
    }
    setButtonEnabled(false);
    let entries;
    let note;
    try {
      ({ entries, note } = await collectPapers());
    } catch (e) {
      setStatus('Error scanning page. See console for details.');
      console.error(e);
      setButtonEnabled(true);
      return;
    }

    if (entries.length === 0) {
      setStatus('No papers found. Open the console (F12) for diagnostics.');
      setButtonEnabled(true);
      return;
    }

    let recordedCount = 0;
    let historyNote = '';
    try {
      recordedCount = await recordDownloadHistory(entries);
    } catch (e) {
      console.warn('SScrapeRN: failed to record download history', e);
      historyNote = " Today's download counts were NOT added to the history (browser storage error; earlier history is untouched).";
    }

    const filename = `${safeFilename(guessAuthorName())}_ssrn_papers_${todayDateStamp()}.csv`;
    downloadCsv(buildCsv(entries), filename);

    setStatus(
      `Done! Downloaded ${entries.length} papers to ${filename}` +
        (recordedCount > 0 ? ` (recorded ${recordedCount} download snapshot(s) for today).` : '.') +
        note +
        historyNote
    );
    setButtonEnabled(true);
  }

  async function onExportHistoryClick() {
    setButtonEnabled(false);
    setStatus('Building download history CSV…');
    try {
      const rows = await buildHistoryRows();
      if (rows.length === 0) {
        setStatus(
          'No download history recorded yet. Run "Export Papers to CSV" at least once first.'
        );
        setButtonEnabled(true);
        return;
      }
      const csv = buildCsv(rows, HISTORY_CSV_HEADERS);
      const filename = `${safeFilename(guessAuthorName())}_ssrn_download_history_${todayDateStamp()}.csv`;
      downloadCsv(csv, filename);
      setStatus(`Done! Downloaded ${rows.length} historical snapshot row(s) to ${filename}`);
    } catch (e) {
      console.error('SSRN CSV exporter: failed to build history CSV', e);
      setStatus('Error building download history. See console for details.');
    }
    setButtonEnabled(true);
  }

  async function onResetHistoryClick() {
    const confirmed = window.confirm(
      'This will permanently delete all locally stored download-history snapshots ' +
        'for every paper. This cannot be undone. Continue?'
    );
    if (!confirmed) return;

    setButtonEnabled(false);
    setStatus('Clearing stored download history…');
    try {
      const removedCount = await clearDownloadHistory();
      setStatus(`Cleared stored history for ${removedCount} paper(s).`);
    } catch (e) {
      console.error('SSRN CSV exporter: failed to clear download history', e);
      setStatus('Error clearing download history. See console for details.');
    }
    setButtonEnabled(true);
  }

  // ---------- Init ----------

  injectPanel();
})();
