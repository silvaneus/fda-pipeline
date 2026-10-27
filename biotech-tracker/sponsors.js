/**
 * Sponsor-name normalization. ClinicalTrials.gov sponsor names are free text,
 * so one company shows up as "Acme Bio", "Acme Bio, Inc." and "Acme Bio Inc".
 * Grouping on a normalized key keeps a renamed or re-punctuated sponsor from
 * looking like a brand-new company.
 */

// Corporate-form words carry no identity. Descriptors like "therapeutics" or
// "bio" are kept: "Loki Therapeutics" and "Loki Bio" can be different firms.
const LEGAL_FORMS = new Set([
  'inc', 'incorporated', 'llc', 'llp', 'lp', 'ltd', 'limited', 'corp', 'corporation',
  'co', 'company', 'plc', 'gmbh', 'ag', 'sa', 'sas', 'sarl', 'srl', 'spa', 'nv', 'bv',
  'ab', 'as', 'asa', 'aps', 'oy', 'oyj', 'kk', 'pte', 'pty', 'pvt', 'private', 'se',
  'usa', 'us', 'the', 'and', 'operating',
]);

// Legal forms that place a company outside the US. Used only when SEC EDGAR
// has no record of the sponsor.
const NON_US_FORM = /\b(ltd|limited|plc|gmbh|ag|s\.?a\.?s?|s\.?r\.?l|s\.?p\.?a|n\.?v|b\.?v|a\/?s|aps|oyj?|k\.?k|pte|pty|pvt|kft|sp\. z o\.o|co\.,? ?ltd)\.?$/i;
const NON_US_PLACE = /\b(shanghai|beijing|suzhou|hangzhou|shenzhen|guangzhou|nanjing|chengdu|jiangsu|zhejiang|wuhan|tianjin|hong kong|taiwan|korea|japan|tokyo|osaka|india|china|chinese)\b/i;

function splitParent(name) {
  // "X, a (wholly owned) subsidiary of Y" / "X (a subsidiary of Y)"
  const m = name.match(/^(.*?)[,(\s]+(?:an?\s+)?(?:wholly[- ]owned\s+)?subsidiary\s+of\s+(.+?)\)?$/i);
  if (m) return { name: m[1].trim(), parent: m[2].trim() };
  // "Holdco LLC dba Brand"
  const d = name.match(/^(.*?)\s+d\/?b\/?a\s+(.+)$/i);
  if (d) return { name: d[2].trim(), parent: null };
  return { name, parent: null };
}

function normalize(name) {
  if (!name) return '';
  const words = name
    .toLowerCase()
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\/[a-z]{2,3}\b/g, ' ') // EDGAR state tag: "Surrozen, Inc./DE"
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(w => w && !LEGAL_FORMS.has(w));
  return words.join(' ');
}

function sponsorKey(name) {
  return normalize(splitParent(name).name);
}

function parentKey(name) {
  const p = splitParent(name).parent;
  return p ? normalize(p) : null;
}

function inferNonUS(name) {
  const clean = splitParent(name).name.trim();
  return NON_US_FORM.test(clean) || NON_US_PLACE.test(clean);
}

module.exports = { normalize, sponsorKey, parentKey, splitParent, inferNonUS };
