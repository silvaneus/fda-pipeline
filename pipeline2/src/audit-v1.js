// Audits the legacy tracker (this repo's report history) against MJH coverage, snapshot by snapshot.
//
// 1. Removal lag: after MJH reported a CRL or approval, how many more days did the tracker
//    keep listing the drug as pending?
// 2. Stale on arrival: entries added after MJH had already reported the decision.
// 3. Today's list: every pending entry checked against MJH (confirmed, date conflict,
//    already decided, or no MJH record at all).
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { appNames, nameMatch, cleanName, fdaApprovals, actionNames } from './coverage.js';
import { indicationTokens } from './extract.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO = path.join(ROOT, '..');
const REPORT = 'reports/fda-pipeline-report.html';
const days = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);

function grab(html, name) {
  const i = html.indexOf(`const ${name} = [`);
  if (i < 0) return [];
  let depth = 0, j = i + `const ${name} = `.length, k = j;
  for (; k < html.length; k++) { if (html[k] === '[') depth++; else if (html[k] === ']' && !--depth) break; }
  try { return Function(`return ${html.slice(j, k + 1)}`)(); } catch { return []; }
}

// The last report committed each day.
function snapshots() {
  const git = args => execFileSync('git', ['-C', REPO, ...args], { maxBuffer: 1e9 }).toString();
  const byDay = new Map();
  for (const line of git(['log', '--format=%H %cs', '--', REPORT]).trim().split('\n')) {
    const [h, d] = line.split(' ');
    if (!byDay.has(d)) byDay.set(d, h);   // log is newest first
  }
  return [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0]))
    .map(([d, h]) => ({ date: d, catalysts: grab(git(['show', `${h}:${REPORT}`]), 'catalysts') }));
}

const namesOf = c => new Set([c.drug, c.brandName].filter(Boolean)
  .flatMap(x => x.split(/\s+(?:plus|with|and)\s+|\s*[+(),;/]\s*/i)).map(cleanName)
  .filter(x => x.length >= 3 && !/^(oral|intravenous|subcutaneous|injection|tablets?|cream|gel|aav|patch)$/.test(x)));

function sim(a, b) {
  const A = indicationTokens(a), B = indicationTokens(b);
  if (!A.size || !B.size) return null;
  let n = 0;
  for (const t of A) if (B.has(t)) n++;
  return n / Math.min(A.size, B.size);
}

export async function audit() {
  const pipe = JSON.parse(fs.readFileSync(path.join(ROOT, 'state', 'pipeline.json'), 'utf8'));
  const snaps = snapshots();
  const latest = snaps.at(-1);

  // One entry per drug + PDUFA month, with every day it was listed as pending.
  const entries = new Map();
  for (const s of snaps) for (const c of s.catalysts) {
    if (!c.pdufaDate || !/pending|awaiting/i.test(c.status || 'Pending')) continue;
    const key = `${(c.drug || '').toLowerCase().replace(/[^a-z0-9]/g, '')}|${c.pdufaDate.slice(0, 7)}`;
    if (!entries.has(key)) entries.set(key, { ...c, listed: [] });
    entries.get(key).listed.push(s.date);
  }

  // MJH-reported decisions only: the question is what MJH coverage alone would have caught.
  // The decision's own headline must name the drug: a roundup line about something else does not count.
  const namesHeadline = a => { const t = cleanName(a.decision.title || ''); return appNames({ ...a, partners: [] }).values().some(n => n.length >= 4 && t.includes(n)); };
  // Every decision, including CRLs on applications that were later resubmitted.
  const decisions = pipe.applications.flatMap(a => [...(a.cycles || []), ...(a.decision ? [a.decision] : [])].map(d => ({ ...a, decision: d })));
  const mjhDecided = decisions.filter(a => a.decision.source !== 'FDA' && a.decision.where === 'headline' && a.decision.type !== 'withdrawn' && namesHeadline(a));
  // Indication to compare against: the application's, or failing that the decision headline's.
  const indOf = a => a.indication || a.decision?.title || null;
  // A later open cycle (resubmission after a CRL, a new indication) with a date near the listed one
  // means the tracker is right to list it.
  const laterCycle = (N, pdufa, D) => pipe.applications.some(a => !a.decision && a.pdufaDate && Math.abs(days(pdufa, a.pdufaDate)) <= 45
    && a.events.some(e => e.published > D) && nameMatch(N, appNames({ ...a, partners: [] })));

  const lag = [], staleOnArrival = [];
  for (const e of entries.values()) {
    const N = namesOf(e);
    const first = e.listed[0], last = e.listed.at(-1);
    // The decision this entry was waiting for: early action up to 4 months, late up to 2.
    const d = mjhDecided.filter(a => nameMatch(N, appNames({ ...a, partners: [] })))
      .filter(a => days(e.pdufaDate, a.decision.when) >= -120 && days(e.pdufaDate, a.decision.when) <= 60)
      .filter(a => { const s = sim(e.indication, indOf(a)); return s === null || s >= 0.34; })
      .sort((x, y) => Math.abs(days(e.pdufaDate, x.decision.when)) - Math.abs(days(e.pdufaDate, y.decision.when)))[0];
    if (!d) continue;
    const D = d.decision.when;
    if (laterCycle(N, e.pdufaDate, D)) continue;
    const after = e.listed.filter(x => days(D, x) >= 2);   // a day's grace for publishing time
    const row = {
      drug: e.drug, indication: e.indication, source: e.source, pdufaDate: e.pdufaDate,
      outcome: d.decision.type, decidedOn: D, mjh: d.decision.url, mjhTitle: d.decision.title,
      firstListed: first, lastListed: last, daysListedAfter: after.length ? days(D, after.at(-1)) : 0,
      stillListedToday: last === latest.date,
    };
    if (days(D, first) >= 2) staleOnArrival.push(row);
    else if (after.length) lag.push(row);
    else lag.push(row);   // removed promptly, kept for the rate
  }

  // Today's pending list against MJH.
  const today = latest.catalysts.filter(c => c.pdufaDate && /pending|awaiting/i.test(c.status || 'Pending')).map(c => {
    const N = namesOf(c);
    const cands = pipe.applications.filter(a => nameMatch(N, appNames({ ...a, partners: [] })));
    const decided = cands.filter(a => a.decision && a.decision.type !== 'withdrawn'
      && days(c.pdufaDate, a.decision.when) >= -240 && a.decision.when <= pipe.today)
      .filter(a => { const s = sim(c.indication, indOf(a)); return s === null || s >= 0.34; })
      .sort((x, y) => y.decision.when.localeCompare(x.decision.when))[0];
    const open = cands.filter(a => ['Pending', 'Overdue', 'Unresolved'].includes(a.status) && a.pdufaDate)
      .sort((x, y) => Math.abs(days(c.pdufaDate, x.pdufaDate)) - Math.abs(days(c.pdufaDate, y.pdufaDate)))[0];
    let verdict;
    const openNear = open && Math.abs(days(c.pdufaDate, open.pdufaDate)) <= 45;
    if (decided && !openNear && (decided.decision.source === 'FDA' || (decided.decision.where === 'headline' && namesHeadline(decided)))) verdict = decided.decision.type === 'crl' ? 'CRL already reported' : 'already approved';
    else if (open?.basis === 'announced') verdict = Math.abs(days(c.pdufaDate, open.pdufaDate)) <= 3 ? 'confirmed' : 'date conflict';
    else if (open) verdict = 'filing confirmed, date not announced in MJH';
    else if (cands.length) verdict = 'MJH covers the drug, not this filing';
    else verdict = 'no MJH record';
    const ref = decided || open || cands[0];
    return {
      drug: c.drug, company: c.company, indication: c.indication, pdufaDate: c.pdufaDate, source: c.source, verdict,
      mjh: ref ? { drug: ref.drug, status: ref.status, pdufaDate: ref.pdufaDate, basis: ref.basis, decision: ref.decision, url: (ref.decision?.url) || ref.basisUrl || ref.sources?.at(-1)?.url } : null,
    };
  });

  // Past entries with no outcome on record anywhere: not in MJH, not in FDA approvals.
  // Not proof an entry was invented (MJH may simply not cover it), but each one needs a source.
  let acts = [];
  try { acts = await fdaApprovals(new Date(Date.parse(pipe.today) - 730 * 864e5).toISOString().slice(0, 10), pipe.today); } catch {}
  const noOutcome = [...entries.values()].filter(e => days(e.pdufaDate, pipe.today) > 30).filter(e => {
    const N = namesOf(e);
    const near = when => days(e.pdufaDate, when) >= -240 && days(e.pdufaDate, when) <= 120;
    return !decisions.some(a => nameMatch(N, appNames({ ...a, partners: [] })) && near(a.decision.when))
      && !acts.some(x => nameMatch(N, actionNames(x)) && near(x.date));
  }).map(e => {
    const N = namesOf(e);
    const later = pipe.applications.find(a => !a.decision && a.pdufaDate > e.pdufaDate && nameMatch(N, appNames({ ...a, partners: [] })));
    const mentioned = pipe.applications.some(a => nameMatch(N, appNames({ ...a, partners: [] })));
    // Already approved before the tracker ever listed it: the entry re-lists an old decision.
    const prior = decisions.filter(a => a.decision.type === 'approved' && a.decision.when < e.listed[0] && nameMatch(N, appNames({ ...a, partners: [] })))
      .sort((x, y) => x.decision.when.localeCompare(y.decision.when))[0];
    return { drug: e.drug, indication: e.indication, source: e.source, pdufaDate: e.pdufaDate, firstListed: e.listed[0], lastListed: e.listed.at(-1),
      priorApproval: prior ? { when: prior.decision.when, url: prior.decision.url, title: prior.decision.title } : null,
      note: prior ? `MJH reported it approved on ${prior.decision.when}, before it was listed` : later ? `MJH now shows a later date (${later.pdufaDate})`
        : mentioned ? 'MJH covers the drug, no record of this decision' : 'no MJH filing or decision story since 2024' };
  });

  const result = { generated: pipe.today, snapshots: snaps.length, from: snaps[0].date, to: latest.date, lag, staleOnArrival, today, noOutcome };
  fs.writeFileSync(path.join(ROOT, 'state', 'v1-audit.json'), JSON.stringify(result, null, 1));
  return result;
}

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = d => d ? new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : '—';
const link = (url, text) => url ? `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(text)}</a>` : esc(text);

export function renderAudit(r) {
  const late = r.lag.filter(x => x.daysListedAfter > 0).sort((a, b) => b.daysListedAfter - a.daysListedAfter);
  const stat = t => { const all = r.lag.filter(x => x.outcome === t), l = all.filter(x => x.daysListedAfter > 0); return { all: all.length, late: l.length, over14: l.filter(x => x.daysListedAfter > 14).length }; };
  const crl = stat('crl'), ap = stat('approved');
  const order = ['CRL already reported', 'already approved', 'date conflict', 'no MJH record', 'MJH covers the drug, not this filing', 'filing confirmed, date not announced in MJH', 'confirmed'];
  const today = r.today.slice().sort((a, b) => order.indexOf(a.verdict) - order.indexOf(b.verdict) || a.pdufaDate.localeCompare(b.pdufaDate));
  const counts = order.map(v => [v, r.today.filter(x => x.verdict === v).length]).filter(([, n]) => n);
  const tone = v => /CRL|approved|conflict/.test(v) ? 'bad' : /no MJH/.test(v) ? 'warn' : v === 'confirmed' ? 'ok' : 'mid';
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Tracker Audit</title>
<style>
:root{--bg:#f6f7f9;--card:#fff;--ink:#16202b;--muted:#5d6b7a;--line:#e3e7ec;--accent:#245b8f;--bad:#b42318;--bad-bg:#fdecea;--warn:#9a6400;--warn-bg:#fff6e5;--ok:#1f7a4d;--ok-bg:#e8f5ee;--mid-bg:#eef2f6}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#0f1419;--card:#171d24;--ink:#e6ebf0;--muted:#97a3b0;--line:#2a333d;--accent:#7fb2e5;--bad:#f08a7e;--bad-bg:#2d1a18;--warn:#e0a640;--warn-bg:#2b2416;--ok:#5cc98d;--ok-bg:#16291f;--mid-bg:#222b35}}
:root[data-theme="dark"]{--bg:#0f1419;--card:#171d24;--ink:#e6ebf0;--muted:#97a3b0;--line:#2a333d;--accent:#7fb2e5;--bad:#f08a7e;--bad-bg:#2d1a18;--warn:#e0a640;--warn-bg:#2b2416;--ok:#5cc98d;--ok-bg:#16291f;--mid-bg:#222b35}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
.wrap{max-width:1180px;margin:0 auto;padding:24px 16px 64px}h1{font-size:22px;margin:0 0 4px}h2{font-size:16px;margin:32px 0 6px}
.sub,.note{color:var(--muted)}.note{max-width:820px;margin:0 0 10px}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin-top:16px}
.tile{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px 14px}.tile .k{color:var(--muted);font-size:12px}.tile .v{font-size:26px;font-weight:650}.tile .s{color:var(--muted);font-size:12px}
.card{background:var(--card);border:1px solid var(--line);border-radius:10px;overflow-x:auto}
table{width:100%;border-collapse:collapse}th,td{padding:8px 10px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}th{font-size:12px;color:var(--muted)}tr:last-child td{border-bottom:0}
td.n{font-variant-numeric:tabular-nums;white-space:nowrap}a{color:var(--accent);text-decoration:none}a:hover{text-decoration:underline}
.b{display:inline-block;border-radius:6px;padding:1px 7px;font-size:12px;font-weight:600;white-space:nowrap}
.bad{background:var(--bad-bg);color:var(--bad)}.warn{background:var(--warn-bg);color:var(--warn)}.ok{background:var(--ok-bg);color:var(--ok)}.mid{background:var(--mid-bg);color:var(--muted)}
.ind{color:var(--muted);font-size:12px;max-width:360px}
</style></head><body><div class="wrap">
<h1>Current tracker audit</h1>
<p class="sub">${r.snapshots} daily snapshots of the current tracker (${fmt(r.from)} – ${fmt(r.to)}) replayed against MJH coverage. Only decisions MJH reported in a headline naming the drug are counted.</p>
<div class="tiles">
<div class="tile"><div class="k">CRLs MJH reported while listed</div><div class="v">${crl.all}</div><div class="s">${crl.late} stayed listed afterward · ${crl.over14} for over 2 weeks</div></div>
<div class="tile"><div class="k">Approvals MJH reported while listed</div><div class="v">${ap.all}</div><div class="s">${ap.late} stayed listed afterward · ${ap.over14} for over 2 weeks</div></div>
<div class="tile"><div class="k">Added after already decided</div><div class="v">${r.staleOnArrival.length}</div><div class="s">listed after MJH reported the outcome</div></div>
<div class="tile"><div class="k">Past entries with no outcome on record</div><div class="v">${r.noOutcome.length}</div><div class="s">neither MJH nor FDA approval records</div></div>
</div>

<h2>Today’s list, checked against MJH</h2>
<p class="note">${counts.map(([v, n]) => `${n} ${esc(v)}`).join(' · ')}</p>
<div class="card"><table><tr><th>Listed PDUFA</th><th>Entry</th><th>Verdict</th><th>What MJH shows</th></tr>
${today.map(x => `<tr><td class="n">${fmt(x.pdufaDate)}</td><td><b>${esc(x.drug)}</b> <span class="ind">${esc(x.source)}</span><div class="ind">${esc((x.indication || '').replace(/^FDA decision (on|regarding) /i, ''))}</div></td><td><span class="b ${tone(x.verdict)}">${esc(x.verdict)}</span></td><td>${x.mjh ? link(x.mjh.url, `${x.mjh.drug} · ${x.mjh.decision ? `${x.mjh.decision.type === 'crl' ? 'CRL' : 'approved'} ${fmt(x.mjh.decision.when)}` : `${x.mjh.status}${x.mjh.pdufaDate ? ` · ${fmt(x.mjh.pdufaDate)} (${x.mjh.basis})` : ''}`}`) : '—'}</td></tr>`).join('')}
</table></div>

<h2>Still listed after MJH reported the decision</h2>
<div class="card"><table><tr><th>MJH reported</th><th>Entry</th><th>Outcome</th><th>Days still listed</th><th>MJH story</th></tr>
${late.map(x => `<tr><td class="n">${fmt(x.decidedOn)}</td><td><b>${esc(x.drug)}</b> <span class="ind">${esc(x.source)}</span></td><td><span class="b ${x.outcome === 'crl' ? 'bad' : 'ok'}">${x.outcome === 'crl' ? 'CRL' : 'Approved'}</span></td><td class="n">${x.daysListedAfter}${x.stillListedToday ? ' <span class="b bad">still listed</span>' : ''}</td><td>${link(x.mjh, x.mjhTitle)}</td></tr>`).join('')}
${r.staleOnArrival.map(x => `<tr><td class="n">${fmt(x.decidedOn)}</td><td><b>${esc(x.drug)}</b> <span class="ind">${esc(x.source)}</span></td><td><span class="b ${x.outcome === 'crl' ? 'bad' : 'ok'}">${x.outcome === 'crl' ? 'CRL' : 'Approved'}</span></td><td class="n"><span class="b bad">added ${fmt(x.firstListed)}</span></td><td>${link(x.mjh, x.mjhTitle)}</td></tr>`).join('')}
</table></div>

<h2>Past entries with no outcome on record</h2>
<p class="note">The date passed, but neither an MJH story nor FDA’s approval records show a decision. Some will be real decisions MJH didn’t cover, or names that didn’t match (DTX401 is likely HCPLive’s “gene therapy for glycogen storage disease type 1a”). Curated entries here are the strongest candidates for invented data.</p>
<div class="card"><table><tr><th>Listed PDUFA</th><th>Entry</th><th>Listed</th><th>Note</th></tr>
${r.noOutcome.sort((a, b) => a.pdufaDate.localeCompare(b.pdufaDate)).map(x => `<tr><td class="n">${fmt(x.pdufaDate)}</td><td><b>${esc(x.drug)}</b> <span class="b ${x.source === 'Curated' ? 'warn' : 'mid'}">${esc(x.source)}</span><div class="ind">${esc((x.indication || '').replace(/^FDA decision (on|regarding) /i, ''))}</div></td><td class="n">${fmt(x.firstListed)} – ${fmt(x.lastListed)}</td><td>${x.priorApproval ? link(x.priorApproval.url, x.note) : esc(x.note)}</td></tr>`).join('')}
</table></div>
</div></body></html>`;
  const out = path.join(ROOT, 'reports', 'tracker-audit.html');
  fs.writeFileSync(out, html);
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const r = await audit();
  console.log(renderAudit(r));
  console.log(`${r.snapshots} daily snapshots, ${r.from} → ${r.to}`);
  for (const t of ['crl', 'approved']) {
    const rows = r.lag.filter(x => x.outcome === t);
    const late = rows.filter(x => x.daysListedAfter > 0).sort((a, b) => b.daysListedAfter - a.daysListedAfter);
    const med = late.length ? late[Math.floor(late.length / 2)].daysListedAfter : 0;
    console.log(`\n${t.toUpperCase()}: ${rows.length} decisions MJH reported while the drug was listed; ${late.length} stayed listed afterward (median ${med} days)`);
    for (const x of late) console.log(`  ${x.decidedOn} ${x.drug} | listed ${x.daysListedAfter} more days${x.stillListedToday ? ' — STILL LISTED' : ''} | ${x.source}`);
  }
  console.log(`\nAdded after MJH had already reported the decision: ${r.staleOnArrival.length}`);
  for (const x of r.staleOnArrival) console.log(`  ${x.drug} | ${x.outcome} ${x.decidedOn}, first listed ${x.firstListed} | ${x.source}`);
  const v = {};
  for (const x of r.today) v[x.verdict] = (v[x.verdict] || 0) + 1;
  console.log('\nToday\'s pending list:', v);
  for (const x of r.today.filter(x => x.verdict !== 'confirmed')) console.log(`  ${x.pdufaDate} ${x.drug} | ${x.verdict} | ${x.source}${x.mjh ? ` | MJH: ${x.mjh.drug} ${x.mjh.status} ${x.mjh.decision ? x.mjh.decision.when : x.mjh.pdufaDate || ''}` : ''}`);
}
