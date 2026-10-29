// Pulls regulatory-candidate articles from MJH brand datasets in Sanity.
// The datasets are publicly readable through Sanity's API CDN, so no token is needed.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STATE = path.join(ROOT, 'state', 'articles');
const PROJECT = '0vv8moc6';
const API = `https://${PROJECT}.apicdn.sanity.io/v2023-05-03/data/query`;

// dataset -> public site. OncLive and HCPLive carry most of it; the specialty brands
// fill gaps in neurology, ophthalmology, dermatology and infectious disease.
export const BRANDS = {
  onclive: 'https://www.onclive.com',
  hcplive: 'https://www.hcplive.com',
  neurolive: 'https://www.neurologylive.com',
  ophtalmology: 'https://www.ophthalmologytimes.com',
  dermatologytimes: 'https://www.dermatologytimes.com',
  contagion: 'https://www.contagionlive.com',
  // Oncology sister brands and the cross-specialty brands that run "PDUFA dates to watch" previews.
  targetedonc: 'https://www.targetedonc.com',
  cancernetwork: 'https://www.cancernetwork.com',
  ajmc: 'https://www.ajmc.com',
  pharmacytimes: 'https://www.pharmacytimes.com',
  // Specialty brands that carry filings nobody else covers (e.g. pediatric sBLAs).
  contpeds: 'https://www.contemporarypediatrics.com',
  contobgyn: 'https://www.contemporaryobgyn.net',
  urologytimes: 'https://www.urologytimes.com',
  psychtimes: 'https://www.psychiatrictimes.com',
  curetoday: 'https://www.curetoday.com',
  pharmexec: 'https://www.pharmexec.com',
};

const BACKFILL_FROM = '2024-01-01';

// Broad server-side net; the local prefilter below narrows it. Filings are often reported
// inside trial-data stories whose headline never says FDA, so the body is searched too.
const QUERY = `*[_type=="article" && published >= $from && published <= now()
  && (title match "FDA" || summary match "FDA" || pt::text(body) match "PDUFA"
    || ((pt::text(body) match "FDA" || pt::text(body) match "Food and Drug Administration") && (pt::text(body) match "BLA" || pt::text(body) match "NDA"
      || pt::text(body) match "sBLA" || pt::text(body) match "sNDA" || pt::text(body) match "biologics license"
      || pt::text(body) match "new drug application" || pt::text(body) match "priority review"
      || pt::text(body) match "submitted" || pt::text(body) match "regulatory submission")))]
  | order(published asc){
    _id, _rev, title, summary, published, "slug": url.current,
    "text": pt::text(body), drugMentions
  }`;

// Regulatory events we care about. Designation-only pieces (fast track, BTD,
// orphan) are dropped unless they also talk about a filing or a decision.
const KEEP = /PDUFA|target action date|accept|priority review|submi|new drug application|biologics license|\b[s]?NDA\b|\b[s]?BLA\b|complete response|\bCRL\b|approv|resubmi|review (period|clock)|extend/i;
const DROP_TITLE = /^(Dr\.?|Drs\.?) [A-Z][\w'-]+ (on|discusses)|^FDA Approval Insights|Roundup of FDA Approvals|Flashback|Diabetes Dialogue|^Q&A/i;
const NON_DRUG = /\b(510\(k\)|De Novo|premarket approval application|clears?|clearance|device|assay|test|pump|catheter|stent|software|algorithm)\b/i;

export function isCandidate(a) {
  const head = `${a.title} ${a.summary || ''}`;
  if (DROP_TITLE.test(a.title)) return false;
  if (!KEEP.test(`${head} ${a.text || ''}`)) return false;
  // Device stories: keep only if they also mention a drug application.
  if (NON_DRUG.test(a.title) && !/NDA|BLA|PDUFA|drug/i.test(head)) return false;
  return true;
}

// drugMentions is an AI-generated JSON string: {"drug_mentions": [...]}
function parseMentions(raw) {
  if (!raw) return [];
  try { return JSON.parse(raw).drug_mentions || []; } catch { return []; }
}

async function query(dataset, params) {
  const url = new URL(`${API}/${dataset}`);
  url.searchParams.set('query', QUERY);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(`$${k}`, JSON.stringify(v));
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(url);
    if (res.ok) return (await res.json()).result;
    if (res.status < 500 && res.status !== 429) throw new Error(`${dataset}: HTTP ${res.status}`);
    await new Promise(r => setTimeout(r, 2000 * 2 ** attempt));
  }
  throw new Error(`${dataset}: Sanity unavailable`);
}

export function loadArticles(brand) {
  const f = path.join(STATE, `${brand}.json`);
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : {};
}

export async function syncBrand(brand) {
  fs.mkdirSync(STATE, { recursive: true });
  const store = loadArticles(brand);
  const dates = Object.values(store).map(a => a.published).sort();
  // Re-read the last 7 days each run so corrections and late edits are picked up.
  const from = dates.length
    ? new Date(Date.parse(dates.at(-1)) - 7 * 864e5).toISOString()
    : BACKFILL_FROM;
  const rows = await query(brand, { from });
  let added = 0, changed = 0;
  for (const a of rows) {
    if (!isCandidate(a)) continue;
    const prev = store[a._id];
    if (prev && prev._rev === a._rev) continue;
    prev ? changed++ : added++;
    store[a._id] = {
      ...a,
      brand,
      url: a.slug ? `${BRANDS[brand]}/view/${a.slug}` : null,
      text: (a.text || '').slice(0, 14000),
      drugMentions: parseMentions(a.drugMentions),
    };
  }
  fs.writeFileSync(path.join(STATE, `${brand}.json`), JSON.stringify(store, null, 1));
  return { brand, fetched: rows.length, added, changed, total: Object.keys(store).length };
}

export async function syncAll() {
  const out = [];
  for (const brand of Object.keys(BRANDS)) out.push(await syncBrand(brand));
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  for (const r of await syncAll()) console.log(r);
}
