/**
 * Headquarters when SEC EDGAR has no record. Two backups, weakest last:
 *
 *  1. GLEIF, the global legal-entity registry: exact-name match gives a
 *     registered HQ address. Covers few small private biotechs but most
 *     foreign companies that have raised institutional money.
 *  2. Trial contacts on ClinicalTrials.gov: when the contact email is on the
 *     company's own domain, its phone number places the company (US area code
 *     -> state, country code -> country) and the domain is the website.
 *     Contacts on a CRO or hospital domain say nothing about the sponsor.
 */

const fs = require('fs');
const path = require('path');
const { normalize, splitParent } = require('./sponsors');

const GLEIF_CACHE = path.join(__dirname, 'state', 'gleif.json');
const AREA_CODES = require('./state/area-codes.json');
const MISS_RECHECK_DAYS = 30;

const STATE_ABBR = {
  Alabama: 'AL', Alaska: 'AK', Arizona: 'AZ', Arkansas: 'AR', California: 'CA', Colorado: 'CO', Connecticut: 'CT',
  Delaware: 'DE', 'District of Columbia': 'DC', Florida: 'FL', Georgia: 'GA', Hawaii: 'HI', Idaho: 'ID', Illinois: 'IL',
  Indiana: 'IN', Iowa: 'IA', Kansas: 'KS', Kentucky: 'KY', Louisiana: 'LA', Maine: 'ME', Maryland: 'MD',
  Massachusetts: 'MA', Michigan: 'MI', Minnesota: 'MN', Mississippi: 'MS', Missouri: 'MO', Montana: 'MT',
  Nebraska: 'NE', Nevada: 'NV', 'New Hampshire': 'NH', 'New Jersey': 'NJ', 'New Mexico': 'NM', 'New York': 'NY',
  'North Carolina': 'NC', 'North Dakota': 'ND', Ohio: 'OH', Oklahoma: 'OK', Oregon: 'OR', Pennsylvania: 'PA',
  'Puerto Rico': 'PR', 'Rhode Island': 'RI', 'South Carolina': 'SC', 'South Dakota': 'SD', Tennessee: 'TN',
  Texas: 'TX', Utah: 'UT', Vermont: 'VT', Virginia: 'VA', Washington: 'WA', 'West Virginia': 'WV',
  Wisconsin: 'WI', Wyoming: 'WY',
};

// +1 numbers that are not US. The area-code table above is US-only.
const CANADA = new Set(('204 226 236 249 250 257 263 289 306 343 354 365 367 368 382 387 403 416 418 428 431 437 438 ' +
  '450 460 468 474 506 514 519 548 579 581 584 587 604 613 639 647 672 683 705 709 742 753 778 780 782 807 819 825 ' +
  '867 873 879 902 905 942').split(' '));

const CALLING_CODES = {
  44: 'United Kingdom', 86: 'China', 41: 'Switzerland', 46: 'Sweden', 45: 'Denmark', 47: 'Norway', 49: 'Germany',
  33: 'France', 31: 'Netherlands', 32: 'Belgium', 34: 'Spain', 39: 'Italy', 43: 'Austria', 353: 'Ireland',
  358: 'Finland', 972: 'Israel', 61: 'Australia', 64: 'New Zealand', 81: 'Japan', 82: 'South Korea', 886: 'Taiwan',
  852: 'Hong Kong', 65: 'Singapore', 91: 'India', 55: 'Brazil', 48: 'Poland', 420: 'Czech Republic', 36: 'Hungary',
  351: 'Portugal', 30: 'Greece', 90: 'Turkey', 971: 'United Arab Emirates', 27: 'South Africa', 52: 'Mexico',
  54: 'Argentina', 66: 'Thailand', 60: 'Malaysia', 63: 'Philippines', 84: 'Vietnam', 62: 'Indonesia', 7: 'Russia',
};

const CC_TLDS = {
  cn: 'China', tw: 'Taiwan', hk: 'Hong Kong', uk: 'United Kingdom', de: 'Germany', fr: 'France', ch: 'Switzerland',
  se: 'Sweden', dk: 'Denmark', no: 'Norway', fi: 'Finland', nl: 'Netherlands', be: 'Belgium', es: 'Spain', it: 'Italy',
  at: 'Austria', ie: 'Ireland', il: 'Israel', au: 'Australia', nz: 'New Zealand', jp: 'Japan', kr: 'South Korea',
  sg: 'Singapore', in: 'India', ca: 'Canada', br: 'Brazil', pl: 'Poland',
};

const FREEMAIL = /^(gmail|googlemail|yahoo|hotmail|outlook|live|icloud|me|aol|163|126|qq|sina|sohu|foxmail|naver|protonmail|proton)\./;

// Words too common in biotech names to tie an email domain to one company.
const GENERIC = new Set(('therapeutics therapeutic tx bio bios bioscience biosciences biotech biotechnology biopharma ' +
  'biopharmaceutical biopharmaceuticals biologics biotherapeutics pharma pharmaceutical pharmaceuticals pharmaceutica ' +
  'medicine medicines medical health healthcare science sciences lab labs laboratories oncology holdings group ' +
  'technologies technology research innovations international global clinical drug drugs').split(' '));

function registrableDomain(email) {
  const host = (email.split('@')[1] || '').toLowerCase().trim();
  const parts = host.split('.').filter(Boolean);
  if (parts.length < 2) return null;
  // example.co.uk / example.com.tw keep three labels
  const n = parts.length >= 3 && /^(co|com|ac|org|net|gov)$/.test(parts[parts.length - 2]) ? 3 : 2;
  return parts.slice(-n).join('.');
}

/** Does this email domain belong to a company with one of these names? */
function domainMatches(domain, names) {
  const label = domain.split('.')[0].replace(/[^a-z0-9]/g, '');
  if (label.length < 3) return false;
  // Check the raw name too: "Xeno Holdings LLC dba ChoironeX" mails from xeno-holdings.com.
  return names.flatMap(n => [splitParent(n).name, n]).some(n => {
    const words = normalize(n).split(' ');
    const distinctive = words.find(w => w.length >= 3 && !GENERIC.has(w));
    if (distinctive) return label.includes(distinctive) || (label.length >= 5 && distinctive.startsWith(label));
    const joined = words.join('');
    return joined.length >= 4 && (label === joined || label.startsWith(joined));
  });
}

/** Phone text -> { us, state } | { country } | null */
function placePhone(raw) {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, '');
  const plus = /^\s*(\+|00)/.test(raw);
  let nanp = null;
  if (plus && digits.startsWith('1') && digits.length === 11) nanp = digits.slice(1);
  else if (!plus && digits.length === 10 && /^[2-9]/.test(digits)) nanp = digits;
  // "1 (617) ..." but not an unformatted 11-digit string, which is usually a
  // Chinese mobile number (186..., 133...).
  else if (!plus && digits.length === 11 && /^\s*1[\s\-.(]/.test(raw)) nanp = digits.slice(1);
  if (nanp) {
    const area = nanp.slice(0, 3);
    if (CANADA.has(area)) return { country: 'Canada' };
    const hit = AREA_CODES[area];
    return hit ? { country: 'United States', state: hit.state } : null;
  }
  const intl = plus ? digits.replace(/^00/, '') : digits.length >= 11 ? digits : null;
  if (!intl) return null;
  for (const len of [3, 2, 1]) {
    const c = CALLING_CODES[intl.slice(0, len)];
    if (c) return { country: c };
  }
  return null;
}

/**
 * Location and website from a company's trial contacts. Votes across every
 * contact on the company's own domain; the most common answer wins.
 */
function fromContacts(contacts, names) {
  const votes = new Map();
  const domains = new Map();
  for (const c of contacts) {
    if (!c.email) continue;
    const domain = registrableDomain(c.email);
    if (!domain || FREEMAIL.test(domain) || !domainMatches(domain, names)) continue;
    domains.set(domain, (domains.get(domain) || 0) + 1);
    let p = placePhone(c.phone);
    if (!p) {
      const tld = domain.split('.').pop();
      if (CC_TLDS[tld]) p = { country: CC_TLDS[tld], weak: true };
    }
    if (!p) continue;
    const k = p.state ? `US|${p.state}` : p.country;
    const v = votes.get(k) || { ...p, n: 0 };
    v.n += p.weak ? 0.5 : 1;
    votes.set(k, v);
  }
  const best = [...votes.values()].sort((a, b) => b.n - a.n)[0];
  const website = [...domains.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
  if (!best) return { website };
  return {
    website,
    us: best.country === 'United States',
    country: best.country,
    place: best.state ? (STATE_ABBR[best.state] || best.state) : best.country,
    via: best.state ? 'phone' : best.weak ? 'email' : 'phone',
  };
}

// --- GLEIF -----------------------------------------------------------------

function loadGleif() {
  try { return JSON.parse(fs.readFileSync(GLEIF_CACHE, 'utf8')); } catch { return {}; }
}

async function gleifLookup(sponsorName) {
  const name = splitParent(sponsorName).name;
  const want = normalize(name);
  const u = 'https://api.gleif.org/api/v1/lei-records?page[size]=15&filter[fulltext]=' + encodeURIComponent(name);
  for (let i = 1; i <= 3; i++) {
    const res = await fetch(u, { headers: { accept: 'application/vnd.api+json' }, signal: AbortSignal.timeout(30000) }).catch(() => null);
    if (res?.ok) {
      const j = await res.json();
      const m = (j.data || []).find(r => normalize(r.attributes.entity.legalName.name) === want);
      if (!m) return { found: false };
      const a = m.attributes.entity.headquartersAddress;
      return { found: true, city: a.city, region: a.region, country: a.country, lei: m.id };
    }
    await new Promise(r => setTimeout(r, 5000 * i));
  }
  throw new Error(`GLEIF failed for ${name}`);
}

async function enrichGleif(names, { log = console.log } = {}) {
  const cache = loadGleif();
  const now = Date.now();
  const todo = names.filter(n => !cache[n] || (!cache[n].found && now - new Date(cache[n].checked) > MISS_RECHECK_DAYS * 864e5));
  log(`  GLEIF: ${names.length - todo.length} cached, ${todo.length} to look up`);
  let done = 0;
  for (const n of todo) {
    try { cache[n] = { ...(await gleifLookup(n)), checked: new Date().toISOString().slice(0, 10) }; } catch (e) { log(`  ${e.message}`); }
    // Save as we go: a first run takes ~35 min and an interruption shouldn't lose it.
    if (++done % 100 === 0) {
      log(`  GLEIF ${done}/${todo.length}`);
      fs.writeFileSync(GLEIF_CACHE, JSON.stringify(cache));
    }
    await new Promise(r => setTimeout(r, 1100)); // GLEIF allows ~60 requests/min
  }
  fs.writeFileSync(GLEIF_CACHE, JSON.stringify(cache));
  return cache;
}

const ISO_COUNTRY = {
  US: 'United States', GB: 'United Kingdom', CN: 'China', CH: 'Switzerland', DK: 'Denmark', SE: 'Sweden', DE: 'Germany',
  FR: 'France', NL: 'Netherlands', BE: 'Belgium', IL: 'Israel', AU: 'Australia', JP: 'Japan', KR: 'South Korea',
  TW: 'Taiwan', HK: 'Hong Kong', SG: 'Singapore', CA: 'Canada', IE: 'Ireland', IT: 'Italy', ES: 'Spain', AT: 'Austria',
  FI: 'Finland', NO: 'Norway', IN: 'India', NZ: 'New Zealand', KY: 'Cayman Islands', BM: 'Bermuda', LU: 'Luxembourg',
};

function fromGleif(g) {
  if (!g?.found) return null;
  const us = g.country === 'US';
  const city = g.city ? g.city.replace(/\w\S*/g, w => w[0] + w.slice(1).toLowerCase()) : null;
  const region = g.region?.startsWith('US-') ? g.region.slice(3) : null;
  return {
    us, country: ISO_COUNTRY[g.country] || g.country,
    place: us ? [city, region].filter(Boolean).join(', ') : [city, ISO_COUNTRY[g.country] || g.country].filter(Boolean).join(', '),
  };
}

module.exports = { fromContacts, enrichGleif, fromGleif, placePhone, domainMatches, registrableDomain };
