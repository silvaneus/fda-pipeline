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
// SEC requires a contact email in the User-Agent for document downloads.
const UA = 'MJH Life Sciences Biotech Tracker sinman@mjhlifesciences.com';
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
  const accs = sub.filings?.recent?.accessionNumber || [];
  const formD = forms.map((f, i) => (f === 'D' || f === 'D/A') ? { acc: accs[i], form: f, date: dates[i] } : null).filter(Boolean);
  return {
    found: true,
    formDDates,
    formD,
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

// --- Fundraising amounts (Form D) ---------------------------------------------

function xmlTag(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
  return m ? m[1].replace(/<[^>]+>/g, '').trim() : null;
}

async function getText(url) {
  for (let i = 1; i <= 4; i++) {
    await pace();
    const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30000) }).catch(() => null);
    if (res?.status === 404) return null;
    if (res?.ok) {
      const t = await res.text();
      if (t.includes('<edgarSubmission')) return t;
    }
    await sleep(800 * i);
  }
  throw new Error(`EDGAR document failed: ${url}`);
}

/**
 * Raise amounts from a company's Form D filings. An amendment (D/A) names the
 * filing it updates, so each round is counted once, at its latest reported
 * amount sold. Rounds are dated by their original filing.
 */
async function fetchRaises(cik, formD) {
  const docs = [];
  for (const f of formD.slice(0, 25)) {
    const xml = await getText(`https://www.sec.gov/Archives/edgar/data/${cik}/${f.acc.replace(/-/g, '')}/primary_doc.xml`);
    if (!xml) continue;
    const num = t => { const v = xmlTag(xml, t); return v && /^\d+(\.\d+)?$/.test(v) ? Number(v) : null; };
    docs.push({ acc: f.acc, date: f.date, prev: xmlTag(xml, 'previousAccessionNumber'), sold: num('totalAmountSold'), offered: num('totalOfferingAmount') });
  }
  const byAcc = new Map(docs.map(d => [d.acc, d]));
  const root = d => { const seen = new Set(); while (d.prev && byAcc.has(d.prev) && !seen.has(d.acc)) { seen.add(d.acc); d = byAcc.get(d.prev); } return d; };
  const rounds = new Map();
  for (const d of docs) {
    const r = root(d);
    const cur = rounds.get(r.acc) || { date: r.date, amount: 0, offered: null, updated: d.date };
    // Latest filing in the chain wins; amounts sold only grow within a round.
    if (d.date >= cur.updated || cur.amount === 0) {
      cur.amount = Math.max(cur.amount, d.sold || 0);
      cur.offered = d.offered ?? cur.offered;
      cur.updated = d.date;
    }
    rounds.set(r.acc, cur);
  }
  const list = [...rounds.values()].filter(r => r.amount > 0).sort((a, b) => b.date.localeCompare(a.date))
    .map(({ date, amount, offered }) => ({ date, amount, offered }));
  return { raises: list, totalRaised: list.reduce((n, r) => n + r.amount, 0) };
}

/** Add raise amounts to every SEC match whose Form D list changed since last time. */
async function enrichRaises(names, { log = console.log } = {}) {
  const cache = loadCache();
  const todo = names.filter(n => {
    const c = cache[n];
    if (!c?.found) return false;
    if (!c.formD) return true; // cached before accession numbers were kept
    return c.formD.length && c.raisesFor !== c.formD.map(f => f.acc).join(',');
  });
  log(`  Form D amounts: ${todo.length} companies to fetch`);
  let done = 0;
  const queue = [...todo];
  const worker = async () => {
    for (let n; (n = queue.shift()) !== undefined;) {
      const c = cache[n];
      try {
        if (!c.formD) Object.assign(c, await lookup(n));
        if (c.found && c.formD?.length) {
          Object.assign(c, await fetchRaises(c.cik, c.formD), { raisesFor: c.formD.map(f => f.acc).join(',') });
        }
      } catch (e) {
        log(`  Form D skip ${n}: ${e.message}`);
      }
      if (++done % 100 === 0) {
        log(`  Form D ${done}/${todo.length}`);
        fs.writeFileSync(CACHE_FILE, JSON.stringify(cache));
      }
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
  fs.writeFileSync(CACHE_FILE, JSON.stringify(cache));
  return cache;
}

// --- Executive officers and directors (Form D "related persons") -------------

// Filers often type names in capitals ("JOHN A. SMITH"); only those get recased.
const recase = s => s && s === s.toUpperCase() && /[A-Z]{2}/.test(s)
  ? s.toLowerCase().replace(/(^|[\s'-])([a-z])/g, (m, p, c) => p + c.toUpperCase()).replace(/\bMc([a-z])/g, (m, c) => 'Mc' + c.toUpperCase())
  : s;

/** People named in one Form D: executive officers, directors and promoters. */
function parsePeople(xml) {
  return [...xml.matchAll(/<relatedPersonInfo>([\s\S]*?)<\/relatedPersonInfo>/g)].map(([, b]) => {
    // Full middle names ("Karun Durgam Naga") read oddly; keep an initial.
    const mid = (xmlTag(b, 'middleName') || '').replace(/\W/g, '')[0];
    const name = [xmlTag(b, 'firstName'), mid && !/^n\/?a$/i.test(xmlTag(b, 'middleName')) ? mid + '.' : null, xmlTag(b, 'lastName')].filter(Boolean).map(recase).join(' ');
    const roles = [...b.matchAll(/<relationship>([^<]+)<\/relationship>/g)].map(m => m[1].trim());
    return { name, roles, note: xmlTag(b, 'relationshipClarification') || undefined };
  }).filter(p => p.name && !/^(n\/?a|none)$/i.test(p.name));
}

/**
 * Leadership from each company's most recent Form D. Refetched only when a
 * newer filing appears, so after the first run this costs a few requests.
 */
async function enrichPeople(names, { log = console.log } = {}) {
  const cache = loadCache();
  const todo = names.filter(n => { const c = cache[n]; return c?.found && c.formD?.length && c.peopleFor !== c.formD[0].acc; });
  log(`  Form D people: ${todo.length} companies to fetch`);
  let done = 0;
  const queue = [...todo];
  const worker = async () => {
    for (let n; (n = queue.shift()) !== undefined;) {
      const c = cache[n], f = c.formD[0];
      try {
        const xml = await getText(`https://www.sec.gov/Archives/edgar/data/${c.cik}/${f.acc.replace(/-/g, '')}/primary_doc.xml`);
        c.people = xml ? parsePeople(xml) : [];
        c.peopleDate = f.date;
        c.peopleFor = f.acc;
      } catch (e) {
        log(`  Form D people skip ${n}: ${e.message}`);
      }
      if (++done % 200 === 0) {
        log(`  Form D people ${done}/${todo.length}`);
        fs.writeFileSync(CACHE_FILE, JSON.stringify(cache));
      }
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
  fs.writeFileSync(CACHE_FILE, JSON.stringify(cache));
  return cache;
}

module.exports = { enrich, enrichRaises, enrichPeople, lookup, loadCache, fetchRaises, parsePeople };
