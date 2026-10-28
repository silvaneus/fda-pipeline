/**
 * Does a company already have an FDA-approved drug? Uses the openFDA
 * Drugs@FDA bulk file (NDA, BLA, ANDA approvals; ~9 MB zipped).
 *
 * FDA writes sponsor names as just the distinctive part, often abbreviated
 * ("ARCUTIS", "VERTEX PHARMS"), so names are compared on their distinctive
 * core: descriptor words like "Therapeutics" or "Pharms" removed. Every
 * match is shown with its brand and year so a wrong one is easy to spot and
 * override (state/overrides.json "marketed" / "notMarketed").
 *
 * Gap: cell/gene therapies and many vaccines are licensed by CBER and are
 * absent from Drugs@FDA. Phase 4 trials cover part of that (see analyze.js).
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { normalize } = require('./sponsors');

const URL = 'https://download.open.fda.gov/drug/drugsfda/drug-drugsfda-0001-of-0001.json.zip';

const DESCRIPTORS = new Set(('therapeutics therapeutic therap theraps tx bio bios bioscience biosciences biotech ' +
  'biotechnology biopharma biopharmaceutical biopharmaceuticals biologics biotherapeutics pharma pharm pharms ' +
  'pharmaceutical pharmaceuticals pharmaceutica medicine medicines medical health healthcare hlthcare science ' +
  'sciences lifesciences lab labs laboratories oncology holdings group technologies technology research ' +
  'innovations international intl global clinical drug drugs industries inds rx ph sub north america americas').split(' '));

function core(name) {
  return normalize(name).split(' ').filter(w => w && !DESCRIPTORS.has(w)).join(' ');
}

// Salt and form words carry no identity: "sodium" would tie any two products together.
const NOT_A_DRUG = new Set(('sodium potassium calcium magnesium hydrochloride acetate sulfate phosphate citrate ' +
  'tartrate maleate mesylate besylate succinate fumarate bromide chloride hydrobromide tosylate injection tablet ' +
  'tablets capsule capsules solution cream gel kit extended release oral topical ophthalmic and with in dextrose water').split(' '));
const drugTokens = s => s.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length >= 5 && !NOT_A_DRUG.has(w));

const ymd = d => d ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` : null;

async function loadApprovals() {
  const res = await fetch(URL, { signal: AbortSignal.timeout(120000) });
  if (!res.ok) throw new Error(`Drugs@FDA download failed: HTTP ${res.status}`);
  const zip = path.join(os.tmpdir(), `drugsfda-${process.pid}.zip`);
  fs.writeFileSync(zip, Buffer.from(await res.arrayBuffer()));
  const json = execFileSync('unzip', ['-p', zip], { maxBuffer: 512 * 1024 * 1024 });
  fs.unlinkSync(zip);
  const byCore = new Map();
  for (const app of JSON.parse(json).results) {
    const orig = (app.submissions || []).find(s => s.submission_type === 'ORIG' && s.submission_status === 'AP');
    if (!orig || !app.sponsor_name) continue;
    const k = core(app.sponsor_name);
    // Single short cores ("ani", "sun") are too ambiguous to match on.
    if (k.length < 4) continue;
    const list = byCore.get(k) || [];
    list.push({
      app: app.application_number,
      sponsor: app.sponsor_name,
      brand: app.products?.[0]?.brand_name || null,
      drugs: [...new Set((app.products || []).flatMap(p => [p.brand_name, ...(p.active_ingredients || []).map(i => i.name)]).filter(Boolean))],
      date: ymd(orig.submission_status_date),
      status: app.products?.some(p => p.marketing_status !== 'Discontinued') ? 'Marketed' : 'Discontinued',
    });
    byCore.set(k, list);
  }
  return byCore;
}

/**
 * Approvals for a company, newest first, or [] (tries every name it has used).
 * A one-word name core ("Alembic", "Hope", "United") is shared by unrelated
 * firms, so those matches stand only when an approved product's ingredient or
 * brand also appears in the company's own trials. Multi-word cores are
 * specific enough on their own.
 */
function approvalsFor(names, byCore, trialText = '') {
  const text = new Set(drugTokens(trialText));
  const seen = new Set();
  const out = [];
  for (const n of names) {
    const k = core(n);
    if (k.length < 4 || seen.has(k)) continue;
    seen.add(k);
    const apps = byCore.get(k) || [];
    if (!apps.length) continue;
    // Only a branded (NDA/BLA) product can confirm a one-word match: generic
    // makers hold hundreds of ANDAs, and one of their common ingredients will
    // show up in almost anyone's trials.
    const confirms = a => !a.app.startsWith('ANDA') && a.drugs.some(d => drugTokens(d).some(t => text.has(t)));
    if (k.includes(' ') || apps.some(confirms)) out.push(...apps);
  }
  return out.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
}

module.exports = { loadApprovals, approvalsFor, core };
