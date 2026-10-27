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

// SEC fair access: at most 10 requests/s across all workers. Space request
// starts 125 ms apart no matter how many lookups run at once.
let nextSlot = 0;
async function pace() {
  const now = Date.now();
  const wait = Math.max(0, nextSlot - now);
  nextSlot = Math.max(now, nextSlot) + 125;
  if (wait) await sleep(wait);
}

async function getJson(url) {
  for (let i = 1; i <= 4; i++) {
    await pace();
    const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30000) }).catch(() => null);
    if (res?.status === 404) return null;
    if (res?.ok) {
      const j = await res.json().catch(() => null);
      if (j && !j.errorType) return j; // error bodies arrive with a 200
    }
    await sleep(800 * i); // EDGAR answers bursts with 429/500
  }
  throw new Error(`EDGAR failed: ${url}`);
}

function loadCache() {
  try { return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')); } catch { return {}; }
}

async function lookup(sponsorName) {
  const name = splitParent(sponsorName).name;
  const want = normalize(name);
  const ascii = name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[,.]/g, ' ').replace(/\s+/g, ' ').trim();
  // EDGAR search sometimes fails for one exact query string while close
  // variants work (seen: "Lexeo Therapeutics"), so fall back to rephrasings.
  // Every query failing throws, so the name is retried next run rather than
  // cached as "not found".
  const queries = [...new Set([ascii, `${ascii} Inc`, ascii.split(' ').slice(0, 2).join(' '), ascii.split(' ')[0]])];
  let hits = null;
  for (const q of queries) {
    try {
      hits = (await getJson(`https://efts.sec.gov/LATEST/search-index?keysTyped=${encodeURIComponent(q)}`)).hits.hits;
      if (hits.some(h => normalize(h._source.entity.replace(/\([A-Z.\-, ]+\)\s*$/, '')) === want)) break;
    } catch { /* try the next phrasing */ }
  }
  if (!hits) throw new Error(`EDGAR search failed for ${name}`);
  const hit = hits.find(h => normalize(h._source.entity.replace(/\([A-Z.\-, ]+\)\s*$/, '')) === want);
  if (!hit) return { found: false };
  const sub = await getJson(`https://data.sec.gov/submissions/CIK${String(hit._id).padStart(10, '0')}.json`);
  if (!sub) return { found: false };
  const a = sub.addresses?.business || {};
  const forms = sub.filings?.recent?.form || [];
  const dates = sub.filings?.recent?.filingDate || [];
  const lastD = forms.findIndex(f => f === 'D' || f === 'D/A');
  const formDDates = forms.map((f, i) => f === 'D' ? dates[i] : null).filter(Boolean);
  return {
    found: true,
    formDDates,
    cik: Number(hit._id),
    edgarName: sub.name,
    city: a.city ? a.city.replace(/\w\S*/g, w => w[0] + w.slice(1).toLowerCase()) : null,
    state: a.stateOrCountry || null,
    us: US_STATES.has(a.stateOrCountry),
    country: US_STATES.has(a.stateOrCountry) ? 'United States' : (a.stateOrCountryDescription || null),
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
  const queue = [...todo];
  const worker = async () => {
    for (let n; (n = queue.shift()) !== undefined;) {
      try {
        cache[n] = { ...(await lookup(n)), checked: new Date().toISOString().slice(0, 10) };
      } catch (e) {
        log(`  EDGAR skip ${n}: ${e.message}`);
      }
      if (++done % 200 === 0) {
        log(`  EDGAR ${done}/${todo.length}`);
        fs.writeFileSync(CACHE_FILE, JSON.stringify(cache));
      }
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
  fs.writeFileSync(CACHE_FILE, JSON.stringify(cache));
  return cache;
}

module.exports = { enrich, lookup, loadCache };
