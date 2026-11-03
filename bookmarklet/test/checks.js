// In-page checks for the test build. Each fixture page sets window.__expect, loads
// ../test-build/sscrapern.test.js, then this file. Results go to <pre id="results">
// and document.title becomes PASS or FAIL. Run `node build.mjs` first.
(async function () {
  const out = [];
  let failures = 0;
  const ok = (cond, name, detail) => {
    if (!cond) failures++;
    out.push(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && detail !== undefined ? '  — got ' + JSON.stringify(detail) : ''}`);
  };
  const eq = (got, want, name) => ok(JSON.stringify(got) === JSON.stringify(want), name, got);
  const api = window.__sscrapern;
  const E = window.__expect;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const panel = document.getElementById('sscr-panel');
  const btn = (text) => Array.from(panel.querySelectorAll('button')).find((b) => b.textContent.includes(text));
  const downloads = () => window.__sscrDownloads || [];
  async function click(text) {
    const n = downloads().length;
    btn(text).click();
    for (let i = 0; i < 200 && downloads().length === n; i++) await sleep(50);
    await sleep(50);
    return downloads()[downloads().length - 1];
  }
  // The tool must make no requests and click nothing on SSRN's page.
  let fetchCalls = 0;
  const realFetch = window.fetch;
  window.fetch = (...a) => { fetchCalls++; return realFetch(...a); };
  const confirms = [];
  let confirmAnswer = true;
  window.confirm = (msg) => { confirms.push(msg); return confirmAnswer; };
  const toObjects = (csv) => {
    const t = api.parseCsv(csv);
    return t.slice(1).map((r) => Object.fromEntries(t[0].map((h, i) => [h, r[i]])));
  };

  try {
    ok(/^SScrapeRN · \d{4}-\d{2}-\d{2} · [0-9a-f]{7}$/.test(panel.querySelector('.sscr-head').textContent.replace('×', '').trim()),
      'panel header shows the build label', panel.querySelector('.sscr-head').textContent);
    // --- pure functions ---
    eq(api.parseCsv('\uFEFFa,b\r\n"x, y","he said ""hi"""\n"multi\nline",z\n\n'),
      [['a', 'b'], ['x, y', 'he said "hi"'], ['multi\nline', 'z']], 'parseCsv: BOM, quotes, commas, embedded newline, blank line');
    eq(['2026-08-18', '8/18/2026', '8/1/26', '2026-8-1', 'junk', '2026-13-01'].map((s) => api.normalizeDate(s, false)),
      ['2026-08-18', '2026-08-18', '2026-08-01', '2026-08-01', '', ''], 'normalizeDate, month-first locale');
    eq(['18/08/2026', '03/08/2026', '8/18/2026', '18.08.2026', '31/31/2026'].map((s) => api.normalizeDate(s, true)),
      ['2026-08-18', '2026-08-03', '2026-08-18', '2026-08-18', ''], 'normalizeDate, day-first locale (a part over 12 overrides)');
    eq(['=1+1', '+44 20', '-x', '@me', 'plain', 'a=b'].map(api.csvEscape),
      ["'=1+1", "'+44 20", "'-x", "'@me", 'plain', 'a=b'], 'csvEscape guards formula-like cells');
    eq([api.sniffDelimiter('Abstract ID;Title;Date Collected;Downloads\n1;x;2026-08-01;5'), api.sniffDelimiter('a,b;c,d')],
      [';', ','], 'sniffDelimiter');
    const semi = api.readHistoryCsv('\uFEFFAbstract ID;Title;Date Collected;Downloads\r\n7;\'=odd title;18/08/2026;"1,204"\r\n8;y;not a date;3\r\n');
    eq(semi.rows.map((r) => [r['Abstract ID'], r.Title, r['Date Collected'], r.Downloads]),
      [['7', '=odd title', '2026-08-18', '1,204'], ['8', 'y', 'not a date', '3']],
      'readHistoryCsv: semicolon file, apostrophe stripped, day-first date, bad date kept');
    eq(semi.badDates, 1, 'readHistoryCsv counts unreadable dates');
    const enc = (bytes) => api.decodeHistoryBytes(new Uint8Array(bytes).buffer);
    eq([enc([0x43, 0x61, 0x66, 0xe9]), enc([0x43, 0x61, 0x66, 0xc3, 0xa9]), enc([0xff, 0xfe, 0x43, 0x00, 0xe9, 0x00])],
      ['Café', 'Café', 'Cé'], 'decodeHistoryBytes: Windows-1252, UTF-8, UTF-16LE');
    let threw = '';
    try { api.readHistoryCsv('Title,Downloads\nX,1\n'); } catch (e) { threw = e.message; }
    ok(/isn't a download-history CSV/.test(threw), 'readHistoryCsv rejects a papers CSV', threw);
    eq(api.historyFilename('example_ssrn_download_history_2026-08-01 (1).csv').replace(/\d{4}-\d{2}-\d{2}/, 'D'),
      'example_ssrn_download_history_D.csv', 'historyFilename keeps the picked stem, drops " (1)"');

    const old = [
      { 'Abstract ID': '20', 'Date Collected': '2026-08-01', Title: 'Old title', Downloads: '5', Citations: '' },
      { 'Abstract ID': '100', 'Date Collected': '2026-08-01', Title: 'Gone paper', Downloads: '9', Citations: '' },
      { 'Abstract ID': '20', 'Date Collected': '2026-09-01', Title: 'Old title', Downloads: '7', Citations: '' }
    ];
    const m = api.mergeHistory(old, [
      { 'Abstract ID': '20', Title: 'New title', Downloads: '8', Citations: '1', 'Authors (with Affiliations)': 'A', 'Venue / Publication': '', 'Abstract Page URL': 'u' },
      { 'Abstract ID': '3', Title: 'Fresh', Downloads: '1', Citations: '', 'Authors (with Affiliations)': '', 'Venue / Publication': '', 'Abstract Page URL': '' },
      { 'Abstract ID': '4', Title: 'No count', Downloads: '', Citations: '' }
    ], '2026-09-01');
    eq(m.rows.map((r) => `${r['Abstract ID']}@${r['Date Collected']}=${r.Downloads}`),
      ['3@2026-09-01=1', '20@2026-08-01=5', '20@2026-09-01=8', '100@2026-08-01=9'],
      'mergeHistory: numeric sort, same-day replace, old papers kept');
    eq([m.added, m.replaced, m.skipped, m.papers], [1, 1, 1, 3], 'mergeHistory counts');
    eq(m.rows.filter((r) => r['Abstract ID'] === '20').map((r) => r.Title), ['New title', 'New title'], 'mergeHistory refreshes metadata on every row of a paper');

    // --- end to end on this fixture ---
    if (E.userClicks) {
      // Not clicked yet: the export warns, and Cancel saves nothing.
      const W = api.readinessWarnings;
      const base = { versionsHidden: false, hasAbstractLink: true, abstractsClicked: false, abstractTotal: 0, abstractsLoaded: 0 };
      eq([W(base).map((w) => w.link), W({ ...base, versionsHidden: true }).map((w) => w.link),
        W({ ...base, abstractTotal: 5, abstractsLoaded: 5 }).map((w) => w.link), W({ ...base, abstractsClicked: true, abstractTotal: 5, abstractsLoaded: 2 }).map((w) => w.link),
        W({ ...base, hasAbstractLink: false, abstractsClicked: true }).map((w) => w.link)],
      [['All Abstracts'], ['All Versions', 'All Abstracts'], [], ['All Abstracts'], []],
      'readinessWarnings: each link on its own, including a page with no abstract slots yet');
      confirmAnswer = false;
      btn('Download papers CSV').click();
      await sleep(200);
      eq(downloads().length, 0, 'export before clicking SSRN\'s links: Cancel saves nothing');
      ok(confirms.length === 1 && /"All Versions"/.test(confirms[0]) && !/"All Abstracts" link/.test(confirms[0]),
        'first warning is for "All Versions" alone; Cancel stops there', confirms[0]);
      ok(/Nothing saved\. Click SSRN's "All Versions"/.test(panel.querySelector('.sscr-status').textContent), 'status says what to click');
      // Versions clicked, abstracts not: the "All Abstracts" warning on its own.
      document.querySelector('.link-show-all-versions').click();
      btn('Download papers CSV').click();
      await sleep(200);
      ok(confirms.length === 2 && /"All Abstracts" link .* hasn't been clicked/.test(confirms[1]) && !/All Versions/.test(confirms[1]),
        'with versions clicked, the "All Abstracts" warning appears on its own', confirms[1]);
      eq(window.__abstractClicks, 0, 'the tool never clicks "All Abstracts"');
      // The user clicks "All Abstracts" and waits; 333 never arrives, so the
      // warning now says how many loaded, and OK goes ahead.
      document.querySelector('.link-show-all-abstracts').click();
      await sleep(1200);
      confirmAnswer = true;
    }
    const papers = await click('Download papers CSV');
    if (E.userClicks) {
      ok(/Only 4 of 5 abstracts have loaded/.test(confirms[confirms.length - 1]) && !/All Versions/.test(confirms[confirms.length - 1]),
        'after the clicks, the warning reports only the missing abstract', confirms[confirms.length - 1]);
    } else {
      eq(confirms.length, 0, 'no warning on a page with no SSRN links to click');
    }
    ok(papers && /_ssrn_papers_\d{4}-\d{2}-\d{2}\.csv$/.test(papers.filename), 'papers CSV filename', papers && papers.filename);
    const rows = toObjects(papers.text);
    ok(/,Author Profile URLs$/.test(papers.text.split('\r\n')[0]), 'papers list has the same columns as the archive papers file', papers.text.split('\r\n')[0].slice(-60));
    eq(rows.length, E.rows, 'papers CSV row count (sidebar excluded, versions included)');
    eq(rows[0].Title, E.firstTitle, 'first title');
    eq(rows[0]['Authors (with Affiliations)'], E.firstAuthors, 'first authors with affiliations');
    for (const [id, fields] of Object.entries(E.byId)) {
      const r = rows.find((x) => x['Abstract ID'] === id) || {};
      for (const [k, v] of Object.entries(fields)) eq(r[k], v, `paper ${id}: ${k}`);
    }
    const statusText = panel.querySelector('.sscr-status').textContent;
    if (E.status) ok(E.status.test(statusText), 'status line after export', statusText);
    if (E.userClicks) eq(window.__abstractClicks, 1, '"All Abstracts" clicked once, by the user');

    window.__sscrTestHistoryFile = null; // "Start a new one" never opens the picker
    const first = await click('Start a history file');
    const h1 = toObjects(first.text);
    eq(h1.length, E.historyPapers, 'new history: one row per paper with a count');

    // Pretend the first file was saved a month ago, then add today's run to it.
    const monthAgo = first.text.replace(/\d{4}-\d{2}-\d{2}/g, '2000-01-01');
    window.__sscrTestHistoryFile = { name: 'my_ssrn_download_history_2000-01-01.csv', text: monthAgo };
    const second = await click('Add today\'s counts');
    const h2 = toObjects(second.text);
    eq(h2.length, E.historyPapers * 2, 'second run: old rows kept plus today');
    ok(/^my_ssrn_download_history_\d{4}-\d{2}-\d{2}\.csv$/.test(second.filename), 'second run keeps the picked name', second.filename);

    window.__sscrTestHistoryFile = { name: 'again.csv', text: second.text };
    const third = await click('Add today\'s counts');
    eq(toObjects(third.text).length, E.historyPapers * 2, 'same-day re-run replaces, does not add');

    window.__sscrTestHistoryFile = { name: 'wrong.csv', text: papers.text };
    btn('Add today\'s counts').click();
    await sleep(300);
    ok(/isn't a download-history CSV/.test(panel.querySelector('.sscr-status').textContent), 'picking a papers CSV shows an error');

    if (E.archive) await archiveChecks();

    // Running the bookmarklet again re-shows the panel instead of adding a second one.
    panel.style.display = 'none';
    const s = document.createElement('script');
    s.src = '../test-build/sscrapern.test.js';
    document.body.appendChild(s);
    await new Promise((r) => { s.onload = r; });
    eq([document.querySelectorAll('#sscr-panel').length, panel.style.display], [1, ''], 're-run shows the existing panel');
  } catch (e) {
    failures++;
    out.push('FAIL  exception: ' + (e && e.stack || e));
  }

  async function archiveChecks() {
    eq([api.pdfLinkFor('1234567', 'https://papers.ssrn.com/sol3/Delivery.cfm/SSRN_ID7654321_code123456.pdf?abstractid=1234567'),
        api.pdfLinkFor('111', 'http://localhost:8741/x/pdfs/111.pdf')],
      ['https://papers.ssrn.com/sol3/Delivery.cfm?abstractid=1234567&mirid=1', 'http://localhost:8741/x/pdfs/111.pdf'],
      'pdfLinkFor: working paper-page form on SSRN, page link elsewhere');
    const ids = new Set(['2635639', '711466', '111']);
    eq(['SSRN_ID2635639_code711466.pdf', 'SSRN-id2635639.pdf', 'ssrn-id711466 (1).pdf', '111.pdf', 'Smith 2019 notes.pdf'].map((n) => api.idInFileName(n, ids)),
      ['2635639', '2635639', '711466', '111', ''], 'idInFileName: SSRN\'s names, a plain id, and no match');
    const pr = api.pairPdfs([{ 'Abstract ID': '1', Title: 'a', 'SSRN Offers': 'Free paper' }, { 'Abstract ID': '2', Title: 'b', 'SSRN Offers': 'Fee paper' },
      { 'Abstract ID': '3', Title: 'c', 'SSRN Offers': 'No PDF file' }, { 'Abstract ID': '4', Title: 'd', 'SSRN Offers': '' }],
    [{ name: 'SSRN-id1.pdf', path: 'pdfs/SSRN-id1.pdf' }, { name: '1.pdf', path: '1.pdf' }, { name: 'x.pdf', path: 'pdfs/x.pdf' }]);
    eq(pr.rows.map((r) => `${r['Abstract ID']}:${r.Status}:${r['PDF File']}:${r.Note}`),
      ['1:saved:pdfs/SSRN-id1.pdf:also matched: 1.pdf', '2:sold_by_ssrn::', '3:no_pdf_on_ssrn::', '4:to_download::'], 'pairPdfs statuses, duplicates noted');
    eq(pr.unmatched, ['pdfs/x.pdf'], 'pairPdfs lists files that match no paper');

    const root = await navigator.storage.getDirectory();
    const name = api.archiveName();
    await root.removeEntry(name, { recursive: true }).catch(() => {});
    window.__sscrTestDir = root;
    // SSRN's row icons: 333 is sold, 444 has no PDF.
    document.querySelector('#div_333 .actions a').setAttribute('title', 'Fee paper');
    document.querySelector('#div_444 .actions a').setAttribute('title', 'No PDF file');
    const status = () => panel.querySelector('.sscr-status').textContent;
    const runButton = async (text, done) => {
      btn(text).click();
      for (let i = 0; i < 200; i++) {
        await sleep(50);
        if (!btn(text).disabled && done.test(status())) break;
      }
      return status();
    };
    const status1 = await runButton('Archive this profile', /Archive saved|archive failed|nothing was|Nothing saved/);
    ok(/Archive saved/.test(status1) && /PDFs: 0 saved, 3 to download, 1 sold by SSRN, 1 with no PDF on SSRN/.test(status1), 'archive saves and reports the checklist', status1);
    const dir = await root.getDirectoryHandle(name);
    const names = [];
    for await (const [n] of dir.entries()) names.push(n);
    const today = names.find((n) => /^papers_\d{4}-\d{2}-\d{2}\.csv$/.test(n)).slice(7, 17);
    eq(names.sort(), ['README.txt', 'download-checklist.html', `manifest_${today}.csv`, `papers_${today}.csv`, `papers_${today}.json`, 'pdfs', `profile_${today}.html`].sort(), 'archive folder contents');
    const read = async (n, d = dir) => (await (await d.getFileHandle(n)).getFile()).text();
    const manifest = async () => Object.fromEntries(toObjects((await read(`manifest_${today}.csv`)).replace(/^﻿/, '')).map((r) => [r['Abstract ID'], r]));
    let m = await manifest();
    eq(['111', '222', '333', '444', '445'].map((id) => m[id].Status), ['to_download', 'to_download', 'sold_by_ssrn', 'no_pdf_on_ssrn', 'to_download'], 'manifest: SSRN\'s offer per paper');
    const papersCsv = toObjects((await read(`papers_${today}.csv`)).replace(/^﻿/, ''));
    eq(papersCsv.map((r) => r['SSRN Offers']), ['Free paper', 'Free paper', 'Fee paper', 'No PDF file', 'Free paper'], 'papers file records what SSRN offers');
    const json = JSON.parse(await read(`papers_${today}.json`));
    eq([json.papers.length, json.papers[0]['Author Profile URLs']], [5, ['https://papers.ssrn.com/sol3/cf_dev/AbsByAuth.cfm?per_id=3']], 'JSON: papers and co-author profile links');
    const html = await read(`profile_${today}.html`);
    eq([/<script/i.test(html), /sscr-panel/.test(html), /<base href=/.test(html), /Abstract of paper 111/.test(html), /\sonclick=/i.test(html)],
      [false, false, true, true, false], 'page snapshot: no scripts/panel/handlers, base link, abstracts kept');
    let list = await read('download-checklist.html');
    ok(!/<script/i.test(list) && /Content-Security-Policy" content="default-src 'none'/.test(list) && /0 saved, 3 to download/.test(list) &&
      /href="https:\/\/papers\.ssrn\.com\/sol3\/papers\.cfm\?abstract_id=111" target="_blank" rel="noopener noreferrer">A First Example Paper/.test(list),
    'checklist: static, no scripts, counts, titles link to SSRN', list.slice(0, 300));
    ok(/save the PDFs you download here/.test(await read('README.txt')), 'README explains the pdfs folder');

    // The user downloads two PDFs into pdfs/ with SSRN's names, saves one in
    // the archive folder itself, and leaves an unrelated PDF and an empty file.
    const put = async (d, n, text) => { const w = await (await d.getFileHandle(n, { create: true })).createWritable(); await w.write(text); await w.close(); };
    const pdfs = await dir.getDirectoryHandle('pdfs');
    await put(pdfs, 'SSRN_ID111_code12345.pdf', '%PDF-1.4 a');
    await put(pdfs, 'SSRN-id222.pdf', '%PDF-1.4 b');
    await put(pdfs, 'notes.pdf', '%PDF-1.4 c');
    await put(pdfs, 'SSRN-id445.pdf', '');
    await put(dir, 'Example 445.pdf', '%PDF-1.4 d');
    window.__sscrTestDir = dir;
    const status2 = await runButton('Check downloaded PDFs', /Checked|isn't an SScrapeRN|failed|No folder/);
    ok(/Checked ".*": PDFs: 3 saved, 0 to download, 1 sold by SSRN, 1 with no PDF on SSRN\. 1 PDF file\(s\) match no paper/.test(status2), 'check pairs the saved PDFs', status2);
    m = await manifest();
    eq(['111', '222', '445'].map((id) => m[id]['PDF File']), ['pdfs/SSRN_ID111_code12345.pdf', 'pdfs/SSRN-id222.pdf', 'Example 445.pdf'],
      'manifest records each file; an empty file is ignored');
    list = await read('download-checklist.html');
    ok(/3 saved, 0 to download/.test(list) && /notes\.pdf/.test(list), 'checklist rewritten, unmatched file listed');

    // Picking the parent folder finds this page's archive inside it; a folder
    // that isn't an archive is refused.
    window.__sscrTestDir = root;
    ok(/Checked/.test(await runButton('Check downloaded PDFs', /Checked|isn't an SScrapeRN|failed/)), 'check from the parent folder finds the archive');
    window.__sscrTestDir = await root.getDirectoryHandle('not-an-archive', { create: true });
    ok(/isn't an SScrapeRN archive/.test(await runButton('Check downloaded PDFs', /Checked|isn't an SScrapeRN|failed/)), 'a folder that isn\'t an archive is refused');

    // Archiving again into the archive folder itself refreshes the metadata,
    // keeps the PDFs, and does not nest a copy.
    window.__sscrTestDir = dir;
    const status3 = await runButton('Archive this profile', /Archive saved|archive failed/);
    ok(/PDFs: 3 saved/.test(status3), 're-archive keeps the saved PDFs', status3);
    let nested = false;
    for await (const [n] of dir.entries()) if (n === name) nested = true;
    eq(nested, false, 'archiving into the archive folder itself does not nest a copy');
    window.__sscrTestDir = undefined;
  }

  eq(fetchCalls, 0, 'the tool made no network requests');
  out.unshift(`${failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'}`);
  const pre = document.createElement('pre');
  pre.id = 'results';
  pre.textContent = out.join('\n');
  document.body.prepend(pre);
  document.title = failures === 0 ? 'PASS' : 'FAIL';
})();
