/**
 * fda-actions.js
 *
 * Answers "what did FDA actually DO recently?" and matches those actions back
 * to tracked catalysts.
 *
 * Why this exists: the previous detection path searched FDA for a catalyst's
 * *name*. That fails for the most common case — a drug tracked under its generic
 * or development code (DTX401, 177Lu-edotreotide) gets announced under a brand
 * name that does not exist until the day it is approved. It also could never see
 * a CRL at all, because a rejection appears in no approval list.
 *
 * So the direction is inverted. Pull every FDA action in a date window, then
 * match. The join key is sponsor + date + drug tokens, none of which depend on
 * knowing a brand name in advance.
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

// Tracked state, so the CBER snapshot diff works across CI runs.
const CACHE_DIR = path.join(__dirname, 'state');

const UA = 'FDA-Pipeline/2.0 (sinman@mjhlifesciences.com)';

function fetchJSON(url, { retries = 3 } = {}) {
  return new Promise((resolve, reject) => {
    const attempt = (n) => {
      const req = https.get(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } }, (res) => {
        // openFDA returns 404 with a JSON body for "no matches" — that is a
        // valid empty answer, not a failure.
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          if (res.statusCode === 404) return resolve({ results: [], meta: { results: { total: 0 } } });
          if (res.statusCode !== 200) {
            if (n < retries) return setTimeout(() => attempt(n + 1), 1000 * (n + 1));
            return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
          }
          try { resolve(JSON.parse(body)); }
          catch (e) { reject(new Error(`Bad JSON from ${url}: ${e.message}`)); }
        });
      });
      req.on('error', (e) => {
        if (n < retries) return setTimeout(() => attempt(n + 1), 1000 * (n + 1));
        reject(e);
      });
      req.setTimeout(30000, () => req.destroy(new Error('timeout')));
    };
    attempt(0);
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------------------------------------------------------------- dates --- */

const yyyymmdd = (d) =>
  `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;

const daysAgo = (n) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
};

/** "20260827" -> "2026-08-27" */
const dashDate = (c) => `${c.slice(0, 4)}-${c.slice(4, 6)}-${c.slice(6, 8)}`;

/** "08/07/2026" -> "2026-08-07" */
function usDate(s) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(s || '').trim());
  return m ? `${m[3]}-${m[1]}-${m[2]}` : null;
}

/* ------------------------------------------------------------ normalize --- */

// Corporate noise that carries no identifying signal. "ITM Isotope Technologies"
// and "ITM Solucin GmbH" are the same company; only "ITM" says so.
const CO_NOISE = new Set([
  'INC', 'INCORPORATED', 'CORP', 'CORPORATION', 'CO', 'COMPANY', 'LLC', 'LP', 'LTD', 'LIMITED',
  'PLC', 'GMBH', 'AG', 'AB', 'AS', 'SA', 'NV', 'BV', 'SE', 'KK', 'SPA', 'OY', 'PTY', 'PUBL',
  'PHARMA', 'PHARMAS', 'PHARMACEUTICAL', 'PHARMACEUTICALS', 'THERAPEUTICS', 'THERAPEUTIC',
  'BIOSCIENCES', 'BIOSCIENCE', 'SCIENCES', 'SCIENCE', 'BIOPHARMA', 'BIOPHARMACEUTICALS',
  'BIOTECH', 'BIOTECHNOLOGY', 'BIO', 'LABS', 'LABORATORIES', 'LABORATORY', 'HOLDINGS',
  'GROUP', 'INTERNATIONAL', 'GLOBAL', 'USA', 'US', 'AMERICA', 'AMERICAS', 'NORTH',
  'MEDICINES', 'MEDICINE', 'HEALTHCARE', 'HEALTH', 'OPERATIONS', 'RESEARCH', 'DEVELOPMENT',
  'TECHNOLOGIES', 'TECHNOLOGY', 'SOLUTIONS', 'SYSTEMS', 'PRODUCTS', 'SERVICES', 'PARTNERS',
  'VENTURES', 'INNOVATIONS', 'INNOVATION', 'MEDICAL', 'CLINICAL', 'GENETICS', 'GENOMICS',
  'AND', 'THE', 'OF',
]);

/** Significant, identity-carrying tokens of a company name. */
function companyTokens(name) {
  return String(name || '')
    .toUpperCase()
    .replace(/&/g, ' ')
    .replace(/[^A-Z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 2 && !CO_NOISE.has(t));
}

function companyMatch(a, b) {
  const A = companyTokens(a);
  const B = companyTokens(b);
  if (!A.length || !B.length) return false;
  // One distinctive shared token is enough once the noise words are gone.
  return A.some((t) => B.includes(t));
}

// Words that appear inside drug names but identify no particular drug. The INN
// suffixes are the dangerous ones: "alfa" alone matched "tividenofusp alfa" to
// "pembrolizumab and berahyaluronidase alfa" and marked a Denali catalyst
// approved on the strength of a Merck record.
const DRUG_NOISE = new Set([
  'ALFA', 'ALPHA', 'BETA', 'GAMMA', 'DELTA', 'PEGOL', 'MABS',
  'ACID', 'SODIUM', 'CHLORIDE', 'SULFATE', 'HYDROCHLORIDE', 'PHOSPHATE', 'CITRATE',
  'ACETATE', 'TARTRATE', 'MALEATE', 'MESYLATE', 'FUMARATE', 'SUCCINATE', 'BROMIDE',
  'PLUS', 'WITH', 'COMBO', 'COMBINATION', 'ORAL', 'INJECTION', 'INJECTABLE',
  'TABLET', 'TABLETS', 'CAPSULE', 'CAPSULES', 'SOLUTION', 'SUSPENSION', 'CREAM',
  'OINTMENT', 'SPRAY', 'PATCH', 'INFUSION', 'SUBCUTANEOUS', 'INTRAVENOUS',
  'EXTENDED', 'RELEASE', 'DELAYED', 'IMMEDIATE', 'THERAPY', 'TREATMENT', 'VACCINE',
  'GENE', 'CELL', 'CELLS', 'AUTOLOGOUS', 'ALLOGENEIC', 'RECOMBINANT', 'HUMAN',
]);

/** Drug-name tokens, splitting combinations and stripping isotope prefixes. */
function drugTokens(name) {
  return String(name || '')
    .toUpperCase()
    .replace(/^\d+\s*[A-Z]{1,2}[- ]/, '')      // 177Lu- , 68Ga-
    .replace(/\bPLUS\b|\bAND\b|\bWITH\b/g, ' ')
    .replace(/[^A-Z0-9]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 4 && !DRUG_NOISE.has(t));
}

/**
 * Is this token specific enough to identify a drug on its own?
 *
 * Short stems recur across unrelated INNs, so molecule-only matching — where the
 * companies differ — needs a token long enough to be the actual drug name.
 */
function isDistinctiveToken(t) {
  return t.length >= 7 && !DRUG_NOISE.has(t);
}

function drugMatch(catalystDrug, fdaGeneric, fdaBrand) {
  const want = drugTokens(catalystDrug);
  if (!want.length) return false;
  const have = [...drugTokens(fdaGeneric), ...drugTokens(fdaBrand)];
  if (!have.length) return false;
  return want.some((w) => have.some((h) => h === w || h.startsWith(w) || w.startsWith(h)));
}

/* ------------------------------------------------------------ approvals --- */

/**
 * Every NDA/BLA approval action in the last `days` days.
 *
 * ANDAs (generics) are dropped — several hundred per quarter, and a PDUFA
 * catalyst is never an ANDA.
 */
async function fetchApprovalSweep(days = 120, verbose = false) {
  const from = yyyymmdd(daysAgo(days));
  const to = yyyymmdd(new Date());
  const base =
    'https://api.fda.gov/drug/drugsfda.json' +
    `?search=submissions.submission_status_date:[${from}+TO+${to}]&limit=100`;

  const apps = [];
  let skip = 0;
  let total = Infinity;

  while (skip < total && skip < 2000) {
    const page = await fetchJSON(`${base}&skip=${skip}`);
    if (!page.results || !page.results.length) break;
    total = page.meta.results.total;
    apps.push(...page.results);
    skip += 100;
    await sleep(200);
  }

  const approvals = [];
  for (const app of apps) {
    const appNo = app.application_number || '';
    if (appNo.startsWith('ANDA')) continue;

    for (const sub of app.submissions || []) {
      if (sub.submission_status !== 'AP') continue;
      const d = sub.submission_status_date;
      if (!d || d < from || d > to) continue;

      // FDA publishes the approval letter and the new label as PDFs for most
      // actions. Those name the specific decision; the Drugs@FDA overview page
      // does not, which is why a link to it reads as if nothing is there.
      const docs = sub.application_docs || [];
      const letter = docs.find((x) => /letter/i.test(x.type || ''));
      const label = docs.find((x) => /label/i.test(x.type || ''));

      approvals.push({
        applicationNumber: appNo,
        sponsor: app.sponsor_name || '',
        brandNames: (app.openfda && app.openfda.brand_name) || [],
        genericNames: (app.openfda && app.openfda.generic_name) || [],
        date: dashDate(d),
        submissionType: `${sub.submission_type || ''}${sub.submission_number || ''}`,
        classCode: sub.submission_class_code_description || '',
        letterUrl: (letter && letter.url) || null,
        labelUrl: (label && label.url) || null,
      });
    }
  }

  if (verbose) {
    console.log(`  FDA approvals swept: ${approvals.length} NDA/BLA actions in last ${days} days`);
  }
  return approvals;
}

/* ----------------------------------------------------------------- CRLs --- */

/**
 * Complete Response Letters from FDA's transparency dataset.
 *
 * FDA began publishing CRLs in July 2025 and moved to ongoing publication that
 * September. This is the only authoritative, structured feed of FDA rejections
 * that exists — before it, a CRL was visible only if the sponsor chose to say so.
 *
 * It refreshes in batches rather than daily, so treat it as the confirming
 * source and let news carry the same-day signal.
 */
async function fetchCRLSweep(days = 120, verbose = false) {
  const cutoff = dashDate(yyyymmdd(daysAgo(days)));
  const years = new Set([new Date().getFullYear(), daysAgo(days).getFullYear()]);

  const crls = [];
  for (const year of years) {
    let skip = 0;
    let total = Infinity;
    while (skip < total && skip < 500) {
      const url =
        'https://api.fda.gov/transparency/crl.json' +
        `?search=letter_year:${year}&limit=100&skip=${skip}`;
      const page = await fetchJSON(url);
      if (!page.results || !page.results.length) break;
      total = page.meta.results.total;

      for (const r of page.results) {
        const date = usDate(r.letter_date);
        if (!date || date < cutoff) continue;
        const appNo = Array.isArray(r.application_number)
          ? r.application_number[0]
          : r.application_number;
        crls.push({
          applicationNumber: String(appNo || '').replace(/\s+/g, ''),
          company: r.company_name || '',
          date,
          fileName: r.file_name || '',
          // First ~1200 chars is where the drug/indication usually appears.
          excerpt: String(r.text || '').slice(0, 1200),
        });
      }
      skip += 100;
      await sleep(200);
    }
  }

  if (verbose) console.log(`  FDA CRLs swept: ${crls.length} letters in last ${days} days`);
  return crls;
}

/* ----------------------------------------------------------------- CBER --- */

/**
 * Cell and gene therapies are licensed by CBER and never appear in drugsfda,
 * which covers CDER only. DTX401 was approved as Genglycos and stayed invisible
 * to every check the pipeline ran, for exactly this reason.
 *
 * FDA publishes the licensed products as a plain cumulative table. Because it is
 * cumulative, presence alone does not date an approval — so the sweep also diffs
 * against the previous run and reports which rows are new.
 */
async function fetchCBERApprovals(verbose = false) {
  const url =
    'https://www.fda.gov/vaccines-blood-biologics/cellular-gene-therapy-products/' +
    'approved-cellular-and-gene-therapy-products';

  const html = await new Promise((resolve) => {
    const req = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; FDA-Pipeline/2.0)' } }, (res) => {
      let b = '';
      res.on('data', (c) => (b += c));
      res.on('end', () => resolve(res.statusCode === 200 ? b : ''));
    });
    req.on('error', () => resolve(''));
    req.setTimeout(30000, () => { req.destroy(); resolve(''); });
  });

  if (!html) {
    if (verbose) console.log('  CBER page unavailable; skipping gene-therapy check');
    return { products: [], newProducts: [] };
  }

  const products = [];
  const rows = html.match(/<tr>[\s\S]*?<\/tr>/g) || [];
  for (const row of rows) {
    const cells = row.match(/<td\b[^>]*>([\s\S]*?)<\/td>/g) || [];
    if (cells.length < 2) continue;
    const strip = (c) =>
      c.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
    const nameCell = strip(cells[0]);
    const sponsor = strip(cells[1]);
    if (!nameCell || !sponsor) continue;

    // "GENGLYCOS (pariglasgene brecaparvovec-opnr)" — the closing parenthesis is
    // sometimes missing in FDA's own markup, so do not require it.
    const m = /^([^(]+?)\s*(?:\(([^)]*)\)?)?$/.exec(nameCell);
    const href = (/href="([^"]+)"/.exec(cells[0]) || [])[1];
    products.push({
      brandName: (m && m[1] ? m[1] : nameCell).trim(),
      genericName: (m && m[2] ? m[2] : '').trim(),
      sponsor,
      url: href ? (href.startsWith('http') ? href : `https://www.fda.gov${href}`) : url,
    });
  }

  // Diff against the last run so a genuinely new listing can be dated.
  const snapPath = path.join(CACHE_DIR, 'cber-products.json');
  let previous = [];
  try { previous = JSON.parse(fs.readFileSync(snapPath, 'utf8')).products || []; } catch { /* first run */ }
  const prevKeys = new Set(previous.map((p) => p.brandName.toUpperCase()));
  const newProducts = previous.length
    ? products.filter((p) => !prevKeys.has(p.brandName.toUpperCase()))
    : [];

  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(snapPath, JSON.stringify({ products, updatedAt: new Date().toISOString() }, null, 1));
  } catch (e) {
    if (verbose) console.log(`  Warning: could not save CBER snapshot: ${e.message}`);
  }

  if (verbose) {
    console.log(
      `  CBER products: ${products.length} licensed` +
      (previous.length ? `, ${newProducts.length} new since last run` : ' (baseline snapshot saved)')
    );
  }
  return { products, newProducts };
}

/**
 * Match a catalyst against the CBER list.
 *
 * Gene-therapy sponsors are small and rarely hold two licensed products, so a
 * company match carries real weight here — but only for a catalyst whose PDUFA
 * has already passed, and only as medium confidence unless the row is new or the
 * molecule name lines up.
 */
function matchCBER(catalyst, cber) {
  const all = (cber && cber.products) || [];
  const fresh = new Set(((cber && cber.newProducts) || []).map((p) => p.brandName.toUpperCase()));

  // Everything CBER licenses is a biologic under a BLA. A catalyst filed as an
  // NDA cannot be on this list, so matching one to it is always wrong — that is
  // how sisunatovir (an NDA) came to match Pfizer's gene therapy BEQVEZ.
  const subType = String(catalyst.submissionType || '');
  if (subType && /NDA/i.test(subType) && !/BLA/i.test(subType)) return null;

  // Does this sponsor have exactly one licensed product? If so there is nothing
  // to confuse it with, the same reasoning used for a company's only CRL.
  const bySponsor = all.filter((p) => companyMatch(catalyst.company, p.sponsor));
  const soleProduct = bySponsor.length === 1;

  let best = null;
  for (const p of all) {
    const co = companyMatch(catalyst.company, p.sponsor);
    const dn = drugMatch(catalyst.drug, p.genericName, p.brandName);
    const bn = catalyst.brandName &&
      p.brandName.toUpperCase() === String(catalyst.brandName).toUpperCase();
    if (!co && !dn && !bn) continue;

    // The list is cumulative, so a company match alone only says "this sponsor
    // has a licensed product" — which may be an old one. That is worth a human
    // look, never an automatic verdict.
    const isNew = fresh.has(p.brandName.toUpperCase());
    let confidence;
    if (bn || (co && dn) || (co && isNew) || (co && soleProduct)) confidence = 'high';
    else if (co) confidence = 'low';
    else continue; // molecule-only on a cumulative list is too weak

    const rank = { high: 3, medium: 2, low: 1 };
    if (!best || rank[confidence] > rank[best.confidence]) {
      best = {
        ...p,
        confidence,
        isNew,
        evidence: bn ? 'brand name' : co && dn ? 'company + molecule'
          : isNew ? 'company + newly listed'
          : soleProduct ? 'sponsor\u2019s only licensed product'
          : 'company on licensed-product list',
      };
    }
  }
  return best;
}

/* -------------------------------------------------------------- matching --- */

/**
 * Was this catalyst approved? Returns the matching action or null.
 *
 * A match needs the company AND either a drug-name token hit or a plausible
 * approval class landing in the PDUFA window. Company alone is not enough —
 * large sponsors have many approvals in any 120-day period.
 */
/**
 * Window note: FDA frequently acts well ahead of the PDUFA goal date. Capivasertib
 * was approved 77 days early, which a flat 45-day window silently excluded and
 * left the entry reading Pending for months.
 *
 * So the window scales with how certain the match is. An exact brand name or a
 * company-plus-molecule hit can be trusted across a wide window; a bare molecule
 * match cannot, and stays tight.
 */
function matchApproval(catalyst, approvals, { windowBefore = 210, windowAfter = 60, looseBefore = 45 } = {}) {
  if (!catalyst.pdufaDate) return null;
  const pdufaMs = new Date(catalyst.pdufaDate + 'T12:00:00').getTime();

  const candidates = approvals.filter((a) => {
    const diff = (new Date(a.date + 'T12:00:00').getTime() - pdufaMs) / 86400000;
    return diff >= -windowBefore && diff <= windowAfter;
  });

  let best = null;
  for (const a of candidates) {
    const co = companyMatch(catalyst.company, a.sponsor);
    const dn = drugMatch(catalyst.drug, a.genericNames.join(' '), a.brandNames.join(' '));
    const bn = catalyst.brandName &&
      a.brandNames.some((b) => b.toUpperCase() === String(catalyst.brandName).toUpperCase());

    // Without a company match the drug name is carrying the whole claim, so it
    // has to be a name rather than a shared stem.
    const want = drugTokens(catalyst.drug);
    const have = [...drugTokens(a.genericNames.join(' ')), ...drugTokens(a.brandNames.join(' '))];
    const distinctive = want.some((w) =>
      isDistinctiveToken(w) && have.some((h) => h === w || h.startsWith(w) || w.startsWith(h))
    );

    // Sponsor alone is not evidence: a large company has many approvals in any
    // window, so requiring only "same company" produced mostly false matches.
    let confidence = null;
    if (bn) confidence = 'high';                       // brand name is exact
    else if (co && dn) confidence = 'high';            // company + molecule
    else if (distinctive) confidence = 'medium';       // licensed or partnered filings
    if (!confidence) continue;

    // A weak match only counts inside the tight window.
    const diff = (new Date(a.date + 'T12:00:00').getTime() - pdufaMs) / 86400000;
    if (confidence === 'medium' && diff < -looseBefore) continue;

    const rank = { high: 3, medium: 2 };
    if (!best || rank[confidence] > rank[best.confidence]) {
      best = { ...a, confidence, evidence: bn ? 'brand name' : 'company + molecule' };
    }
  }
  return best;
}

/**
 * Did this catalyst get a CRL? Returns the letter or null.
 *
 * CRL records carry no drug name field, so the join is company + date. That is
 * safe here because the date window is tight: a CRL lands on or just before the
 * PDUFA date, and a given company rarely has two in the same fortnight.
 */
function matchCRL(catalyst, crls, { windowBefore = 60, windowAfter = 30 } = {}) {
  if (!catalyst.pdufaDate) return null;
  const pdufaMs = new Date(catalyst.pdufaDate + 'T12:00:00').getTime();

  const inWindow = crls.filter((c) => {
    const diff = (new Date(c.date + 'T12:00:00').getTime() - pdufaMs) / 86400000;
    return diff >= -windowBefore && diff <= windowAfter && companyMatch(catalyst.company, c.company);
  });
  if (!inWindow.length) return null;

  // CRL records carry no drug name, so the question is whether this company has
  // more than one letter near this date. If it has exactly one, there is nothing
  // to confuse it with — and FDA saying a letter issued is definitive.
  const unambiguous = inWindow.length === 1;

  let best = null;
  for (const c of inWindow) {
    const named = drugTokens(catalyst.drug).some((t) => c.excerpt.toUpperCase().includes(t));
    const confidence = named || unambiguous ? 'high' : 'medium';
    const rank = { high: 3, medium: 2 };
    if (!best || rank[confidence] > rank[best.confidence]) {
      best = {
        ...c,
        confidence,
        evidence: named ? 'company + molecule in letter'
          : unambiguous ? 'company\u2019s only CRL in the window'
          : 'company + date window',
      };
    }
  }
  return best;
}


/**
 * The indication text from a CBER product page, cached per product.
 *
 * Needed because a company match alone cannot identify a product on a
 * cumulative list — Ultragenyx has two gene-therapy programs, so both DTX401
 * and UX111 "matched" its single listed product GENGLYCOS. The indications tell
 * them apart: GENGLYCOS treats glycogen storage disease, UX111 targets
 * Sanfilippo syndrome.
 */
const cberIndicationCache = new Map();

async function fetchCBERIndication(url) {
  if (cberIndicationCache.has(url)) return cberIndicationCache.get(url);

  const html = await new Promise((resolve) => {
    const req = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; FDA-Pipeline/2.0)' } }, (res) => {
      let b = '';
      res.on('data', (c) => (b += c));
      res.on('end', () => resolve(res.statusCode === 200 ? b : ''));
    });
    req.on('error', () => resolve(''));
    req.setTimeout(20000, () => { req.destroy(); resolve(''); });
  });

  // Strip scripts first: the page embeds JSON-LD that otherwise swamps the match.
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ');

  const m = /Indications?[:\s]*(?:STN\s*\d+\s*-\s*)?([\s\S]{0,400})/i.exec(text);
  const indication = m ? m[1].trim() : '';
  cberIndicationCache.set(url, indication);
  return indication;
}

// Words too common in indication text to carry meaning on their own.
const INDICATION_STOP = new Set([
  'PATIENTS', 'TREATMENT', 'ADULTS', 'ADULT', 'CHILDREN', 'PEDIATRIC', 'YEARS', 'OLDER',
  'THERAPY', 'DISEASE', 'DISORDER', 'SYNDROME', 'CHRONIC', 'ACUTE', 'SEVERE', 'APPROVED',
  'INDICATED', 'INDICATION', 'USE', 'WITH', 'AND', 'THE', 'FOR', 'TYPE', 'CELL', 'CELLS',
]);

function indicationOverlap(a, b) {
  const tok = (t) => new Set(
    String(t || '').toUpperCase().replace(/[^A-Z0-9]/g, ' ').split(/\s+/)
      .filter((w) => w.length >= 5 && !INDICATION_STOP.has(w))
  );
  const A = tok(a);
  const B = tok(b);
  if (!A.size || !B.size) return false;
  for (const w of A) if (B.has(w)) return true;
  return false;
}

/**
 * Confirm a company-only CBER match by indication, or reject it.
 * Returns the match unchanged when it never rested on company alone.
 */
async function confirmCBERMatch(catalyst, match) {
  if (!match) return null;
  const companyOnly = /only licensed product|licensed-product list|multiple candidates/.test(match.evidence || '');
  if (!companyOnly) return match;

  const fdaIndication = await fetchCBERIndication(match.url);

  // Compare everything each side says about itself, not indication to indication.
  // FDA describes TREGZI by its modality ("matched donor hematopoietic stem cell
  // transplantation") while the catalyst names the disease ("Acute Myeloid
  // Leukemia"). Those are the same product in different vocabulary, and a
  // narrow indication-to-indication test rejected it. The product's proper name
  // carries the modality, so include it on both sides.
  const catalystText = [catalyst.indication, catalyst.notes, catalyst.drug].filter(Boolean).join(' ');
  const fdaText = [fdaIndication, match.genericName, match.brandName].filter(Boolean).join(' ');

  if (!catalystText || !fdaText) return { ...match, confidence: 'low' };

  if (indicationOverlap(catalystText, fdaText)) {
    return { ...match, confidence: 'high', evidence: 'sponsor + matching indication' };
  }
  // The sponsor's product treats something else entirely. Not this catalyst.
  return null;
}

/* ------------------------------------------------------------ source URLs --- */

/** A real FDA page for an application, instead of a Google search link. */
function drugsAtFDAUrl(applicationNumber) {
  const m = /(\d{6,})/.exec(String(applicationNumber || ''));
  if (!m) return null;
  return `https://www.accessdata.fda.gov/scripts/cder/daf/index.cfm?event=overview.process&ApplNo=${m[1]}`;
}

/**
 * A readable source for a CRL.
 *
 * NOT Drugs@FDA. That database only holds *approved* applications, so an
 * application that received a complete response has no record there — the page
 * loads but is an empty shell. FDA publishes the letters themselves only as a
 * bulk dataset, with no per-letter URL to link to.
 *
 * So the caller supplies whatever readable source it found (trade coverage, the
 * company's own 8-K) and this is the honest last resort.
 */
// FDA has moved this page before; the old fda.gov transparency path now 404s.
// This openFDA page is the live home for the CRL dataset and is verified to load.
const CRL_INDEX_URL = 'https://open.fda.gov/apis/transparency/completeresponseletters/';

function crlUrl() {
  return CRL_INDEX_URL;
}

/* ------------------------------------------------------------------ main --- */

/** One sweep, reused across every catalyst. */
async function buildActionIndex({ days = 120, verbose = false } = {}) {
  if (verbose) console.log('  Building FDA action index...');
  const [approvals, crls, cber] = await Promise.all([
    fetchApprovalSweep(days, verbose),
    fetchCRLSweep(days, verbose),
    fetchCBERApprovals(verbose),
  ]);
  return { approvals, crls, cber, days, fetchedAt: new Date().toISOString() };
}

module.exports = {
  buildActionIndex,
  fetchApprovalSweep,
  fetchCRLSweep,
  fetchCBERApprovals,
  matchApproval,
  matchCRL,
  matchCBER,
  confirmCBERMatch,
  fetchCBERIndication,
  indicationOverlap,
  companyMatch,
  companyTokens,
  drugMatch,
  drugsAtFDAUrl,
  crlUrl,
  CRL_INDEX_URL,
  isDistinctiveToken,
};
