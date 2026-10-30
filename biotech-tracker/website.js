/**
 * Company websites for sponsors whose trial contacts don't give one away.
 * Tries the usual biotech domain patterns built from the name
 * (sirenbiotechnology.com, arunabio.com, ratiotx.com) and keeps a hit only
 * when the page itself names the company and reads like a drug developer.
 *
 * A guess is a weaker source than a trial contact on the company's own
 * domain; the weekly leadership check confirms or replaces it.
 * Results are cached in state/websites.json; misses are retried after 60 days.
 */

const fs = require('fs');
const path = require('path');
const { splitParent } = require('./sponsors');

const CACHE_FILE = path.join(__dirname, 'state', 'websites.json');
const MISS_RECHECK_DAYS = 60;
const MAX_PER_RUN = 600; // the first run has ~1,100 to try; spread it over two nights
const UA = { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36' };

const LEGAL = /\b(inc|incorporated|llc|ltd|limited|corp|corporation|co|company|plc|gmbh|ag|sa|sas|bv|nv|pty|lp|the)\b\.?/gi;
// Words a company often drops from its domain (Revolution Medicines -> revmed is out of reach, but Aruna Bio -> arunabio is not).
const GENERIC = /^(therapeutics|therapeutic|pharmaceuticals|pharmaceutical|pharma|biosciences|bioscience|biotherapeutics|biotechnology|biotech|biologics|medicines|medical|oncology|biopharma|biopharmaceuticals|sciences|health|holdings|labs|laboratories|bio|technologies|group)$/;
// Pages that answer but aren't a company site.
const PARKED = /domain (is |may be )?for sale|buy this domain|this domain|parked|hugedomains|godaddy|sedo|dan\.com|under construction|account suspended|default web site page|website coming soon/i;
// A drug developer's homepage uses at least two of these.
const BIOTECH = /\b(pipeline|clinical|patients?|diseases?|therap(y|ies)|drugs?|biotech\w*|pharmaceutical|trials?|molecules?|cancers?|oncology|antibod(y|ies)|gene|cell|treatment|medicines?)\b/gi;

function loadCache() {
  try { return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')); } catch { return {}; }
}

function words(name) {
  return splitParent(name).name.replace(/\(.*?\)/g, ' ').replace(/,.*$/, '').replace(LEGAL, ' ')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
}

/** Candidate domains, most likely first. */
function candidates(name) {
  const w = words(name);
  if (!w.length) return { domains: [], core: [] };
  const core = w.filter(x => !GENERIC.test(x));
  const full = w.join(''), short = core.join('');
  const set = new Set([full + '.com']);
  if (short && short !== full) set.add(short + '.com');
  if (short) for (const d of [short + 'bio.com', short + '.bio', short + 'tx.com', short + 'rx.com', short + 'therapeutics.com', short + 'pharma.com']) set.add(d);
  // Two-character names (x4.com) are almost always someone else's.
  return { domains: [...set].filter(d => d.length > 6), core: core.length ? core : w, full };
}

// A domain is the company's own when one label is its name, or its
// distinctive words plus a usual suffix (ratiotx, eileanther, lagunabio).
const SUFFIX = /^(|tx|rx|bio|ther|thera|therapeutics|pharma|pharmaceuticals|biosciences|bioscience|biotech|biologics|medicines|inc|labs|health|oncology|neuro|usa|us)$/;
function ownDomain(host, core, full) {
  const c = core.join('');
  return host.split('.').some(l => { l = l.replace(/[^a-z0-9]/g, ''); return l === full || (l.startsWith(c) && SUFFIX.test(l.slice(c.length))); });
}

async function check(domain, core, full = core.join('')) {
  let res;
  try {
    res = await fetch('https://' + domain, { headers: UA, redirect: 'follow', signal: AbortSignal.timeout(10000) });
  } catch { return null; }
  if (!res.ok) return null;
  const html = (await res.text().catch(() => '')).slice(0, 400000);
  const host = new URL(res.url).hostname.replace(/^www\./, '');
  const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '') + ' ' +
    (html.match(/<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)/i)?.[1] || '');
  const text = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ');
  const squash = s => s.toLowerCase().replace(/&amp;/g, '&').replace(/[^a-z0-9]/g, '');
  // Redirected off to some other company (Fulcrum Therapeutics -> Fulcrum Genomics) or a domain marketplace.
  if (!ownDomain(host, core, full)) return null;
  if (PARKED.test(title) || PARKED.test(text.slice(0, 5000))) return null;
  // The company's own name must be in the page title (or site name), not just somewhere in the text.
  if (!squash(title).includes(core.join(''))) return null;
  // A bare short domain (prescient.com, juno.bio) is often another firm with
  // the same word; there the page must carry the full name somewhere
  // (usually the copyright line: "© Aquestive Therapeutics").
  const label = host.split('.').find(l => l.replace(/[^a-z0-9]/g, '').startsWith(core.join(''))) || '';
  if (full !== core.join('') && label.replace(/[^a-z0-9]/g, '') === core.join('') && !squash(title + ' ' + text).includes(full)) return null;
  const terms = new Set((text.match(BIOTECH) || []).map(t => t.toLowerCase().replace(/s$/, '')));
  if (terms.size < 3) return null;
  return host;
}

/**
 * Guess websites for these sponsors (display names) and return the whole
 * cache: { name: { website|null, checked } }.
 */
async function enrich(names, { log = console.log } = {}) {
  const cache = loadCache();
  const now = Date.now();
  const due = names.filter(n => {
    const c = cache[n];
    return !c || (!c.website && now - new Date(c.checked) > MISS_RECHECK_DAYS * 864e5);
  });
  const todo = due.slice(0, MAX_PER_RUN);
  log(`  Website guesses: ${names.length - due.length} cached, ${todo.length} to try` + (due.length > todo.length ? `, ${due.length - todo.length} left for the next run` : ''));
  let done = 0, found = 0;
  const queue = [...todo];
  const worker = async () => {
    for (let n; (n = queue.shift()) !== undefined;) {
      const { domains, core, full } = candidates(n);
      let website = null;
      for (const d of domains) if ((website = await check(d, core, full))) break;
      cache[n] = { website, checked: new Date().toISOString().slice(0, 10) };
      if (website) found++;
      if (++done % 100 === 0) {
        log(`  Websites ${done}/${todo.length} (${found} found)`);
        fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 1));
      }
    }
  };
  await Promise.all(Array.from({ length: 12 }, worker));
  fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 1));
  if (todo.length) log(`  Websites: ${found} of ${todo.length} found`);
  return cache;
}

module.exports = { enrich, loadCache, candidates, check };
