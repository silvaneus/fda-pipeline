/**
 * Turns the full industry study list into company histories and the four
 * dashboard views. Pure function of (studies, today, config) so the numbers
 * can be re-derived from any snapshot.
 */

const { sponsorKey, parentKey, splitParent } = require('./sponsors');
const { classifyCondition } = require('./classify-disease');

const CONFIG = {
  newWindowDays: 183,      // how long a company keeps its "new" flag
  startsWindowDays: 90,    // Phase 2 starts feed
  smallCompanyMaxTrials: 25, // size proxy: total phased industry trials
  directoryActiveYears: 5, // directory: posted a trial within this many years
};

const isP1 = s => s.phases.includes('PHASE1') || s.phases.includes('EARLY_PHASE1');
// A "real" Phase 2: 2 or 2/3. Phase 1/2 is still first-in-human territory.
const isP2 = s => s.phases.includes('PHASE2') && !isP1(s);
const isP3 = s => s.phases.includes('PHASE3') || s.phases.includes('PHASE4');
const isPhased = s => s.phases.length && !s.phases.every(p => p === 'NA');
// Device and imaging-procedure studies sometimes carry a phase; only count
// studies that test a drug, biologic or gene therapy.
const DRUG_TYPES = new Set(['DRUG', 'BIOLOGICAL', 'GENETIC', 'COMBINATION_PRODUCT']);
const isDrug = s => s.interventionTypes.some(t => DRUG_TYPES.has(t));
const hasUS = s => s.countries.includes('United States');
// New postings often list no sites for weeks. Counting them keeps the freshest
// studies visible; the company-HQ check does the US filtering instead.
const usOrPending = s => hasUS(s) || s.countries.length === 0;
const siteStatus = s => hasUS(s) ? 'US' : s.countries.length ? 'Non-US' : 'Pending';

function daysAgo(today, n) {
  return new Date(today.getTime() - n * 864e5).toISOString().slice(0, 10);
}

function stageOf(s) {
  if (s.phases.includes('PHASE4')) return 'Phase 4';
  if (s.phases.includes('PHASE3')) return s.phases.includes('PHASE2') ? 'Phase 2/3' : 'Phase 3';
  if (s.phases.includes('PHASE2')) return s.phases.includes('PHASE1') ? 'Phase 1/2' : 'Phase 2';
  if (s.phases.includes('PHASE1')) return 'Phase 1';
  if (s.phases.includes('EARLY_PHASE1')) return 'Early Phase 1';
  return 'N/A';
}

function slimStudy(s) {
  return {
    nct: s.nct, title: s.title, phase: stageOf(s), status: s.status,
    posted: s.firstPosted, start: s.start || null, sites: siteStatus(s),
    conditions: s.conditions.slice(0, 4), interventions: s.interventions.slice(0, 3),
  };
}

function buildCompanies(studies) {
  const phased = studies.filter(s => s.sponsor && isPhased(s) && isDrug(s) && s.firstPosted);
  const keys = new Set(phased.map(s => sponsorKey(s.sponsor)));
  const companies = new Map();
  for (const s of phased) {
    const own = sponsorKey(s.sponsor);
    const parent = parentKey(s.sponsor);
    // Fold a subsidiary into its parent when the parent has its own trials.
    const key = parent && keys.has(parent) ? parent : own;
    let c = companies.get(key);
    if (!c) companies.set(key, c = { key, names: new Map(), studies: [], parentName: null });
    c.names.set(s.sponsor, (c.names.get(s.sponsor) || 0) + 1);
    if (parent && !keys.has(parent)) c.parentName = splitParent(s.sponsor).parent;
    c.studies.push(s);
  }
  for (const c of companies.values()) {
    c.studies.sort((a, b) => a.firstPosted.localeCompare(b.firstPosted));
    // Display the most-used spelling, preferring the plain (non-subsidiary) form.
    c.name = [...c.names.entries()]
      .sort((a, b) => (/subsidiary/i.test(a[0]) - /subsidiary/i.test(b[0])) || b[1] - a[1])[0][0];
    c.firstTrial = c.studies[0];
    c.firstP2 = c.studies.find(isP2) || null;
    c.firstP3 = c.studies.find(isP3) || null;
    c.lastPosted = c.studies[c.studies.length - 1].firstPosted;
    c.trialCount = c.studies.length;
    c.area = classifyCondition(c.studies.slice(-5).flatMap(s => s.conditions));
    c.highest = c.firstP3 ? (c.studies.some(s => s.phases.includes('PHASE4')) ? 'Phase 4' : 'Phase 3')
      : c.firstP2 ? 'Phase 2' : 'Phase 1';
  }
  return companies;
}

function summarize(c, extra = {}) {
  return {
    key: c.key, name: c.name, parent: c.parentName, area: c.area,
    trialCount: c.trialCount, highest: c.highest,
    firstTrialDate: c.firstTrial.firstPosted,
    firstP2Date: c.firstP2?.firstPosted || null,
    lastPosted: c.lastPosted,
    ...extra,
  };
}

function buildViews(studies, today = new Date(), cfg = CONFIG) {
  const companies = buildCompanies(studies);
  const newCut = daysAgo(today, cfg.newWindowDays);
  const startsCut = daysAgo(today, cfg.startsWindowDays);
  const dirCut = daysAgo(today, cfg.directoryActiveYears * 365);

  const newCompanies = [];
  const newToP2 = [];
  const p2Starts = [];
  const directory = [];

  for (const c of companies.values()) {
    const usP1 = c.studies.filter(s => isP1(s) && usOrPending(s));
    const usP2 = c.studies.filter(s => isP2(s) && usOrPending(s));

    if (c.firstTrial.firstPosted >= newCut && usP1.length) {
      newCompanies.push(summarize(c, { studies: c.studies.map(slimStudy) }));
    }

    if (c.firstP2 && c.firstP2.firstPosted >= newCut && usP2.length) {
      const priorP1 = c.studies.filter(s => isP1(s) && s.firstPosted < c.firstP2.firstPosted);
      const monthsInClinic = (new Date(c.firstP2.firstPosted) - new Date(c.firstTrial.firstPosted)) / (30.44 * 864e5);
      newToP2.push(summarize(c, {
        priorP1Count: priorP1.length,
        monthsToP2: Math.round(monthsInClinic),
        p2Study: slimStudy(c.firstP2),
        studies: c.studies.map(slimStudy),
      }));
    }

    for (const s of usP2) {
      if (s.firstPosted >= startsCut) {
        p2Starts.push({ ...slimStudy(s), companyKey: c.key, company: c.name, trialCount: c.trialCount,
          area: classifyCondition(s.conditions), firstP2ForCompany: s === c.firstP2 });
      }
    }

    if (c.trialCount <= cfg.smallCompanyMaxTrials && c.lastPosted >= dirCut && (usP1.length || usP2.length)) {
      directory.push(summarize(c, {
        usP1: usP1.length, usP2: usP2.length,
        isNew: c.firstTrial.firstPosted >= newCut,
        isNewP2: !!(c.firstP2 && c.firstP2.firstPosted >= newCut),
      }));
    }
  }

  const byDate = f => (a, b) => f(b).localeCompare(f(a));
  newCompanies.sort(byDate(c => c.firstTrialDate));
  newToP2.sort(byDate(c => c.firstP2Date));
  p2Starts.sort(byDate(s => s.posted));
  directory.sort(byDate(c => c.lastPosted));
  return { newCompanies, newToP2, p2Starts, directory, config: cfg, companyCount: companies.size };
}

module.exports = { buildViews, CONFIG };
