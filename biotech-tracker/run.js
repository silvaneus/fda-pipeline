/**
 * Nightly pipeline: pull every industry interventional study from
 * ClinicalTrials.gov, derive company histories, add SEC EDGAR headquarters,
 * and write the dashboard.
 *
 *   node run.js            full run (~2 min plus any new EDGAR lookups)
 *   node run.js --cached   reuse data/all-industry.json from the last pull
 *   node run.js --no-sec   use only already-cached SEC lookups (fast preview)
 */

const fs = require('fs');
const path = require('path');
const { fetchStudies } = require('./ctgov');
const { buildViews } = require('./analyze');
const { enrich, loadCache } = require('./edgar');
const { inferNonUS } = require('./sponsors');
const { renderDashboard } = require('./render');

const DATA_FILE = path.join(__dirname, 'data', 'all-industry.json');
const OVERRIDES_FILE = path.join(__dirname, 'state', 'overrides.json');
const OUT_FILE = path.join(__dirname, 'reports', 'index.html');

function hqFor(name, edgar, overrides) {
  const o = overrides.hq?.[name];
  if (o) return { ...o, source: 'manual' };
  const e = edgar[name];
  if (e?.found) {
    return {
      us: e.us, place: e.us ? `${e.city}, ${e.state}` : null, source: 'sec',
      public: e.tickers.length > 0, ticker: e.tickers[0] || null, lastFormD: e.lastFormD, cik: e.cik,
    };
  }
  return { us: inferNonUS(name) ? false : null, place: null, source: inferNonUS(name) ? 'name' : null };
}

async function main() {
  const cached = process.argv.includes('--cached');
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
  for (const k of ['newCompanies', 'newToP2', 'directory']) views[k] = views[k].filter(c => !exclude.has(c.name));
  views.p2Starts = views.p2Starts.filter(s => !exclude.has(s.company));

  const names = [...new Set([
    ...views.newCompanies, ...views.newToP2, ...views.directory,
  ].map(c => c.name).concat(views.p2Starts.map(s => s.company)))];
  const edgar = process.argv.includes('--no-sec') ? loadCache() : await enrich(names);

  const attach = (c, name) => { c.hq = hqFor(name, edgar, overrides); };
  for (const k of ['newCompanies', 'newToP2', 'directory']) views[k].forEach(c => attach(c, c.name));
  views.p2Starts.forEach(s => attach(s, s.company));

  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, renderDashboard(views, { generated: new Date().toISOString(), studyCount: studies.length }));
  console.log(`Wrote ${OUT_FILE}: ${views.newCompanies.length} new, ${views.newToP2.length} new to P2, ` +
    `${views.p2Starts.length} P2 starts, ${views.directory.length} in directory (${Math.round((Date.now() - t0) / 1000)}s)`);
}

main().catch(e => { console.error(e); process.exit(1); });
