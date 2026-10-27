/**
 * SEC EDGAR lookup for sponsor headquarters. ClinicalTrials.gov has no sponsor
 * address, but most US biotechs, private ones included, file a Form D when
 * they raise money, and that record carries the business address.
 *
 * Matching is exact on the normalized name: generic words like
 * "Therapeutics" make fuzzy matching pick the wrong company.
 */

const fs = require('fs');
const path = require('path');
const { normalize, splitParent } = require('./sponsors');

const CACHE_FILE = path.join(__dirname, 'state', 'edgar.json');
const UA = 'MJH Life Sciences biotech tracker (research use)';
const MISS_RECHECK_DAYS = 30;
const US_STATES = new Set('AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA PR RI SC SD TN TX UT VT VA WA WV WI WY'.split(' '));

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function getJson(url) {
  for (let i = 1; i <= 4; i++) {
    const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30000) }).catch(() => null);
    if (res?.ok) return res.json();
    if (res?.status === 404) return null;
    await sleep(1500 * i); // EDGAR answers bursts with 429/500
  }
  throw new Error(`EDGAR failed: ${url}`);
}

function loadCache() {
  try { return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')); } catch { return {}; }
}

async function lookup(sponsorName) {
  const name = splitParent(sponsorName).name;
  const want = normalize(name);
  const q = encodeURIComponent(name.replace(/[,.]/g, ' ').replace(/\s+/g, ' ').trim());
  const hits = (await getJson(`https://efts.sec.gov/LATEST/search-index?keysTyped=${q}`))?.hits?.hits || [];
  const hit = hits.find(h => normalize(h._source.entity.replace(/\([A-Z.\-, ]+\)\s*$/, '')) === want);
  if (!hit) return { found: false };
  await sleep(120);
  const sub = await getJson(`https://data.sec.gov/submissions/CIK${String(hit._id).padStart(10, '0')}.json`);
  if (!sub) return { found: false };
  const a = sub.addresses?.business || {};
  const forms = sub.filings?.recent?.form || [];
  const dates = sub.filings?.recent?.filingDate || [];
  const lastD = forms.findIndex(f => f === 'D' || f === 'D/A');
  return {
    found: true,
    cik: Number(hit._id),
    edgarName: sub.name,
    city: a.city ? a.city.replace(/\w\S*/g, w => w[0] + w.slice(1).toLowerCase()) : null,
    state: a.stateOrCountry || null,
    us: US_STATES.has(a.stateOrCountry),
    tickers: sub.tickers || [],
    lastFormD: lastD >= 0 ? dates[lastD] : null,
  };
}

/** Look up every name not already cached; returns the full cache. */
async function enrich(names, { log = console.log } = {}) {
  const cache = loadCache();
  const now = Date.now();
  const todo = names.filter(n => {
    const c = cache[n];
    if (!c) return true;
    return !c.found && now - new Date(c.checked) > MISS_RECHECK_DAYS * 864e5;
  });
  log(`  EDGAR: ${names.length - todo.length} cached, ${todo.length} to look up`);
  let done = 0;
  for (const n of todo) {
    try {
      cache[n] = { ...(await lookup(n)), checked: new Date().toISOString().slice(0, 10) };
    } catch (e) {
      log(`  EDGAR skip ${n}: ${e.message}`);
    }
    if (++done % 100 === 0) {
      log(`  EDGAR ${done}/${todo.length}`);
      fs.writeFileSync(CACHE_FILE, JSON.stringify(cache));
    }
    await sleep(120); // SEC fair-access limit is 10 req/s
  }
  fs.writeFileSync(CACHE_FILE, JSON.stringify(cache));
  return cache;
}

module.exports = { enrich, lookup, loadCache };
