// Bridge to the FDA Catalysts tab: runs the pipeline and returns its rows in the shape
// generate-integrated-report.js renders.
//
// One list: RTTNews entries (with MJH outcomes, extensions and dates applied) and filings MJH
// reported in a headline, each with a confidence level saying how well-evidenced it is.
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

// The story that is about this decision: an MJH headline on the filing itself, in the current review
// cycle. A trial-results story that mentions the PDUFA date in passing is the fallback, not the source.
const BRAND_ORDER = ['onclive', 'targetedonc', 'cancernetwork', 'hcplive', 'neurolive', 'dermatologytimes', 'ophtalmology', 'contagion', 'urologytimes', 'psychtimes', 'contpeds', 'contobgyn', 'curetoday', 'ajmc', 'pharmacytimes', 'pharmexec'];
const HEADLINE_RANK = { extended: 5, pdufa: 4, accepted: 4, resubmitted: 3, submitted: 2 };
function primaryStory(r) {
  const lastCrl = (r.events || []).filter(e => e.type === 'crl' && e.where === 'headline').map(e => e.published).sort().at(-1) || '';
  const heads = (r.events || []).filter(e => e.where === 'headline' && HEADLINE_RANK[e.type] && e.published >= lastCrl && e.url);
  // A headline naming a different date is another filing's story.
  const fits = heads.filter(e => !e.pdufaDate || e.pdufaDate === r.pdufaDate);
  // The original news, not a later recap: earliest report (latest, for an extension), specialty brands first.
  const brand = e => { const i = BRAND_ORDER.indexOf(e.brand); return i < 0 ? 99 : i; };
  const best = (fits.length ? fits : heads).sort((x, y) => HEADLINE_RANK[y.type] - HEADLINE_RANK[x.type]
    || (x.type === 'extended' ? y.published.localeCompare(x.published) : x.published.localeCompare(y.published))
    || brand(x) - brand(y))[0];
  return best ? { url: best.url, title: best.title } : null;
}

// How far to trust a row, from the evidence behind it.
function confidence(r, story, basis, overdue) {
  const why = [];
  if (r.rtt) why.push('on RTTNews');
  if (story) why.push('MJH headline on the filing');
  else if ((r.sources || []).length) why.push('MJH mention only');
  why.push(basis === 'Announced' ? 'date announced' : basis === 'Company guidance' ? 'company date window' : 'date estimated');
  let level;
  if (overdue) { level = 'Low'; why.push('date passed with no outcome reported'); }
  else if (story && (r.rtt || basis === 'Announced')) level = 'High';
  else if (story || (r.rtt && basis !== 'Estimated')) level = 'Medium';
  else level = 'Low';
  return { level, why: why.join(' · ') };
}

function toCatalyst(r) {
  const basis = dateBasis(r.basis);
  const story = primaryStory(r);
  const src = story?.url || r.basisUrl || latestSource(r)?.url || null;
  const overdue = r.pdufaDate < new Date().toISOString().slice(0, 10);
  const conf = confidence(r, story, basis, overdue);
  const supplemental = /^s(NDA|BLA)/i.test(r.rtt?.type || '') || (!r.rtt?.type && r.supplemental);
  const flags = [];
  if (supplemental) flags.push('new use of an approved drug');
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
    status: overdue ? 'Overdue' : 'Pending',
    confidence: conf.level,
    confidenceWhy: conf.why,
    origin: r.origin,
    flags,
    source: r.origin,
    sourceUrl: src || (r.rtt ? RTT_PAGE : null),
    sourceTitle: story?.title || null,
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
      origin: d.source === 'FDA' ? 'FDA record' : 'MJH', flags: [],
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
  // A date more than 30 days gone with no outcome reported is not an upcoming decision; the old tab
  // dropped these too. They stay on the 2.0 report under "past date, no outcome".
  const cutoff = new Date(Date.parse(pipe.today) - RECENT_DAYS * 864e5).toISOString().slice(0, 10);
  const rows = merged.rows.filter(r => r.confidence === 'high' && (r.status === 'Pending' || r.status === 'Overdue') && r.pdufaDate && r.pdufaDate >= cutoff);
  const catalysts = [...rows.map(toCatalyst), ...recentDecisions(pipe)];
  const report = renderReport();
  const by = {};
  for (const c of catalysts) by[c.status + (c.confidence ? ':' + c.confidence : '')] = (by[c.status + (c.confidence ? ':' + c.confidence : '')] || 0) + 1;
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
