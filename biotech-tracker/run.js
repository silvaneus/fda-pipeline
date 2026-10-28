/**
 * Nightly pipeline: pull every industry interventional study from
 * ClinicalTrials.gov, derive company histories, locate headquarters, and
 * write the dashboard plus per-company profiles.
 *
 *   node run.js            full run (~2 min plus any new lookups)
 *   node run.js --cached   reuse data/all-industry.json from the last pull
 *   node run.js --no-sec   use only already-cached SEC/GLEIF lookups (fast preview)
 */

const fs = require('fs');
const path = require('path');
const { fetchStudies } = require('./ctgov');
const { buildViews, buildProfile } = require('./analyze');
const edgar = require('./edgar');
const locate = require('./locate');
const fda = require('./fda');
const { inferNonUS } = require('./sponsors');
const { renderDashboard, renderProfiles, renderSearch } = require('./render');

const DATA_FILE = path.join(__dirname, 'data', 'all-industry.json');
const OVERRIDES_FILE = path.join(__dirname, 'state', 'overrides.json');
const OUT_DIR = path.join(__dirname, 'reports');
const MARKETED_FILE = path.join(__dirname, 'state', 'marketed.json');

/**
 * Companies with a marketed drug: an FDA approval (Drugs@FDA, see fda.js) or
 * any Phase 4 trial (post-marketing, which also covers drugs sold only abroad
 * and CBER-licensed products missing from Drugs@FDA). If the FDA download
 * fails, the last good result is reused so graduated companies don't all
 * reappear for a night.
 */
async function findMarketed(companies, overrides) {
  let byCore = null;
  try { byCore = await fda.loadApprovals(); } catch (e) { console.log(`  ${e.message}; reusing last FDA match`); }
  const last = (() => { try { return JSON.parse(fs.readFileSync(MARKETED_FILE, 'utf8')); } catch { return {}; } })();
  const force = new Set(overrides.marketed || []);
  const deny = new Set(overrides.notMarketed || []);
  const out = {};
  for (const c of companies) {
    const approvals = byCore
      ? fda.approvalsFor([...c.names.keys()], byCore, c.studies.flatMap(s => [...s.interventions, s.title]).join(' '))
          // One line per brand, dated by its first approval.
          .filter((a, i, all) => all.findLastIndex(b => (b.brand || b.app) === (a.brand || a.app)) === i)
          .slice(0, 3).map(({ brand, date, app, status }) => ({ brand, date, app, status }))
      : (last[c.key]?.approvals || []);
    const phase4 = c.studies.filter(s => s.phases.includes('PHASE4')).length;
    if (deny.has(c.name)) continue;
    if (approvals.length || phase4 || force.has(c.name)) out[c.key] = { approvals, phase4, manual: force.has(c.name) };
  }
  fs.writeFileSync(MARKETED_FILE, JSON.stringify(out));
  return out;
}

/**
 * Form D is filed within 15 days of a round's first sale, so "amount sold"
 * is often only the first tranche (TwoStep: $62.2M Series A, $21.1M sold at
 * filing). Companies rarely amend as later tranches close. The round size
 * ("total offering amount") is what press releases report, so it is the
 * headline; amount sold is kept for the profile. Indefinite size -> sold.
 */
function roundSizes(raises) {
  const list = raises.map(r => ({ date: r.date, amount: Math.max(r.offered || 0, r.amount), sold: r.amount }));
  return { raises: list.slice(0, 10), totalRaised: list.reduce((n, r) => n + r.amount, 0) };
}

/**
 * Best available headquarters, strongest source first:
 * manual override > SEC EDGAR > GLEIF > trial contact (own domain) > legal form in the name.
 */
function resolveHq(company, sec, gleif, overrides) {
  const contacts = company.studies.flatMap(s => s.contacts || []);
  const fromContacts = locate.fromContacts(contacts, [...company.names.keys()]);
  const base = { website: fromContacts.website || null };
  const o = overrides.hq?.[company.name];
  if (o) return { ...base, ...o, source: 'manual' };

  const e = sec[company.name];
  const secInfo = e?.found ? {
    public: e.tickers.length > 0, ticker: e.tickers[0] || null, cik: e.cik,
    lastFormD: e.lastFormD, formDDates: (e.formDDates || []).slice(0, 8),
    ...roundSizes(e.raises || []),
  } : {};
  if (e?.found) {
    return { ...base, ...secInfo, us: e.us, country: e.country, source: 'sec',
      place: e.us ? `${e.city}, ${e.state}` : (e.country || null) };
  }
  const g = locate.fromGleif(gleif[company.name]);
  if (g) return { ...base, ...g, source: 'gleif' };
  if (fromContacts.country) {
    return { ...base, us: fromContacts.us, country: fromContacts.country, place: fromContacts.place, source: 'contact', via: fromContacts.via };
  }
  if (inferNonUS(company.name)) return { ...base, us: false, place: null, source: 'name' };
  return { ...base, us: null, place: null, source: null };
}

async function main() {
  const cached = process.argv.includes('--cached');
  const lookups = !process.argv.includes('--no-sec');
  const t0 = Date.now();
  let studies;
  if (cached && fs.existsSync(DATA_FILE)) {
    studies = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    console.log(`Loaded ${studies.length} cached studies`);
  } else {
    console.log('Fetching industry interventional studies from ClinicalTrials.gov...');
    studies = await fetchStudies('AREA[LeadSponsorClass]INDUSTRY AND AREA[StudyType]INTERVENTIONAL');
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(studies));
    console.log(`  ${studies.length} studies in ${Math.round((Date.now() - t0) / 1000)}s`);
  }
  // A full pull far below the known total means a truncated response, not a
  // quiet night; publishing it would wipe companies off the dashboard.
  if (studies.length < 100000) throw new Error(`Only ${studies.length} studies; refusing to publish`);

  const overrides = fs.existsSync(OVERRIDES_FILE) ? JSON.parse(fs.readFileSync(OVERRIDES_FILE, 'utf8')) : {};
  const exclude = new Set(overrides.exclude || []);
  const views = buildViews(studies);
  const { companies } = views;
  delete views.companies;
  for (const k of ['newCompanies', 'newToP2', 'directory']) views[k] = views[k].filter(c => !exclude.has(c.name));
  views.p2Starts = views.p2Starts.filter(s => !exclude.has(s.company));

  const keys = new Set([...views.newCompanies, ...views.newToP2, ...views.directory].map(c => c.key)
    .concat(views.p2Starts.map(s => s.companyKey)));
  const shown = [...keys].map(k => companies.get(k));
  const names = shown.map(c => c.name);

  if (lookups) await edgar.enrich(names);
  const sec = lookups ? await edgar.enrichRaises(names) : edgar.loadCache();
  // GLEIF is slow (~1 request/s) and rarely knows small private biotechs, so
  // ask it only about companies neither SEC nor the trial contacts could place.
  const gleifNames = shown.filter(c => !sec[c.name]?.found && !overrides.hq?.[c.name] &&
    !locate.fromContacts(c.studies.flatMap(s => s.contacts || []), [...c.names.keys()]).country).map(c => c.name);
  const gleif = lookups ? await locate.enrichGleif(gleifNames) : (() => { try { return require('./state/gleif.json'); } catch { return {}; } })();

  const hq = new Map(shown.map(c => [c.key, resolveHq(c, sec, gleif, overrides)]));
  const marketed = await findMarketed(shown, overrides);
  for (const k of ['newCompanies', 'newToP2', 'directory']) views[k].forEach(c => { c.marketed = marketed[c.key] || null; });
  console.log(`  Marketed drug: ${views.directory.filter(c => c.marketed).length} of ${views.directory.length} directory companies`);
  for (const k of ['newCompanies', 'newToP2', 'directory']) views[k].forEach(c => { c.hq = hq.get(c.key); });
  views.p2Starts.forEach(s => { s.hq = hq.get(s.companyKey); });

  const profiles = {};
  for (const c of shown) profiles[c.key] = { ...buildProfile(c), hq: hq.get(c.key), marketed: marketed[c.key] || null };

  const sources = {};
  for (const h of hq.values()) sources[h.source || 'unknown'] = (sources[h.source || 'unknown'] || 0) + 1;
  console.log('  HQ sources:', JSON.stringify(sources));

  const meta = { generated: new Date().toISOString(), studyCount: studies.length };
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, 'index.html'), renderDashboard(views, meta));
  fs.writeFileSync(path.join(OUT_DIR, 'profiles.js'), renderProfiles(profiles));
  // Full-text search over official titles, loaded on first search.
  const search = {};
  for (const c of shown) search[c.key] = [...new Set(c.live.map(s => s.officialTitle).filter(Boolean))].join(' | ').toLowerCase();
  fs.writeFileSync(path.join(OUT_DIR, 'search.js'), renderSearch(search));
  console.log(`Wrote reports/: ${views.newCompanies.length} new, ${views.newToP2.length} new to P2, ` +
    `${views.p2Starts.length} P2 starts, ${views.directory.length} in directory, ${shown.length} profiles ` +
    `(${Math.round((Date.now() - t0) / 1000)}s)`);
}

main().catch(e => { console.error(e); process.exit(1); });
