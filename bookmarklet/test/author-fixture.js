// Shared author-page fixture data: builds the rows and simulates SSRN's "All Abstracts".
// Used by author.html (bookmarklet) and extension-author.html (extension).
const PAPERS = [
  { id: '111', n: 1, title: 'A First Example Paper', ref: 'THE EXAMPLE HANDBOOK, 2010, Example Law School Research Paper No. 12-11', pages: 36, posted: '13 Feb 2012', authors: 'Jane Example and <a href="https://papers.ssrn.com/sol3/cf_dev/AbsByAuth.cfm?per_id=3">Sam Coauthor</a>', affs: 'Example University School of Law and Independent', dl: '4,408', cit: '8', kw: 'rules, examples, testing' },
  { id: '222', n: 2, title: 'A Second Example Paper', ref: 'Example Agency', pages: 12, posted: '1 Jan 2015', authors: 'Jane Example', affs: 'Example University School of Law', dl: '980', kw: 'examples, measurement' },
  { id: '333', n: 3, title: 'A Journal Article Without Counts', ref: 'Example Journal of Law', pages: 50, posted: '4 Apr 2018', authors: 'Jane Example', affs: 'Example University School of Law', kw: 'journals' },
  { id: '444', n: 4, title: 'A Fourth Example Paper', ref: 'Working paper', pages: 20, posted: '5 May 2019', authors: 'Jane Example and <a href="https://papers.ssrn.com/sol3/cf_dev/AbsByAuth.cfm?per_id=2">Alex Coauthor</a>', affs: 'Example University School of Law and Other University', dl: '55' },
  { id: '445', n: 5, title: 'A Fourth Example Paper (earlier version)', ref: 'Working paper', pages: 18, posted: '1 Feb 2019', authors: 'Jane Example', affs: 'Example University School of Law', dl: '12', version: true }
];
// Stand-in PDF links (SSRN's are papers.ssrn.com/sol3/Delivery.cfm/...). Nothing fetches them.
const pdf = (id) => new URL(`pdfs/${id}.pdf`, location.href).href;
document.getElementById('tbody').innerHTML = PAPERS.map((p) => `
<div class="trow abs abs_${p.id}${p.version ? ' version-row' : ''}" id="div_${p.id}">
  <div class="actions">${p.n}. <a title="Free paper" href="${pdf(p.id)}"><i class="icn icn-free"></i></a></div>
  <div class="description">
    <h3><a class="title optClickTitle" href="https://papers.ssrn.com/sol3/papers.cfm?abstract_id=${p.id}"><span>${p.title}</span></a></h3>
    <div class="reference">${p.ref}</div>
    <div class="note note-list"><span>Number of pages: ${p.pages}</span> <span>Posted: ${p.posted}</span></div>
    <div class="authors-list">${p.authors}</div>
    <div class="afiliations">${p.affs}</div>
  </div>
  <div class="downloads">${p.dl ? `<span>Downloads</span> <span>${p.dl}</span>` : ''}</div>
  <div class="citations">${p.cit ? `<span>Citation</span> <span><a href="javascript:void(0);">    ${p.cit}</a></span>` : ''}</div>
</div>
<div class="trow abstract-row abs abs_${p.id}">
  <div class="description">
    <ul class="separators-list">
      <li><a class="optClickOpenPDF" id="hrefOpen${p.id}" href="${pdf(p.id)}&amp;type=2">View PDF</a></li>
      <li><a class="optClickDownload" id="hrefDown${p.id}" href="${pdf(p.id)}">Download</a></li>
    </ul>
    <div id="abstract_${p.id}" class="collapse abstract-container"><div class="abstract">
      <h4>Abstract:</h4>
      <p id="waiting_${p.id}"></p>
      <p id="abstractBody_${p.id}"></p>
      ${p.kw ? `<p class="hide" id="keywords_${p.id}">${p.kw}</p>` : ''}
    </div></div>
  </div>
</div>`).join('');
window.__abstractClicks = 0;
function fixtureShowAllAbstracts(link) {
  window.__abstractClicks++;
  link.style.display = 'none';
  document.querySelectorAll('.abstract-container').forEach((c) => c.classList.add('in'));
  PAPERS.forEach((p, i) => {
    if (p.id === '333') return; // SSRN refused this one
    setTimeout(() => {
      document.getElementById('abstractBody_' + p.id).innerHTML = `Abstract of paper ${p.id},  with <i>markup</i>\n and spacing.`;
    }, 200 + 100 * i);
  });
}
