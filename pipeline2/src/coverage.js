// Measures how much of the real FDA pipeline MJH coverage captures.
//
// Backtest: every NDA/BLA approval FDA recorded in the window (openFDA). For each, did MJH
// coverage put the application on the tracker BEFORE the decision (submission, acceptance or
// PDUFA article), and did MJH report the decision itself?
//
// Forward check: the current tracker's upcoming list, matched against this one.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { normName } from './extract.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STATE = path.join(ROOT, 'state');
const V1_REPORT = path.join(ROOT, '..', 'reports', 'fda-pipeline-report.html');

const SALTS = /\b(hydrochloride|hcl|mesylate|maleate|sodium|potassium|calcium|citrate|tartrate|succinate|fumarate|phosphate|sulfate|acetate|bromide|besylate|tosylate|dihydrochloride|monohydrate|hydrobromide|disodium|anhydrous|free base|olamine|meglumine|magnesium|trihydrate)\b/g;
export const cleanName = s => normName((s || '').toLowerCase().replace(SALTS, '')).replace(/\s+/g, ' ').trim();
const ONCOLOGY = /cancer|carcinoma|lymphoma|leukemia|myeloma|melanoma|sarcoma|tumou?r|glioma|glioblastoma|neoplasm|myelodysplastic|myelofibrosis|mastocytosis|polycythemia|thrombocythemia|mesothelioma|blastoma|macroglobulinemia|metasta/i;

async function getJSON(url) {
  for (let i = 0; i < 4; i++) {
    const r = await fetch(url);
    if (r.ok) return r.json();
    if (r.status === 404) return { results: [] };
    await new Promise(res => setTimeout(res, 1500 * 2 ** i));
  }
  throw new Error(`openFDA unavailable: ${url}`);
}

// NDA/BLA approvals in the window: originals and efficacy (new indication/population) supplements.
export async function fdaApprovals(from, to) {
  const f = path.join(STATE, `fda-approvals-${from}-${to}.json`);
  if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8'));
  const q = `submissions.submission_status_date:[${from.replace(/-/g, '')}+TO+${to.replace(/-/g, '')}]+AND+submissions.submission_status:AP`;
  const recs = [];
  for (let skip = 0; ; skip += 1000) {
    const d = await getJSON(`https://api.fda.gov/drug/drugsfda.json?search=${q}&limit=1000&skip=${skip}`);
    recs.push(...d.results);
    if (d.results.length < 1000) break;
  }
  const lo = from.replace(/-/g, ''), hi = to.replace(/-/g, '');
  const rows = new Map();
  for (const r of recs) {
    if (!/^(NDA|BLA)/.test(r.application_number)) continue;
    const of = r.openfda || {};
    const prod = (r.products || [])[0] || {};
    for (const s of r.submissions || []) {
      const d = s.submission_status_date || '';
      if (s.submission_status !== 'AP' || d < lo || d > hi) continue;
      const cls = s.submission_class_code || '';
      let kind = null;
      if (s.submission_type === 'ORIG' && /^TYPE 1/.test(cls)) kind = 'novel';
      else if (cls === 'EFFICACY' || /^TYPE (9|10)/.test(cls)) kind = 'new indication';
      if (!kind) continue;
      const generic = of.generic_name?.[0] || (prod.active_ingredients || []).map(i => i.name).join(' + ');
      const date = `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
      // One decision can be booked on several applications (strengths, formulations).
      const key = `${cleanName(generic)}|${date}`;
      if (rows.has(key)) continue;
      rows.set(key, {
        date, kind, app: r.application_number, sponsor: r.sponsor_name,
        brand: of.brand_name?.[0] || prod.brand_name || null, generic,
        priority: s.review_priority || null,
      });
    }
  }
  const out = [...rows.values()].sort((a, b) => a.date.localeCompare(b.date));
  fs.writeFileSync(f, JSON.stringify(out, null, 1));
  return out;
}

// Indication text from the label, only to tag oncology. Cached; failures just leave it untagged.
async function tagOncology(actions) {
  const f = path.join(STATE, 'fda-label-tags.json');
  const cache = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : {};
  for (const a of actions) {
    if (!(a.app in cache)) {
      try {
        const d = await getJSON(`https://api.fda.gov/drug/label.json?search=openfda.application_number:${a.app}&limit=1`);
        cache[a.app] = (d.results?.[0]?.indications_and_usage || []).join(' ').slice(0, 1500);
      } catch { cache[a.app] = null; }
      await new Promise(r => setTimeout(r, 300));
    }
    a.oncology = cache[a.app] == null ? null : ONCOLOGY.test(cache[a.app]);
  }
  fs.writeFileSync(f, JSON.stringify(cache));
}

export function actionNames(a) {
  const names = new Set();
  for (const part of `${a.generic} + ${a.brand || ''}`.split(/\s*(?:\+|;|,| and )\s*/)) {
    const n = cleanName(part);
    if (n.length >= 4) names.add(n);
  }
  return names;
}

export function appNames(app) {
  const s = new Set([cleanName(app.drug), ...app.aliases.map(cleanName)]);
  for (const p of app.partners) s.add(cleanName(p));
  return s;
}

// One-letter typos happen in the source lists ("Zlurgisertib").
function within1(a, b) {
  if (Math.abs(a.length - b.length) > 1 || a.length < 8) return false;
  let i = 0, j = 0, edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}
const GENERIC_WORD = /^(oral|intravenous|subcutaneous|injection|tablets?|cream|gel|aav|patch|weekly|low|dose|estrogen|extended|release|inhalation|solution|suspension|plus|therapy|gene|cell|for|the|and|with)$/;

export const nameMatch = (A, B) => {
  for (const a of A) for (const b of B) {
    if (a === b || within1(a, b)) return true;
    // Multi-word list names ("UX111 AAV", "Lunsumio VELO"): a distinctive single word is enough.
    for (const w of a.split(' ')) if (w.length >= 5 && !GENERIC_WORD.test(w) && b.split(' ').includes(w) && (/\d/.test(w) || b.split(' ').length === 1 || a.split(' ').length > 1)) return true;
    // "trastuzumab deruxtecan" vs "trastuzumab deruxtecan nxki", "insulin icodec" vs "icodec"
    if (a.length >= 6 && b.length >= 6 && (a.startsWith(`${b} `) || b.startsWith(`${a} `) || a.endsWith(` ${b}`) || b.endsWith(` ${a}`))) return true;
  }
  return false;
};

const PRE = new Set(['submitted', 'accepted', 'pdufa', 'extended', 'resubmitted']);
const days = (a, b) => (Date.parse(b) - Date.parse(a)) / 864e5;

export function backtest(apps, actions) {
  return actions.map(act => {
    const N = actionNames(act);
    const cands = apps.filter(app => nameMatch(N, appNames(app)));
    // Ahead: a pre-decision article published before the action, within 15 months of it.
    // The matched filing must still have been open then: one decided long before is a different filing.
    const ahead = cands.filter(app => (!app.decision || days(act.date, app.decision.when) >= -120)
      && app.events.some(e => PRE.has(e.type) && e.published < act.date && days(e.published, act.date) <= 460));
    const reported = cands.some(app => app.events.some(e => e.type === 'approved' && Math.abs(days(e.published, act.date)) <= 30));
    const best = ahead.sort((x, y) => (x.basis === 'announced' ? -1 : 1) - (y.basis === 'announced' ? -1 : 1))[0];
    const firstPre = best?.events.filter(e => PRE.has(e.type) && e.published < act.date).map(e => e.published).sort()[0];
    const announcedBefore = best?.events.some(e => e.pdufaDate && e.published < act.date);
    return { ...act, ahead: !!best, reported, leadDays: firstPre ? Math.round(days(firstPre, act.date)) : null, announcedBefore: !!announcedBefore, matched: best?.drug || cands[0]?.drug || null };
  });
}

// Every catalyst the current tracker has listed, rebuilt from its nightly report commits
// (one snapshot per week). This is the "publicly announced pipeline" yardstick.
export function v1History() {
  const repo = path.dirname(path.dirname(V1_REPORT));
  if (!fs.existsSync(path.join(repo, '.git'))) return [];
  const git = args => execFileSync('git', ['-C', repo, ...args], { maxBuffer: 1e9 }).toString();
  const commits = git(['log', '--format=%H %cs', '--', 'reports/fda-pipeline-report.html']).trim().split('\n')
    .map(l => l.split(' ')).sort((a, b) => a[1].localeCompare(b[1]));
  const weekly = new Map();
  for (const [h, d] of commits) {
    const wk = `${d.slice(0, 8)}${Math.floor(Number(d.slice(8)) / 7)}`;
    if (!weekly.has(wk)) weekly.set(wk, [h, d]);
  }
  const all = new Map();
  for (const [h, d] of weekly.values()) {
    const html = git(['show', `${h}:reports/fda-pipeline-report.html`]);
    const i = html.indexOf('const catalysts = [');
    if (i < 0) continue;
    let depth = 0, j = i + 'const catalysts = '.length, k = j;
    for (; k < html.length; k++) { if (html[k] === '[') depth++; else if (html[k] === ']' && !--depth) break; }
    let arr;
    try { arr = Function(`return ${html.slice(j, k + 1)}`)(); } catch { continue; }
    for (const c of arr) {
      if (!c.pdufaDate) continue;
      const key = `${(c.drug || '').toLowerCase().replace(/[^a-z0-9]/g, '')}|${c.pdufaDate.slice(0, 7)}`;
      if (!all.has(key)) all.set(key, { drug: c.drug, brandName: c.brandName, company: c.company, indication: c.indication, pdufaDate: c.pdufaDate, source: c.source, firstListed: d });
    }
  }
  return [...all.values()].sort((a, b) => a.pdufaDate.localeCompare(b.pdufaDate));
}

export function historyCheck(apps, today) {
  return v1History().map(c => {
    const N = new Set([c.drug, c.brandName].filter(Boolean)
      .flatMap(x => x.split(/\s+(?:plus|with|and)\s+|\s*[+(),;]\s*/i)).map(cleanName).filter(x => x.length >= 3 && !/^(oral|intravenous|subcutaneous|injection|tablets?|cream|gel|aav)$/.test(x)));
    const cands = apps.filter(app => nameMatch(N, appNames(app)));
    const cutoff = c.pdufaDate < today ? c.pdufaDate : today;
    const ahead = cands.filter(app => (!app.decision || days(c.pdufaDate, app.decision.when) >= -120)
      && app.events.some(e => PRE.has(e.type) && e.published <= cutoff && days(e.published, c.pdufaDate) <= 460));
    // Closest PDUFA date among matching applications, to compare against the tracker's date.
    const best = (ahead.length ? ahead : cands).filter(a => a.pdufaDate)
      .sort((x, y) => Math.abs(days(x.pdufaDate, c.pdufaDate)) - Math.abs(days(y.pdufaDate, c.pdufaDate)))[0];
    return {
      ...c, upcoming: c.pdufaDate >= today, found: cands.length > 0, ahead: ahead.length > 0,
      v2: best ? { drug: best.drug, status: best.status, pdufaDate: best.pdufaDate, basis: best.basis, offByDays: Math.round(days(c.pdufaDate, best.pdufaDate)) } : null,
    };
  });
}

const pct = (n, d) => d ? `${Math.round(100 * n / d)}% (${n}/${d})` : 'n/a';

export async function measure({ from, to } = {}) {
  const pipe = JSON.parse(fs.readFileSync(path.join(STATE, 'pipeline.json'), 'utf8'));
  from ||= '2025-10-01';
  to ||= pipe.today;
  const actions = await fdaApprovals(from, to);
  await tagOncology(actions);
  const bt = backtest(pipe.applications, actions);
  const hist = historyCheck(pipe.applications, pipe.today);
  const histHigh = historyCheck(pipe.applications.filter(a => a.confidence === 'high'), pipe.today);
  hist.forEach((r, i) => { r.aheadHigh = histHigh[i].ahead; });
  const btHigh = backtest(pipe.applications.filter(a => a.confidence === 'high'), actions);
  bt.forEach((r, i) => { r.aheadHigh = btHigh[i].ahead; });
  const summary = {};
  for (const [label, rows] of [
    ['all', bt], ['novel', bt.filter(r => r.kind === 'novel')], ['new indication', bt.filter(r => r.kind === 'new indication')],
    ['oncology', bt.filter(r => r.oncology)], ['oncology novel', bt.filter(r => r.oncology && r.kind === 'novel')],
    ['non-oncology', bt.filter(r => r.oncology === false)],
  ]) {
    summary[label] = { n: rows.length, aheadOfDecision: pct(rows.filter(r => r.ahead).length, rows.length), aheadHighConf: pct(rows.filter(r => r.aheadHigh).length, rows.length), decisionReported: pct(rows.filter(r => r.reported).length, rows.length), eitherAheadOrReported: pct(rows.filter(r => r.ahead || r.reported).length, rows.length) };
  }
  const tracker = {};
  for (const [label, rows] of [['all listed', hist], ['RTTNews', hist.filter(r => r.source === 'RTTNews')], ['curated', hist.filter(r => r.source === 'Curated')], ['upcoming now', hist.filter(r => r.upcoming)]]) {
    const ann = rows.filter(r => r.v2?.basis === 'announced');
    tracker[label] = {
      n: rows.length, onTrackerAhead: pct(rows.filter(r => r.ahead).length, rows.length), aheadHighConf: pct(rows.filter(r => r.aheadHigh).length, rows.length), anyMention: pct(rows.filter(r => r.found).length, rows.length),
      announcedDateWithin3d: pct(ann.filter(r => Math.abs(r.v2.offByDays) <= 3).length, ann.length),
    };
  }
  const result = { window: { from, to }, summary, tracker, backtest: bt, trackerRows: hist };
  fs.writeFileSync(path.join(STATE, 'coverage.json'), JSON.stringify(result, null, 1));
  return result;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const r = await measure({ from: process.argv[2], to: process.argv[3] });
  console.log(r.window);
  console.table(r.summary);
  console.log('Against every catalyst the current tracker has listed:');
  console.table(r.tracker);
}
