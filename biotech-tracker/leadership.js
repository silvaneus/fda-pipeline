/**
 * Company leadership, strongest source first:
 *   1. The leadership check (state/leadership.json): a scheduled Claude routine
 *      reads each company's own website (team / leadership / about pages) and
 *      records the executive team with titles and who founded the company.
 *   2. The company's latest SEC Form D, which names executive officers and
 *      directors but gives no titles.
 *
 * The routine works through state/leadership-queue.json, which every nightly
 * run rewrites: companies never checked or last checked more than
 * RECHECK_DAYS ago, most useful first.
 */

const fs = require('fs');
const path = require('path');

const CHECKS_FILE = path.join(__dirname, 'state', 'leadership.json');
const QUEUE_FILE = path.join(__dirname, 'state', 'leadership-queue.json');
const RECHECK_DAYS = 180;
const QUEUE_SIZE = 200;

const CEO = /\b(ceo|chief executive)\b/i;
const CSUITE = /\b(chief \w+( \w+)? officer|ceo|cfo|coo|cso|cmo|cto|cbo|cco|president)\b/i;

function loadChecks() {
  try { return JSON.parse(fs.readFileSync(CHECKS_FILE, 'utf8')).checks || {}; } catch { return {}; }
}

/** The leadership block for one company's profile, or null. */
function leadersFor(key, name, checks, sec) {
  const c = checks[key];
  if (c?.people?.length) {
    return { source: 'web', checked: c.checked, url: c.sources?.[0] || null,
      people: c.people.map(p => ({ name: p.name, title: p.title || '', founder: !!p.founder })) };
  }
  const e = sec[name];
  if (e?.people?.length) {
    return { source: 'sec', checked: e.peopleDate, url: null,
      people: e.people.map(p => ({ name: p.name, title: p.roles.join(', '), founder: false, note: p.note })) };
  }
  return null;
}

/**
 * Rows for the Leadership tab: one per person. Form D directors are left out
 * (board seats, often investors); executive officers stay.
 */
function tabRows(companies, leaders) {
  const rows = [];
  for (const c of companies) {
    const l = leaders.get(c.key);
    if (!l) continue;
    for (const p of l.people) {
      if (l.source === 'sec' && !/Executive Officer/.test(p.title)) continue;
      rows.push({ key: c.key, person: p.name, role: l.source === 'sec' ? 'Executive officer' : p.title, founder: p.founder,
        ceo: CEO.test(p.title), csuite: CSUITE.test(p.title) || p.founder, src: l.source });
    }
  }
  return rows;
}

/**
 * Rewrite the routine's work list. Order: new to the clinic / new to Phase 2,
 * then emerging US companies (most recent trial first), then unknown HQ,
 * then the rest.
 */
function writeQueue(views, profileOf, checks, sec) {
  const now = Date.now();
  const due = key => { const c = checks[key]; return !c || now - new Date(c.checked) > RECHECK_DAYS * 864e5; };
  const tier = c => {
    if (c.isNew || c.isNewP2) return 0;
    if (c.marketed) return c.hq?.us ? 3 : 4;
    return c.hq?.us === true ? 1 : c.hq?.us == null ? 2 : 4;
  };
  const seen = new Map();
  for (const c of [...views.newCompanies.map(x => ({ ...x, isNew: true })), ...views.newToP2.map(x => ({ ...x, isNewP2: true })), ...views.directory]) {
    if (!seen.has(c.key)) seen.set(c.key, c);
  }
  const list = [...seen.values()].filter(c => due(c.key))
    .sort((a, b) => tier(a) - tier(b) || String(b.lastPosted || b.firstTrialDate).localeCompare(String(a.lastPosted || a.firstTrialDate)))
    .slice(0, QUEUE_SIZE)
    .map(c => {
      const p = profileOf(c.key);
      const lead = p?.pipeline.find(g => g.current) || p?.pipeline[0];
      return {
        key: c.key, name: c.name, previousCheck: checks[c.key]?.checked || null,
        website: c.hq?.website || null, websiteSource: c.hq?.websiteSource || null,
        headquarters: c.hq?.place || null, area: c.area,
        leadDrug: lead ? `${lead.drug} (${lead.phase}, ${lead.conditions.slice(0, 2).join('; ')})` : null,
        secOfficers: (sec[c.name]?.people || []).filter(x => x.roles.includes('Executive Officer')).map(x => x.name),
      };
    });
  fs.writeFileSync(QUEUE_FILE, JSON.stringify({
    about: 'Companies due for a leadership check, most useful first. Rewritten every night by run.js; do not edit by hand. Results go in leadership.json.',
    generated: new Date().toISOString().slice(0, 10),
    remaining: [...seen.values()].filter(c => due(c.key)).length,
    companies: list,
  }, null, 1));
  return list.length;
}

module.exports = { loadChecks, leadersFor, tabRows, writeQueue, CHECKS_FILE };
