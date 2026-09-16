/**
 * mjh-news.js
 *
 * Reads the MJH brand network's own RSS feeds.
 *
 * Two jobs:
 *
 *  1. Speed. openFDA lags one to three weeks — the Skyclarys pediatric approval
 *     was six days old and still absent from drugsfda. Trade press publishes the
 *     same day. News is the fast signal; openFDA is the confirming one.
 *
 *  2. Reducing single-source risk. The pipeline's calendar came from one scraped
 *     site. These are first-party feeds across sixteen brands, and they already
 *     cover the therapeutic areas the pipeline tracks.
 *
 * Each feed carries only ~30 items (two or three days), so results accumulate
 * into a rolling cache. One missed nightly run then costs nothing.
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

// Tracked and committed by the nightly workflow. Each feed holds only ~30
// items (two or three days), so the rolling window only exists if it survives
// between runs — in CI that means it must be in git, not in gitignored data/.
const STATE_DIR = path.join(__dirname, 'state');
const NEWS_CACHE = path.join(STATE_DIR, 'mjh-news.json');
const RETENTION_DAYS = 45;

// Brands whose coverage overlaps the drug-approval calendar.
const BRANDS = [
  ['onclive', 'OncLive'],
  ['cancernetwork', 'CancerNetwork'],
  ['targetedonc', 'Targeted Oncology'],
  ['neurologylive', 'NeurologyLive'],
  ['hcplive', 'HCPLive'],
  ['contagionlive', 'Contagion Live'],
  ['ajmc', 'AJMC'],
  ['pharmacytimes', 'Pharmacy Times'],
  ['drugtopics', 'Drug Topics'],
  ['urologytimes', 'Urology Times'],
  ['dermatologytimes', 'Dermatology Times'],
  ['ophthalmologytimes', 'Ophthalmology Times'],
  ['contemporarypediatrics', 'Contemporary Pediatrics'],
  ['medicaleconomics', 'Medical Economics'],
  ['managedhealthcareexecutive', 'Managed Healthcare Executive'],
  ['chiefhealthcareexecutive', 'Chief Healthcare Executive'],
];

function fetchText(url, redirects = 0) {
  return new Promise((resolve) => {
    const req = https.get(
      url,
      { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; FDA-Pipeline/2.0)' } },
      (res) => {
        if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location && redirects < 3) {
          res.resume();
          const next = new URL(res.headers.location, url);
          // The feeds redirect http->https on some hosts; force https.
          next.protocol = 'https:';
          return resolve(fetchText(next.href, redirects + 1));
        }
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => resolve(res.statusCode === 200 ? body : ''));
      }
    );
    req.on('error', () => resolve(''));
    req.setTimeout(20000, () => { req.destroy(); resolve(''); });
  });
}

/** Feed titles arrive CDATA-wrapped, sometimes double-escaped. */
function decode(s) {
  return String(s || '')
    .replace(/&lt;!\[CDATA\[([\s\S]*?)\]\]&gt;/g, '$1')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;|&apos;|&rsquo;/g, "'")
    .replace(/&nbsp;/g, ' ').replace(/&#\d+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseFeed(xml, brandLabel) {
  const items = [];
  const blocks = xml.match(/<item\b[\s\S]*?<\/item>/g) || [];
  for (const b of blocks) {
    const pick = (tag) => {
      const m = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`).exec(b);
      return m ? decode(m[1]) : '';
    };
    const title = pick('title');
    if (!title) continue;
    const pub = pick('pubDate');
    const ts = pub ? new Date(pub) : null;
    items.push({
      brand: brandLabel,
      title,
      link: pick('link'),
      description: pick('description').slice(0, 500),
      published: ts && !isNaN(ts) ? ts.toISOString().slice(0, 10) : null,
    });
  }
  return items;
}

/* --------------------------------------------------------------- caching --- */

function loadCache() {
  try { return JSON.parse(fs.readFileSync(NEWS_CACHE, 'utf8')); }
  catch { return { items: [], updatedAt: null }; }
}

function saveCache(items) {
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    fs.writeFileSync(NEWS_CACHE, JSON.stringify({ items, updatedAt: new Date().toISOString() }, null, 1));
  } catch (e) {
    console.log(`  Warning: could not write news cache: ${e.message}`);
  }
}

/**
 * Fetch every brand feed and merge into the rolling cache.
 * Deduplicates on article link.
 */
async function fetchMJHNews({ verbose = false } = {}) {
  const fresh = [];
  const failed = [];

  // Small concurrency: polite to the origin, still finishes in seconds.
  const queue = [...BRANDS];
  const workers = Array.from({ length: 4 }, async () => {
    while (queue.length) {
      const [slug, label] = queue.shift();
      const xml = await fetchText(`https://www.${slug}.com/rss.xml`);
      if (!xml) { failed.push(label); continue; }
      fresh.push(...parseFeed(xml, label));
    }
  });
  await Promise.all(workers);

  const cache = loadCache();
  const byLink = new Map();
  for (const it of [...cache.items, ...fresh]) {
    if (it.link) byLink.set(it.link, it);
  }

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - RETENTION_DAYS);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  const items = [...byLink.values()]
    .filter((i) => !i.published || i.published >= cutoffStr)
    .sort((a, b) => String(b.published).localeCompare(String(a.published)));

  saveCache(items);

  if (verbose) {
    console.log(
      `  MJH news: ${fresh.length} fetched from ${BRANDS.length - failed.length}/${BRANDS.length} brands, ` +
      `${items.length} in ${RETENTION_DAYS}-day window` +
      (failed.length ? ` (no response: ${failed.join(', ')})` : '')
    );
  }
  return items;
}

/* -------------------------------------------------------------- matching --- */

const APPROVAL_RE =
  /\b(FDA approves|approved by the FDA|receives? (?:FDA )?approval|wins? (?:FDA )?approval|gains? (?:FDA )?approval|grants? (?:full |traditional |accelerated )?approval|earns? (?:FDA )?approval|approval (?:is )?granted|greenlights?|clears?)\b/i;

const CRL_RE =
  /\b(complete response letter|CRL\b|FDA rejects|rejected by the FDA|declines? to approve|does not approve|refuse to file|refusal to file)\b/i;

const DELAY_RE = /\b(extends? (?:the )?review|PDUFA (?:date )?(?:is )?extended|delays? (?:the )?decision|three-month extension)\b/i;

// Connector and dosage-form words that appear in drug names but identify
// nothing. Without these, "Bictegravir Plus Lenacapavir" matches any headline
// containing "plus".
const NAME_NOISE = new Set([
  'PLUS', 'WITH', 'COMBO', 'COMBINATION', 'ORAL', 'INJECTION', 'INJECTABLE',
  'TABLET', 'TABLETS', 'CAPSULE', 'CAPSULES', 'SOLUTION', 'SUSPENSION', 'CREAM',
  'GEL', 'OINTMENT', 'SPRAY', 'PATCH', 'INFUSION', 'SUBCUTANEOUS', 'INTRAVENOUS',
  'EXTENDED', 'RELEASE', 'DELAYED', 'IMMEDIATE', 'FIXED', 'DOSE', 'DOSING',
  'THERAPY', 'TREATMENT', 'REGIMEN', 'VACCINE', 'TEST', 'BLOOD', 'CANCER',
  'EARLY', 'DETECTION', 'MULTI', 'ACID', 'SODIUM', 'HYDROCHLORIDE', 'SULFATE',
]);

function tokens(s) {
  return String(s || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 5 && !NAME_NOISE.has(t) && !/^\d+$/.test(t));
}

/**
 * Articles that plausibly concern this catalyst.
 * Requires a drug or brand name hit — company alone is too loose, since a big
 * sponsor is named in dozens of unrelated stories a week.
 */
function findCoverage(catalyst, items, { sinceDays = 45 } = {}) {
  const names = [catalyst.drug, catalyst.brandName].filter(Boolean);
  const wanted = [...new Set(names.flatMap(tokens))];
  if (!wanted.length) return [];

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - sinceDays);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  return items.filter((it) => {
    if (it.published && it.published < cutoffStr) return false;
    const hay = `${it.title} ${it.description}`.toUpperCase();
    return wanted.some((w) => hay.includes(w));
  });
}

/**
 * Read an outcome out of MJH coverage: approved, CRL, delayed, or nothing.
 * The headline carries the verdict; the description is only supporting text.
 */
function detectOutcome(catalyst, items, opts = {}) {
  const coverage = findCoverage(catalyst, items, opts);
  if (!coverage.length) return null;

  const scan = (re, kind) => {
    const hit = coverage.find((c) => re.test(c.title)) || coverage.find((c) => re.test(c.description));
    if (!hit) return null;
    return {
      outcome: kind,
      title: hit.title,
      url: hit.link,
      brand: hit.brand,
      published: hit.published,
      confidence: re.test(hit.title) ? 'high' : 'medium',
    };
  };

  // CRL first: "X receives CRL" would otherwise trip the approval pattern on
  // phrases like "approval decision".
  return scan(CRL_RE, 'crl') || scan(APPROVAL_RE, 'approved') || scan(DELAY_RE, 'delayed') || null;
}

module.exports = { fetchMJHNews, findCoverage, detectOutcome, BRANDS };
