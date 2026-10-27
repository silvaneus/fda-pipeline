/**
 * Renders the dashboard as one self-contained HTML file: data embedded as
 * JSON, filtering and sorting done in the browser.
 */

function renderDashboard(views, meta) {
  const data = JSON.stringify({ ...views, meta }).replace(/</g, '\\u003c');
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Emerging Biotech Tracker</title>
<style>
  * { box-sizing: border-box; }
  [hidden] { display: none !important; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 20px; background: #f5f7fa; color: #333; }
  .container { max-width: 1800px; margin: 0 auto; }
  h1 { color: #134e4a; margin: 0 0 5px; }
  .subtitle { color: #666; margin-bottom: 6px; }
  .generated-date { color: #888; font-size: 0.85em; margin-bottom: 20px; }
  .summary-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; margin-bottom: 24px; }
  .summary-card { background: white; padding: 18px 20px; border-radius: 10px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); display: flex; flex-direction: column; cursor: pointer; border: 2px solid transparent; }
  .summary-card:hover { border-color: #99f6e4; }
  .summary-card h3 { margin: 0 0 10px; color: #666; font-size: 0.8em; text-transform: uppercase; letter-spacing: .03em; }
  .summary-card .value { margin-top: auto; font-size: 1.9em; font-weight: bold; color: #0f766e; }
  .summary-card .subtext { color: #888; font-size: 0.82em; margin-top: 4px; }
  .tabs { display: flex; flex-wrap: wrap; gap: 5px; margin-bottom: 16px; border-bottom: 2px solid #e5e7eb; }
  .tab { padding: 12px 20px; background: none; border: none; cursor: pointer; font-size: 1em; font-weight: 500; color: #666; border-bottom: 3px solid transparent; margin-bottom: -2px; }
  .tab:hover { color: #0f766e; }
  .tab.active { color: #0f766e; border-bottom-color: #0f766e; }
  .tab .n { font-size: .8em; background: #f0fdfa; color: #0f766e; padding: 1px 7px; border-radius: 10px; margin-left: 4px; }
  .explain { color: #555; font-size: 0.9em; margin: 0 0 14px; max-width: 900px; line-height: 1.45; }
  .filters { background: white; padding: 16px 20px; border-radius: 10px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); margin-bottom: 16px; display: flex; flex-wrap: wrap; gap: 15px; align-items: flex-end; }
  .filter-group { display: flex; flex-direction: column; gap: 5px; }
  .filter-group label { font-size: 0.82em; color: #666; font-weight: 500; }
  .filter-group input, .filter-group select { padding: 8px 12px; border: 1px solid #ddd; border-radius: 5px; font-size: 0.95em; background: white; }
  .filter-group input:focus, .filter-group select:focus { outline: none; border-color: #0f766e; }
  .check { display: flex; gap: 6px; align-items: center; font-size: .9em; color: #444; padding: 8px 0; }
  .btn { border: none; padding: 8px 16px; border-radius: 5px; cursor: pointer; font-size: 0.95em; }
  .reset-btn { background: #e5e7eb; }
  .export-btn { background: #0f766e; color: white; }
  .export-btn:hover { background: #115e59; }
  .table-container { background: white; border-radius: 10px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); overflow: hidden; }
  .table-header { padding: 14px 20px; border-bottom: 1px solid #eee; display: flex; justify-content: space-between; align-items: center; gap: 10px; flex-wrap: wrap; }
  .result-count { color: #666; font-size: 0.9em; }
  .table-wrapper { overflow: auto; max-height: 72vh; }
  table { width: 100%; border-collapse: collapse; font-size: 0.88em; }
  th, td { padding: 10px 14px; text-align: left; border-bottom: 1px solid #eee; vertical-align: top; }
  th { background: #f8fafc; font-weight: 600; color: #374151; cursor: pointer; white-space: nowrap; position: sticky; top: 0; z-index: 10; }
  th:hover { background: #f1f5f9; }
  th.sorted-asc::after { content: ' ▲'; color: #0f766e; }
  th.sorted-desc::after { content: ' ▼'; color: #0f766e; }
  tr.row { cursor: pointer; }
  tr.row:hover { background: #f8fafc; }
  tr.detail td { background: #fbfdfd; padding: 4px 14px 14px 34px; }
  .co { font-weight: 600; color: #111827; }
  .muted { color: #888; font-size: .88em; }
  .nowrap { white-space: nowrap; }
  a.nct { color: #0f766e; text-decoration: none; }
  a.nct:hover { text-decoration: underline; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 0.82em; font-weight: 500; white-space: nowrap; }
  .b-new { background: #ccfbf1; color: #115e59; }
  .b-p2 { background: #ede9fe; color: #5b21b6; }
  .b-direct { background: #fef3c7; color: #92400e; }
  .b-public { background: #dbeafe; color: #1e40af; }
  .b-gray { background: #f3f4f6; color: #6b7280; }
  .b-pending { background: #fff; color: #92400e; border: 1px dashed #d97706; }
  .studies { width: 100%; font-size: .95em; }
  .studies td { border: none; padding: 4px 10px 4px 0; background: transparent; }
  .caret { display: inline-block; width: 12px; color: #9ca3af; }
  .empty { padding: 30px; text-align: center; color: #888; }
  footer { color: #888; font-size: .8em; margin: 24px 0 10px; line-height: 1.5; }
</style>
</head>
<body>
<div class="container">
  <h1>Emerging Biotech Tracker</h1>
  <div class="subtitle">US industry-sponsored drug trials: companies entering the clinic, and companies taking the step to Phase 2</div>
  <div class="generated-date" id="generated"></div>

  <div class="summary-grid" id="summary"></div>
  <div class="tabs" id="tabs"></div>
  <p class="explain" id="explain"></p>

  <div class="filters">
    <div class="filter-group"><label for="q">Search</label><input id="q" type="search" placeholder="Company, drug, condition…" style="min-width:240px"></div>
    <div class="filter-group"><label for="area">Therapeutic area</label><select id="area"><option value="">All areas</option></select></div>
    <div class="filter-group"><label for="hq">Headquarters</label>
      <select id="hq">
        <option value="us-or-unknown">US + not yet verified</option>
        <option value="us">US confirmed only</option>
        <option value="all">All, including non-US</option>
      </select></div>
    <div class="filter-group"><label for="own">Ownership</label>
      <select id="own"><option value="">Any</option><option value="public">Public</option><option value="private">Private</option></select></div>
    <label class="check" id="smallWrap"><input type="checkbox" id="small" checked> Smaller companies only (≤ <span id="smallN"></span> trials)</label>
    <button class="btn reset-btn" id="reset">Reset</button>
  </div>

  <div class="table-container">
    <div class="table-header"><span class="result-count" id="count"></span><button class="btn export-btn" id="export">Export CSV</button></div>
    <div class="table-wrapper"><table><thead id="thead"></thead><tbody id="tbody"></tbody></table></div>
  </div>

  <footer id="footer"></footer>
</div>

<script>
const D = ${data};
const C = D.config;
const TODAY = new Date(D.meta.generated);

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmtDate = d => d ? new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
const fmtMonth = d => d ? new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) : '';
const daysLeft = d => Math.max(0, Math.round((new Date(d + 'T12:00:00').getTime() + C.newWindowDays * 864e5 - TODAY) / 864e5));
const nctLink = n => '<a class="nct" target="_blank" rel="noopener" href="https://clinicaltrials.gov/study/' + esc(n) + '">' + esc(n) + '</a>';
const title = s => s.replace(/_/g, ' ').toLowerCase().replace(/^./, c => c.toUpperCase());

function hqText(h) {
  if (!h) return '';
  if (h.us === true) return h.place || 'US';
  if (h.us === false) return h.source === 'name' ? 'Non-US (by name)' : 'Non-US';
  return 'Not verified';
}
function hqCell(h) {
  if (h.us === true) return esc(h.place || 'US');
  if (h.us === false) return '<span class="muted">' + esc(hqText(h)) + '</span>';
  return '<span class="badge b-gray" title="No SEC filing found under this exact name">Not verified</span>';
}
function ownText(h) {
  if (h.public) return 'Public' + (h.ticker ? ' (' + h.ticker + ')' : '');
  if (h.source === 'sec') return 'Private' + (h.lastFormD ? ', last raise ' + fmtMonth(h.lastFormD) : '');
  return '';
}
function ownCell(h) {
  if (h.public) return '<span class="badge b-public">' + esc(h.ticker || 'Public') + '</span>';
  if (h.source === 'sec') return 'Private' + (h.lastFormD ? '<div class="muted">last raise ' + fmtMonth(h.lastFormD) + '</div>' : '');
  return '<span class="muted">—</span>';
}
function sitesBadge(s) {
  return s.sites === 'Pending' ? ' <span class="badge b-pending" title="No trial sites listed yet">sites pending</span>'
    : s.sites === 'Non-US' ? ' <span class="badge b-gray">non-US sites</span>' : '';
}
function studyLine(s) {
  return '<tr><td class="nowrap">' + nctLink(s.nct) + '</td><td class="nowrap">' + esc(s.phase) + '</td><td class="nowrap">' + fmtDate(s.posted) +
    '</td><td>' + esc(s.title) + sitesBadge(s) + '<div class="muted">' + esc(s.conditions.join('; ')) +
    (s.interventions.length ? ' · ' + esc(s.interventions.join(', ')) : '') + '</div></td><td class="nowrap muted">' + esc(title(s.status || '')) + '</td></tr>';
}
function studiesTable(list) {
  return '<table class="studies">' + list.slice().reverse().map(studyLine).join('') + '</table>';
}
function companyCell(c) {
  return '<span class="caret">▸</span><span class="co">' + esc(c.name) + '</span>' +
    (c.parent ? '<div class="muted">subsidiary of ' + esc(c.parent) + '</div>' : '');
}

const TABS = {
  new: {
    label: 'New to the Clinic', rows: () => D.newCompanies,
    explain: 'Companies whose <b>first-ever drug trial</b> on ClinicalTrials.gov was posted in the last ' + Math.round(C.newWindowDays / 30.4) +
      ' months and that have a Phase 1 study in the US (or with sites not yet listed). Each company keeps its "new" flag for ' +
      Math.round(C.newWindowDays / 30.4) + ' months after that first posting. Click a row to see its studies.',
    cols: [
      ['Company', c => c.name, c => companyCell(c)],
      ['Headquarters', c => hqText(c.hq), c => hqCell(c.hq)],
      ['Ownership', c => ownText(c.hq), c => ownCell(c.hq)],
      ['Area', c => c.area, c => esc(c.area)],
      ['First trial posted', c => c.firstTrialDate, c => '<span class="nowrap">' + fmtDate(c.firstTrialDate) + '</span>'],
      ['Lead study', c => c.studies[0].title, c => { const s = c.studies[0]; return esc(s.title) + sitesBadge(s) + '<div class="muted">' + nctLink(s.nct) + ' · ' + esc(s.phase) + ' · ' + esc(s.conditions.slice(0, 2).join('; ')) + '</div>'; }],
      ['New flag', c => daysLeft(c.firstTrialDate), c => '<span class="badge b-new">' + daysLeft(c.firstTrialDate) + ' days left</span>', 'num'],
    ],
    detail: c => studiesTable(c.studies),
    sort: [4, 'desc'],
  },
  p2: {
    label: 'New to Phase 2', rows: () => D.newToP2,
    explain: 'Companies that posted their <b>first Phase 2</b> (or Phase 2/3) trial in the last ' + Math.round(C.newWindowDays / 30.4) +
      ' months, often the point where planning for Phase 3 and commercialization starts. <span class="badge b-p2">Graduated</span> companies ran Phase 1 studies first. ' +
      '<span class="badge b-direct">Direct to Phase 2</span> companies have no Phase 1 on ClinicalTrials.gov, which usually means an in-licensed drug or a Phase 1 run outside the US.',
    cols: [
      ['Company', c => c.name, c => companyCell(c)],
      ['Headquarters', c => hqText(c.hq), c => hqCell(c.hq)],
      ['Ownership', c => ownText(c.hq), c => ownCell(c.hq)],
      ['Area', c => c.area, c => esc(c.area)],
      ['First Phase 2 posted', c => c.firstP2Date, c => '<span class="nowrap">' + fmtDate(c.firstP2Date) + '</span>'],
      ['Path', c => c.priorP1Count ? c.monthsToP2 : -1, c => c.priorP1Count
        ? '<span class="badge b-p2">Graduated</span><div class="muted">' + c.priorP1Count + ' Phase 1 ' + (c.priorP1Count > 1 ? 'studies' : 'study') + ', ' + c.monthsToP2 + ' mo in clinic</div>'
        : '<span class="badge b-direct">Direct to Phase 2</span>', 'num'],
      ['Phase 2 study', c => c.p2Study.title, c => { const s = c.p2Study; return esc(s.title) + sitesBadge(s) + '<div class="muted">' + nctLink(s.nct) + ' · ' + esc(s.phase) + ' · ' + esc(title(s.status)) + '</div>'; }],
    ],
    detail: c => studiesTable(c.studies),
    sort: [4, 'desc'],
  },
  starts: {
    label: 'Phase 2 Starts', rows: () => D.p2Starts, small: true,
    explain: 'Every industry Phase 2 or Phase 2/3 study posted in the last ' + C.startsWindowDays + ' days with US sites (or sites not yet listed). ' +
      'Turn off "smaller companies only" to include big pharma. <span class="badge b-p2">First Phase 2</span> marks a company\\'s first.',
    cols: [
      ['Posted', s => s.posted, s => '<span class="nowrap">' + fmtDate(s.posted) + '</span>'],
      ['Company', s => s.company, s => '<span class="co">' + esc(s.company) + '</span>' + (s.firstP2ForCompany ? ' <span class="badge b-p2">First Phase 2</span>' : '')],
      ['Headquarters', s => hqText(s.hq), s => hqCell(s.hq)],
      ['Ownership', s => ownText(s.hq), s => ownCell(s.hq)],
      ['Area', s => s.area, s => esc(s.area)],
      ['Study', s => s.title, s => esc(s.title) + sitesBadge(s) + '<div class="muted">' + nctLink(s.nct) + ' · ' + esc(s.phase) + ' · ' + esc(s.conditions.slice(0, 3).join('; ')) + (s.interventions.length ? ' · ' + esc(s.interventions.join(', ')) : '') + '</div>'],
      ['Status', s => s.status, s => '<span class="nowrap">' + esc(title(s.status)) + '</span>'],
      ['Company trials', s => s.trialCount, s => s.trialCount, 'num'],
    ],
    sort: [0, 'desc'],
  },
  dir: {
    label: 'All Emerging Companies', rows: () => D.directory,
    explain: 'Smaller companies (≤ ' + C.smallCompanyMaxTrials + ' drug trials on ClinicalTrials.gov) that posted a trial in the last ' + C.directoryActiveYears +
      ' years and have a Phase 1 or Phase 2 study in the US. Use this view to look up a company or browse by area.',
    cols: [
      ['Company', c => c.name, c => '<span class="co">' + esc(c.name) + '</span>' + (c.isNew ? ' <span class="badge b-new">New</span>' : '') + (c.isNewP2 ? ' <span class="badge b-p2">New to Phase 2</span>' : '')],
      ['Headquarters', c => hqText(c.hq), c => hqCell(c.hq)],
      ['Ownership', c => ownText(c.hq), c => ownCell(c.hq)],
      ['Area', c => c.area, c => esc(c.area)],
      ['Furthest phase', c => c.highest, c => esc(c.highest)],
      ['First trial', c => c.firstTrialDate, c => '<span class="nowrap">' + fmtDate(c.firstTrialDate) + '</span>'],
      ['First Phase 2', c => c.firstP2Date || '', c => '<span class="nowrap">' + fmtDate(c.firstP2Date) + '</span>'],
      ['Latest trial', c => c.lastPosted, c => '<span class="nowrap">' + fmtDate(c.lastPosted) + '</span>'],
      ['Trials', c => c.trialCount, c => c.trialCount, 'num'],
    ],
    sort: [7, 'desc'],
  },
};

let tab = 'new';
const sortState = {};
const open = new Set();
const $ = id => document.getElementById(id);

function passes(r) {
  const h = r.hq || {};
  const hq = $('hq').value;
  if (hq === 'us' && h.us !== true) return false;
  if (hq === 'us-or-unknown' && h.us === false) return false;
  const own = $('own').value;
  if (own === 'public' && !h.public) return false;
  if (own === 'private' && (h.public || h.source !== 'sec')) return false;
  if ($('area').value && r.area !== $('area').value) return false;
  if (TABS[tab].small && $('small').checked && r.trialCount > C.smallCompanyMaxTrials) return false;
  const q = $('q').value.trim().toLowerCase();
  if (q) {
    const hay = JSON.stringify([r.name, r.company, r.title, r.conditions, r.interventions, r.studies, r.p2Study, r.hq?.place, r.hq?.ticker]).toLowerCase();
    if (!hay.includes(q)) return false;
  }
  return true;
}

function filtered(t) {
  const T = TABS[t];
  const [ci, dir] = sortState[t] || T.sort;
  const key = T.cols[ci][1];
  return T.rows().filter(passes).sort((a, b) => {
    const x = key(a), y = key(b);
    const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x ?? '').localeCompare(String(y ?? ''));
    return dir === 'asc' ? c : -c;
  });
}

function render() {
  const T = TABS[tab];
  $('explain').innerHTML = T.explain;
  $('smallWrap').hidden = !T.small;
  const [ci, dir] = sortState[tab] || T.sort;
  $('thead').innerHTML = '<tr>' + T.cols.map((c, i) => '<th data-i="' + i + '" class="' + (i === ci ? 'sorted-' + dir : '') + '">' + c[0] + '</th>').join('') + '</tr>';
  const rows = filtered(tab);
  $('count').textContent = rows.length + ' of ' + T.rows().length + (tab === 'starts' ? ' studies' : ' companies');
  $('tbody').innerHTML = rows.length ? rows.map((r, i) => {
    const id = r.key || r.nct;
    const isOpen = T.detail && open.has(id);
    return '<tr class="row" data-id="' + esc(id) + '">' + T.cols.map(c => '<td>' + c[2](r) + '</td>').join('') + '</tr>' +
      (isOpen ? '<tr class="detail"><td colspan="' + T.cols.length + '">' + T.detail(r) + '</td></tr>' : '');
  }).join('') : '<tr><td class="empty" colspan="' + T.cols.length + '">No matches for these filters.</td></tr>';
  if (T.detail) document.querySelectorAll('tr.row').forEach(tr => { if (open.has(tr.dataset.id)) tr.querySelector('.caret').textContent = '▾'; });
  document.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b.dataset.t === tab));
  document.querySelectorAll('.tab .n').forEach(n => n.textContent = TABS[n.dataset.t].rows().filter(passes).length);
}

function setup() {
  const g = new Date(D.meta.generated);
  $('generated').textContent = 'Updated ' + g.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }) +
    ' · ' + D.meta.studyCount.toLocaleString() + ' industry trials analyzed';
  $('smallN').textContent = C.smallCompanyMaxTrials;
  const cards = [
    ['new', 'New to the clinic', D.newCompanies, 'first trial in last ' + Math.round(C.newWindowDays / 30.4) + ' months'],
    ['p2', 'New to Phase 2', D.newToP2, 'first Phase 2 in last ' + Math.round(C.newWindowDays / 30.4) + ' months'],
    ['starts', 'Phase 2 starts', D.p2Starts.filter(s => s.trialCount <= C.smallCompanyMaxTrials), 'smaller companies, last ' + C.startsWindowDays + ' days'],
    ['dir', 'Emerging companies', D.directory, 'Phase 1 or 2 in the US'],
  ];
  const usOk = r => r.hq?.us !== false;
  $('summary').innerHTML = cards.map(([t, h, rows, sub]) =>
    '<div class="summary-card" data-t="' + t + '"><h3>' + h + '</h3><div class="value">' + rows.filter(usOk).length + '</div><div class="subtext">' + sub + '</div></div>').join('');
  $('tabs').innerHTML = Object.entries(TABS).map(([t, T]) => '<button class="tab" data-t="' + t + '">' + T.label + '<span class="n" data-t="' + t + '"></span></button>').join('');
  const areas = [...new Set([...D.directory, ...D.newCompanies, ...D.newToP2, ...D.p2Starts].map(r => r.area))].sort();
  $('area').innerHTML += areas.map(a => '<option>' + esc(a) + '</option>').join('');
  $('footer').innerHTML = 'Sources: ClinicalTrials.gov (all industry-sponsored interventional studies; Phase 1/2 studies count as Phase 1) and SEC EDGAR (headquarters, public listing, funding filings). ' +
    'Headquarters is matched on exact company name; "Not verified" means no SEC filing under that name, common for foreign and very early private companies. ' +
    'Companies whose first trial was registered only outside ClinicalTrials.gov (e.g., Australia\\'s registry) can appear newer than they are.';

  document.addEventListener('click', e => {
    const t = e.target.closest('[data-t]');
    if (t && (t.classList.contains('tab') || t.classList.contains('summary-card'))) { tab = t.dataset.t; render(); return; }
    const th = e.target.closest('th[data-i]');
    if (th) {
      const i = +th.dataset.i; const cur = sortState[tab] || TABS[tab].sort;
      sortState[tab] = [i, cur[0] === i && cur[1] === 'desc' ? 'asc' : 'desc']; render(); return;
    }
    const tr = e.target.closest('tr.row');
    if (tr && TABS[tab].detail && !e.target.closest('a')) { const id = tr.dataset.id; open.has(id) ? open.delete(id) : open.add(id); render(); }
  });
  ['q', 'area', 'hq', 'own', 'small'].forEach(id => $(id).addEventListener('input', render));
  $('reset').onclick = () => { $('q').value = ''; $('area').value = ''; $('hq').value = 'us-or-unknown'; $('own').value = ''; $('small').checked = true; render(); };
  $('export').onclick = exportCsv;
  render();
}

function exportCsv() {
  const T = TABS[tab];
  const rows = filtered(tab);
  const cell = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';
  const head = tab === 'starts'
    ? ['Posted', 'Company', 'Headquarters', 'Ownership', 'Area', 'NCT', 'Phase', 'Study', 'Conditions', 'Interventions', 'Status', 'Company trials', 'First Phase 2']
    : ['Company', 'Headquarters', 'Ownership', 'Area', 'Furthest phase', 'First trial', 'First Phase 2', 'Latest trial', 'Trials', 'Studies'];
  const lines = rows.map(r => tab === 'starts'
    ? [r.posted, r.company, hqText(r.hq), ownText(r.hq), r.area, r.nct, r.phase, r.title, r.conditions.join('; '), r.interventions.join('; '), r.status, r.trialCount, r.firstP2ForCompany ? 'Yes' : '']
    : [r.name, hqText(r.hq), ownText(r.hq), r.area, r.highest, r.firstTrialDate, r.firstP2Date, r.lastPosted, r.trialCount, (r.studies || []).map(s => s.nct).join(' ')]);
  const csv = [head, ...lines].map(l => l.map(cell).join(',')).join('\\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = 'biotech-tracker-' + tab + '-' + D.meta.generated.slice(0, 10) + '.csv';
  a.click();
}

setup();
</script>
</body>
</html>
`;
}

module.exports = { renderDashboard };
