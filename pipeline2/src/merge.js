// The combined tracker: MJH coverage (2.0) plus the RTTNews calendar. No curated list.
//
// - RTTNews generic (ANDA) entries are dropped: out of scope.
// - An RTTNews entry whose decision MJH already reported (approval or CRL) comes off.
// - Where both have a date, an MJH-reported date wins (it carries extensions RTTNews misses);
//   an RTTNews exact date beats an MJH estimate.
// - RTTNews entries MJH never covered stay, labelled as RTTNews only.
// - MJH filings RTTNews doesn't list stay, labelled with how the date was set.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { appNames, nameMatch, cleanName } from './coverage.js';
import { indicationTokens, ABBREV } from './extract.js';
import { loadRTTNews } from './rttnews.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'state', 'merged.json');
const LOOKUP = path.join(ROOT, 'state', 'openfda-brands.json');
const days = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);
const DECIDED_RTT = /^(approved|rejected)/i;

function sim(a, b) {
  const A = indicationTokens(a), B = indicationTokens(b);
  if (!A.size || !B.size) return null;
  let n = 0;
  for (const t of A) if (B.has(t)) n++;
  return n / Math.min(A.size, B.size);
}

const rttNames = e => new Set(`${e.drug}`.split(/\s+(?:plus|with|and)\s+|\s*[+(),;/]\s*/i).map(cleanName)
  .filter(x => x.length >= 3 && !/^(oral|intravenous|subcutaneous|injection|tablets?|cream|gel|aav|patch|extended release injection)$/.test(x)));

// RTTNews lists marketed drugs by brand (MYQORZO, Yeztugo); openFDA maps a brand to its generic.
async function brandGenerics(entries) {
  const cache = fs.existsSync(LOOKUP) ? JSON.parse(fs.readFileSync(LOOKUP, 'utf8')) : {};
  for (const e of entries) {
    const brand = e.drug.split(/\s+(?:plus|with|and)\s+|\s*[+(]/i)[0].trim();
    if (!/^[A-Z][A-Z0-9-]{3,}$/.test(brand.split(' ')[0]) && !/^[A-Z][a-z]+$/.test(brand)) continue;
    if (brand in cache) continue;
    try {
      const r = await fetch(`https://api.fda.gov/drug/drugsfda.json?search=openfda.brand_name:"${encodeURIComponent(brand)}"&limit=3`);
      const d = r.ok ? await r.json() : { results: [] };
      cache[brand] = [...new Set((d.results || []).flatMap(x => x.openfda?.generic_name || []))];
    } catch { cache[brand] = []; }
    await new Promise(r => setTimeout(r, 250));
  }
  fs.writeFileSync(LOOKUP, JSON.stringify(cache, null, 1));
  return cache;
}

// "FDA decision on giredestrant in combination with everolimus for the treatment of adult with ER-Posit"
// -> indication "ER-positive…" and partner "everolimus". The scraper cuts long text mid-word.
function rttParts(e) {
  let t = (e.indication || '').replace(/^FDA decision (?:on|regarding)\s+/i, '');
  const first = e.drug.split(/\s+(?:plus|with|and)\s+|\s*[+(]/i)[0].trim();
  if (t.toLowerCase().startsWith(first.toLowerCase())) t = t.slice(first.length);
  const pm = t.match(/^\s*(?:in combination with|plus|with|and)\s+([\w-]+(?:\s+[\w-]+)?)\s+(?=for|to|as|in)/i);
  const partner = pm && !/^(the|a|an)$/i.test(pm[1]) ? pm[1] : null;
  if (pm) t = t.slice(pm[0].length);
  t = t.replace(/^\s*(?:for|to treat|as|in)\s+(?:(?:the\s+)?treatment of\s+|a\s+)?(?:(?:adult\s+)?(?:patients|adults?|people)\s+with\s+)?/i, '').trim();
  // "fourth-line treatment for patients with relapsed or refractory multiple myeloma"
  t = t.replace(/^([\w-]+-line)\s+(?:treatment|therapy)\s+(?:for|of|in)\s+(?:(?:adult\s+)?(?:patients|adults?)\s+with\s+)?/i, '$1 ');
  return { indication: t ? t[0].toUpperCase() + t.slice(1) : null, partner };
}

// Indications read from headlines carry headline phrasing; reduce them to the condition.
const titleCase = t => t && !/^[a-z][A-Z]/.test(t) ? t[0].toUpperCase() + t.slice(1) : t;
export function cleanIndication(t) {
  if (!t) return t;
  let x = t.trim().replace(/^the\s+/i, '');
  x = x.replace(/['’]s\s+Potential First\s+(?:Therapy|Treatment)\b.*$/i, '').replace(/^Potential First\s+(?:Therapy|Treatment)\s+for\s+/i, '');
  x = x.replace(/\s+After\s+[\w-]+\s+Amendment$/i, '');
  x = x.replace(/,\s+(?:expanding|marking|making|becoming|the first)\b.*$/i, '');
  x = x.replace(/,\s+(?:an?\s+)?rare\s+[\w\s-]+$/i, '');
  // "Adults, Adolescents with Vitiligo"
  x = x.replace(/^(?:(?:adults?|adolescents?|children|patients)(?:,?\s+(?:and\s+)?)?)+\s*with\s+/i, '');
  // A trial title ("MAPLE-HCM (Metoprolol vs Aficamten in Patients with ... in HCM)") becomes its condition.
  const trial = x.match(/^([A-Z0-9]+-[A-Z0-9-]+)\s+\((.+\s+in\s+([^()]+))\)$/);
  if (trial) x = `${trial[3]} (${trial[1]})`;
  // A bare abbreviation ("PDCD") is spelled out.
  const bare = x.match(/^([A-Za-z0-9-]{2,7})(\s+\(.+\))?$/);
  const full = bare && ABBREV[bare[1].toLowerCase()];
  if (full && full.includes(' ')) x = full.replace(/\bb cell\b/, 'B-cell') + ` (${bare[1]})` + (bare[2] && bare[2] !== `(${bare[1]})` ? ' ' + bare[2].trim() : '');
  return titleCase(x.trim());
}

export async function mergeSources() {
  const pipe = JSON.parse(fs.readFileSync(path.join(ROOT, 'state', 'pipeline.json'), 'utf8'));
  const today = pipe.today;
  const rtt = loadRTTNews().filter(e => e.pdufaDate >= today && !DECIDED_RTT.test(e.status));
  const generics = await brandGenerics(rtt);

  const open = pipe.applications.filter(a => a.confidence === 'high' && (a.status === 'Pending' || a.status === 'Overdue'));
  const used = new Set();
  const rows = [], removed = [], excluded = [];

  // Same drug and date listed under two companies (partners) is one entry.
  const seen = new Set();
  const queue = [];
  for (const e of rtt) {
    const N = rttNames(e);
    for (const g of generics[e.drug.split(/\s+(?:plus|with|and)\s+|\s*[+(]/i)[0].trim()] || []) N.add(cleanName(g));
    const key = `${[...N].sort().join('|')}|${e.pdufaDate}`;
    if (seen.has(key)) continue;
    seen.add(key);

    if (/^ANDA$/i.test(e.submissionType)) { excluded.push({ ...e, reason: 'generic (ANDA)' }); continue; }
    queue.push({ e, N });
  }
  // Exact-date pairs first, so a drug with two filings (giredestrant) pairs each date with its own filing.
  const exact = ({ e, N }) => open.some(a => !used.has(a) && a.pdufaDate && Math.abs(days(e.pdufaDate, a.pdufaDate)) <= 3 && nameMatch(N, appNames({ ...a, partners: [] })));
  queue.sort((x, y) => exact(y) - exact(x));
  for (const { e, N } of queue) {
    const match = a => nameMatch(N, appNames({ ...a, partners: [] }));
    // Already decided per MJH, near this listing's date.
    // A drug can have several filings at once (lenacapavir): the decision must be for this indication.
    const decided = pipe.applications.filter(a => a.decision && a.decision.type !== 'withdrawn' && match(a)
      && days(e.pdufaDate, a.decision.when) >= -240 && a.decision.when <= today
      && (sim(e.indication, a.indication) ?? sim(e.indication, a.decision.title) ?? 0) >= 0.34)
      .sort((x, y) => y.decision.when.localeCompare(x.decision.when))[0];
    const app = open.filter(a => match(a) && !used.has(a))
      .sort((x, y) => Math.abs(days(e.pdufaDate, x.pdufaDate || e.pdufaDate)) - Math.abs(days(e.pdufaDate, y.pdufaDate || e.pdufaDate)))[0];
    if (decided && (!app || decided.decision.when >= (app.events.at(-1)?.published || ''))) {
      removed.push({ drug: e.drug, rttDate: e.pdufaDate, outcome: decided.decision.type, when: decided.decision.when, url: decided.decision.url, title: decided.decision.title });
      continue;
    }

    if (app) {
      used.add(app);
      let pdufa = app.pdufaDate, basis = app.basis, note = null;
      if (app.basis !== 'announced' && !e.isQuarterlyEstimate) { pdufa = e.pdufaDate; basis = 'announced (RTTNews)'; }
      // MJH's date has passed with no decision on record while RTTNews shows a future one: a resubmission MJH didn't connect.
      else if (app.pdufaDate < today && !e.isQuarterlyEstimate) { pdufa = e.pdufaDate; basis = 'announced (RTTNews)'; note = `MJH last reported ${app.pdufaDate}`; }
      else if (app.basis === 'announced' && Math.abs(days(app.pdufaDate, e.pdufaDate)) > 3) note = `RTTNews still lists ${e.pdufaDate}`;
      // RTTNews names the indication of the listing it scheduled; MJH's can be missing or from another filing of the drug.
      const rp = rttParts(e);
      const A = indicationTokens(app.indication), R = indicationTokens(rp.indication);
      const fuller = rp.indication && rp.indication.length <= 110 && A.size && [...A].every(t => R.has(t)) && R.size > A.size;
      const indication = !app.indication || fuller || (rp.indication?.length >= 25 && sim(app.indication, rp.indication) === 0) ? rp.indication || app.indication : app.indication;
      // When the indication came from RTTNews, MJH's partners may belong to the drug's other filing too.
      const base = indication === app.indication ? app.partners : [];
      // RTTNews often names the partner by brand (Tecentriq) where MJH has the generic, so it only fills a gap.
      const partners = rp.partner && !base.length ? [rp.partner] : base;
      rows.push({ ...app, indication, partners, supplemental: /^s(NDA|BLA)/i.test(e.submissionType) || (!e.submissionType && app.supplemental), pdufaDate: pdufa, basis, status: pdufa >= today ? 'Pending' : app.status, origin: 'MJH + RTTNews', rtt: { date: e.pdufaDate, type: e.submissionType, company: e.company, drug: e.drug }, note });
    } else {
      rows.push({
        drug: e.drug, aliases: [...N], partners: [], indication: rttParts(e).indication,
        pdufaDate: e.pdufaDate, basis: e.isQuarterlyEstimate ? 'company guidance (RTTNews quarter)' : 'announced (RTTNews)',
        basisEvidence: null, basisUrl: null, priority: false, status: 'Pending', confidence: 'high', decision: null, priorCRLs: 0,
        supplemental: /^s(NDA|BLA)/i.test(e.submissionType), brands: [], sources: [], events: [],
        origin: 'RTTNews only', rtt: { date: e.pdufaDate, type: e.submissionType, company: e.company, drug: e.drug }, note: null,
      });
    }
  }
  // MJH filings RTTNews doesn't list. Only a filing MJH ran a headline about goes on the main list;
  // one assembled from passing mentions in other stories goes to "signals to verify". Checked against
  // 77 hand-verified rows, this kept 44 of 50 real filings and dropped 19 of 24 bad ones.
  const PRE = new Set(['submitted', 'accepted', 'pdufa', 'extended', 'resubmitted']);
  for (const a of open) if (!used.has(a)) {
    const headline = a.events.some(e => e.where === 'headline' && PRE.has(e.type));
    rows.push({ ...a, origin: 'MJH only', rtt: null, note: null, confidence: headline ? 'high' : 'low' });
  }

  for (const r of rows) {
    // No indication anywhere: the filing sentence often names it ("an NDA for CagriSema for weight management in...").
    if (!r.indication && r.basisEvidence) {
      for (const n of [r.drug, ...(r.aliases || [])]) {
        const m = r.basisEvidence.match(new RegExp(`${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+(?:for|to treat)\\s+(?:the\\s+treatment\\s+of\\s+)?([a-z][\\w'’ -]{3,60}?)(?=\\s+(?:in|on|by|and|was|is)\\s|[,.;])`, 'i'));
        if (m) { r.indication = m[1]; break; }
      }
    }
    r.indication = cleanIndication(r.indication);
    // RTTNews's name wins where MJH's is a fragment of it (PLEX100 for D-PLEX100) or a component of a
    // coined combination name (cagrilintide for CagriSema).
    const rn = r.rtt?.drug?.split(/\s+\(/)[0].trim();
    if (rn && rn.toLowerCase() !== r.drug.toLowerCase()) {
      const a = cleanName(r.drug), b = cleanName(rn);
      if ((b.endsWith(a) && b.length > a.length) || (/^[A-Z][a-z]+[A-Z][a-z]+$/.test(rn) && (r.aliases || []).some(x => cleanName(x) === b))) r.drug = rn;
    }
    // A partner that is the drug under another name (obinutuzumab + Gazyva) is not a partner.
    const own = new Set([r.drug, ...(r.aliases || [])].flatMap(x => x.split(/\s+/)).map(cleanName));
    r.partners = [...new Map((r.partners || []).filter(p => !own.has(cleanName(p))).map(p => [cleanName(p), p])).values()];
  }
  rows.sort((x, y) => (x.pdufaDate || '9999').localeCompare(y.pdufaDate || '9999'));
  const result = { generated: pipe.generated, today, rows, removed, excluded };
  fs.writeFileSync(OUT, JSON.stringify(result, null, 1));
  return result;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const r = await mergeSources();
  const by = {};
  for (const x of r.rows) by[x.origin] = (by[x.origin] || 0) + 1;
  console.log('rows', r.rows.length, by, '| removed as decided', r.removed.length, '| excluded', r.excluded.length);
  for (const x of r.removed) console.log(`  removed ${x.drug} (RTTNews ${x.rttDate}): ${x.outcome} ${x.when} — ${x.title}`);
  for (const x of r.excluded) console.log(`  excluded ${x.drug}: ${x.reason}`);
  for (const x of r.rows.filter(x => x.origin === 'RTTNews only')) console.log(`  RTTNews only: ${x.pdufaDate} ${x.drug} (${x.rtt.type})`);
  for (const x of r.rows.filter(x => x.note)) console.log(`  date: ${x.drug} ${x.pdufaDate} — ${x.note}`);
}
