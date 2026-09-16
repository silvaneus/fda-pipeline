/**
 * resolve-outcomes.js
 *
 * Decides what actually happened to a catalyst whose PDUFA date has passed.
 *
 * The previous pipeline asked one question — "can I find an approval for this
 * drug's name?" — and silently kept the entry when the answer was no. That is
 * why four past-due entries sat marked Pending for weeks while all four had in
 * fact been decided.
 *
 * This asks a better question by combining four independent sources, then grades
 * how sure it is:
 *
 *   openFDA drugsfda   authoritative, CDER only, lags 1-3 weeks
 *   openFDA CRL        the only structured feed of FDA rejections
 *   FDA CBER list      cell and gene therapies, absent from drugsfda entirely
 *   MJH brand feeds    same-day, and supplies a real article URL
 *
 * Confidence governs what the pipeline is allowed to do:
 *
 *   resolved  two sources agree, or one names the exact product -> act on it
 *   likely    one good source -> mark it, keep it visible
 *   review    suggestive but unproven -> flag for a human, change nothing
 */

const https = require('https');
const fa = require('./fda-actions');
const mjh = require('./mjh-news');

/**
 * The company's own 8-K announcing a complete response.
 *
 * A CRL has no linkable FDA document — the letters ship only as a bulk dataset,
 * and Drugs@FDA holds approved applications only, so linking there gives an
 * empty page. Issuers are required to disclose a CRL, so their 8-K is the
 * readable primary source.
 */
function edgarCRLFiling(catalyst) {
  const term = String(catalyst.drug || '').split(/[+/(]/)[0].trim();
  if (term.length < 4) return Promise.resolve(null);

  const q = encodeURIComponent(`"${term}" "complete response"`);
  const url = `https://efts.sec.gov/LATEST/search-index?q=${q}&forms=8-K`;

  return new Promise((resolve) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': 'MJH Life Sciences FDA-Pipeline (sinman@mjhlifesciences.com)',
        Accept: 'application/json',
      },
    }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => {
        try {
          const hits = (JSON.parse(body).hits || {}).hits || [];
          if (!hits.length) return resolve(null);
          // Only the applicant's own filing will do. Many sponsors are private
          // or foreign and file nothing with SEC — ITM Solucin among them — and
          // falling back to whoever else mentioned the drug produced a link to
          // an unrelated company's press release.
          const hit = hits.find((h) =>
            ((h._source && h._source.display_names) || []).some((n) =>
              fa.companyMatch(catalyst.company, String(n).replace(/\s*\(.*$/, ''))
            )
          );
          if (!hit) return resolve(null);
          const cik = String((hit._source.ciks && hit._source.ciks[0]) || '').replace(/^0+/, '');
          const adsh = hit._source.adsh || '';
          const doc = String(hit._id || '').split(':')[1] || '';
          if (!cik || !adsh) return resolve(null);
          const acc = adsh.replace(/-/g, '');
          resolve(doc
            ? `https://www.sec.gov/Archives/edgar/data/${cik}/${acc}/${doc}`
            : `https://www.sec.gov/Archives/edgar/data/${cik}/${acc}/${adsh}-index.htm`);
        } catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(20000, () => { req.destroy(); resolve(null); });
  });
}

const RANK = { high: 3, medium: 2, low: 1 };


/**
 * For a past-due entry nothing could resolve: does FDA show any activity at all
 * near this date?
 *
 * openFDA lists only approved submissions, so it cannot prove an application is
 * pending. It can show the opposite — that a drug's entire approval history sits
 * far from the PDUFA date the pipeline is tracking. Omaveloxolone was listed with
 * a 2026-09-10 date while Skyclarys' last action was a labeling supplement in
 * April and its pediatric efficacy supplement cleared in December 2024. Nothing
 * was pending; the date itself was wrong.
 *
 * This does not delete anything. It says the date deserves a look.
 */
async function checkForStaleDate(catalyst) {
  const names = [catalyst.brandName, catalyst.drug].filter(Boolean);
  for (const name of names) {
    const term = String(name).split(/[+/(]/)[0].trim();
    if (term.length < 4) continue;
    const field = name === catalyst.brandName ? 'openfda.brand_name' : 'openfda.generic_name';
    const url = `https://api.fda.gov/drug/drugsfda.json` +
      `?search=${field}:"${encodeURIComponent(term)}"&limit=5`;

    let data;
    try { data = await new Promise((resolve) => {
      const req = https.get(url, { headers: { 'User-Agent': 'MJH Life Sciences FDA-Pipeline (sinman@mjhlifesciences.com)', Accept: 'application/json' } }, (res) => {
        let b = ''; res.on('data', (c) => (b += c));
        res.on('end', () => { try { resolve(JSON.parse(b)); } catch { resolve(null); } });
      });
      req.on('error', () => resolve(null));
      req.setTimeout(20000, () => { req.destroy(); resolve(null); });
    }); } catch { data = null; }

    const results = (data && data.results) || [];
    if (!results.length) continue;

    const approvals = [];
    for (const app of results) {
      for (const sub of app.submissions || []) {
        if (sub.submission_status === 'AP' && sub.submission_status_date) {
          approvals.push({ date: sub.submission_status_date, app: app.application_number });
        }
      }
    }
    if (!approvals.length) continue;

    approvals.sort((a, b) => b.date.localeCompare(a.date));
    const latest = approvals[0];
    const iso = `${latest.date.slice(0, 4)}-${latest.date.slice(4, 6)}-${latest.date.slice(6, 8)}`;
    const gapDays = Math.round(
      (new Date(catalyst.pdufaDate + 'T12:00:00') - new Date(iso + 'T12:00:00')) / 86400000
    );

    // Already a marketed product, and its most recent FDA action is well before
    // the date being tracked, with nothing found at the date itself.
    if (gapDays > 120) {
      return {
        applicationNumber: latest.app,
        lastApproval: iso,
        gapDays,
        note: `No FDA action found near this date. ${term} is already approved ` +
              `(${latest.app}, last action ${iso}, ${gapDays} days before this PDUFA date) ` +
              `and nothing was found at the date itself \u2014 verify this entry is real.`,
        url: fa.drugsAtFDAUrl(latest.app),
      };
    }
    return null;
  }
  return null;
}

/** Build every index once; reused across all catalysts. */
async function buildContext({ days = 150, verbose = false } = {}) {
  const [actions, news] = await Promise.all([
    fa.buildActionIndex({ days, verbose }),
    mjh.fetchMJHNews({ verbose }),
  ]);
  return { actions, news };
}

/**
 * Resolve one catalyst. Returns null when nothing was found.
 *
 * Ordering matters: a CRL is checked before an approval, because a company can
 * have both a rejection for this product and an unrelated approval in the same
 * window, and the rejection is the one that concerns this entry.
 */
function resolveCatalyst(catalyst, ctx) {
  const { actions, news } = ctx;
  const evidence = [];
  let ambiguous = null;

  const crl = fa.matchCRL(catalyst, actions.crls);
  const approval = fa.matchApproval(catalyst, actions.approvals);
  // Confirmed against the product's indication in the async pre-pass below;
  // a company-only match that could not be confirmed is dropped there.
  const cber = ctx.cberConfirmed ? ctx.cberConfirmed.get(catalyst) : fa.matchCBER(catalyst, actions.cber);

  // A brand name discovered by FDA lets the news search find coverage that the
  // generic name never would — "Bixlenvo" appears in the headline, "bictegravir"
  // does not.
  const discoveredBrand =
    (approval && approval.brandNames && approval.brandNames[0]) ||
    (cber && cber.confidence === 'high' && cber.brandName) ||
    null;

  const newsTarget = discoveredBrand
    ? { ...catalyst, brandName: catalyst.brandName || discoveredBrand }
    : catalyst;
  const newsHit = mjh.detectOutcome(newsTarget, news);

  if (crl) {
    evidence.push({
      source: 'openFDA CRL',
      detail: `${crl.applicationNumber} — ${crl.company}, letter dated ${crl.date}`,
      confidence: crl.confidence,
      url: fa.crlUrl(),
    });
  }
  // Xspray had one application approved and another rejected in the same window.
  // Citing the approval on a CRL row points the reader at the wrong decision.
  const crlAppNo = crl && String(crl.applicationNumber || '').replace(/\D/g, '');
  const apAppNo = approval && String(approval.applicationNumber || '').replace(/\D/g, '');
  const differentApplication = crl && approval && crlAppNo && apAppNo && crlAppNo !== apAppNo;

  if (approval) {
    evidence.push({
      source: 'openFDA drugsfda',
      detail:
        `${approval.applicationNumber} ${approval.submissionType} approved ${approval.date}` +
        (approval.brandNames.length ? ` as ${approval.brandNames.join(', ')}` : ''),
      confidence: approval.confidence,
      // The approval letter is the document for this specific action.
      url: approval.letterUrl || approval.labelUrl || fa.drugsAtFDAUrl(approval.applicationNumber),
    });
  }
  // A company-only hit on FDA's cumulative gene-therapy list is a prompt to
  // look, not a finding. Cite it only when it is the sole signal, so it does not
  // pad the evidence behind a verdict that rests on something stronger.
  const citeCber = cber && (cber.confidence !== 'low' || (!crl && !approval && !newsHit));
  if (citeCber) {
    evidence.push({
      source: 'FDA CBER licensed products',
      detail: `${cber.brandName}${cber.genericName ? ` (${cber.genericName})` : ''} — ${cber.sponsor}` +
        (cber.isNew ? ', newly listed' : ''),
      confidence: cber.confidence,
      url: cber.url,
    });
  }
  if (newsHit) {
    evidence.push({
      source: `${newsHit.brand}`,
      detail: newsHit.title,
      confidence: newsHit.confidence,
      url: newsHit.url,
      published: newsHit.published,
    });
  }

  if (!evidence.length) return null;

  // What happened?
  let outcome = null;
  if (crl || (newsHit && newsHit.outcome === 'crl')) outcome = 'CRL';
  else if (approval || (cber && cber.confidence === 'high') || (newsHit && newsHit.outcome === 'approved')) outcome = 'Approved';
  else if (newsHit && newsHit.outcome === 'delayed') outcome = 'Review extended';
  else if (citeCber) outcome = 'Approved';       // low-confidence CBER: review only

  // How sure?
  const agreeing = evidence.filter((e) => RANK[e.confidence] >= 2).length;
  const strongest = evidence.reduce((m, e) => Math.max(m, RANK[e.confidence] || 0), 0);

  let certainty;
  if (agreeing >= 2 || strongest === 3) certainty = 'resolved';
  else if (strongest === 2) certainty = 'likely';
  else certainty = 'review';

  // A same-day news report of a delay is not a resolution; it is a date change.
  if (outcome === 'Review extended') certainty = certainty === 'resolved' ? 'likely' : certainty;

  // Two different applications from the same company decided opposite ways in
  // the same window: FDA is definitive about both, but which one this catalyst
  // tracks is not something the pipeline can tell. Say so instead of guessing.
  if (differentApplication) {
    certainty = 'review';
    ambiguous = `Company had both a CRL (${crl.applicationNumber}) and an approval ` +
      `(${approval.applicationNumber}) near this date — confirm which application this entry tracks.`;
  }

  // Prefer a source a person can actually read. For a CRL the FDA link is a
  // generic index page, so it ranks below anything specific.
  const isGeneric = (u) => !u || u === fa.CRL_INDEX_URL;
  // On a CRL row, an approval record for a different application is not a
  // source for this decision.
  const usable = evidence.filter((e) =>
    !(outcome === 'CRL' && differentApplication && /drugsfda/.test(e.source))
  );
  const preferred =
    usable.find((e) => e.published && !isGeneric(e.url)) ||
    usable.find((e) => !isGeneric(e.url)) ||
    usable.find((e) => e.url);

  return {
    outcome,
    certainty,
    ambiguous,
    sourceUrl: preferred ? preferred.url : null,
    resolvedDate:
      (crl && crl.date) ||
      (approval && approval.date) ||
      (newsHit && newsHit.published) ||
      null,
    brandName: discoveredBrand || catalyst.brandName || null,
    evidence,
  };
}

/**
 * Check every catalyst.
 *
 * Past-due entries are resolved. Future entries are checked too, but only to
 * flag an anomaly — FDA acting before the PDUFA date means either the date is
 * wrong or the entry is stale, and both are worth knowing.
 */
async function resolveAll(catalysts, { verbose = false, days = 150 } = {}) {
  const ctx = await buildContext({ days, verbose });
  const today = new Date().toISOString().slice(0, 10);

  const resolutions = [];
  const anomalies = [];
  const needsFiling = [];
  const unresolved = [];
  const staleDates = [];

  // "Sponsor's only licensed product" identifies a match only when the sponsor
  // also has a single candidate. Ultragenyx has two gene-therapy programs, so
  // DTX401 and UX111 both matched GENGLYCOS on company alone — one correctly,
  // one not. Where several catalysts claim the same product, none of them is
  // identified by it.
  ctx.cberConfirmed = new Map();
  for (const c of catalysts) {
    if (!c.pdufaDate || String(c.status || 'Pending').toLowerCase() !== 'pending') continue;
    const raw = fa.matchCBER(c, ctx.actions.cber);
    if (!raw) continue;
    ctx.cberConfirmed.set(c, await fa.confirmCBERMatch(c, raw));
  }

  for (const c of catalysts) {
    if (!c.pdufaDate) continue;
    const isPast = c.pdufaDate < today;
    const status = String(c.status || 'Pending').toLowerCase();
    if (status !== 'pending') continue;

    const r = resolveCatalyst(c, ctx);
    if (!r) {
      if (isPast) unresolved.push(c);
      continue;
    }

    // FDA routinely acts ahead of the goal date. A high-confidence approval
    // before a future PDUFA date is a decided entry, not an oddity to flag.
    const decidedEarly = !isPast && r.certainty === 'resolved' &&
      (r.outcome === 'Approved' || r.outcome === 'CRL');

    if (isPast || decidedEarly) {
      if (decidedEarly) r.decidedEarly = true;
      resolutions.push({ catalyst: c, ...r });
      // Filled in below; the lookup is network-bound so it runs after the pass.
      if (r.outcome === 'CRL' && (!r.sourceUrl || r.sourceUrl === fa.CRL_INDEX_URL || /drugsfda|accessdata/.test(r.sourceUrl))) {
        needsFiling.push(resolutions[resolutions.length - 1]);
      }
    }
  }

  for (const c of unresolved) {
    const stale = await checkForStaleDate(c);
    if (stale) staleDates.push({ catalyst: c, ...stale });
    await new Promise((res) => setTimeout(res, 250));
  }

  for (const r of needsFiling) {
    const filing = await edgarCRLFiling(r.catalyst);
    if (filing) {
      r.sourceUrl = filing;
      r.evidence.push({ source: 'SEC 8-K', detail: 'Company disclosure of the complete response', confidence: 'high', url: filing });
    }
    await new Promise((res) => setTimeout(res, 250));
  }

  if (verbose) {
    console.log(`\n  Resolved ${resolutions.length} past-due entr${resolutions.length === 1 ? 'y' : 'ies'}:`);
    for (const r of resolutions) {
      console.log(`    ${r.catalyst.drug} — ${r.outcome || 'unclear'} [${r.certainty}]`);
      r.evidence.forEach((e) => console.log(`        ${e.source}: ${e.detail}`));
    }
    if (staleDates.length) {
      console.log(`\n  ${staleDates.length} past-due entr${staleDates.length === 1 ? 'y' : 'ies'} with no FDA activity near the date:`);
      staleDates.forEach((x) => console.log(`    ${x.catalyst.drug} (PDUFA ${x.catalyst.pdufaDate}) \u2014 last action ${x.lastApproval}`));
    }
    if (anomalies.length) {
      console.log(`\n  ${anomalies.length} future-dated entr${anomalies.length === 1 ? 'y' : 'ies'} FDA appears to have already acted on:`);
      anomalies.forEach((a) =>
        console.log(`    ${a.catalyst.drug} (PDUFA ${a.catalyst.pdufaDate}) — ${a.outcome} ${a.resolvedDate || ''}`)
      );
    }
  }

  return { resolutions, anomalies, staleDates, context: ctx };
}

module.exports = { buildContext, resolveCatalyst, resolveAll };
