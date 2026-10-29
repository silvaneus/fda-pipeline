// Bridge to the FDA Catalysts tab: runs the pipeline and returns its rows in the shape
// generate-integrated-report.js renders.
//
// Two tiers:
//   main  - RTTNews entries (with MJH outcomes, extensions and dates applied) and MJH filings
//           confirmed by an RTTNews listing
//   mjh   - filings MJH reported in a headline that RTTNews does not list
// MJH filings seen only in passing ("signals to verify") stay on the 2.0 report, not the tab.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { syncAll } from './sanity.js';
import { buildPipeline } from './build.js';
import { mergeSources, cleanIndication } from './merge.js';
import { scrapeRTTNews } from './rttnews.js';
import { renderReport } from './report.js';
import { appNames, nameMatch } from './coverage.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'state', 'catalysts.json');
const RTT_PAGE = 'https://www.rttnews.com/corpinfo/fdacalendar.aspx';
const RECENT_DAYS = 30;

const MONTHS = /January|February|March|April|May|June|July|August|September|October|November|December/i;
// A company window is shown as the window, not as its last day.
function dateLabel(date, basis) {
  const d = new Date(date + 'T12:00:00Z'), y = d.getUTCFullYear(), m = d.getUTCMonth();
  if (/half|H[12]\b/i.test(basis)) return `H${m < 6 ? 1 : 2} ${y}`;
  if (/quarter|\bQ[1-4]\b/i.test(basis)) return `Q${Math.floor(m / 3) + 1} ${y}`;
  if (/\b(19|20)\d\d\b/.test(basis) && !MONTHS.test(basis)) return String(y);
  return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
}

function dateBasis(basis) {
  if (/^announced/.test(basis || '')) return 'Announced';
  if (/^company guidance/.test(basis || '')) return 'Company guidance';
  return 'Estimated';
}

const latestSource = r => [...(r.sources || [])].sort((a, b) => (b.published || '').localeCompare(a.published || ''))[0];

function toCatalyst(r) {
  const basis = dateBasis(r.basis);
  const src = r.basisUrl || latestSource(r)?.url || null;
  const flags = [];
  if (r.priorCRLs) flags.push('after CRL');
  if (r.priority) flags.push('priority review');
  if (r.note) flags.push(r.note);
  return {
    drug: r.drug + (partnerList(r).length ? ' + ' + partnerList(r).join(' + ') : ''),
    brandName: null,
    company: r.rtt?.company || null,
    indication: r.indication || null,
    pdufaDate: r.pdufaDate,
    dateLabel: basis === 'Company guidance' ? dateLabel(r.pdufaDate, r.basis) : null,
    dateBasis: basis,
    dateBasisDetail: r.basis,
    submissionType: r.rtt?.type || (r.supplemental ? 'sNDA/sBLA' : null),
    status: r.pdufaDate < new Date().toISOString().slice(0, 10) ? 'Overdue' : 'Pending',
    tier: r.origin === 'MJH only' ? 'mjh' : 'main',
    origin: r.origin,
    flags,
    source: r.origin,
    sourceUrl: src || (r.rtt ? RTT_PAGE : null),
    sourceType: 'news',
    mjhStories: (r.sources || []).length,
  };
}

// Decisions MJH (or FDA's records) reported in the last 30 days, shown for context as the old tab did.
// Only filings MJH had on the tracker before the decision: the point is to show what just came off it.
const PRE = new Set(['submitted', 'accepted', 'pdufa', 'extended', 'resubmitted']);
const partnerList = a => [...new Map((a.partners || []).filter(p => p.toLowerCase() !== a.drug.toLowerCase()).map(p => [p.toLowerCase(), p])).values()].slice(0, 2);
// The approval headline names the indication more reliably than a stray fragment ("High-Grade").
function decisionIndication(a) {
  const weak = !a.indication || a.indication.split(/\s+/).length < 2 || /\b(review|FDA)\b/i.test(a.indication);
  const fromTitle = (a.decision.title || '').match(/.*\b(?:in|for)\s+(.+)$/i)?.[1];
  return cleanIndication(weak && fromTitle ? fromTitle : a.indication) || null;
}
function recentDecisions(pipe) {
  const kept = [], out = [];
  const lo = new Date(Date.parse(pipe.today) - RECENT_DAYS * 864e5).toISOString().slice(0, 10);
  const apps = pipe.applications.filter(a => a.decision && a.confidence === 'high' && ['approved', 'crl'].includes(a.decision.type)
    && a.decision.when >= lo && a.decision.when <= pipe.today && a.pdufaDate
    && a.events.some(e => PRE.has(e.type) && e.published < a.decision.when))
    .sort((x, y) => y.sources.length - x.sources.length);
  for (const a of apps) {
    const d = a.decision;
    const N = appNames({ ...a, partners: [] });
    if (kept.some(k => Math.abs(Date.parse(k.decision.when) - Date.parse(d.when)) <= 7 * 864e5 && nameMatch(N, appNames({ ...k, partners: [] })))) continue;
    kept.push(a);
    out.push({
      drug: a.drug + (partnerList(a).length ? ' + ' + partnerList(a).join(' + ') : ''),
      brandName: null, company: null, indication: decisionIndication(a),
      pdufaDate: d.when, scheduledDate: a.pdufaDate, decisionTitle: d.title || null, dateLabel: null, dateBasis: 'Decision', dateBasisDetail: d.title || null,
      submissionType: a.supplemental ? 'sNDA/sBLA' : null,
      status: d.type === 'approved' ? 'Approved' : 'CRL',
      tier: 'main', origin: d.source === 'FDA' ? 'FDA record' : 'MJH', flags: [],
      source: d.source === 'FDA' ? 'FDA' : 'MJH', sourceUrl: d.url || null, sourceType: d.source === 'FDA' ? 'fda' : 'news',
      mjhStories: (a.sources || []).length,
    });
  }
  return out;
}

export async function buildCatalysts({ sync = true, verbose = true } = {}) {
  const log = (...a) => verbose && console.log(...a);
  if (sync) {
    const r = await syncAll();
    log(`  MJH articles: ${r.reduce((n, b) => n + b.total, 0).toLocaleString()} across ${r.length} brands (+${r.reduce((n, b) => n + b.added, 0)} new)`);
    try { log(`  RTTNews: ${(await scrapeRTTNews()).length} entries`); } catch (e) { log(`  RTTNews scrape failed, using last good copy: ${e.message}`); }
  }
  const pipe = await buildPipeline();
  const merged = await mergeSources();
  const rows = merged.rows.filter(r => r.confidence === 'high' && (r.status === 'Pending' || r.status === 'Overdue') && r.pdufaDate);
  const catalysts = [...rows.map(toCatalyst), ...recentDecisions(pipe)];
  const report = renderReport();
  const by = {};
  for (const c of catalysts) by[c.tier + ':' + c.status] = (by[c.tier + ':' + c.status] || 0) + 1;
  log(`  Catalysts: ${catalysts.length}`, by, `| ${merged.removed.length} RTTNews entries removed as already decided`);
  fs.writeFileSync(OUT, JSON.stringify({ generated: new Date().toISOString(), catalysts }, null, 1));
  return { catalysts, report };
}

// The last good list, for when Sanity or RTTNews is unreachable.
export function lastCatalysts() {
  return fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')).catalysts : null;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { catalysts, report } = await buildCatalysts({ sync: !process.argv.includes('--no-sync') });
  console.log(`${catalysts.length} catalysts → ${OUT}\nreport: ${report}`);
}
