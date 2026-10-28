/**
 * Turns the full industry study list into company histories and the four
 * dashboard views. Pure function of (studies, today, config) so the numbers
 * can be re-derived from any snapshot.
 */

const { sponsorKey, parentKey, splitParent } = require('./sponsors');
const { classifyCondition } = require('./classify-disease');
const { tagIndications } = require('./indications');

const CONFIG = {
  newWindowDays: 183,      // how long a company keeps its "new" flag
  startsWindowDays: 90,    // Phase 2 starts feed
  smallCompanyMaxTrials: 25, // size proxy: total phased industry trials
  directoryActiveYears: 5, // directory: posted a trial within this many years
  currentYears: 2,         // a completed study keeps its indication "current" this long
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
// Terminated or withdrawn studies usually mean a dropped program. They still
// count as history (when a company entered the clinic) but never as a
// current program, indication or Phase 2 start.
const isDead = s => s.status === 'TERMINATED' || s.status === 'WITHDRAWN';
// "Current" = still pursued: running now, or finished recently enough that a
// follow-on study may not be posted yet. A Phase 1 completed in 2019 with
// nothing since is a dormant program and shouldn't put a company under that
// indication today (Shattuck Labs: one 2019 basket study tagged it lung cancer).
const RUNNING = new Set(['RECRUITING', 'NOT_YET_RECRUITING', 'ACTIVE_NOT_RECRUITING', 'ENROLLING_BY_INVITATION']);
const isCurrent = (s, cut) => RUNNING.has(s.status) || (s.completion || s.lastUpdate || '') >= cut;
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
    // Often names the mechanism, line of therapy and population; skip when it
    // just repeats the brief title.
    officialTitle: s.officialTitle && s.officialTitle.toLowerCase() !== (s.title || '').toLowerCase() ? s.officialTitle : null,
    posted: s.firstPosted, start: s.start || null, sites: siteStatus(s),
    conditions: s.conditions.slice(0, 4), interventions: s.interventions.slice(0, 3),
  };
}

function buildCompanies(studies, today = new Date(), cfg = CONFIG) {
  const currentCut = daysAgo(today, cfg.currentYears * 365);
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
    c.live = c.studies.filter(s => !isDead(s));
    c.current = c.live.filter(s => isCurrent(s, currentCut));
    c.currentCut = currentCut;
    c.area = classifyCondition((c.current.length ? c.current : c.live.length ? c.live : c.studies).slice(-5).flatMap(s => s.conditions));
    // Furthest phase among programs still alive: a Phase 3 that was
    // terminated doesn't make a company late-stage.
    c.highest = c.live.some(s => s.phases.includes('PHASE4')) ? 'Phase 4'
      : c.live.some(isP3) ? 'Phase 3' : c.live.some(isP2) ? 'Phase 2' : c.live.length ? 'Phase 1' : 'None active';
  }
  return companies;
}

// Interventions that are comparators, not the company's own program.
const NON_PROGRAM = /placebo|vehicle|saline|sham|standard[- ]of[- ]care|best supportive|usual care|matching|\bcontrol\b|observation|no intervention|dummy/i;
// Development codes ("MTX-531", "ABC123") are the surest sign of an in-house drug.
const DEV_CODE = /\b[A-Z]{1,6}[- ]?\d{2,}[A-Z0-9-]*\b/;
const PHASE_RANK = { 'Early Phase 1': 1, 'Phase 1': 2, 'Phase 1/2': 3, 'Phase 2': 4, 'Phase 2/3': 5, 'Phase 3': 6, 'Phase 4': 7, 'N/A': 0 };
const ACTIVE = new Set(['RECRUITING', 'NOT_YET_RECRUITING', 'ACTIVE_NOT_RECRUITING', 'ENROLLING_BY_INVITATION']);

/** Group a company's studies by lead drug: the closest thing to a pipeline chart. */
function buildPipeline(c) {
  const groups = new Map();
  for (const s of c.live) {
    const ivs = s.interventions.filter(x => x && !NON_PROGRAM.test(x));
    const primary = ivs.find(x => DEV_CODE.test(x)) || ivs[0];
    if (!primary) continue;
    const code = primary.match(DEV_CODE)?.[0];
    const key = (code || primary).toLowerCase().replace(/[^a-z0-9]/g, '');
    let g = groups.get(key);
    if (!g) groups.set(key, g = { names: new Map(), with: new Set(), conditions: new Set(), studies: [] });
    g.names.set(primary, (g.names.get(primary) || 0) + 1);
    // Dose arms ("Mid Dose LX2006") repeat the lead code; they are not partners.
    const sameDrug = x => (x.match(DEV_CODE)?.[0] || x).toLowerCase().replace(/[^a-z0-9]/g, '') === key;
    ivs.filter(x => x !== primary && !sameDrug(x)).forEach(x => g.with.add(x));
    s.conditions.forEach(x => g.conditions.add(x));
    g.studies.push(s);
  }
  return [...groups.values()].map(g => {
    const current = g.studies.some(s => isCurrent(s, c.currentCut));
    const lastActivity = g.studies.map(s => s.completion || s.lastUpdate || s.firstPosted).sort().pop();
    const latest = g.studies[g.studies.length - 1];
    const top = g.studies.map(stageOf).sort((a, b) => PHASE_RANK[b] - PHASE_RANK[a])[0];
    return {
      indications: tagIndications([...g.conditions]),
      drug: [...g.names.entries()].sort((a, b) => b[1] - a[1] || a[0].length - b[0].length)[0][0],
      with: [...g.with].slice(0, 4),
      conditions: [...g.conditions].slice(0, 6),
      area: classifyCondition([...g.conditions]),
      phase: top,
      status: latest.status,
      active: g.studies.some(s => ACTIVE.has(s.status)),
      current, lastActivity,
      trials: g.studies.map(s => s.nct),
      firstPosted: g.studies[0].firstPosted,
      lastPosted: latest.firstPosted,
    };
  }).sort((a, b) => (b.current - a.current) || PHASE_RANK[b.phase] - PHASE_RANK[a.phase] || b.lastPosted.localeCompare(a.lastPosted));
}

function buildProfile(c) {
  const areas = {};
  for (const s of (c.current.length ? c.current : c.live)) { const a = classifyCondition(s.conditions); areas[a] = (areas[a] || 0) + 1; }
  return {
    key: c.key, name: c.name, otherNames: [...c.names.keys()].filter(n => n !== c.name).slice(0, 5),
    parent: c.parentName, area: c.area, areas, trialCount: c.trialCount, highest: c.highest,
    firstTrialDate: c.firstTrial.firstPosted, firstP2Date: c.firstP2?.firstPosted || null, lastPosted: c.lastPosted,
    activeCount: c.live.filter(s => ACTIVE.has(s.status)).length,
    usSites: c.live.some(hasUS),
    pipeline: buildPipeline(c).slice(0, 20),
    studies: c.live.slice(-40).map(slimStudy).reverse(),
    liveCount: c.live.length,
    currentCount: c.current.length,
    droppedCount: c.trialCount - c.live.length,
  };
}

function summarize(c, extra = {}) {
  const conds = [...new Set(c.live.flatMap(s => s.conditions))];
  return {
    key: c.key, name: c.name, parent: c.parentName, area: c.area,
    // Filters use current programs only; search still covers every live trial.
    indications: tagIndications([...new Set(c.current.flatMap(s => s.conditions))]),
    // Search fields: every condition and lead drug, so "NSCLC" or a drug
    // code finds a company even from the directory.
    conds: conds.slice(-30),
    drugs: buildPipeline(c).slice(0, 15).map(g => g.drug),
    trialCount: c.trialCount, highest: c.highest,
    firstTrialDate: c.firstTrial.firstPosted,
    firstP2Date: c.firstP2?.firstPosted || null,
    lastPosted: c.lastPosted,
    ...extra,
  };
}

function buildViews(studies, today = new Date(), cfg = CONFIG) {
  const companies = buildCompanies(studies, today, cfg);
  const newCut = daysAgo(today, cfg.newWindowDays);
  const startsCut = daysAgo(today, cfg.startsWindowDays);
  const dirCut = daysAgo(today, cfg.directoryActiveYears * 365);

  const newCompanies = [];
  const newToP2 = [];
  const p2Starts = [];
  const directory = [];

  for (const c of companies.values()) {
    const usP1 = c.live.filter(s => isP1(s) && usOrPending(s));
    const usP2 = c.live.filter(s => isP2(s) && usOrPending(s));

    if (c.firstTrial.firstPosted >= newCut && usP1.length) {
      newCompanies.push(summarize(c, { studies: c.live.map(slimStudy) }));
    }

    // First-ever Phase 2 is recent, and a Phase 2 from that window is still alive.
    const liveNewP2 = usP2.find(s => s.firstPosted >= newCut);
    if (c.firstP2 && c.firstP2.firstPosted >= newCut && liveNewP2) {
      const priorP1 = c.studies.filter(s => isP1(s) && s.firstPosted < c.firstP2.firstPosted);
      const monthsInClinic = (new Date(c.firstP2.firstPosted) - new Date(c.firstTrial.firstPosted)) / (30.44 * 864e5);
      const newP2s = usP2.filter(s => s.firstPosted >= newCut);
      newToP2.push(summarize(c, {
        // On this tab the indication is the new Phase 2's, not the company's.
        p2Indications: tagIndications(newP2s.flatMap(s => s.conditions)),
        p2Area: classifyCondition(newP2s.flatMap(s => s.conditions)),
        priorP1Count: priorP1.length,
        monthsToP2: Math.round(monthsInClinic),
        p2Study: slimStudy(liveNewP2),
        studies: c.live.map(slimStudy),
      }));
    }

    for (const s of usP2) {
      if (s.firstPosted >= startsCut) {
        p2Starts.push({ ...slimStudy(s), companyKey: c.key, company: c.name, trialCount: c.trialCount,
          area: classifyCondition(s.conditions), indications: tagIndications(s.conditions), firstP2ForCompany: s === c.firstP2 });
      }
    }

    // Phase 3 counts too: a company stops being emerging once it has a marketed
    // drug (run.js), not once it reaches Phase 3.
    const usP3 = c.live.filter(s => s.phases.includes('PHASE3') && usOrPending(s));
    if (c.trialCount <= cfg.smallCompanyMaxTrials && c.lastPosted >= dirCut && (usP1.length || usP2.length || usP3.length)) {
      directory.push(summarize(c, {
        usP1: usP1.length, usP2: usP2.length, usP3: usP3.length,
        isNew: c.firstTrial.firstPosted >= newCut,
        isNewP2: !!(c.firstP2 && c.firstP2.firstPosted >= newCut && usP2.some(s => s.firstPosted >= newCut)),
      }));
    }
  }

  const byDate = f => (a, b) => f(b).localeCompare(f(a));
  newCompanies.sort(byDate(c => c.firstTrialDate));
  newToP2.sort(byDate(c => c.firstP2Date));
  p2Starts.sort(byDate(s => s.posted));
  directory.sort(byDate(c => c.lastPosted));
  return { newCompanies, newToP2, p2Starts, directory, config: cfg, companyCount: companies.size, companies };
}

module.exports = { buildViews, buildProfile, CONFIG };
