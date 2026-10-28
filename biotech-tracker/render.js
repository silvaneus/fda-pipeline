/**
 * Renders the dashboard as one self-contained HTML file: data embedded as
 * JSON, filtering and sorting done in the browser.
 */

function renderProfiles(profiles) {
  return 'window.PROFILES = ' + JSON.stringify(profiles).replace(/</g, '\\u003c') + ';\n';
}

function renderSearch(index) {
  return 'window.SEARCH = ' + JSON.stringify(index).replace(/</g, '\\u003c') + ';\n';
}

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
  .b-mkt { background: #fee2e2; color: #991b1b; }
  .b-pending { background: #fff; color: #92400e; border: 1px dashed #d97706; }
  .studies { width: 100%; font-size: .95em; }
  .studies td { border: none; padding: 4px 10px 4px 0; background: transparent; }
  .caret { display: inline-block; width: 12px; color: #9ca3af; }
  .empty { padding: 30px; text-align: center; color: #888; }
  footer { color: #888; font-size: .8em; margin: 24px 0 10px; line-height: 1.5; }
  .co-link { font-weight: 600; color: #111827; border-bottom: 1px dotted #94a3b8; }
  tr.row:hover .co-link { color: #0f766e; border-bottom-color: #0f766e; }
  .soft { border-bottom: 1px dotted #9ca3af; cursor: help; }
  .unknown { color: #c0c4cc; }
  /* Company profile drawer */
  .scrim { position: fixed; inset: 0; background: rgba(15,23,42,.35); z-index: 50; }
  .drawer { position: fixed; top: 0; right: 0; bottom: 0; width: min(760px, 100vw); background: #fff; z-index: 51;
            box-shadow: -8px 0 30px rgba(0,0,0,.18); overflow-y: auto; padding: 28px 32px 40px; }
  .drawer .close { position: sticky; top: 0; float: right; background: #f3f4f6; border: none; border-radius: 6px;
                   font-size: 1.1em; width: 34px; height: 34px; cursor: pointer; }
  .drawer h2 { margin: 0 0 4px; color: #134e4a; font-size: 1.5em; padding-right: 44px; }
  .drawer .aka { color: #888; font-size: .85em; margin-bottom: 8px; }
  .drawer .bio { font-size: 1em; line-height: 1.55; color: #1f2937; margin: 14px 0 18px; }
  .facts { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px 24px; margin-bottom: 22px;
           padding: 16px 18px; background: #f8fafc; border-radius: 8px; }
  .facts dt { font-size: .75em; text-transform: uppercase; letter-spacing: .04em; color: #6b7280; margin-bottom: 2px; }
  .facts dd { margin: 0; font-size: .95em; }
  .drawer h3 { font-size: .85em; text-transform: uppercase; letter-spacing: .04em; color: #374151; margin: 22px 0 8px;
               padding-bottom: 6px; border-bottom: 1px solid #e5e7eb; }
  .drawer table { font-size: .88em; }
  .drawer th { position: static; cursor: default; }
  .links a { display: inline-block; margin: 0 16px 6px 0; color: #0f766e; text-decoration: none; font-weight: 500; }
  .links a:hover { text-decoration: underline; }
  .src { color: #9ca3af; font-size: .8em; }
  .otitle { color: #4b5563; font-size: .86em; font-style: italic; margin-top: 2px; line-height: 1.35; }
  .clamp { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
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
    <div class="filter-group"><label for="q">Search</label><input id="q" type="search" placeholder="Company, drug, condition, title…" style="min-width:260px"></div>
    <div class="filter-group"><label for="area">Therapeutic area</label><select id="area"><option value="">All areas</option></select></div>
    <div class="filter-group"><label for="ind">Indication</label><select id="ind" style="max-width:260px"><option value="">All indications</option></select></div>
    <div class="filter-group"><label for="hq">Headquarters</label>
      <select id="hq">
        <option value="us-or-unknown">US + unknown</option>
        <option value="us">US confirmed only</option>
        <option value="all">All, including non-US</option>
      </select></div>
    <div class="filter-group"><label for="raised" title="Sum of round sizes in SEC private-fundraising filings (Form D). Public stock offerings are not included.">Raised at least</label>
      <select id="raised"><option value="0">Any amount</option><option value="1e6">$1M</option><option value="1e7">$10M</option><option value="2.5e7">$25M</option><option value="5e7">$50M</option><option value="1e8">$100M</option><option value="2.5e8">$250M</option></select></div>
    <div class="filter-group"><label for="own">Ownership</label>
      <select id="own"><option value="">Any</option><option value="public">Public</option><option value="private">Private</option></select></div>
    <label class="check" id="smallWrap"><input type="checkbox" id="small" checked> Smaller companies only (≤ <span id="smallN"></span> trials)</label>
    <label class="check" id="mktWrap" title="A company with an FDA-approved drug or a Phase 4 (post-marketing) trial is no longer counted as emerging"><input type="checkbox" id="mkt"> Include companies with a marketed drug</label>
    <button class="btn reset-btn" id="reset">Reset</button>
  </div>

  <div class="table-container">
    <div class="table-header"><span class="result-count" id="count"></span><button class="btn export-btn" id="export">Export CSV</button></div>
    <div class="table-wrapper"><table><thead id="thead"></thead><tbody id="tbody"></tbody></table></div>
  </div>

  <footer id="footer"></footer>
</div>
<div class="scrim" id="scrim" hidden></div>
<aside class="drawer" id="drawer" hidden aria-label="Company profile"></aside>

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

const HQ_SOURCE = {
  sec: 'From SEC filings', gleif: 'From the global legal-entity registry (GLEIF)', manual: 'Set manually',
  name: 'Inferred from the legal form of the company name',
};
function hqSourceNote(h) {
  if (h.source === 'contact') return h.via === 'email' ? "Inferred from the country domain of the company's trial contact email"
    : "Inferred from the company's trial contact phone number";
  return HQ_SOURCE[h.source] || 'No public record found';
}
function hqText(h) {
  if (!h) return '';
  if (h.us === true) return h.place || 'US';
  if (h.us === false) return h.place || h.country || 'Outside US';
  return '';
}
function hqCell(h) {
  const t = hqText(h);
  if (!t) return '<span class="unknown" title="No public record of headquarters found">—</span>';
  const soft = h.source === 'contact' || h.source === 'name';
  const inner = soft ? '<span class="soft" title="' + esc(hqSourceNote(h)) + '">' + esc(t) + '</span>' : esc(t);
  return h.us === false ? '<span class="muted">' + inner + '</span>' : inner;
}
const money = n => !n ? '' : n >= 1e9 ? '$' + (n / 1e9).toFixed(1) + 'B' : n >= 1e6 ? '$' + (n / 1e6).toFixed(n >= 1e8 ? 0 : 1) + 'M' : '$' + Math.round(n / 1e3) + 'K';
function ownText(h) {
  const parts = [h.public ? 'Public' + (h.ticker ? ' (' + h.ticker + ')' : '') : h.source === 'sec' ? 'Private' : ''];
  if (h.totalRaised) parts.push(money(h.totalRaised) + ' raised');
  return parts.filter(Boolean).join(', ');
}
function ownCell(h) {
  const last = h.raises?.[0];
  const tag = h.public ? '<span class="badge b-public">' + esc(h.ticker || 'Public') + '</span>' : h.source === 'sec' ? 'Private' : '';
  if (h.totalRaised) return '<b>' + money(h.totalRaised) + '</b> ' + tag +
    '<div class="muted nowrap">last ' + money(last.amount) + ', ' + fmtMonth(last.date) + '</div>';
  return tag || '<span class="unknown">—</span>';
}
function officialLine(s, clamp) {
  return s.officialTitle ? '<div class="otitle' + (clamp ? ' clamp' : '') + '" title="' + esc(s.officialTitle) + '">' + esc(s.officialTitle) + '</div>' : '';
}
function sitesBadge(s) {
  return s.sites === 'Pending' ? ' <span class="badge b-pending" title="No trial sites listed yet">sites pending</span>'
    : s.sites === 'Non-US' ? ' <span class="badge b-gray">non-US sites</span>' : '';
}
function studyLine(s) {
  return '<tr><td class="nowrap">' + nctLink(s.nct) + '</td><td class="nowrap">' + esc(s.phase) + '</td><td class="nowrap">' + fmtDate(s.posted) +
    '</td><td>' + esc(s.title) + sitesBadge(s) + officialLine(s) + '<div class="muted">' + esc(s.conditions.join('; ')) +
    (s.interventions.length ? ' · ' + esc(s.interventions.join(', ')) : '') + '</div></td><td class="nowrap muted">' + esc(title(s.status || '')) + '</td></tr>';
}
function studiesTable(list) {
  return '<table class="studies">' + list.slice().reverse().map(studyLine).join('') + '</table>';
}
function companyCell(c) {
  return '<span class="co-link">' + esc(c.name) + '</span>' +
    (c.parent ? '<div class="muted">subsidiary of ' + esc(c.parent) + '</div>' : '');
}

const TABS = {
  new: {
    label: 'New to the Clinic', rows: () => D.newCompanies,
    explain: 'Companies whose <b>first-ever drug trial</b> on ClinicalTrials.gov was posted in the last ' + Math.round(C.newWindowDays / 30.4) +
      ' months and that have a Phase 1 study in the US (or with sites not yet listed). Each company keeps its "new" flag for ' +
      Math.round(C.newWindowDays / 30.4) + ' months after that first posting. Click a company for its profile and pipeline.',
    cols: [
      ['Company', c => c.name, c => companyCell(c)],
      ['Headquarters', c => hqText(c.hq), c => hqCell(c.hq)],
      ['Funding', c => c.hq.totalRaised || 0, c => ownCell(c.hq), 'num'],
      ['Area', c => c.area, c => esc(c.area)],
      ['First trial posted', c => c.firstTrialDate, c => '<span class="nowrap">' + fmtDate(c.firstTrialDate) + '</span>'],
      ['Lead study', c => c.studies[0].title, c => { const s = c.studies[0]; return esc(s.title) + sitesBadge(s) + officialLine(s, true) + '<div class="muted">' + nctLink(s.nct) + ' · ' + esc(s.phase) + ' · ' + esc(s.conditions.slice(0, 2).join('; ')) + '</div>'; }],
      ['New flag', c => daysLeft(c.firstTrialDate), c => '<span class="badge b-new">' + daysLeft(c.firstTrialDate) + ' days left</span>', 'num'],
    ],
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
      ['Funding', c => c.hq.totalRaised || 0, c => ownCell(c.hq), 'num'],
      ['Area', c => c.area, c => esc(c.area)],
      ['First Phase 2 posted', c => c.firstP2Date, c => '<span class="nowrap">' + fmtDate(c.firstP2Date) + '</span>'],
      ['Path', c => c.priorP1Count ? c.monthsToP2 : -1, c => c.priorP1Count
        ? '<span class="badge b-p2">Graduated</span><div class="muted">' + c.priorP1Count + ' Phase 1 ' + (c.priorP1Count > 1 ? 'studies' : 'study') + ', ' + c.monthsToP2 + ' mo in clinic</div>'
        : '<span class="badge b-direct">Direct to Phase 2</span>', 'num'],
      ['Phase 2 study', c => c.p2Study.title, c => { const s = c.p2Study; return esc(s.title) + sitesBadge(s) + officialLine(s, true) + '<div class="muted">' + nctLink(s.nct) + ' · ' + esc(s.phase) + ' · ' + esc(title(s.status)) + '</div>'; }],
    ],
    sort: [4, 'desc'],
  },
  starts: {
    label: 'Phase 2 Starts', rows: () => D.p2Starts, small: true,
    explain: 'Every industry Phase 2 or Phase 2/3 study posted in the last ' + C.startsWindowDays + ' days with US sites (or sites not yet listed). ' +
      'Turn off "smaller companies only" to include big pharma. <span class="badge b-p2">First Phase 2</span> marks a company\\'s first.',
    cols: [
      ['Posted', s => s.posted, s => '<span class="nowrap">' + fmtDate(s.posted) + '</span>'],
      ['Company', s => s.company, s => '<span class="co-link">' + esc(s.company) + '</span>' + (s.firstP2ForCompany ? ' <span class="badge b-p2">First Phase 2</span>' : '')],
      ['Headquarters', s => hqText(s.hq), s => hqCell(s.hq)],
      ['Funding', s => s.hq.totalRaised || 0, s => ownCell(s.hq), 'num'],
      ['Area', s => s.area, s => esc(s.area)],
      ['Study', s => s.title, s => esc(s.title) + sitesBadge(s) + officialLine(s, true) + '<div class="muted">' + nctLink(s.nct) + ' · ' + esc(s.phase) + ' · ' + esc(s.conditions.slice(0, 3).join('; ')) + (s.interventions.length ? ' · ' + esc(s.interventions.join(', ')) : '') + '</div>'],
      ['Status', s => s.status, s => '<span class="nowrap">' + esc(title(s.status)) + '</span>'],
      ['Company trials', s => s.trialCount, s => s.trialCount, 'num'],
    ],
    sort: [0, 'desc'],
  },
  dir: {
    label: 'All Emerging Companies', rows: () => D.directory,
    explain: 'Smaller companies (≤ ' + C.smallCompanyMaxTrials + ' drug trials on ClinicalTrials.gov) that posted a trial in the last ' + C.directoryActiveYears +
      ' years and have a Phase 1 or Phase 2 study in the US. A company graduates out once it has a marketed drug (an FDA approval or a Phase 4 trial); ' +
      D.directory.filter(r => r.marketed).length + ' are hidden for that reason unless you tick "Include companies with a marketed drug".',
    cols: [
      ['Company', c => c.name, c => '<span class="co-link">' + esc(c.name) + '</span>' + (c.marketed ? ' <span class="badge b-mkt">Marketed</span>' : '') + (c.isNew ? ' <span class="badge b-new">New</span>' : '') + (c.isNewP2 ? ' <span class="badge b-p2">New to Phase 2</span>' : '')],
      ['Headquarters', c => hqText(c.hq), c => hqCell(c.hq)],
      ['Funding', c => c.hq.totalRaised || 0, c => ownCell(c.hq), 'num'],
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
const $ = id => document.getElementById(id);

// t = the tab the row belongs to. Tab badges count every tab at once, so the
// tab-specific checkboxes must follow the row's tab, not the open one.
function passes(r, t = tab) {
  const h = r.hq || {};
  const hq = $('hq').value;
  if (hq === 'us' && h.us !== true) return false;
  if (hq === 'us-or-unknown' && h.us === false) return false;
  const own = $('own').value;
  if (own === 'public' && !h.public) return false;
  if (own === 'private' && (h.public || h.source !== 'sec')) return false;
  if (+$('raised').value && !((h.totalRaised || 0) >= +$('raised').value)) return false;
  const area = $('area').value;
  // A company counts for an area if any of its indications falls there, not
  // just its main one: a neurology company with one lung-cancer drug shows
  // up under Oncology.
  if (area && r.area !== area && !(r.indications || []).some(t => t.startsWith(area + ' › '))) return false;
  if ($('ind').value && !(r.indications || []).includes($('ind').value)) return false;
  if (TABS[t].small && $('small').checked && r.trialCount > C.smallCompanyMaxTrials) return false;
  if (t === 'dir' && !$('mkt').checked && r.marketed) return false;
  const q = $('q').value.trim().toLowerCase();
  if (q) {
    const hay = JSON.stringify([r.name, r.company, r.title, r.officialTitle, r.conditions, r.interventions, r.conds, r.drugs, r.p2Study, r.hq?.place, r.hq?.ticker]).toLowerCase();
    if (!hay.includes(q) && !(window.SEARCH?.[r.key || r.companyKey] || '').includes(q)) return false;
  }
  return true;
}

function filtered(t) {
  const T = TABS[t];
  const [ci, dir] = sortState[t] || T.sort;
  const key = T.cols[ci][1];
  return T.rows().filter(r => passes(r, t)).sort((a, b) => {
    const x = key(a), y = key(b);
    const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x ?? '').localeCompare(String(y ?? ''));
    return dir === 'asc' ? c : -c;
  });
}

function render() {
  const T = TABS[tab];
  $('explain').innerHTML = T.explain;
  $('smallWrap').hidden = !T.small;
  $('mktWrap').hidden = tab !== 'dir';
  const [ci, dir] = sortState[tab] || T.sort;
  $('thead').innerHTML = '<tr>' + T.cols.map((c, i) => '<th data-i="' + i + '" class="' + (i === ci ? 'sorted-' + dir : '') + '">' + c[0] + '</th>').join('') + '</tr>';
  const rows = filtered(tab);
  $('count').textContent = rows.length + ' of ' + T.rows().length + (tab === 'starts' ? ' studies' : ' companies');
  $('tbody').innerHTML = rows.length ? rows.map((r, i) => {
    return '<tr class="row" data-key="' + esc(r.key || r.companyKey) + '">' + T.cols.map(c => '<td>' + c[2](r) + '</td>').join('') + '</tr>';
  }).join('') : '<tr><td class="empty" colspan="' + T.cols.length + '">No matches for these filters.</td></tr>';
  document.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b.dataset.t === tab));
  document.querySelectorAll('.tab .n').forEach(n => n.textContent = TABS[n.dataset.t].rows().filter(r => passes(r, n.dataset.t)).length);
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
    ['dir', 'Emerging companies', D.directory.filter(r => !r.marketed), 'Phase 1 or 2 in the US, no marketed drug'],
  ];
  const usOk = r => r.hq?.us !== false;
  $('summary').innerHTML = cards.map(([t, h, rows, sub]) =>
    '<div class="summary-card" data-t="' + t + '"><h3>' + h + '</h3><div class="value">' + rows.filter(usOk).length + '</div><div class="subtext">' + sub + '</div></div>').join('');
  $('tabs').innerHTML = Object.entries(TABS).map(([t, T]) => '<button class="tab" data-t="' + t + '">' + T.label + '<span class="n" data-t="' + t + '"></span></button>').join('');
  const areas = [...new Set([...D.directory, ...D.newCompanies, ...D.newToP2, ...D.p2Starts].map(r => r.area))].sort();
  $('area').innerHTML += areas.map(a => '<option>' + esc(a) + '</option>').join('');
  const allTags = [...new Set([...D.directory, ...D.newCompanies, ...D.newToP2, ...D.p2Starts].flatMap(r => r.indications || []))].sort();
  const fillInd = () => {
    const area = $('area').value, cur = $('ind').value;
    const byArea = {};
    for (const t of allTags) { const [a, n] = t.split(' › '); if (!area || a === area) (byArea[a] = byArea[a] || []).push([t, n]); }
    $('ind').innerHTML = '<option value="">All indications</option>' + Object.entries(byArea).map(([a, list]) =>
      '<optgroup label="' + esc(a) + '">' + list.map(([t, n]) => '<option value="' + esc(t) + '">' + esc(n) + '</option>').join('') + '</optgroup>').join('');
    $('ind').value = allTags.includes(cur) && (!area || cur.startsWith(area + ' › ')) ? cur : '';
  };
  fillInd();
  $('area').addEventListener('input', fillInd);
  $('footer').innerHTML = 'Sources: ClinicalTrials.gov (all industry-sponsored interventional studies; Phase 1/2 studies count as Phase 1) and SEC EDGAR (headquarters, public listing, funding filings). ' +
    'Headquarters comes from SEC filings first, then the global legal-entity registry (GLEIF), then the phone number on the company\\'s own trial contacts (dotted underline = inferred). A dash means no public record was found. ' +
    'Companies whose first trial was registered only outside ClinicalTrials.gov (e.g., Australia\\'s registry) can appear newer than they are.';

  document.addEventListener('click', e => {
    const t = e.target.closest('[data-t]');
    if (t && (t.classList.contains('tab') || t.classList.contains('summary-card'))) { tab = t.dataset.t; render(); return; }
    const th = e.target.closest('th[data-i]');
    if (th) {
      const i = +th.dataset.i; const cur = sortState[tab] || TABS[tab].sort;
      sortState[tab] = [i, cur[0] === i && cur[1] === 'desc' ? 'asc' : 'desc']; render(); return;
    }
    if (e.target.closest('#drawer .close') || e.target.id === 'scrim') { closeProfile(); return; }
    const tr = e.target.closest('tr.row');
    if (tr && !e.target.closest('a')) openProfile(tr.dataset.key);
  });
  ['q', 'area', 'ind', 'raised', 'hq', 'own', 'small', 'mkt'].forEach(id => $(id).addEventListener('input', render));
  // Official-title search text is large, so fetch it on the first search.
  $('q').addEventListener('input', () => {
    if (window.SEARCH || loadSearch.started) return;
    loadSearch.started = true;
    const sc = document.createElement('script');
    sc.src = 'search.js?v=' + encodeURIComponent(D.meta.generated);
    sc.onload = render;
    document.head.appendChild(sc);
  }, { once: false });
  $('reset').onclick = () => { $('q').value = ''; $('area').value = ''; $('area').dispatchEvent(new Event('input')); $('raised').value = '0'; $('hq').value = 'us-or-unknown'; $('own').value = ''; $('small').checked = true; $('mkt').checked = false; render(); };
  $('export').onclick = exportCsv;
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeProfile(); });
  window.addEventListener('hashchange', fromHash);
  render();
  fromHash();
}

function loadSearch() {}

// --- Company profiles ------------------------------------------------------
// Profiles live in profiles.js, loaded on first open so the table stays fast.
let profilesReady = null;
function loadProfiles() {
  if (!profilesReady) profilesReady = new Promise((res, rej) => {
    const sc = document.createElement('script');
    sc.src = 'profiles.js?v=' + encodeURIComponent(D.meta.generated);
    sc.onload = () => res(window.PROFILES); sc.onerror = rej;
    document.head.appendChild(sc);
  });
  return profilesReady;
}
const flagsFor = key => ({
  isNew: D.newCompanies.find(c => c.key === key),
  isNewP2: D.newToP2.find(c => c.key === key),
});
function bio(p) {
  const h = p.hq || {};
  const own = h.public ? 'publicly traded' + (h.ticker ? ' (' + h.ticker + ')' : '') : h.source === 'sec' ? 'privately held' : '';
  const where = h.us === true ? (h.place ? 'based in ' + h.place : 'US-based') : h.us === false && (h.place || h.country) ? 'based in ' + (h.place || h.country) : '';
  let t = esc(p.name) + ' is a ' + (own ? own + ' ' : '') + 'drug developer' + (where ? ' ' + esc(where) : '') +
    ' that registered its first trial on ClinicalTrials.gov in ' + fmtMonth(p.firstTrialDate) + '. ';
  if (h.totalRaised) t += 'It has reported ' + money(h.totalRaised) + ' in funding rounds in SEC filings, most recently a ' + money(h.raises[0].amount) + ' round in ' + fmtMonth(h.raises[0].date) + '. ';
  t += 'It has ' + p.liveCount + ' current drug trial' + (p.liveCount === 1 ? '' : 's') + (p.activeCount ? ' (' + p.activeCount + ' active)' : '') +
    (p.highest === 'None active' ? ', and no programs that have not been terminated or withdrawn. ' : ', and its furthest program has reached ' + esc(p.highest) + '. ');
  const lead = p.pipeline[0];
  if (lead) t += 'Its most advanced drug, <b>' + esc(lead.drug) + '</b>, is in ' + esc(lead.phase) + ' for ' + esc(lead.conditions.slice(0, 2).join(' and ') || 'an undisclosed indication') + '. ';
  if (p.pipeline.length > 1) t += 'It has ' + (p.pipeline.length - 1) + ' other program' + (p.pipeline.length > 2 ? 's' : '') + ' in the clinic. ';
  const f = flagsFor(p.key);
  if (f.isNew) t += 'New to the clinic: flagged until ' + fmtDate(new Date(new Date(p.firstTrialDate + 'T12:00:00').getTime() + C.newWindowDays * 864e5).toISOString().slice(0, 10)) + '. ';
  if (f.isNewP2) t += 'Posted its first Phase 2 trial on ' + fmtDate(p.firstP2Date) + '.';
  return t;
}
function profileHtml(p) {
  const h = p.hq || {};
  const f = flagsFor(p.key);
  const badges = (f.isNew ? '<span class="badge b-new">New to the clinic</span> ' : '') + (f.isNewP2 ? '<span class="badge b-p2">New to Phase 2</span> ' : '') +
    (h.public ? '<span class="badge b-public">' + esc(h.ticker || 'Public') + '</span> ' : '') +
    (p.marketed ? '<span class="badge b-mkt">Marketed drug</span>' : '');
  const areas = Object.entries(p.areas).filter(([a]) => a !== 'Other').sort((a, b) => b[1] - a[1]).slice(0, 3).map(([a]) => a).join(', ') || '—';
  const fact = (k, v) => '<div><dt>' + k + '</dt><dd>' + v + '</dd></div>';
  const raises = (h.formDDates || []).map(fmtMonth);
  const site = h.website ? '<a class="nct" target="_blank" rel="noopener" href="https://' + esc(h.website) + '">' + esc(h.website) + '</a>' : '<span class="unknown">—</span>';
  const pipe = p.pipeline.length ? '<div class="table-wrapper" style="max-height:none"><table><thead><tr><th>Drug</th><th>Indications</th><th>Phase</th><th>Status</th><th>Trials</th></tr></thead><tbody>' +
    p.pipeline.map(g => '<tr><td><b>' + esc(g.drug) + '</b>' + (g.with.length ? '<div class="muted">with ' + esc(g.with.join(', ')) + '</div>' : '') +
      '</td><td>' + esc(g.conditions.slice(0, 3).join('; ')) + '<div class="muted">' + esc((g.indications.length ? g.indications.map(t => t.split(' › ')[1]) : [g.area]).join(', ')) + '</div></td><td class="nowrap">' + esc(g.phase) +
      '</td><td class="nowrap">' + esc(title(g.status || '')) + '</td><td>' + g.trials.slice(-4).map(nctLink).join('<br>') + (g.trials.length > 4 ? '<div class="muted">+' + (g.trials.length - 4) + ' more</div>' : '') + '</td></tr>').join('') +
    '</tbody></table></div><div class="src">Grouped by lead drug in each trial; combination partners listed under "with". Terminated and withdrawn trials excluded.</div>' : '<p class="muted">No drug names listed on its trials.</p>';
  const q = encodeURIComponent(p.name.replace(/,?\s*(Inc|LLC|Ltd|Corp)\.?$/i, ''));
  const links = '<div class="links">' +
    '<a target="_blank" rel="noopener" href="https://clinicaltrials.gov/search?spons=' + encodeURIComponent(p.name) + '">ClinicalTrials.gov</a>' +
    (h.cik ? '<a target="_blank" rel="noopener" href="https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=' + h.cik + '">SEC filings</a>' : '') +
    (h.website ? '<a target="_blank" rel="noopener" href="https://' + esc(h.website) + '">Website</a>' : '') +
    '<a target="_blank" rel="noopener" href="https://news.google.com/search?q=%22' + q + '%22">News</a>' +
    '<a target="_blank" rel="noopener" href="https://www.linkedin.com/search/results/companies/?keywords=' + q + '">LinkedIn</a></div>';
  return '<button class="close" title="Close (Esc)">✕</button>' +
    '<h2>' + esc(p.name) + '</h2>' +
    (p.otherNames.length ? '<div class="aka">Also registered as ' + esc(p.otherNames.join('; ')) + '</div>' : '') +
    (p.parent ? '<div class="aka">Subsidiary of ' + esc(p.parent) + '</div>' : '') +
    '<div>' + badges + '</div>' +
    '<p class="bio">' + bio(p) + '</p>' +
    '<dl class="facts">' +
      fact('Headquarters', (hqText(h) ? esc(hqText(h)) : '<span class="unknown">Unknown</span>') + '<div class="src">' + esc(hqSourceNote(h)) + '</div>') +
      fact('Ownership', h.public ? 'Public' + (h.ticker ? ' · ' + esc(h.ticker) : '') : h.source === 'sec' ? 'Private' : '<span class="unknown">Unknown</span>') +
      fact('Website', site) +
      fact('Raised (SEC filings)', h.totalRaised
        ? '<b>' + money(h.totalRaised) + '</b> across ' + h.raises.length + ' round' + (h.raises.length > 1 ? 's' : '') +
          '<div class="muted">' + h.raises.slice(0, 4).map(r => money(r.amount) + ' ' + fmtMonth(r.date) +
            (r.sold < r.amount * 0.95 ? ' (' + money(r.sold) + ' closed at filing)' : '')).join('<br>') + (h.raises.length > 4 ? '<br>…' : '') + '</div>' +
          '<div class="src">Round sizes from private fundraising filings (Form D). A filing is due within 15 days of the first sale, so later tranches are often not in the "closed" figure. Public stock offerings not included.</div>'
        : raises.length ? raises.slice(0, 4).join(', ') + '<div class="src">Filing dates; amounts not reported</div>' : '<span class="unknown">None found</span>') +
      fact('Marketed drug', !p.marketed ? '<span class="unknown">None found</span>'
        : (p.marketed.approvals.length ? p.marketed.approvals.map(a => esc(a.brand || a.app) + ' <span class="muted">FDA ' + esc((a.date || '').slice(0, 4)) + '</span>').join(', ') : '') +
          (p.marketed.phase4 ? (p.marketed.approvals.length ? '<br>' : '') + p.marketed.phase4 + ' Phase 4 trial' + (p.marketed.phase4 > 1 ? 's' : '') + ' on record' : '') +
          (p.marketed.manual && !p.marketed.approvals.length && !p.marketed.phase4 ? 'Yes (set manually)' : '') +
          '<div class="src">Not counted as emerging</div>') +
      fact('In the clinic since', fmtMonth(p.firstTrialDate)) +
      fact('First Phase 2', p.firstP2Date ? fmtMonth(p.firstP2Date) : '<span class="unknown">Not yet</span>') +
      fact('Trials', p.liveCount + (p.activeCount ? ' · ' + p.activeCount + ' active' : '') +
        (p.droppedCount ? '<div class="src">' + p.droppedCount + ' terminated or withdrawn not shown</div>' : '')) +
      fact('Main areas', esc(areas)) +
    '</dl>' +
    '<h3>Pipeline</h3>' + pipe +
    '<h3>Trials</h3>' + studiesTable(p.studies.slice().reverse()) +
      '<div class="src">' + (p.liveCount > p.studies.length ? 'Showing the ' + p.studies.length + ' most recent of ' + p.liveCount + '. ' : '') +
      (p.droppedCount ? p.droppedCount + ' terminated or withdrawn trial' + (p.droppedCount > 1 ? 's are' : ' is') + ' left out of the pipeline, indications and filters.' : '') + '</div>' +
    '<h3>Links</h3>' + links;
}
async function openProfile(key) {
  if (!key) return;
  $('drawer').innerHTML = '<p class="muted">Loading…</p>';
  $('drawer').hidden = $('scrim').hidden = false;
  document.body.style.overflow = 'hidden';
  if (location.hash !== '#c=' + encodeURIComponent(key)) history.replaceState(null, '', '#c=' + encodeURIComponent(key));
  try {
    const P = await loadProfiles();
    const p = P[key];
    $('drawer').innerHTML = p ? profileHtml(p) : '<button class="close">✕</button><p>No profile for this company.</p>';
    $('drawer').scrollTop = 0;
  } catch {
    $('drawer').innerHTML = '<button class="close">✕</button><p>Could not load company profiles.</p>';
  }
}
function closeProfile() {
  if ($('drawer').hidden) return;
  $('drawer').hidden = $('scrim').hidden = true;
  document.body.style.overflow = '';
  history.replaceState(null, '', location.pathname + location.search);
}
function fromHash() {
  const m = location.hash.match(/^#c=(.+)$/);
  if (m) openProfile(decodeURIComponent(m[1]));
}

function exportCsv() {
  const T = TABS[tab];
  const rows = filtered(tab);
  const cell = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';
  const head = tab === 'starts'
    ? ['Posted', 'Company', 'Headquarters', 'Funding', 'Raised (USD)', 'Area', 'NCT', 'Phase', 'Study', 'Conditions', 'Interventions', 'Status', 'Company trials', 'First Phase 2']
    : ['Company', 'Headquarters', 'Funding', 'Raised (USD)', 'Area', 'Indications', 'Lead drugs', 'Furthest phase', 'First trial', 'First Phase 2', 'Latest trial', 'Trials', 'Studies'];
  const lines = rows.map(r => tab === 'starts'
    ? [r.posted, r.company, hqText(r.hq), ownText(r.hq), r.hq.totalRaised || '', r.area, r.nct, r.phase, r.title, r.conditions.join('; '), r.interventions.join('; '), r.status, r.trialCount, r.firstP2ForCompany ? 'Yes' : '']
    : [r.name, hqText(r.hq), ownText(r.hq), r.hq.totalRaised || '', r.area, (r.indications || []).map(t => t.split(' › ')[1]).join('; '), (r.drugs || []).join('; '), r.highest, r.firstTrialDate, r.firstP2Date, r.lastPosted, r.trialCount, (r.studies || []).map(s => s.nct).join(' ')]);
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

module.exports = { renderDashboard, renderProfiles, renderSearch };
