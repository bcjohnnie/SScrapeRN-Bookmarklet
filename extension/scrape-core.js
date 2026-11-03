// SScrapeRN core: everything that reads SSRN pages and writes the papers CSV.
//
// Shared by both packagings:
//   - the extension loads it as a content script ahead of content.js
//     (manifest.json), so SScrapeRNCore is a global in content.js;
//   - the bookmarklet's build.mjs wraps this file and src/sscrapern.js in
//     one function, so nothing leaks into the page.
//
// It reads only what is already on the page. It makes no requests to SSRN
// and clicks nothing on SSRN's page. The user clicks SSRN's own "All
// Versions" and "All Abstracts" links; pageReadiness() says whether they have.
// eslint-disable-next-line no-unused-vars
const SScrapeRNCore = (() => {
  'use strict';

  const CSV_HEADERS = [
    'Title',
    'Authors (with Affiliations)',
    'Venue / Publication',
    'Abstract',
    'Keywords',
    'DOI',
    'Number of Pages',
    'Posted Date',
    'Last Revised Date',
    'Downloads',
    'Citations',
    'PDF URL',
    'Abstract Page URL',
    'Abstract ID'
  ];


  // User-agent check, not `typeof browser`: page scripts can define a global
  // called `browser`, and the bookmarklet shares the page's window.
  const IS_FIREFOX = /firefox\//i.test(navigator.userAgent);

  // Set by configure(): where status text goes, and an element (our panel)
  // whose links are never papers.
  let status = () => {};
  let ignoreWithin = null;

  function configure(opts) {
    if (opts.onStatus) status = opts.onStatus;
    if (opts.ignoreWithin) ignoreWithin = opts.ignoreWithin;
  }

  // ---------- Scraping the list page ----------

  // Climb up from the title link until we find an ancestor whose parent has
  // several siblings that each also contain a title link. That ancestor is
  // "one paper's container", whatever class names SSRN uses.
  function findContainer(anchor) {
    let candidate = anchor;
    let node = anchor.parentElement;
    while (node) {
      const siblingsWithTitle = Array.from(node.children).filter(
        (c) => c.querySelector && c.querySelector('a[href*="papers.cfm?abstract_id="]')
      );
      if (siblingsWithTitle.length >= 4) {
        return candidate;
      }
      candidate = node;
      node = node.parentElement;
    }
    return anchor.parentElement || anchor;
  }

  function getLines(elem) {
    return (elem.innerText || '')
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
  }

  // Splits SSRN's "A, B and C" / "A and B" style lists into ["A","B","C"].
  function splitPeopleList(str) {
    if (!str) return [];
    const normalized = str.replace(/,?\s+and\s+(?=[^,]+$)/, ', ');
    return normalized
      .split(/,\s*/)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  function combineAuthorsAffiliations(authorsStr, affiliationsStr) {
    const authors = splitPeopleList(authorsStr);
    const affiliations = splitPeopleList(affiliationsStr);
    if (authors.length === 0) return '';
    return authors
      .map((name, i) => (affiliations[i] ? `${name}, ${affiliations[i]}` : name))
      .join('; ');
  }

  // Series-page template (www.ssrn.com): real CSS classes, so read them
  // directly. Each author is in its own <div>, which innerText would run
  // together.
  function parseStructuredPaperWrap(anchor, entry) {
    const wrap = anchor.closest('.paper-wrap');
    if (!wrap) return false;

    const referenceEl = wrap.querySelector('.reference');
    if (referenceEl) {
      entry['Venue / Publication'] = referenceEl.textContent.trim();
    }

    const statsEl = wrap.querySelector('.stats');
    if (statsEl) {
      const statsText = statsEl.textContent;
      const pagesMatch =
        statsText.match(/Number of pages:\s*(\d+)/i) || statsText.match(/(\d+)\s*Pages?\b/i);
      if (pagesMatch) entry['Number of Pages'] = pagesMatch[1];
      const postedMatch = statsText.match(/Posted:?\s*([\d]{1,2}\s+\w+\s+\d{4})/i);
      if (postedMatch) entry['Posted Date'] = postedMatch[1];
      const revisedMatch = statsText.match(/Last Revised:?\s*([\d]{1,2}\s+\w+\s+\d{4})/i);
      if (revisedMatch) entry['Last Revised Date'] = revisedMatch[1];
    }

    const authorNames = Array.from(wrap.querySelectorAll('.authors a'))
      .map((a) => a.textContent.trim())
      .filter(Boolean);

    const affiliationsEl = wrap.querySelector('.affiliations');
    const affiliationsList = affiliationsEl ? splitPeopleList(affiliationsEl.textContent.trim()) : [];

    entry['Authors (with Affiliations)'] = authorNames
      .map((name, i) => (affiliationsList[i] ? `${name}, ${affiliationsList[i]}` : name))
      .join('; ');

    // Look in the parent only if it holds this paper alone; otherwise a paper
    // with no Downloads block would take the first count in the list.
    const parent = wrap.parentElement;
    const parentIsOwn = parent && parent.querySelectorAll('.paper-wrap').length === 1;
    const downloadsEl = wrap.querySelector('.downloads') || (parentIsOwn ? parent.querySelector('.downloads') : null);
    if (downloadsEl) {
      const numMatch = downloadsEl.textContent.match(/([\d,]+)/);
      if (numMatch) {
        entry.Downloads = numMatch[1] || '';
      }
    }

    const citMatch = wrap.textContent.match(/Citation:?\s*(\d+)/i);
    if (citMatch) entry.Citations = citMatch[1];

    return true;
  }

  // Every author profile linked from a paper's row (the page owner's own name
  // is plain text on author pages, so it is not among them). Kept outside
  // CSV_HEADERS: the archive mode writes it, the plain export doesn't.
  function authorProfileUrls(anchor) {
    const box = anchor.closest('.paper-wrap, .trow') || findContainer(anchor);
    const urls = Array.from(box.querySelectorAll('a[href*="AbsByAuth.cfm"]'))
      .map((a) => a.href)
      .filter((h) => /per_id=\d+/.test(h));
    return Array.from(new Set(urls));
  }

  function parseListEntry(anchor) {
    const entry = parseListEntryFields(anchor);
    entry._authorProfileUrls = authorProfileUrls(anchor);
    return entry;
  }

  // Author-page template (papers.ssrn.com): each paper is
  // a div.trow.abs holding .description (.reference, .note-list spans,
  // .authors-list, .afiliations [sic]) plus .downloads and .citations. Read by
  // class with textContent, which also works in hidden version rows. The line
  // heuristic below misses some papers on this template.
  function parseStructuredAuthorRow(anchor, entry) {
    const row = anchor.closest('.trow.abs');
    if (!row || row.classList.contains('abstract-row')) return false;
    const desc = row.querySelector('.description');
    if (!desc) return false;
    const text = (sel) => {
      const n = row.querySelector(sel);
      return n ? n.textContent.replace(/\s+/g, ' ').trim() : '';
    };

    entry['Venue / Publication'] = text('.description .reference');
    const note = text('.description .note-list');
    const pages = note.match(/Number of pages:\s*(\d+)/i);
    if (pages) entry['Number of Pages'] = pages[1];
    const posted = note.match(/Posted:?\s*(\d{1,2}\s+\w+\s+\d{4})/i);
    if (posted) entry['Posted Date'] = posted[1];
    const revised = note.match(/Last Revised:?\s*(\d{1,2}\s+\w+\s+\d{4})/i);
    if (revised) entry['Last Revised Date'] = revised[1];

    // The page owner's name is plain text and co-authors are links, so read
    // the list as text: "A , B and C" -> ["A", "B", "C"].
    entry['Authors (with Affiliations)'] = combineAuthorsAffiliations(
      text('.description .authors-list'), text('.description .afiliations, .description .affiliations'));

    const downloads = text('.downloads').match(/([\d,]+)/);
    if (downloads) entry.Downloads = downloads[1];
    const citations = text('.citations').match(/(\d+)/);
    if (citations) entry.Citations = citations[1];
    return true;
  }

  function parseListEntryFields(anchor) {
    const title = anchor.textContent.trim();
    const abstractUrl = anchor.href.split('#')[0];
    const idMatch = abstractUrl.match(/abstract_id=(\d+)/);
    const abstractId = idMatch ? idMatch[1] : '';

    const entry = {
      Title: title,
      'Authors (with Affiliations)': '',
      'Venue / Publication': '',
      Abstract: '',
      Keywords: '',
      DOI: '',
      'Number of Pages': '',
      'Posted Date': '',
      'Last Revised Date': '',
      Downloads: '',
      Citations: '',
      'PDF URL': '',
      'Abstract Page URL': abstractUrl,
      'Abstract ID': abstractId
    };

    if (parseStructuredPaperWrap(anchor, entry) || parseStructuredAuthorRow(anchor, entry)) {
      return entry;
    }

    let rawAuthors = '';
    let rawAffiliations = '';

    try {
      const container = findContainer(anchor);
      const lines = getLines(container);

      const titleIdx = Math.max(
        0,
        lines.findIndex((l) => l.includes(title.slice(0, Math.min(15, title.length))))
      );

      const pagesIdx = lines.findIndex((l) => /Posted:\s*\d{1,2}\s+\w+\s+\d{4}/i.test(l));
      const pagesLine = pagesIdx !== -1 ? lines[pagesIdx] : '';

      const pagesMatch =
        pagesLine.match(/Number of pages:\s*(\d+)/i) || pagesLine.match(/(\d+)\s*Pages?\b/i);
      if (pagesMatch) entry['Number of Pages'] = pagesMatch[1];

      const postedMatch = pagesLine.match(/Posted:\s*([\d]{1,2}\s+\w+\s+\d{4})/i);
      if (postedMatch) entry['Posted Date'] = postedMatch[1];

      const revisedMatch = pagesLine.match(/Last Revised:\s*([\d]{1,2}\s+\w+\s+\d{4})/i);
      if (revisedMatch) entry['Last Revised Date'] = revisedMatch[1];

      if (pagesIdx > titleIdx + 1) {
        entry['Venue / Publication'] = lines.slice(titleIdx + 1, pagesIdx).join(' ').trim();
      }

      // Authors/affiliations are the two lines after the dates line, whether
      // or not a Downloads line follows (journal articles often have none).
      if (pagesIdx !== -1 && lines.length > pagesIdx + 2) {
        rawAuthors = lines[pagesIdx + 1];
        rawAffiliations = lines[pagesIdx + 2];
      }

      const dlIdx = lines.findIndex((l) => /^Downloads(\s|$)/i.test(l));
      if (dlIdx !== -1) {
        const sameLineMatch = lines[dlIdx].match(/Downloads\s*([\d,]+)/i);
        if (sameLineMatch && sameLineMatch[1]) {
          entry.Downloads = sameLineMatch[1];
        } else if (lines[dlIdx + 1]) {
          const nextLineMatch = lines[dlIdx + 1].match(/([\d,]+)/);
          if (nextLineMatch) {
            entry.Downloads = nextLineMatch[1] || '';
          }
        }
        if (!rawAuthors && dlIdx >= 2) rawAuthors = lines[dlIdx - 2];
        if (!rawAffiliations && dlIdx >= 1) rawAffiliations = lines[dlIdx - 1];
      }

      const citIdx = lines.findIndex((l) => /^Citation(\s|$)/i.test(l));
      if (citIdx !== -1) {
        const sameLineMatch = lines[citIdx].match(/Citation\s*(\d+)/i);
        if (sameLineMatch && sameLineMatch[1]) {
          entry.Citations = sameLineMatch[1];
        } else if (lines[citIdx + 1] && /^\d+$/.test(lines[citIdx + 1])) {
          entry.Citations = lines[citIdx + 1];
        }
      }
    } catch (e) {
      console.warn('SScrapeRN: failed to parse list entry', title, e);
    }

    entry['Authors (with Affiliations)'] = combineAuthorsAffiliations(rawAuthors, rawAffiliations);

    return entry;
  }

  // Series pages show "Top Downloaded"/"Top Cited" sidebar widgets before the
  // real list, which starts at "Displaying X-Y of Z papers". Keep only links
  // after that marker when it exists.
  function findResultsMarker() {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      if (/Displaying\s+[\d,]+\s*-\s*[\d,]+\s+of\s+[\d,]+\s+papers/i.test(node.textContent)) {
        return node.parentElement || node;
      }
    }
    return null;
  }

  function findTitleAnchors() {
    const candidateSelectors = [
      'a[href*="papers.cfm?abstract_id="]',
      'a[href*="abstract_id="]',
      'a[href*="/abstract="]'
    ];
    const set = new Set();
    const anchors = [];
    for (const sel of candidateSelectors) {
      document.querySelectorAll(sel).forEach((a) => {
        if (set.has(a)) return;
        if (ignoreWithin && ignoreWithin.contains(a)) return; // our own panel
        const href = a.href || '';
        const text = a.textContent.trim();
        if (!text) return;
        if (href.includes('AbsByAuth.cfm')) return; // author link, not a title
        if (href.includes('Delivery.cfm')) return; // PDF download link
        if (!/abstract(_id)?=\d+/.test(href)) return;
        set.add(a);
        anchors.push(a);
      });
    }
    const marker = findResultsMarker();
    if (marker) {
      return anchors.filter((a) => {
        const position = marker.compareDocumentPosition(a);
        return Boolean(position & Node.DOCUMENT_POSITION_FOLLOWING);
      });
    }
    return anchors;
  }

  function waitForAnchors(timeoutMs, onTick) {
    return new Promise((resolve) => {
      const existing = findTitleAnchors();
      if (existing.length > 0) {
        resolve(existing);
        return;
      }
      const startedAt = Date.now();
      const observer = new MutationObserver(() => {
        const found = findTitleAnchors();
        if (found.length > 0) {
          observer.disconnect();
          clearTimeout(timer);
          clearInterval(ticker);
          resolve(found);
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });

      const ticker = setInterval(() => {
        // Nudge the page in case content lazy-loads on scroll.
        window.scrollTo(0, document.body.scrollHeight);
        if (onTick) onTick(Math.round((Date.now() - startedAt) / 1000));
      }, 1000);

      const timer = setTimeout(() => {
        observer.disconnect();
        clearInterval(ticker);
        resolve(findTitleAnchors());
      }, timeoutMs);
    });
  }

  // SSRN hides a "show all" link (display:none on the link itself) once it
  // has been clicked. Test the link's own display, not offsetParent: the
  // toolbar holding these links is .hidden-xs/.hidden-sm, so in a narrow
  // window every link has a null offsetParent while still unclicked.
  function isToggleShown(link) {
    return getComputedStyle(link).display !== 'none';
  }

  // ---------- What the user still has to click ----------
  // The tool never clicks SSRN's links itself. "All Abstracts" makes SSRN
  // fetch every paper's abstract, so it stays the user's own action.
  // "All Versions" is a list-wide toggle for multi-version papers.
  // SSRN's toolbar link: by class first, then by its text in case SSRN
  // renames the class. Never one inside our own panel.
  function findToolbarLink(cls, text) {
    const byClass = document.querySelector('.' + cls);
    if (byClass) return byClass;
    return Array.from(document.querySelectorAll('a')).find((a) =>
      !(ignoreWithin && ignoreWithin.contains(a)) && a.textContent.trim().toLowerCase() === text) || null;
  }

  function pageReadiness() {
    const versions = findToolbarLink('link-show-all-versions', 'all versions');
    const showAll = findToolbarLink('link-show-all-abstracts', 'all abstracts');
    const bodies = Array.from(document.querySelectorAll('[id^="abstractBody_"]'))
      .filter((b) => !(ignoreWithin && ignoreWithin.contains(b)));
    return {
      versionsHidden: Boolean(versions && isToggleShown(versions)),
      hasAbstractLink: Boolean(showAll),
      abstractsClicked: !showAll || !isToggleShown(showAll),
      abstractTotal: bodies.length,
      abstractsLoaded: bodies.filter((b) => b.textContent.trim()).length
    };
  }

  // Plain-language reasons to stop and click first, one per link; empty when
  // ready. Each is checked on its own: "All Abstracts"
  // warns whenever SSRN still shows it unclicked and the abstracts aren't all
  // there, even if the page has no abstract slots yet.
  function readinessWarnings(r = pageReadiness()) {
    const out = [];
    if (r.versionsHidden) {
      out.push({ link: 'All Versions', text: 'SSRN\'s "All Versions" link (above the paper list) hasn\'t been clicked, so earlier versions of some papers may be missing.' });
    }
    const missing = r.abstractTotal === 0 || r.abstractsLoaded < r.abstractTotal;
    if (!r.abstractsClicked && missing) {
      out.push({ link: 'All Abstracts', text: 'SSRN\'s "All Abstracts" link (above the paper list) hasn\'t been clicked, so the abstracts are empty' +
        (r.abstractTotal ? ` (${r.abstractsLoaded} of ${r.abstractTotal} loaded).` : '.') });
    } else if (r.abstractsClicked && r.abstractTotal && r.abstractsLoaded < r.abstractTotal) {
      out.push({ link: 'All Abstracts', text: `Only ${r.abstractsLoaded} of ${r.abstractTotal} abstracts have loaded. Wait a few seconds for the rest; if they don't come, reload the page and click "All Abstracts" again.` });
    }
    return out;
  }

  async function scrapeListPage() {
    const anchors = await waitForAnchors(25000, (seconds) => {
      status(`Waiting for the paper list to load… (${seconds}s)`);
    });

    // De-duplicate by abstract_id while preserving order.
    const seen = new Set();
    const unique = [];
    for (const a of anchors) {
      const m = a.href.match(/abstract(_id)?=(\d+)/);
      const id = m ? m[2] : a.href;
      if (!seen.has(id)) {
        seen.add(id);
        unique.push(a);
      }
    }
    return unique.map(parseListEntry);
  }

  // ---------- Links ----------

  // The profile page's own Download links (Delivery.cfm/SSRN_ID…_code….pdf)
  // have returned 404, while the paper page's form,
  // Delivery.cfm?abstractid=<id>&mirid=1, works. On SSRN, build that form;
  // elsewhere (test fixtures) keep the page's link. Only papers whose row has
  // a Download link get one at all.
  function pdfLinkFor(id, pageLink) {
    let u;
    try {
      u = new URL(pageLink, location.href);
    } catch {
      return pageLink;
    }
    if (!/^\d+$/.test(String(id)) || !isSsrnHost(u.hostname)) return u.href;
    return `https://${u.hostname}/sol3/Delivery.cfm?abstractid=${id}&mirid=1`;
  }

  function isSsrnHost(hostname) {
    return hostname === 'ssrn.com' || hostname.endsWith('.ssrn.com');
  }

  function isSameOrigin(url) {
    try {
      return new URL(url, location.href).origin === location.origin;
    } catch {
      return false;
    }
  }

  // ---------- In-page abstracts, keywords and PDF links (author pages) ----------
  // Each paper's row is followed by a hidden "abstract-row" holding:
  //   #keywords_<id>      keywords, already in the page
  //   #hrefDown<id>       the PDF download link, already in the page
  //   #abstractBody_<id>  empty until the user clicks SSRN's "All Abstracts"
  //                       (or a paper's own toggle)
  // The row's .actions icon title says what SSRN offers: "Free paper",
  // "No PDF file" or "Fee paper".

  const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();

  function readInPageExtras(entries) {
    for (const e of entries) {
      const id = e['Abstract ID'];
      if (!id) continue;
      const body = document.getElementById('abstractBody_' + id);
      if (body && !e.Abstract) e.Abstract = clean(body.textContent);
      const kw = document.getElementById('keywords_' + id);
      if (kw && !e.Keywords) e.Keywords = clean(kw.textContent).replace(/^Keywords:\s*/i, '');
      // A "Fee paper" row's Download link is javascript:void(0);: SSRN sells
      // the paper, so there is no PDF link to record.
      // Any other link that isn't a web address is dropped the same way.
      const row = document.getElementById('div_' + id);
      const icon = row && row.querySelector('.actions [title]');
      if (icon) e._ssrnOffers = icon.getAttribute('title').trim();
      if (e._ssrnOffers === 'Fee paper') e._feePaper = true;
      const pdf = document.getElementById('hrefDown' + id);
      const href = pdf ? pdf.getAttribute('href') || '' : '';
      if (href && !/^\s*(https?:|\/|[^:]*$)/i.test(href)) e._deadLink = true;
      if (pdf && pdf.href && !e._feePaper && !e._deadLink && !e['PDF URL']) e['PDF URL'] = pdfLinkFor(id, pdf.href);
    }
  }

  // ---------- The whole export scan ----------

  // Read the page as it stands. Returns {entries, note}, where note is the
  // status-line summary of what is missing and why.
  async function collectPapers() {
    status('Scanning page for papers…');
    const entries = await scrapeListPage();
    if (entries.length === 0) return { entries, note: '' };
    readInPageExtras(entries);

    const r = pageReadiness();
    const withAbstract = entries.filter((e) => e.Abstract).length;
    let note;
    if (r.abstractTotal === 0 && withAbstract === 0) {
      note = ' This page shows no abstracts in its list.';
    } else {
      note = ` Abstracts: ${withAbstract} of ${entries.length}`;
      if (withAbstract < entries.length) {
        note += !r.abstractsClicked ? ' ("All Abstracts" wasn\'t clicked).'
          : r.hasAbstractLink ? ' (SSRN hadn\'t returned the rest).' : '.';
      } else {
        note += '.';
      }
    }
    if (r.versionsHidden) note += ' "All Versions" wasn\'t clicked, so earlier versions may be missing.';
    note += ' DOIs aren\'t collected (they appear only on each paper\'s own page).';
    return { entries, note };
  }

  // ---------- CSV and filenames ----------

  // A cell starting with = + - or @ would run as a formula in Excel; a
  // leading apostrophe makes Excel show it as text. readHistoryCsv strips it
  // again, so the history file doesn't gain one apostrophe per round trip.
  const FORMULA_START = /^[=+\-@]/;

  function csvEscape(value) {
    let s = (value === undefined || value === null ? '' : String(value))
      .replace(/\r?\n/g, ' ')
      .trim();
    if (FORMULA_START.test(s)) s = "'" + s;
    if (/[",]/.test(s)) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  }

  function buildCsv(rows, headers = CSV_HEADERS) {
    const lines = [headers.map(csvEscape).join(',')];
    for (const row of rows) {
      lines.push(headers.map((h) => csvEscape(row[h])).join(','));
    }
    return lines.join('\r\n');
  }

  function guessAuthorName() {
    const h1 = document.querySelector('h1');
    if (h1 && h1.textContent.trim()) {
      return h1.textContent.trim();
    }
    return 'ssrn-author';
  }

  function todayDateStamp() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function safeFilename(name) {
    return (
      name
        .replace(/[^a-z0-9]+/gi, '_')
        .replace(/^_+|_+$/g, '')
        .toLowerCase() || 'ssrn_export'
    );
  }


  return {
    CSV_HEADERS,
    isSameOrigin,
    isSsrnHost,
    pdfLinkFor,
    IS_FIREFOX,
    configure,
    collectPapers,
    scrapeListPage,
    waitForAnchors,
    pageReadiness,
    readinessWarnings,
    csvEscape,
    buildCsv,
    guessAuthorName,
    todayDateStamp,
    safeFilename
  };
})();
