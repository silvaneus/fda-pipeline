// Groups article events into FDA applications and assigns each one a decision date:
// announced PDUFA date if MJH reported one, otherwise an estimate from acceptance or submission.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractAll, normName, indicationTokens } from './extract.js';
import { fdaApprovals, actionNames, appNames, nameMatch, cleanName } from './coverage.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'state', 'pipeline.json');

// The user's estimation rules. For a new application the review clock starts after the
// 60-day filing review; for a supplement (sNDA/sBLA) FDA starts it at submission, so a
// supplement's goal date is 10 or 6 months from submission (acceptance minus 60 days).
// Checked against MJH-reported dates: priority supplements land a median 4.0 months after
// acceptance, standard supplements 7.6.
export const RULES = {
  filingDays: 60,          // FDA filing review before the PDUFA clock starts (new applications only)
  standardMonths: 10,
  priorityMonths: 6,
  resubClass1Months: 2,
  resubClass2Months: 6,    // also used when the class is not reported
};

const addMonths = (iso, m) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + m);
  return d.toISOString().slice(0, 10);
};
const addDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);

class UnionFind {
  constructor() { this.p = new Map(); }
  find(x) {
    if (!this.p.has(x)) this.p.set(x, x);
    while (this.p.get(x) !== x) { this.p.set(x, this.p.get(this.p.get(x))); x = this.p.get(x); }
    return x;
  }
  union(a, b) { this.p.set(this.find(a), this.find(b)); }
}

const looksGeneric = s => /^[a-z][a-z -]+$/.test(s) && !/\b(plus|and|with)\b/.test(s);

// Early-disease and advanced-disease filings of one drug are separate applications, even when
// "ER-positive breast cancer" makes them read alike.
const stageOf = t => {
  const early = /\b(early|adjuvant|neoadjuvant|perioperative|resectable)\b/i.test(t || ''), late = /\b(advanced|metastatic|unresectable|pretreated|previously treated)\b/i.test(t || '');
  return early === late ? null : early ? 'early' : 'late';
};
function similarity(a, b) {
  if (!a.size || !b.size) return null;
  let n = 0;
  for (const t of a) if (b.has(t)) n++;
  return n / Math.min(a.size, b.size);
}

const KNOWN_ALIASES = [['NAI', 'nogapendekin alfa inbakicept'], ['N-803', 'nogapendekin alfa inbakicept'], ['NAI', 'nogapendekin alfa inbakicept-pmln']];

export async function buildPipeline({ today = new Date().toISOString().slice(0, 10), useFDA = true } = {}) {
  const { articles, events, pairs } = extractAll();

  // 1. Drug identity: merge names the articles themselves equate, e.g. "obinutuzumab (Gazyva)".
  const uf = new UnionFind();
  const counts = new Map();
  // Short names the articles never spell out next to the full one.
  for (const [a, b] of KNOWN_ALIASES) pairs.push([a, b]);
  for (const [a, b] of pairs) {
    const x = normName(a), y = normName(b);
    // A brand that is paired with more than one generic is a combination; do not chain through it.
    counts.set(`${x}|${y}`, (counts.get(`${x}|${y}`) || 0) + 1);
  }
  const partnersOf = new Map();
  for (const key of counts.keys()) {
    const [x, y] = key.split('|');
    for (const [k, v] of [[x, y], [y, x]]) {
      if (!partnersOf.has(k)) partnersOf.set(k, new Set());
      partnersOf.get(k).add(v);
    }
  }
  for (const key of counts.keys()) {
    const [x, y] = key.split('|');
    const gx = [...partnersOf.get(x)].filter(looksGeneric).length;
    const gy = [...partnersOf.get(y)].filter(looksGeneric).length;
    if (looksGeneric(x) && looksGeneric(y) && gx > 1 && gy > 1) continue;
    // A name paired with many different names is a hub (a company, a class, a common word), not an alias.
    if (partnersOf.get(x).size > 3 || partnersOf.get(y).size > 3) continue;
    uf.union(x, y);
  }
  // "nogapendekin alfa inbakicept" / "nogapendekin", "ifinatamab deruxtecan" / "ifinatamab":
  // the short form is the same agent unless it is a drug in its own right (trastuzumab).
  const standalone = new Set(events.filter(e => e.type === 'approved' && e.where === 'headline').map(e => normName(e.drug)));
  const names = new Set(events.map(e => normName(e.drug)));
  for (const n of names) {
    const words = n.split(' ');
    if (words[0].length < 6) continue;
    for (let k = 1; k < words.length; k++) {
      const pre = words.slice(0, k).join(' ');
      // Only a one-word stem can be a drug in its own right (trastuzumab vs trastuzumab deruxtecan).
      if (names.has(pre) && !(k === 1 && standalone.has(pre))) uf.union(pre, n);
    }
  }
  // Event names written as "name (alias)" also merge their two halves.
  for (const e of events) {
    const x = e.drug.match(/^(.+?)\s*\(([^()]+)\)$/);
    if (x) uf.union(normName(x[1]), normName(x[2]));
  }
  const display = new Map();
  for (const e of events) {
    const k = uf.find(normName(e.drug));
    if (!display.has(k)) display.set(k, new Map());
    const m = display.get(k);
    m.set(e.drug, (m.get(e.drug) || 0) + 1);
  }
  const nameFor = k => {
    const m = [...display.get(k).entries()];
    const generic = m.filter(([n]) => looksGeneric(n.toLowerCase()) && n === n.toLowerCase());
    const clean = (generic.length ? generic : m).filter(([n]) => !n.includes('('));
    return (clean.length ? clean : m).sort((a, b) => b[1] - a[1])[0][0];
  };
  const aliasesFor = k => [...uf.p.keys()].filter(x => uf.find(x) === k);

  // 2. Decision articles restate how the application got there. Without a date those
  //    restatements are history, not news, so they are dropped.
  const decided = new Set(events.filter(e => e.where === 'headline' && (e.type === 'approved' || e.type === 'crl'))
    .map(e => `${e.articleId}|${uf.find(normName(e.drug))}`));
  const usable = events.filter(e => {
    if (e.where !== 'body') return true;
    const k = `${e.articleId}|${uf.find(normName(e.drug))}`;
    if (e.date === 'history') return false;
    return !decided.has(k) || (e.date && e.type !== 'pdufa');
  });

  // 3. Applications per drug, walked in date order.
  const byDrug = new Map();
  for (const e of usable) {
    const k = uf.find(normName(e.drug));
    if (!byDrug.has(k)) byDrug.set(k, []);
    // A passing "FDA approved X" sentence carries its indication in the sentence itself.
    byDrug.get(k).push({ ...e, when: e.date || e.published, tokens: indicationTokens(e.indication || (e.closeOnly ? e.evidence : null)), stage: stageOf(e.indication) });
  }

  const apps = [];
  for (const [drugKey, evs] of byDrug) {
    evs.sort((a, b) => a.when.localeCompare(b.when) || (a.where === 'headline' ? -1 : 1));
    // Two announced PDUFA dates apart are two filings (giredestrant adjuvant Nov 30, with
    // everolimus Dec 18), however alike their indications read. An extension is the exception.
    const artDates = new Map(), artExt = new Set();
    for (const e of evs) {
      if (e.pdufaDate) artDates.set(e.articleId, [...(artDates.get(e.articleId) || []), e.pdufaDate]);
      if (e.type === 'extended') artExt.add(e.articleId);
    }
    const appDates = a => a.events.map(x => x.pdufaDate).filter(Boolean);
    const dateConflict = (e, a) => {
      const mineD = e.pdufaDate ? [e.pdufaDate] : artDates.get(e.articleId) || [];
      const theirs = appDates(a);
      // After a CRL, the resubmission's new date is the same application's next cycle.
      if (!mineD.length || !theirs.length || artExt.has(e.articleId) || a.events.some(x => x.type === 'extended' || x.type === 'crl')) return false;
      return !mineD.some(d => theirs.some(t => Math.abs(daysBetween(d, t)) <= 7));
    };
    const mine = [];
    for (const e of evs) {
      const isDecision = e.type === 'approved' || e.type === 'crl' || e.type === 'withdrawn';
      // A story recalling the drug's last CRL in passing is history, not a second CRL.
      if (e.type === 'crl' && e.where === 'body' && mine.some(a => [a.decision, ...a.cycles].some(d => d?.type === 'crl' && daysBetween(d.when, e.when) >= 0 && daysBetween(d.when, e.when) <= 400))) continue;
      // Candidates: undecided apps, or a CRL'd app being resubmitted.
      const candidates = mine.filter(a =>
        !a.decision || (a.decision.type === 'crl' && !isDecision) ||
        // Same decision reported twice (news story, then a follow-up) stays on one app.
        (isDecision && a.decision.type === e.type && daysBetween(a.decision.when, e.when) <= 45));
      let best = null, bestScore = -1;
      for (const a of candidates) {
        const sim = similarity(e.tokens, a.tokens);
        // The same decision written up again within weeks is one decision, however it is worded.
        const repeat = isDecision && a.decision?.type === e.type && daysBetween(a.decision.when, e.when) <= 45;
        if (sim !== null && sim < 0.34 && !repeat) continue;
        if (!isDecision && (e.where === 'headline' || e.tokens.size) && dateConflict(e, a)) continue;
        if (e.stage && a.stage && e.stage !== a.stage) continue;
        // A stated PDUFA date is the strongest link: it names the filing outright.
        const dateHit = e.pdufaDate && appDates(a).some(t => Math.abs(daysBetween(e.pdufaDate, t)) <= 7) ? 1 : 0;
        // News about a filing under review belongs to the open cycle, not to one a CRL already closed.
        const closed = !isDecision && a.decision?.type === 'crl' && e.type !== 'resubmitted' ? 0.6 : 0;
        const score = (sim ?? 0.5) + dateHit - closed + (a.lastWhen <= e.when ? 0.01 : 0);
        if (score > bestScore || (score === bestScore && a.lastWhen > best.lastWhen)) { best = a; bestScore = score; }
      }
      // A decision whose indication reads differently still closes the drug's only open application.
      if (!best && isDecision) {
        // ...but never across two indications that share no terms at all (ccRCC vs MIBC).
        const open = mine.filter(a => !a.decision && daysBetween(a.lastWhen, e.when) >= 0 && daysBetween(a.lastWhen, e.when) <= 460
          && similarity(e.tokens, a.tokens) !== 0);
        if (open.length === 1) best = open[0];
      }
      if (!best && e.closeOnly) continue;
      // ...and only closes a filing whose indication it names.
      if (e.closeOnly && best && best.tokens.size && !(similarity(e.tokens, best.tokens) > 0)) continue;
      // A CRL'd app only reopens on an explicit resubmission or a later acceptance/PDUFA.
      if (best?.decision?.type === 'crl' && !isDecision && !['resubmitted', 'accepted', 'pdufa', 'extended'].includes(e.type)) best = null;
      if (!best) {
        best = { drugKey, events: [], tokens: new Set(), indication: null, partners: new Set(), decision: null, lastWhen: e.when, cycles: [] };
        mine.push(best);
      }
      best.events.push(e);
      best.lastWhen = e.when;
      // "Submitted for Adults" says nothing about the indication; keep the one already known.
      if (e.indication && (!best.indication || (e.where === 'headline' && (e.tokens.size || !best.tokens.size)))) { best.indication = e.indication; best.tokens = e.tokens; }
      if (e.stage && !best.stage) best.stage = e.stage;
      for (const p of e.partners || []) best.partners.add(p);
      if (isDecision) {
        if (!best.decision || best.decision.type !== e.type) best.decision = { type: e.type, when: e.when, url: e.url, title: e.title, where: e.where };
      } else if (best.decision?.type === 'crl') {
        best.cycles.push(best.decision);
        best.decision = null;
      }
    }
    apps.push(...mine);
  }

  // 3b. A name seen only inside one drug's articles, never in a headline of its own, is almost
  //     always that drug under another name (brand, code, formulation). Fold it in.
  const headlineDrugOf = new Map();
  for (const e of usable) if (e.where === 'headline') headlineDrugOf.set(e.articleId, uf.find(normName(e.drug)));
  const hostOf = a => {
    if (a.events.some(e => e.where === 'headline')) return null;
    const hosts = new Set(a.events.map(e => headlineDrugOf.get(e.articleId)));
    if (hosts.size !== 1) return null;
    const [h] = hosts;
    return h && h !== a.drugKey ? h : null;
  };
  for (const a of [...apps]) {
    const host = hostOf(a);
    if (!host || a.decision) continue;
    const targets = apps.filter(t => t.drugKey === host && t !== a && (!t.decision || t.decision.when >= a.lastWhen));
    if (!targets.length) continue;
    const t = targets.sort((x, y) => (similarity(a.tokens, y.tokens) ?? 0.5) - (similarity(a.tokens, x.tokens) ?? 0.5))[0];
    t.events.push(...a.events);
    t.events.sort((x, y) => x.when.localeCompare(y.when));
    if (!t.indication && a.indication) { t.indication = a.indication; t.tokens = a.tokens; }
    apps.splice(apps.indexOf(a), 1);
  }

  // 3c. One filing, several rows: a still-open application with no indication is a passing mention
  //     of the drug's other open filing; open applications sharing an announced PDUFA date are one.
  // Same choice as the row's date below: the most recently published announced date.
  // A filing's own headline date, else the date its stories give most often: a roundup naming the
  // drug's other filing date in passing must not make two filings look like one.
  const announcedOf = a => {
    const ds = a.events.filter(e => e.pdufaDate);
    const head = ds.filter(e => e.where === 'headline');
    const pool = head.length ? head : ds;
    const n = new Map();
    for (const e of pool) n.set(e.pdufaDate, (n.get(e.pdufaDate) || 0) + 1);
    return [...n].sort((x, y) => y[1] - x[1] || y[0].localeCompare(x[0]))[0]?.[0] || null;
  };
  const stem = a => [a.drugKey, ...[...uf.p.keys()].filter(x => uf.find(x) === a.drugKey)].map(n => n.replace(/[^a-z]/g, '').slice(0, 5)).filter(x => x.length === 5);
  const fold = (from, into) => {
    into.events.push(...from.events);
    into.events.sort((x, y) => x.when.localeCompare(y.when));
    if (!into.indication && from.indication) { into.indication = from.indication; into.tokens = from.tokens; }
    for (const p of from.partners) into.partners.add(p);
    apps.splice(apps.indexOf(from), 1);
  };
  for (const a of [...apps]) {
    if (a.decision || !apps.includes(a)) continue;
    const ann = announcedOf(a);
    const sameDrug = apps.filter(t => t !== a && !t.decision && t.drugKey === a.drugKey);
    let into = null;
    if (ann) into = sameDrug.find(t => announcedOf(t) === ann)
      || apps.find(t => t !== a && !t.decision && t.drugKey !== a.drugKey && announcedOf(t) === ann && stem(t).some(x => stem(a).includes(x)));
    if (!into && !a.indication && !ann) into = sameDrug.sort((x, y) => y.lastWhen.localeCompare(x.lastWhen))[0];
    // A submission that went quiet, then an acceptance with a date for the same indication: one filing
    // (zipalertinib submitted Mar 10, accepted Apr 28 with a Feb 27 PDUFA).
    if (!into && !ann) into = sameDrug.find(t => announcedOf(t) && (similarity(a.tokens, t.tokens) ?? 0) >= 0.5
      && !(a.stage && t.stage && a.stage !== t.stage) && a.lastWhen <= t.events.map(e => e.when).sort()[0]);
    if (into) fold(a, into);
  }

  // 4. Decision date for each application.
  const rows = apps.map(a => {
    // The current cycle starts at the latest CRL report (a third CRL can be reported over several days).
    // Folding rows together (3b, 3c) can bring in a CRL and a later resubmission without the cycle record.
    const lastCrl = a.events.filter(e => e.type === 'crl').map(e => e.when).sort().at(-1);
    const reopened = !!lastCrl && !a.decision && a.events.some(e => e.type === 'resubmitted' && e.when > lastCrl);
    const cycleStart = a.cycles.length || reopened ? lastCrl : '0000';
    // A CRL headline with no resubmission or acceptance after it closes the application, even when
    // folding rows together (3b, 3c) lost the decision record (oxylanthanum carbonate, second CRL).
    const crlHead = a.events.filter(e => e.type === 'crl' && e.where === 'headline').sort((x, y) => x.published.localeCompare(y.published)).at(-1);
    if (!a.decision && crlHead && !a.events.some(e => e.published > crlHead.published && ['resubmitted', 'accepted', 'pdufa', 'extended', 'submitted', 'approved'].includes(e.type))
      && !a.events.some(e => e.pdufaDate && e.pdufaDate > crlHead.published))
      a.decision = { type: 'crl', when: crlHead.published, url: crlHead.url, title: crlHead.title, where: 'headline' };
    const cur = a.events.filter(e => e.when >= cycleStart && !(e.pdufaDate && e.pdufaDate <= cycleStart));
    const priority = cur.some(e => e.priority);
    // A reported extension wins over later stories that restate the original date.
    const byPub = (x, y) => x.published.localeCompare(y.published);
    const ext = cur.filter(e => e.pdufaDate && e.type === 'extended').sort(byPub).at(-1);
    // Extensions only ever move a date later, so an "extension" older than a later announced date is stale.
    const latest = cur.filter(e => e.pdufaDate).sort(byPub).at(-1);
    const announced = ext && (!latest || ext.pdufaDate >= latest.pdufaDate) ? ext : latest;
    const guided = cur.filter(e => e.pdufaTimeframeEnd).sort((x, y) => x.published.localeCompare(y.published)).at(-1);
    const resub = cur.filter(e => e.type === 'resubmitted').sort((x, y) => x.when.localeCompare(y.when))[0];
    const accepted = cur.filter(e => e.type === 'accepted').sort((x, y) => x.when.localeCompare(y.when))[0];
    const submitted = cur.filter(e => e.type === 'submitted').sort((x, y) => x.when.localeCompare(y.when))[0];
    const months = priority ? RULES.priorityMonths : RULES.standardMonths;
    const supplemental = a.events.some(e => e.supplemental);

    let pdufa = null, basis = null, basisEvent = null;
    // A preview listing "PDUFA Date: November 30" where the company only said "by November" is the
    // writer's month-end, not an announced date.
    const PREVIEW = /preview|to watch|headlines|recap|rewind|outlook|roundup|look ahead/i;
    const placeholder = announced && guided && announced.pdufaDate === guided.pdufaTimeframeEnd
      && cur.filter(e => e.pdufaDate === announced.pdufaDate).every(e => PREVIEW.test(e.title));
    if (announced && !placeholder) { pdufa = announced.pdufaDate; basis = 'announced'; basisEvent = announced; }
    else if (placeholder) { pdufa = guided.pdufaTimeframeEnd; basis = `company guidance (${guided.pdufaTimeframe})`; basisEvent = guided; }
    else if (resub) {
      const cls = cur.find(e => e.resubClass)?.resubClass;
      pdufa = addMonths(resub.when, cls === 1 ? RULES.resubClass1Months : RULES.resubClass2Months);
      basis = 'estimated from resubmission'; basisEvent = resub;
    } else if (accepted) {
      pdufa = addMonths(supplemental ? addDays(accepted.when, -RULES.filingDays) : accepted.when, months);
      basis = 'estimated from acceptance'; basisEvent = accepted;
    } else if (submitted) {
      pdufa = addMonths(supplemental ? submitted.when : addDays(submitted.when, RULES.filingDays), months);
      basis = 'estimated from submission'; basisEvent = submitted;
    }
    else if (guided) { pdufa = guided.pdufaTimeframeEnd; basis = `company guidance (${guided.pdufaTimeframe})`; basisEvent = guided; }
    // Company guidance beats a formula when there is no announced date.
    // ...unless that window has already closed while the formula still points ahead (a stale mention).
    if (guided && basis?.startsWith('estimated') && !(guided.pdufaTimeframeEnd < today && pdufa >= today)) { pdufa = guided.pdufaTimeframeEnd; basis = `company guidance (${guided.pdufaTimeframe})`; basisEvent = guided; }

    let status = a.decision ? { approved: 'Approved', crl: 'CRL', withdrawn: 'Withdrawn' }[a.decision.type] : 'Pending';
    if (status === 'Pending' && pdufa && pdufa < today) status = daysBetween(pdufa, today) > 120 ? 'Unresolved' : 'Overdue';
    if (status === 'Pending' && !pdufa) status = 'Unresolved';

    const sources = [...new Map(a.events.map(e => [e.articleId, { url: e.url, title: e.title, published: e.published, brand: e.brand }])).values()]
      .sort((x, y) => x.published.localeCompare(y.published));
    // High confidence: a dated PDUFA, a headline about the filing itself, or more than one article.
    const preDecision = a.events.filter(e => !['approved', 'crl', 'withdrawn'].includes(e.type));
    const confidence = basis === 'announced' || preDecision.some(e => e.where === 'headline')
      || new Set(preDecision.map(e => e.articleId)).size > 1 || a.decision ? 'high' : 'low';
    return {
      drug: nameFor(a.drugKey),
      confidence,
      aliases: aliasesFor(a.drugKey),
      // A partner named both ways ("Tecentriq", "atezolizumab") is listed once.
      partners: [...new Map([...a.partners].map(p => [uf.find(normName(p)), p])).values()],
      indication: a.indication,
      priority,
      pdufaDate: pdufa,
      basis,
      basisEvidence: basisEvent?.evidence || null,
      basisUrl: basisEvent?.url || null,
      status,
      decision: a.decision,
      // A resubmission after a CRL filed under an earlier application still counts.
      priorCRLs: a.cycles.length || (reopened ? 1 : 0) || (a.events.some(e => e.type === 'resubmitted') && apps.some(o => o !== a && o.drugKey === a.drugKey && o.decision?.type === 'crl' && o.decision.when <= a.events[0].when) ? 1 : 0),
      cycles: a.cycles,
      firstSeen: a.events[0].when,
      // A supplement if a headline says sNDA/sBLA, or MJH reported an earlier approval of this drug.
      // A passing "supplemental" in some story's body is not enough (ivonescimab is a new BLA).
      supplemental: a.events.some(e => e.where === 'headline' && /\bs(NDA|BLA)\b|supplemental/i.test(e.title))
        || apps.some(o => o !== a && o.drugKey === a.drugKey && o.decision?.type === 'approved' && o.decision.when < a.events[0].when),
      brands: [...new Set(a.events.map(e => e.brand))],
      sources,
      events: a.events.map(({ tokens, partners, ...e }) => e),
    };
  });

  // 4b. A drug named next to another drug's PDUFA date (a partner, a comparator, background therapy,
  //     or a stray word) picks up that date. When every filing signal for an application comes from
  //     sentences in stories where another application has the same date and a headline of its own,
  //     it is that other application's date, not this drug's.
  const owners = new Map();
  for (const r of rows) for (const e of r.events) if (e.pdufaDate && e.where === 'headline') owners.set(`${e.articleId}|${e.pdufaDate}`, r);
  const sameDateOwner = new Map();
  for (const r of rows) for (const e of r.events) if (e.pdufaDate) {
    const k = `${e.articleId}|${e.pdufaDate}`;
    if (!sameDateOwner.has(k)) sameDateOwner.set(k, new Set());
    sameDateOwner.get(k).add(r);
  }
  const PRE = new Set(['submitted', 'accepted', 'pdufa', 'extended', 'resubmitted']);
  const headlineOwner = new Map();   // articleId -> application whose filing is the headline
  for (const r of rows) for (const e of r.events) if (e.where === 'headline' && PRE.has(e.type)) headlineOwner.set(e.articleId, r);
  const borrowed = r => {
    if (r.decision) return false;
    const pre = r.events.filter(e => PRE.has(e.type));
    if (!pre.length || pre.some(e => e.where === 'headline')) return false;
    // Shares a story with another filing carrying the same date.
    const articles = new Set(r.events.map(e => e.articleId));
    if (r.pdufaDate && rows.some(o => o !== r && o.drug !== r.drug && o.pdufaDate === r.pdufaDate
      && o.events.some(e => articles.has(e.articleId)) && (o.events.some(e => e.where === 'headline') || o.sources.length >= r.sources.length))) return true;
    // Every mention of its filing sits in a story whose headline is another drug's filing.
    return pre.every(e => { const o = headlineOwner.get(e.articleId); return o && o !== r && o.drug !== r.drug; });
  };
  for (let i = rows.length - 1; i >= 0; i--) if (borrowed(rows[i])) rows.splice(i, 1);

  // 4b'. The same open filing under two spellings ("delgocitinib" / "delgocitinib cream", "SL1009"
  //      twice): same first word, dates within 45 days, indications not contradicting. Keep the
  //      better-evidenced row and fold the other's sources into it.
  const firstWord = r => r.drug.toLowerCase().split(/[\s(]/)[0];
  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i];
    if (r.decision || !r.pdufaDate || firstWord(r).length < 5) continue;
    const twin = rows.find(o => o !== r && !o.decision && o.pdufaDate && firstWord(o) === firstWord(r)
      && Math.abs(daysBetween(o.pdufaDate, r.pdufaDate)) <= 45
      // Two different announced dates are two filings (giredestrant Nov 30 and Dec 18).
      && !(o.basis === 'announced' && r.basis === 'announced' && Math.abs(daysBetween(o.pdufaDate, r.pdufaDate)) > 3)
      && similarity(indicationTokens(o.indication), indicationTokens(r.indication)) !== 0);
    if (!twin) continue;
    // A row still ahead of its date is the live cycle; a past-due twin is the one a CRL ended.
    const score = x => (x.pdufaDate >= today ? 1000 : 0) + (x.basis === 'announced' ? 100 : 0) + x.sources.length;
    const [keep, drop] = score(twin) >= score(r) ? [twin, r] : [r, twin];
    keep.sources = [...new Map([...keep.sources, ...drop.sources].map(x => [x.url, x])).values()];
    keep.events = [...keep.events, ...drop.events];
    rows.splice(rows.indexOf(drop), 1);
    i = Math.min(i, rows.length);
  }

  // 4c. An approval MJH reported under a shorter or plainer name ("Once-Monthly Olanzapine" for
  //     TEV-'749 olanzapine extended-release) closes the open filing it names, when the indications agree.
  const mjhApprovals = rows.filter(r => r.decision?.type === 'approved' && r.decision.where === 'headline');
  for (const r of rows) {
    if (r.decision || !r.pdufaDate) continue;
    const N = appNames({ ...r, partners: [] });
    const hit = mjhApprovals.find(d => d !== r && d.decision.when >= r.firstSeen && daysBetween(r.pdufaDate, d.decision.when) >= -200
      && daysBetween(r.pdufaDate, d.decision.when) <= 60 && nameMatch(N, appNames({ ...d, partners: [] }))
      && (similarity(indicationTokens(r.indication), indicationTokens(d.indication || d.decision.title)) ?? 0) > 0);
    if (hit) { r.decision = { ...hit.decision }; r.status = 'Approved'; }
  }

  // 4d. A filing past its date with no outcome, whose drug MJH reported approved near that date, is the
  //     same filing split by different indication wording ("MDS, Leukemia" vs "Hematological Malignancies").
  for (const r of rows) {
    if (r.decision || !r.pdufaDate || r.pdufaDate >= today) continue;
    const N = appNames({ ...r, partners: [] });
    const twin = rows.find(d => d !== r && d.decision?.type === 'approved' && Math.abs(daysBetween(r.pdufaDate, d.decision.when)) <= 90
      && d.decision.when >= r.firstSeen && nameMatch(N, appNames({ ...d, partners: [] })));
    if (twin) { r.decision = { ...twin.decision }; r.status = 'Approved'; }
  }
  // 4e. A past-due row filed under the partner's name ("camrelizumab" for rivoceranib plus camrelizumab)
  //     whose combination is open again under the lead drug's name is the same filing's last cycle.
  for (const r of [...rows]) {
    if (r.decision || !r.pdufaDate || r.pdufaDate >= today) continue;
    const N = appNames({ ...r, partners: [] });
    const live = rows.find(o => o !== r && !o.decision && o.pdufaDate >= today && o.partners.some(p => nameMatch(N, new Set([cleanName(p)])))
      && similarity(indicationTokens(o.indication), indicationTokens(r.indication)) !== 0);
    if (live) {
      live.sources = [...new Map([...live.sources, ...r.sources].map(x => [x.url, x])).values()];
      rows.splice(rows.indexOf(r), 1);
    }
  }

  // 5. Close out applications FDA has acted on that MJH did not (or not recognisably) report.
  //    Matching is by name and by the decision falling near the expected date.
  if (useFDA) {
    let actions = [];
    try { actions = await fdaApprovals(addMonths(today, -24), today); } catch (e) { console.warn(`FDA approvals unavailable: ${e.message}`); }
    for (const act of actions) {
      const N = actionNames(act);
      // MJH already attributed this decision to one of the drug's filings: don't spend it on another.
      if (rows.some(r => r.decision && r.decision.source !== 'FDA' && Math.abs(daysBetween(r.decision.when, act.date)) <= 7 && nameMatch(N, appNames({ ...r, partners: [] })))) continue;
      // Early action is routine but rarely months ahead of an announced goal date.
      const open = rows.filter(r => {
        if (!['Pending', 'Overdue', 'Unresolved'].includes(r.status) || !r.pdufaDate || r.firstSeen > act.date) return false;
        const d = daysBetween(r.pdufaDate, act.date);
        const [lo, hi] = r.basis === 'announced' ? [-75, 30] : [-200, 60];
        // Combination partners are not the drug under review.
        return d >= lo && d <= hi && nameMatch(N, appNames({ ...r, partners: [] }));
      });
      const r = open.sort((x, y) => Math.abs(daysBetween(x.pdufaDate, act.date)) - Math.abs(daysBetween(y.pdufaDate, act.date)))[0];
      if (!r) continue;
      r.status = 'Approved';
      r.decision = { type: 'approved', when: act.date, source: 'FDA', title: `FDA approval: ${act.brand || act.generic} (${act.app})`, url: `https://www.accessdata.fda.gov/scripts/cder/daf/index.cfm?event=overview.process&ApplNo=${act.app.replace(/\D/g, '')}` };
    }
  }

  rows.sort((x, y) => (x.pdufaDate || '9999').localeCompare(y.pdufaDate || '9999'));
  const result = { generated: new Date().toISOString(), today, rules: RULES, articles: articles.length, events: events.length, applications: rows };
  fs.writeFileSync(OUT, JSON.stringify(result, null, 1));
  return result;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const r = await buildPipeline();
  const st = {};
  for (const a of r.applications) st[a.status] = (st[a.status] || 0) + 1;
  const basis = {};
  for (const a of r.applications.filter(x => x.status === 'Pending')) basis[a.basis?.replace(/ \(.*/, '')] = (basis[a.basis?.replace(/ \(.*/, '')] || 0) + 1;
  console.log({ applications: r.applications.length, status: st, pendingBasis: basis });
}
