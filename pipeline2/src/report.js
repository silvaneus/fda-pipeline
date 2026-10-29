// Renders state/pipeline.json (+ state/coverage.json when present) as one self-contained HTML page.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'reports', 'pipeline-2.0.html');
const ONC_BRANDS = new Set(['onclive', 'targetedonc', 'cancernetwork', 'curetoday']);
const NON_ONC = /hypercortisolism|cushing|diabetes|obesity|arthritis|psoriasis|dermatitis|migraine|epilepsy|schizophrenia|depress|alzheimer|parkinson|hiv|hepatitis|infection|asthma|copd|heart|hypertension|kidney disease|nephropathy|lupus|myasthenia|dystrophy/i;
const GENERAL_BRANDS = new Set(['ajmc', 'pharmacytimes', 'pharmexec']);
const ONCOLOGY = /cancer|carcinoma|lymphoma|leukemia|myeloma|melanoma|sarcoma|tumou?r|glioma|glioblastoma|neoplasm|myelodysplastic|myelofibrosis|mastocytosis|polycythemia|thrombocythemia|mesothelioma|blastoma|macroglobulinemia|nsclc|sclc|crc|hcc|rcc|aml|cll|mds|dlbcl|lbcl|nmibc|mibc|pdac|gist|nets?\b|ptld/i;
const BRAND_LABEL = {
  onclive: 'OncLive', hcplive: 'HCPLive', neurolive: 'NeurologyLive', ophtalmology: 'Ophthalmology Times',
  dermatologytimes: 'Dermatology Times', contagion: 'Contagion Live', targetedonc: 'Targeted Oncology',
  cancernetwork: 'CancerNetwork', ajmc: 'AJMC', pharmacytimes: 'Pharmacy Times',
  contpeds: 'Contemporary Pediatrics', contobgyn: 'Contemporary OB/GYN', urologytimes: 'Urology Times', psychtimes: 'Psychiatric Times', curetoday: 'CURE', pharmexec: 'Pharmaceutical Executive',
};

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function rowsFor(apps) {
  return apps.map(a => ({
    drug: a.drug,
    partners: [...new Map(a.partners.filter(p => p.toLowerCase() !== a.drug.toLowerCase()).map(p => [p.toLowerCase(), p])).values()].slice(0, 3),
    indication: a.indication,
    pdufa: a.pdufaDate,
    basis: a.basis,
    evidence: a.basisEvidence,
    evidenceUrl: a.basisUrl,
    priority: a.priority,
    status: a.status,
    confidence: a.confidence,
    decision: a.decision ? { type: a.decision.type, when: a.decision.when, url: a.decision.url, title: a.decision.title, source: a.decision.source || 'MJH' } : null,
    priorCRLs: a.priorCRLs,
    supplemental: a.supplemental,
    // The indication decides; brand only when it is silent. Relacorilant runs in OncLive for ovarian
    // cancer, but the pending filing is for hypercortisolism.
    oncology: ONCOLOGY.test(a.indication || '') || (!NON_ONC.test(a.indication || '') && a.brands.some(b => ONC_BRANDS.has(b)) && !a.brands.some(b => !ONC_BRANDS.has(b) && !GENERAL_BRANDS.has(b))),
    sources: a.sources.slice(-6).map(s => ({ url: s.url, title: s.title, date: s.published, brand: BRAND_LABEL[s.brand] || s.brand })),
    nSources: a.sources.length,
    origin: a.origin || 'MJH only',
    rtt: a.rtt || null,
    note: a.note || null,
  }));
}

export function renderReport() {
  const pipe = JSON.parse(fs.readFileSync(path.join(ROOT, 'state', 'pipeline.json'), 'utf8'));
  const covFile = path.join(ROOT, 'state', 'coverage.json');
  const cov = fs.existsSync(covFile) ? JSON.parse(fs.readFileSync(covFile, 'utf8')) : null;
  const mergedFile = path.join(ROOT, 'state', 'merged.json');
  const merged = fs.existsSync(mergedFile) ? JSON.parse(fs.readFileSync(mergedFile, 'utf8')) : null;
  const data = {
    generated: pipe.generated, today: pipe.today, rules: pipe.rules, articles: pipe.articles,
    // Upcoming comes from the combined MJH + RTTNews list when it exists; everything else from MJH.
    rows: rowsFor(pipe.applications),
    upcoming: merged ? rowsFor(merged.rows) : null,
    removed: merged ? merged.removed : [],
    coverage: cov ? { window: cov.window, summary: cov.summary, tracker: cov.tracker } : null,
  };
  const html = TEMPLATE.replace('__DATA__', JSON.stringify(data).replace(/</g, '\\u003c'));
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, html);
  return OUT;
}

const TEMPLATE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Pipeline Tracker 2.0</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='7' fill='%23245b8f'/%3E%3Cpath d='M8 22h4v-6H8zm6 0h4V10h-4zm6 0h4v-9h-4z' fill='white'/%3E%3C/svg%3E">
<style>
:root{--bg:#f6f7f9;--card:#fff;--ink:#16202b;--muted:#5d6b7a;--line:#e3e7ec;--accent:#245b8f;--ann:#1f7a4d;--est:#9a6400;--est-bg:#fff6e5;--ann-bg:#e8f5ee;--warn:#b42318;--warn-bg:#fdecea;--chip:#eef2f6}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#0f1419;--card:#171d24;--ink:#e6ebf0;--muted:#97a3b0;--line:#2a333d;--accent:#7fb2e5;--ann:#5cc98d;--est:#e0a640;--est-bg:#2b2416;--ann-bg:#16291f;--warn:#f08a7e;--warn-bg:#2d1a18;--chip:#222b35}}
:root[data-theme="dark"]{--bg:#0f1419;--card:#171d24;--ink:#e6ebf0;--muted:#97a3b0;--line:#2a333d;--accent:#7fb2e5;--ann:#5cc98d;--est:#e0a640;--est-bg:#2b2416;--ann-bg:#16291f;--warn:#f08a7e;--warn-bg:#2d1a18;--chip:#222b35}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
.wrap{max-width:1280px;margin:0 auto;padding:24px 16px 64px}
h1{font-size:22px;margin:0 0 4px}h2{font-size:16px;margin:32px 0 10px}.sub{color:var(--muted);margin:0 0 20px}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px}
.tile{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px 14px;display:flex;flex-direction:column;justify-content:space-between;min-height:84px}
.tile .k{color:var(--muted);font-size:12px}.tile .v{font-size:26px;font-weight:650;font-variant-numeric:tabular-nums}.tile .s{color:var(--muted);font-size:12px}
.controls{display:flex;flex-wrap:wrap;gap:8px;margin:16px 0 10px}
.controls input,.controls select{background:var(--card);color:var(--ink);border:1px solid var(--line);border-radius:8px;padding:7px 10px;font:inherit}
.controls input{flex:1 1 220px}
.card{background:var(--card);border:1px solid var(--line);border-radius:10px;overflow-x:auto}
table{width:100%;border-collapse:collapse}th,td{padding:9px 10px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}
th{font-size:12px;color:var(--muted);font-weight:600;position:sticky;top:0;background:var(--card)}tr:last-child td{border-bottom:0}
td.date{white-space:nowrap;font-variant-numeric:tabular-nums}.days{color:var(--muted);font-size:12px}
.drug{font-weight:600}.partners{color:var(--muted);font-size:12px}.ind{max-width:340px}
.badge{display:inline-block;border-radius:6px;padding:1px 7px;font-size:12px;font-weight:600;white-space:nowrap}
.b-ann{background:var(--ann-bg);color:var(--ann)}.b-est{background:var(--est-bg);color:var(--est);border:1px dashed var(--est)}
.b-pri{background:var(--chip);color:var(--accent)}.b-warn{background:var(--warn-bg);color:var(--warn)}.b-ok{background:var(--ann-bg);color:var(--ann)}
.ev{color:var(--muted);font-size:12px;margin-top:3px;max-width:380px}
.src a{color:var(--accent);text-decoration:none;font-size:12px;display:block;max-width:300px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.src a:hover{text-decoration:underline}
.chip{display:inline-block;background:var(--chip);border-radius:5px;padding:0 6px;font-size:11px;color:var(--muted);margin-right:4px}
details{margin-top:28px}summary{cursor:pointer;font-weight:600;font-size:16px}
.note{color:var(--muted);font-size:13px;max-width:820px}
.cov{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:12px}.cov table td,.cov table th{padding:6px 10px}
.num{font-variant-numeric:tabular-nums}
@media (max-width:700px){.ind,.ev{max-width:none}th:nth-child(5),td:nth-child(5){display:none}}
</style>
</head>
<body>
<div class="wrap">
<h1>New-drug pipeline tracker 2.0</h1>
<p class="sub" id="sub"></p>
<div class="tiles" id="tiles"></div>

<h2>Upcoming FDA decisions</h2>
<div class="controls">
  <input id="q" placeholder="Search drug, indication or source…" aria-label="Search">
  <select id="area" aria-label="Area"><option value="">All areas</option><option value="onc">Oncology</option><option value="non">Non-oncology</option></select>
  <select id="basis" aria-label="Date basis"><option value="">Announced and estimated</option><option value="ann">Announced dates only</option><option value="est">Estimated dates only</option></select>
  <select id="horizon" aria-label="Horizon"><option value="">Any date</option><option value="90">Next 90 days</option><option value="180">Next 6 months</option><option value="365">Next 12 months</option></select>
</div>
<div class="card"><table id="up"></table></div>

<h2>Past their date, no decision found yet</h2>
<p class="note">The decision date has passed and neither MJH coverage nor FDA's approval records show an outcome. Usually an unreported CRL, an extension, or an early approval under a name the tracker did not recognise.</p>
<div class="card"><table id="overdue"></table></div>

<h2>Decided in the last 60 days</h2>
<div class="card"><table id="decided"></table></div>

<details><summary>Signals to verify</summary>
<p class="note">Filings mentioned once, in passing, inside a story about something else. Some are real and simply under-covered; others are background or plans. They are not counted in the totals above.</p>
<div class="card"><table id="low"></table></div>
</details>

<details id="covwrap"><summary>Coverage</summary><div id="cov"></div></details>

<details><summary>How dates are set</summary>
<div class="note" id="method"></div>
</details>
</div>
<script>
const D = __DATA__;
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const days = d => Math.round((Date.parse(d) - Date.parse(D.today)) / 864e5);
const fmt = d => d ? new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', {month:'short', day:'numeric', year:'numeric', timeZone:'UTC'}) : '—';
const isAnn = r => /^announced/.test(r.basis || '');
// A company window ("fourth quarter of 2026") is shown as the window, not as its last day.
const fmtDue = r => {
  const b = r.basis || '', d = new Date(r.pdufa + 'T12:00:00Z'), y = d.getUTCFullYear(), m = d.getUTCMonth();
  if (!/^company guidance/.test(b)) return fmt(r.pdufa);
  if (/half|H[12]\b/i.test(b)) return 'H' + (m < 6 ? 1 : 2) + ' ' + y;
  if (/quarter|\bQ[1-4]\b/i.test(b)) return 'Q' + (Math.floor(m / 3) + 1) + ' ' + y;
  if (/\b(19|20)\d\d\b/.test(b) && !/January|February|March|April|May|June|July|August|September|October|November|December/i.test(b)) return String(y);
  return d.toLocaleDateString('en-US', {month:'short', year:'numeric', timeZone:'UTC'});
};
const basisBadge = r => !r.basis ? '' : isAnn(r) ? '<span class="badge b-ann">Announced</span>' + (/RTTNews/.test(r.basis) ? ' <span class="chip">via RTTNews</span>' : '')
  : '<span class="badge b-est" title="' + esc(r.basis) + '">Est. · ' + esc(r.basis.replace('estimated from ', '').replace(/company guidance.*/, 'guidance')) + '</span>';

const open = (D.upcoming || D.rows).filter(r => r.confidence === 'high' && r.status === 'Pending' && r.pdufa >= D.today);
const overdue = (D.upcoming || D.rows).filter(r => r.confidence === 'high' && (r.status === 'Overdue' || (r.status === 'Pending' && r.pdufa < D.today)));
const decided = D.rows.filter(r => r.decision && days(r.decision.when) >= -60 && days(r.decision.when) <= 0 && r.decision.type !== 'withdrawn')
  .sort((a, b) => b.decision.when.localeCompare(a.decision.when));
const low = (D.upcoming || D.rows).filter(r => r.confidence === 'low' && (r.status === 'Pending' || r.status === 'Overdue') && r.pdufa >= D.today);

$('sub').textContent = 'Built from ' + D.articles.toLocaleString() + ' MJH articles' + (D.upcoming ? ' and the RTTNews FDA calendar' : '') + ' · updated ' + fmt(D.generated.slice(0,10));
const within = n => open.filter(r => days(r.pdufa) <= n).length;
$('tiles').innerHTML = [
  ['Upcoming decisions', open.length, open.filter(isAnn).length + ' announced · ' + open.filter(r => !isAnn(r)).length + ' estimated'],
  ['Next 30 days', within(30), within(90) + ' within 90 days'],
  ['Oncology', open.filter(r => r.oncology).length, open.filter(r => !r.oncology).length + ' other areas'],
  ['Not covered by MJH', open.filter(r => r.origin === 'RTTNews only').length, 'from RTTNews only'],
  ['Past date, no outcome', overdue.length, 'needs a look'],
  ['Decided (60 days)', decided.length, decided.filter(r => r.decision.type === 'approved').length + ' approved · ' + decided.filter(r => r.decision.type === 'crl').length + ' CRL'],
].map(([k, v, s]) => '<div class="tile"><div class="k">' + k + '</div><div class="v">' + v + '</div><div class="s">' + s + '</div></div>').join('');

const srcCell = r => (r.origin === 'RTTNews only' ? '<span class="badge b-est">RTTNews only · no MJH coverage</span>' + (r.rtt ? '<div class="ev">' + esc(r.rtt.company) + ' · ' + esc(r.rtt.type) + '</div>' : '') : '')
  + '<div class="src">' + r.sources.slice().reverse().slice(0, 3).map(s => '<a href="' + esc(s.url) + '" target="_blank" rel="noopener" title="' + esc(s.title) + '">' + esc(s.brand) + ' · ' + fmt(s.date) + '</a>').join('') + (r.nSources > 3 ? '<span class="chip">' + r.nSources + ' articles</span>' : '') + '</div>';
const drugCell = r => '<div class="drug">' + esc(r.drug) + '</div>' + (r.partners.length ? '<div class="partners">+ ' + r.partners.map(esc).join(', ') + '</div>' : '')
  + (r.supplemental ? '<span class="chip">supplement</span>' : '') + (r.priorCRLs ? '<span class="chip">after CRL</span>' : '');

function table(el, rows, opts = {}) {
  const head = '<tr><th>' + (opts.decision ? 'Decision' : 'PDUFA') + '</th><th>Drug</th><th>Indication</th><th>' + (opts.decision ? 'Outcome' : 'Date basis') + '</th><th>MJH coverage</th></tr>';
  const body = rows.map(r => {
    const d = opts.decision ? r.decision.when : r.pdufa;
    const dd = days(d);
    const dateCell = '<td class="date">' + (opts.decision ? fmt(d) : fmtDue(r)) + '<div class="days">' + (opts.decision ? '' : /^company guidance/.test(r.basis || '') ? 'by end · ' : !isAnn(r) ? 'est. · ' : '') + (dd === 0 ? 'today' : dd > 0 ? 'in ' + dd + ' d' : -dd + ' d ago') + '</div></td>';
    const basis = opts.decision
      ? '<td>' + (r.decision.type === 'approved' ? '<span class="badge b-ok">Approved</span>' : '<span class="badge b-warn">CRL</span>')
        + '<div class="ev">' + (r.decision.url ? '<a href="' + esc(r.decision.url) + '" target="_blank" rel="noopener">' + esc(r.decision.source === 'FDA' ? 'FDA record' : 'MJH story') + '</a>' : '') + '</div></td>'
      : '<td>' + basisBadge(r) + (r.priority ? ' <span class="badge b-pri">Priority</span>' : '') + (r.evidence ? '<div class="ev">“' + esc(r.evidence.slice(0, 160)) + (r.evidence.length > 160 ? '…' : '') + '”</div>' : '')
        + (r.note ? '<div class="ev">' + esc(r.note) + '</div>' : '') + '</td>';
    return '<tr>' + dateCell + '<td>' + drugCell(r) + '</td><td class="ind">' + esc(r.indication || '—') + '</td>' + basis + '<td>' + srcCell(r) + '</td></tr>';
  }).join('');
  el.innerHTML = head + (body || '<tr><td colspan="5" class="note">Nothing here.</td></tr>');
}

function render() {
  const q = $('q').value.trim().toLowerCase(), area = $('area').value, basis = $('basis').value, hz = Number($('horizon').value) || Infinity;
  const rows = open.filter(r => (!q || JSON.stringify([r.drug, r.partners, r.indication, r.sources.map(s => s.title)]).toLowerCase().includes(q))
    && (!area || (area === 'onc') === r.oncology) && (!basis || (basis === 'ann') === isAnn(r)) && days(r.pdufa) <= hz);
  table($('up'), rows);
}
['q', 'area', 'basis', 'horizon'].forEach(id => $(id).addEventListener('input', render));
render();
table($('overdue'), overdue.slice().reverse());
table($('decided'), decided, { decision: true });
table($('low'), low);

if (D.coverage) {
  const t = (title, obj, cols) => '<div><h3 style="font-size:14px;margin:14px 0 6px">' + title + '</h3><div class="card"><table><tr><th></th>' + cols.map(c => '<th>' + c[1] + '</th>').join('') + '</tr>'
    + Object.entries(obj).map(([k, v]) => '<tr><td>' + esc(k) + '</td>' + cols.map(c => '<td class="num">' + esc(v[c[0]]) + '</td>').join('') + '</tr>').join('') + '</table></div></div>';
  $('cov').innerHTML = '<p class="note">How much of the real pipeline MJH coverage catches. “On tracker ahead” means an MJH story about the submission, acceptance or PDUFA date ran before the decision.</p><div class="cov">'
    + (D.coverage.tracker ? t('Against every catalyst the current tracker has listed', D.coverage.tracker, [['n', 'n'], ['onTrackerAhead', 'On tracker ahead'], ['anyMention', 'Mentioned by MJH']]) : '')
    + t('Against FDA approvals ' + fmt(D.coverage.window.from) + ' – ' + fmt(D.coverage.window.to), D.coverage.summary, [['n', 'n'], ['aheadOfDecision', 'On tracker ahead'], ['decisionReported', 'Approval reported']])
    + '</div>';
} else $('covwrap').remove();

const R = D.rules;
$('method').innerHTML = '<p>Each row is one FDA application, assembled from every MJH story that mentions it. The decision date is set in this order:</p><ol>'
  + '<li><b>Announced.</b> If any story reports a PDUFA or target action date, that date is used, including later extensions.</li>'
  + '<li><b>Resubmission.</b> A resubmission after a CRL: ' + R.resubClass1Months + ' months for a Class 1, otherwise ' + R.resubClass2Months + ' months.</li>'
  + '<li><b>Acceptance.</b> New application: acceptance + ' + R.standardMonths + ' months (standard) or ' + R.priorityMonths + ' months (priority). Supplement (sNDA/sBLA): 2 months less, because FDA starts a supplement’s clock at submission.</li>'
  + '<li><b>Submission.</b> New application: submission + ' + R.filingDays + ' days filing review + ' + R.standardMonths + ' or ' + R.priorityMonths + ' months. Supplement: submission + ' + R.standardMonths + ' or ' + R.priorityMonths + ' months.</li>'
  + '<li><b>Company guidance.</b> When a company only gives a window (“first quarter of 2027”), the end of that window, which takes precedence over a formula estimate.</li></ol>'
  + '<p>Outcomes come from MJH approval and CRL stories, with FDA approval records as a backstop for decisions MJH did not cover.</p>';
</script>
</body>
</html>`;

if (process.argv[1] === fileURLToPath(import.meta.url)) console.log(renderReport());
