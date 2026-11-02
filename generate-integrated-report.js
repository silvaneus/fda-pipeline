/**
 * Generates integrated HTML report combining:
 * - Phase 3 Clinical Trials Pipeline
 * - Near-Term FDA Catalysts (PDUFA dates)
 */

const fs = require('fs');
const path = require('path');
const { fetchAllTrials } = require('./fetch-trials');
const { classifyCondition, getAllTherapeuticAreas } = require('./classify-disease');
const { getSuccessRate, getAllSuccessRates, estimateApprovalDate } = require('./success-rates');
const { fetchApprovedDrugs, determineApprovalTypeAsync, getBestInterventionName } = require('./approved-drugs');
const { getPDUFACatalysts, getCatalystStats } = require('./pdufa-catalysts');

const REPORTS_DIR = path.join(__dirname, 'reports');

const EXCLUDED_INTERVENTION_PATTERNS = [
  /\bplacebo\b/i, /\bsham\b/i, /\bstandard of care\b/i, /\busual care\b/i,
  /\bbest supportive care\b/i, /\bactive comparator\b/i, /\bcontrol\s*(arm|group)?\b/i,
  /\bno treatment\b/i, /\bobservation(al)?\b/i, /\bwatchful waiting\b/i, /^soc$/i, /^bsc$/i
];

function formatDate(dateStr) {
  if (!dateStr) return 'Not specified';
  try {
    // Add T12:00:00 to avoid timezone issues with YYYY-MM-DD dates
    const normalized = dateStr.includes('T') ? dateStr : dateStr + 'T12:00:00';
    const date = new Date(normalized);
    if (isNaN(date.getTime())) return dateStr;
    return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short' });
  } catch { return dateStr; }
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

function getInvestigationalInterventions(interventions) {
  if (!interventions || interventions.length === 0) return [];
  return interventions.filter(i => !EXCLUDED_INTERVENTION_PATTERNS.some(p => p.test(i)));
}

function filterStaleTrials(trials) {
  const now = new Date();
  return trials.filter(t => {
    if (!t.primaryCompletionDate) return true;
    const d = new Date(t.primaryCompletionDate);
    return isNaN(d.getTime()) || d >= now;
  });
}

function filterNonDrugTrials(trials) {
  const patterns = [/\b(prosthesis|implant|device)\b/i, /\b(surgery|surgical|procedure)\b/i,
    /\b(radiation|radiotherapy)\b/i, /\b(diagnostic|imaging)\b/i, /\b(bioavailability|healthy volunteer)\b/i];
  return trials.filter(t => {
    const text = [...(t.conditions || []), ...(t.interventions || [])].join(' ').toLowerCase();
    return !patterns.some(p => p.test(text));
  });
}

async function processTrials(trials, approvedDrugs = {}, verbose = false) {
  const results = [];
  for (let i = 0; i < trials.length; i++) {
    const t = trials[i];
    const area = classifyCondition(t.conditions);
    const rate = getSuccessRate(area);
    const invInterventions = getInvestigationalInterventions(t.interventions);
    const bestName = getBestInterventionName(invInterventions);
    const approvalInfo = await determineApprovalTypeAsync(invInterventions, approvedDrugs);
    const estApproval = estimateApprovalDate(t.primaryCompletionDate, area);
    if (verbose && (i + 1) % 100 === 0) console.log(`  Processed ${i + 1}/${trials.length} trials...`);
    results.push({
      ...t, therapeuticArea: area, successRate: rate.rate, successRateRange: rate.range,
      formattedCompletionDate: formatDate(t.primaryCompletionDate),
      estimatedApprovalDate: estApproval,
      formattedApprovalDate: estApproval ? formatDate(estApproval.toISOString()) : 'TBD',
      investigationalIntervention: bestName || invInterventions.slice(0, 2).join(', ') || 'Not specified',
      conditionDisplay: t.conditions?.slice(0, 2).join(', ') || 'Not specified',
      approvalType: approvalInfo.type
    });
  }
  return results;
}

function generateTrialStats(trials) {
  const byArea = {}, bySponsor = {}, byApprovalType = { 'New Approval': 0, 'Supplemental': 0 }, timeline = {};
  for (const t of trials) {
    byArea[t.therapeuticArea] = (byArea[t.therapeuticArea] || 0) + 1;
    bySponsor[t.leadSponsor || 'Unknown'] = (bySponsor[t.leadSponsor || 'Unknown'] || 0) + 1;
    byApprovalType[t.approvalType] = (byApprovalType[t.approvalType] || 0) + 1;
    if (t.primaryCompletionDate) {
      const d = new Date(t.primaryCompletionDate);
      if (!isNaN(d.getTime())) {
        const q = `${d.getFullYear()} Q${Math.ceil((d.getMonth() + 1) / 3)}`;
        timeline[q] = (timeline[q] || 0) + 1;
      }
    }
  }
  const topSponsors = Object.entries(bySponsor).sort((a, b) => b[1] - a[1]).slice(0, 20);
  return { total: trials.length, byArea, topSponsors, timeline, byApprovalType };
}

// The page shares the Emerging Biotech Tracker's look: one accent colour,
// neutral badges, colour kept for what needs attention (due soon, past due).
// Client code below avoids backslashes: this is one template literal, so a
// "\s" or "\n" written here would reach the page as "s" or a raw line break.
function generateHTML(trials, trialStats, catalysts, catalystStats, recentOutcomes = []) {
  const successRates = getAllSuccessRates();
  const areas = getAllTherapeuticAreas();
  const timelineLabels = Object.keys(trialStats.timeline).sort();
  const timelineData = timelineLabels.map(q => trialStats.timeline[q]);
  const sortedAreas = Object.entries(trialStats.byArea).sort((a, b) => b[1] - a[1]);
  const areaLabels = sortedAreas.map(([a]) => a);
  const areaCounts = sortedAreas.map(([, c]) => c);

  // Get unique years for filters
  const completionYears = [...new Set(trials.filter(t => t.primaryCompletionDate).map(t => new Date(t.primaryCompletionDate).getFullYear()).filter(y => !isNaN(y)))].sort();
  const fdaYears = [...new Set(trials.filter(t => t.estimatedApprovalDate).map(t => new Date(t.estimatedApprovalDate).getFullYear()).filter(y => !isNaN(y)))].sort();

  const announced = catalysts.filter(c => !c.dateBasis || c.dateBasis === 'Announced').length;
  const next30 = catalysts.filter(c => c.daysUntilPDUFA !== null && c.daysUntilPDUFA >= 0 && c.daysUntilPDUFA <= 30).length;
  const by30 = new Date(Date.now() + 30 * 864e5).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/New_York' });
  const approved = recentOutcomes.filter(o => o.outcome === 'Approved').length;
  const crl = recentOutcomes.filter(o => o.outcome === 'CRL').length;
  const generated = new Date().toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York', timeZoneName: 'short' });
  const n = x => Number(x || 0).toLocaleString('en-US');
  // Pipeline 2.0 decisions rarely name the company; drop the column rather than show a column of dashes.
  const decidedCompany = recentOutcomes.some(o => o.company);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>FDA Pipeline</title>
  <link rel="icon" type="image/svg+xml" href="data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
    <rect width="64" height="64" rx="14" fill="#1d4ed8"/>
    <rect x="14" y="18" width="36" height="32" rx="5" fill="white"/>
    <rect x="14" y="18" width="36" height="9" rx="4" fill="#bfdbfe"/>
    <rect x="21" y="12" width="4" height="10" rx="2" fill="white"/>
    <rect x="39" y="12" width="4" height="10" rx="2" fill="white"/>
    <path d="M24 38 l5 5 l11-11" stroke="#1d4ed8" stroke-width="4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`)}">
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>
  <style>
    :root {
      --bg: #f5f7fa; --card: #fff; --ink: #111827; --ink-2: #374151; --muted: #6b7280; --faint: #9ca3af;
      --line: #e5e7eb; --line-2: #f1f5f9;
      --accent: #1d4ed8; --accent-ink: #1e3a8a; --accent-soft: #eff6ff; --accent-line: #bfdbfe;
      --hot: #b91c1c; --hot-soft: #fef2f2; --warn: #92400e; --warn-soft: #fffbeb; --warn-line: #f59e0b;
      --ok: #047857; --ok-soft: #ecfdf5;
      --shadow: 0 1px 2px rgba(15,23,42,.06), 0 2px 6px rgba(15,23,42,.05);
    }
    * { box-sizing: border-box; }
    [hidden] { display: none !important; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 20px; background: var(--bg); color: #333; }
    a { color: var(--accent); }
    .container { max-width: 1800px; margin: 0 auto; }
    h1 { color: var(--accent-ink); margin: 0 0 5px; }
    .subtitle { color: #666; margin-bottom: 6px; }
    .generated-date { color: #888; font-size: .85em; margin-bottom: 20px; }
    .generated-date a { color: var(--accent); text-decoration: none; }
    .generated-date a:hover { text-decoration: underline; }

    .summary-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; margin-bottom: 24px; }
    .summary-card { font: inherit; text-align: left; background: var(--card); padding: 18px 20px; border-radius: 10px; box-shadow: var(--shadow);
                    display: flex; flex-direction: column; cursor: pointer; border: 2px solid transparent; }
    .summary-card:hover, .summary-card:focus-visible { border-color: var(--accent-line); outline: none; }
    .summary-card h3 { margin: 0 0 10px; color: #666; font-size: .8em; text-transform: uppercase; letter-spacing: .03em; }
    .summary-card .value { margin-top: auto; font-size: 1.9em; font-weight: bold; color: var(--accent); font-variant-numeric: tabular-nums; }
    .summary-card.hot .value { color: var(--hot); }
    .summary-card .subtext { color: #888; font-size: .82em; margin-top: 4px; }

    .tabs { display: flex; flex-wrap: wrap; gap: 5px; margin-bottom: 16px; border-bottom: 2px solid var(--line); }
    .tab { padding: 12px 20px; background: none; border: none; cursor: pointer; font-size: 1em; font-weight: 500; color: #666; border-bottom: 3px solid transparent; margin-bottom: -2px; }
    .tab:hover { color: var(--accent); }
    .tab.active { color: var(--accent); border-bottom-color: var(--accent); }
    .tab .n { font-size: .8em; background: var(--accent-soft); color: var(--accent); padding: 1px 7px; border-radius: 10px; margin-left: 4px; }
    .tab-content { display: none; }
    .tab-content.active { display: block; }
    .explain { color: #555; font-size: .9em; margin: 0 0 14px; max-width: 900px; line-height: 1.45; }

    .filters { background: var(--card); padding: 16px 20px; border-radius: 10px; box-shadow: var(--shadow); margin-bottom: 16px; display: flex; flex-wrap: wrap; gap: 15px; align-items: flex-end; }
    .filter-group { display: flex; flex-direction: column; gap: 5px; }
    .filter-group label { font-size: .82em; color: #666; font-weight: 500; }
    .filter-group input, .filter-group select { padding: 8px 12px; border: 1px solid #ddd; border-radius: 5px; font-size: .95em; background: white; }
    .filter-group input:focus, .filter-group select:focus { outline: none; border-color: var(--accent); }
    .search-input { min-width: 240px; }
    .btn { border: none; padding: 8px 16px; border-radius: 5px; cursor: pointer; font-size: .95em; font-family: inherit; }
    .reset-btn { background: var(--line); color: var(--ink); }
    .reset-btn:hover { background: #d1d5db; }
    .export-btn { background: var(--accent); color: white; }
    .export-btn:hover { background: var(--accent-ink); }
    .ghost-btn { background: white; color: var(--accent); border: 1px solid var(--accent-line); }
    .ghost-btn:hover { background: var(--accent-soft); }
    .multi-select { position: relative; min-width: 150px; }
    .multi-select-btn { width: 100%; padding: 8px 12px; border: 1px solid #ddd; border-radius: 5px; background: white; cursor: pointer; text-align: left; font-size: .95em; display: flex; justify-content: space-between; align-items: center; gap: 8px; font-family: inherit; color: var(--ink); }
    .multi-select-btn:hover { border-color: var(--accent); }
    .multi-select-btn::after { content: '▾'; font-size: .85em; color: #666; }
    .multi-select-dropdown { display: none; position: absolute; top: 100%; left: 0; min-width: 100%; background: white; border: 1px solid #ddd; border-radius: 6px; box-shadow: 0 8px 24px rgba(15,23,42,.14); z-index: 100; max-height: 280px; overflow-y: auto; margin-top: 4px; }
    .multi-select-dropdown.show { display: block; }
    .multi-select-option { padding: 7px 12px; cursor: pointer; display: flex; align-items: center; gap: 8px; white-space: nowrap; font-size: .92em; }
    .multi-select-option:hover { background: var(--accent-soft); }
    .multi-select-option input { margin: 0; cursor: pointer; }
    .multi-select-option.selected { background: var(--accent-soft); }
    .multi-select-count { background: var(--accent); color: white; font-size: .75em; padding: 1px 6px; border-radius: 10px; margin-left: 4px; }

    .table-container { background: var(--card); border-radius: 10px; box-shadow: var(--shadow); overflow: hidden; }
    .table-header { padding: 12px 20px; border-bottom: 1px solid #eee; display: flex; justify-content: space-between; align-items: center; gap: 10px; flex-wrap: wrap; }
    .table-header h3 { margin: 0; font-size: 1em; color: var(--ink); }
    .header-actions { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
    .result-count { color: #666; font-size: .9em; }
    .table-wrapper { overflow: auto; max-height: 72vh; }
    table { width: 100%; border-collapse: collapse; font-size: .88em; }
    th, td { padding: 10px 14px; text-align: left; border-bottom: 1px solid #eee; vertical-align: top; }
    th { background: #f8fafc; font-weight: 600; color: var(--ink-2); cursor: pointer; white-space: nowrap; position: sticky; top: 0; z-index: 10; }
    th:hover { background: var(--line-2); }
    th.sorted-asc::after { content: ' ▲'; color: var(--accent); }
    th.sorted-desc::after { content: ' ▼'; color: var(--accent); }
    tbody tr:hover { background: #f8fafc; }
    tr.crow { cursor: pointer; }
    .drug { font-weight: 600; color: var(--ink); }
    tr.crow:hover .drug { color: var(--accent); }
    .brand { color: var(--muted); font-weight: 400; }
    .muted { color: var(--muted); }
    .nowrap { white-space: nowrap; }
    .sub { display: block; margin-top: 2px; font-size: .82em; color: var(--muted); }
    .dw { color: var(--muted); display: inline-block; min-width: 2.6em; }
    .truncate { max-width: 220px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .ind-cell { min-width: 220px; max-width: 380px; white-space: normal; line-height: 1.35; }
    .tags { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 4px; }
    .tag { font-size: .75em; color: var(--muted); background: var(--line-2); padding: 1px 6px; border-radius: 4px; white-space: nowrap; font-weight: 400; }
    .note { display: block; margin-top: 4px; font-size: .78em; color: var(--warn); line-height: 1.35; font-weight: 400; }
    .badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: .82em; font-weight: 500; white-space: nowrap; }
    .b-soon { background: var(--hot-soft); color: var(--hot); }
    .b-over { background: var(--warn-soft); color: var(--warn); border: 1px solid #fcd34d; }
    .b-ok { background: var(--ok-soft); color: var(--ok); }
    .b-bad { background: var(--hot-soft); color: var(--hot); }
    .b-new { background: var(--accent-soft); color: var(--accent-ink); }
    .b-gray { background: #f3f4f6; color: #4b5563; }
    .b-unconfirmed { background: #fff; color: var(--warn); border: 1px dashed #d97706; }
    .certainty { display: block; margin-top: 4px; font-size: .72em; letter-spacing: .02em; text-transform: uppercase; color: var(--warn); font-weight: 600; }
    .days { font-variant-numeric: tabular-nums; color: var(--ink-2); }
    .src-link { color: var(--accent); text-decoration: none; white-space: nowrap; }
    .src-link:hover { text-decoration: underline; }
    .src-link.dim { color: var(--faint); }
    .rate-hi { color: var(--ok); } .rate-mid { color: var(--warn); } .rate-lo { color: var(--hot); }
    .empty { padding: 30px; text-align: center; color: #888; }

    /* View switch */
    .seg { display: inline-flex; border: 1px solid #d1d5db; border-radius: 6px; overflow: hidden; }
    .seg button { font: inherit; font-size: .9em; padding: 7px 14px; border: none; background: white; color: var(--ink-2); cursor: pointer; }
    .seg button + button { border-left: 1px solid #d1d5db; }
    .seg button.on { background: var(--accent); color: white; }

    /* Calendar */
    .cal-bar { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; padding: 14px 20px 8px; }
    .cal-nav { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .cal-nav h3 { margin: 0; min-width: 9.5em; text-align: center; font-size: 1.15em; color: var(--ink); }
    .cal-nav .count { color: var(--muted); font-size: .88em; margin-right: 6px; }
    .icon-btn { width: 32px; height: 32px; border-radius: 6px; border: 1px solid #d1d5db; background: white; cursor: pointer; font-size: 1.1em; line-height: 1; color: var(--ink-2); }
    .icon-btn:hover { border-color: var(--accent); color: var(--accent); }
    .btn.small { padding: 6px 12px; font-size: .88em; }
    .legend { display: flex; gap: 8px; align-items: center; font-size: .85em; color: var(--muted); flex-wrap: wrap; }
    .legend .chip { cursor: default; width: auto; }
    .months { display: flex; gap: 4px; overflow-x: auto; padding: 4px 20px 12px; }
    .mon { font: inherit; flex: 0 0 auto; width: 58px; padding: 6px 0 5px; border: 1px solid var(--line); border-radius: 6px; background: white; cursor: pointer; display: flex; flex-direction: column; align-items: center; gap: 2px; color: var(--ink-2); }
    .mon:hover { border-color: var(--accent-line); }
    .mon .bar { width: 26px; height: 22px; display: flex; align-items: flex-end; justify-content: center; }
    .mon .bar i { display: block; width: 100%; background: var(--accent-line); border-radius: 2px 2px 0 0; }
    .mon b { font-size: .78em; font-variant-numeric: tabular-nums; }
    .mon span { font-size: .78em; }
    .mon small { font-size: .65em; color: var(--faint); height: 1em; }
    .mon.on { border-color: var(--accent); background: var(--accent-soft); color: var(--accent-ink); }
    .mon.on .bar i { background: var(--accent); }
    .mon.zero { color: var(--faint); }
    .cal-window { margin: 0 20px 10px; padding: 10px 12px; border: 1px dashed var(--accent-line); border-radius: 8px; background: #fafcff; display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
    .cal-window:empty { display: none; }
    .cal-window .wlabel { font-size: .8em; color: var(--muted); margin-right: 4px; }
    .cal-grid { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); border-top: 1px solid var(--line); }
    .dow { padding: 8px 10px; font-size: .75em; font-weight: 600; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); background: #f8fafc; border-bottom: 1px solid var(--line); }
    .day { min-height: 118px; padding: 6px 6px 8px; border-right: 1px solid var(--line-2); border-bottom: 1px solid var(--line); display: flex; flex-direction: column; gap: 3px; min-width: 0; }
    .day:nth-child(7n) { border-right: none; }
    .day .num { font-size: .82em; color: var(--ink-2); font-weight: 600; width: 24px; height: 24px; line-height: 24px; text-align: center; border-radius: 50%; margin-bottom: 1px; }
    .day.wkend { background: #fafbfc; }
    .day.out { background: #fcfcfd; }
    .day.out .num { color: #c7cbd1; font-weight: 400; }
    .day.out .chip { opacity: .55; }
    .day.past:not(.out) .num { color: var(--faint); }
    .day.today .num { background: var(--accent); color: white; }
    .day .chip.xtra { display: none; }
    .day.open .chip.xtra { display: block; }
    .more { font: inherit; font-size: .76em; color: var(--accent); background: none; border: none; padding: 2px 4px; text-align: left; cursor: pointer; }
    .more:hover { text-decoration: underline; }
    .chip { font: inherit; font-size: .78em; line-height: 1.3; text-align: left; display: block; width: 100%; padding: 3px 7px; border-radius: 4px; cursor: pointer;
            background: var(--accent-soft); color: var(--accent-ink); border: 1px solid var(--accent-line); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-weight: 500; }
    .chip:hover, .chip:focus-visible { background: #dbeafe; outline: none; }
    .chip .brand { color: #3b5bab; font-weight: 400; }
    .chip.est { background: white; border-style: dashed; }
    .chip.over { background: var(--warn-soft); color: var(--warn); border-color: #fcd34d; }
    .chip.over .brand { color: #a16207; }
    .cal-window .chip { width: auto; max-width: 100%; display: inline-block; }
    .chip .when { color: var(--muted); font-weight: 400; margin-left: 4px; }
    .agenda { display: none; padding: 0 16px 12px; }
    .aday { padding: 10px 0; border-top: 1px solid var(--line); }
    .aday h4 { margin: 0 0 6px; font-size: .85em; color: var(--ink-2); }
    .aday.today h4 { color: var(--accent); }
    .aday .chip { white-space: normal; margin-bottom: 4px; padding: 6px 9px; font-size: .88em; }
    .aday .chip .ind { display: block; color: var(--muted); font-weight: 400; font-size: .9em; }
    .agenda .none { padding: 18px 0; color: var(--muted); font-size: .9em; }
    @media (max-width: 760px) {
      body { padding: 14px; }
      .cal-grid { display: none; }
      .agenda { display: block; }
      .legend { display: none; }
      .filters { flex-direction: column; align-items: stretch; }
      .search-input { min-width: 0; width: 100%; }
    }

    /* Detail dialog */
    dialog#detail { border: none; border-radius: 12px; padding: 26px 28px 24px; width: min(560px, calc(100vw - 32px)); box-shadow: 0 20px 50px rgba(15,23,42,.3); color: var(--ink); }
    dialog#detail::backdrop { background: rgba(15,23,42,.35); }
    dialog#detail .close { position: absolute; top: 12px; right: 12px; width: 32px; height: 32px; border: none; border-radius: 6px; background: #f3f4f6; cursor: pointer; font-size: 1.1em; }
    dialog#detail h2 { margin: 0 40px 4px 0; font-size: 1.35em; color: var(--accent-ink); }
    dialog#detail .dsub { color: var(--muted); margin-bottom: 14px; }
    .when-box { background: var(--accent-soft); border-radius: 8px; padding: 12px 14px; margin-bottom: 16px; }
    .when-box .big { font-size: 1.1em; font-weight: 600; color: var(--accent-ink); }
    .when-box .rel { font-size: .88em; color: var(--ink-2); margin-top: 2px; }
    .when-box.over { background: var(--warn-soft); }
    .when-box.over .big { color: var(--warn); }
    .facts { display: grid; grid-template-columns: 120px 1fr; gap: 8px 14px; margin: 0 0 14px; font-size: .92em; }
    .facts dt { color: var(--muted); }
    .facts dd { margin: 0; }
    .read { display: inline-block; margin-top: 6px; font-weight: 600; text-decoration: none; }
    .read:hover { text-decoration: underline; }
    .read-title { color: var(--muted); font-size: .85em; margin-top: 4px; line-height: 1.4; }

    /* Trials tab */
    .charts-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(420px, 1fr)); gap: 16px; margin-bottom: 16px; }
    .chart-container { background: var(--card); padding: 16px 20px; border-radius: 10px; box-shadow: var(--shadow); }
    .chart-container h3, .panel h3 { margin: 0 0 12px; font-size: .8em; text-transform: uppercase; letter-spacing: .04em; color: var(--ink-2); }
    .chart-wrapper { position: relative; height: 240px; }
    .panel { background: var(--card); padding: 16px 20px; border-radius: 10px; box-shadow: var(--shadow); margin-bottom: 16px; }
    .panel h3 .hint { text-transform: none; letter-spacing: 0; font-weight: 400; color: var(--faint); }
    .sponsor-items { display: flex; flex-wrap: wrap; gap: 6px; }
    .sponsor-item { font: inherit; background: var(--line-2); border: 1px solid transparent; padding: 5px 10px; border-radius: 999px; font-size: .85em; cursor: pointer; color: var(--ink-2); }
    .sponsor-item:hover { border-color: var(--accent-line); background: var(--accent-soft); color: var(--accent-ink); }
    .sponsor-count { color: var(--faint); margin-left: 4px; font-variant-numeric: tabular-nums; }
    .nct-link { color: var(--accent); text-decoration: none; }
    .nct-link:hover { text-decoration: underline; }
    .rates-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 6px 24px; }
    .rate-item { padding: 8px 0; border-bottom: 1px solid var(--line-2); display: flex; justify-content: space-between; font-size: .92em; }
    .ref-list { margin: 0; padding-left: 18px; line-height: 1.7; font-size: .92em; }
    footer, .about { color: #888; font-size: .8em; margin: 20px 0 10px; line-height: 1.55; max-width: 980px; }
    @media (max-width: 760px) { .charts-grid { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <div class="container">
    <h1>FDA Pipeline</h1>
    <div class="subtitle">Upcoming FDA decisions, and the Phase 3 trials behind the next wave</div>
    <div class="generated-date">Updated ${generated} · <a href="../biotech-tracker/">Emerging Biotech Tracker →</a></div>

    <div class="summary-grid">
      <button class="summary-card" data-go="catalysts"><h3>FDA decisions ahead</h3><div class="value">${n(catalysts.length)}</div><div class="subtext">${n(announced)} with an announced PDUFA date</div></button>
      <button class="summary-card hot" data-go="catalysts" data-days="30"><h3>Next 30 days</h3><div class="value" id="next30">${n(next30)}</div><div class="subtext">decisions due by <span id="next30By">${by30}</span></div></button>
      <button class="summary-card" data-go="decided"><h3>Decided, last 30 days</h3><div class="value">${n(recentOutcomes.length)}</div><div class="subtext">${approved} approved · ${crl} CRL</div></button>
      <button class="summary-card" data-go="trials"><h3>Phase 3 trials</h3><div class="value">${n(trialStats.total)}</div><div class="subtext">${n(trialStats.byApprovalType['New Approval'])} new drugs · ${n(trialStats.byApprovalType['Supplemental'])} new uses</div></button>
    </div>

    <nav class="tabs">
      <button class="tab" data-tab="catalysts">FDA Catalysts <span class="n">${n(catalysts.length)}</span></button>
      <button class="tab" data-tab="trials">Phase 3 Trials <span class="n">${n(trialStats.total)}</span></button>
      <button class="tab" data-tab="reference">Reference</button>
    </nav>

    <!-- Catalysts Tab -->
    <section id="catalysts-tab" class="tab-content">
      <p class="explain">Pending FDA decisions from MJH's own coverage and the RTTNews FDA calendar, checked every night. Dates are the announced PDUFA date unless marked <b>est.</b> (projected from the filing date on the FDA review clock) or given by the company only as a month or quarter. Click any drug for details; <b>Calendar</b> shows the same list by day.</p>

      <div class="filters">
        <div class="filter-group"><label for="catalystSearch">Search</label><input type="search" id="catalystSearch" class="search-input" placeholder="Drug, company, indication…"></div>
        <div class="filter-group"><label>Disease area</label>
          <div class="multi-select" id="catalystAreaFilterWrap">
            <button class="multi-select-btn" type="button" onclick="toggleMulti('catalystAreaFilter')"><span id="catalystAreaFilterLabel">All areas</span></button>
            <div class="multi-select-dropdown" id="catalystAreaFilterDrop">
              ${Object.keys(catalystStats.byTherapeuticArea).filter(a => a !== 'Unknown').sort().map(a => `<label class="multi-select-option"><input type="checkbox" value="${escapeHtml(a)}" onchange="updateMulti('catalystAreaFilter')">${escapeHtml(a)} <span class="muted">${catalystStats.byTherapeuticArea[a]}</span></label>`).join('')}
            </div>
          </div>
        </div>
        <div class="filter-group"><label for="catalystStatusFilter">Status</label>
          <select id="catalystStatusFilter" onchange="filterCatalysts()">
            <option value="">All statuses</option>
            ${Object.keys(catalystStats.byStatus).map(s => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('')}
          </select>
        </div>
        <div class="filter-group"><label for="catalystTypeFilter">Application</label>
          <select id="catalystTypeFilter" onchange="filterCatalysts()">
            <option value="">All types</option>
            ${Object.keys(catalystStats.bySubmissionType).filter(t => t !== 'Unknown').map(t => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join('')}
          </select>
        </div>
        <div class="filter-group"><label for="catalystTimeFilter">Timeframe</label>
          <select id="catalystTimeFilter" onchange="filterCatalysts()">
            <option value="">All dates</option><option value="30">Next 30 days</option><option value="90">Next 90 days</option><option value="180">Next 6 months</option><option value="365">Next year</option>
          </select>
        </div>
        <button class="btn reset-btn" type="button" onclick="resetCatalystFilters()">Reset</button>
      </div>

      <div class="table-container">
        <div class="table-header">
          <span class="result-count" id="catalystCount"></span>
          <div class="header-actions">
            <div class="seg" role="group" aria-label="View">
              <button type="button" data-view="list" aria-pressed="true" class="on">List</button><button type="button" data-view="calendar" aria-pressed="false">Calendar</button>
            </div>
            <button class="btn ghost-btn" type="button" id="icsBtn" title="Decisions with an exact date in the current filter, as all-day events for Outlook, Google or Apple Calendar">Add to my calendar</button>
            <button class="btn export-btn" type="button" onclick="exportCatalystsCSV()">Export CSV</button>
          </div>
        </div>
        <div class="table-wrapper" id="listView">
          <table id="catalystsTable">
            <thead><tr>
              <th data-sort="drug">Drug</th>
              <th data-sort="indication">Indication</th>
              <th data-sort="pdufaDate">PDUFA date</th>
              <th data-sort="daysUntilPDUFA">Days</th>
              <th data-sort="status">Status</th>
              <th data-sort="submissionType">Application</th>
              <th data-sort="therapeuticArea">Disease area</th>
              <th data-sort="company">Company</th>
              <th>Source</th>
            </tr></thead>
            <tbody id="catalystsBody"></tbody>
          </table>
        </div>
        <div id="calView" hidden>
          <div class="cal-bar">
            <div class="cal-nav">
              <button type="button" class="icon-btn" id="calPrev" aria-label="Previous month">‹</button>
              <h3 id="calTitle"></h3>
              <button type="button" class="icon-btn" id="calNext" aria-label="Next month">›</button>
              <button type="button" class="btn reset-btn small" id="calToday">Today</button>
              <span class="count" id="calCount"></span>
            </div>
            <div class="legend"><span class="chip">Announced date</span><span class="chip est">Estimated</span><span class="chip over">Past due, no decision yet</span></div>
          </div>
          <div class="months" id="calMonths"></div>
          <div class="cal-window" id="calWindow"></div>
          <div class="cal-grid" id="calGrid"></div>
          <div class="agenda" id="calAgenda"></div>
        </div>
      </div>

      ${recentOutcomes.length ? `
      <div class="table-container" id="decided" style="margin-top:18px">
        <div class="table-header">
          <h3>Recently decided</h3>
          <span class="result-count">${recentOutcomes.length} in the last 30 days</span>
        </div>
        <div class="table-wrapper">
          <table>
            <thead><tr>
              <th>Drug</th>${decidedCompany ? '<th>Company</th>' : ''}<th>PDUFA</th><th>Outcome</th>
              <th>Decided</th><th>Evidence</th><th>Source</th>
            </tr></thead>
            <tbody>
            ${recentOutcomes.map(o => `<tr>
              <td><span class="drug">${escapeHtml(o.drug)}</span>${o.brandName ? ' <span class="brand">' + escapeHtml(o.brandName) + '</span>' : ''}${o.ambiguous ? '<span class="note">' + escapeHtml(o.ambiguous) + '</span>' : o.note ? '<span class="note">' + escapeHtml(o.note) + '</span>' : ''}</td>
              ${decidedCompany ? `<td class="truncate" title="${escapeHtml(o.company || '')}">${escapeHtml(o.company || '—')}</td>` : ''}
              <td class="nowrap">${o.pdufaDate ? shortDay(o.pdufaDate) : '—'}</td>
              <td>${(() => {
                const cert = o.certainty || 'resolved';
                const label = escapeHtml(o.outcome || 'Unclear');
                if (cert === 'resolved') {
                  const cls = o.outcome === 'CRL' ? 'b-bad' : o.outcome === 'Approved' ? 'b-ok' : 'b-gray';
                  return `<span class="badge ${cls}">${label}</span>`;
                }
                // One source, or a weak one. Say so on the verdict itself rather
                // than in an evidence cell that truncates.
                const note = o.ambiguous ? 'which application?' : cert === 'likely' ? 'single source' : 'unconfirmed';
                return `<span class="badge b-unconfirmed" title="${escapeHtml(o.ambiguous || note)}">${label}?</span>` +
                       `<span class="certainty">${note}</span>`;
              })()}</td>
              <td class="nowrap">${o.resolvedDate ? shortDay(o.resolvedDate) : '—'}</td>
              <td class="truncate" title="${escapeHtml((o.evidence || []).map(e => e.source + ': ' + e.detail).join(' | '))}">${escapeHtml((o.evidence || []).map(e => e.detail || e.source).join(' + '))}</td>
              <td>${o.sourceUrl ? `<a class="src-link" href="${escapeHtml(o.sourceUrl)}" target="_blank" rel="noopener">${escapeHtml(sourceName(o.sourceUrl))} ↗</a>` : '—'}</td>
            </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>` : ''}

      <p class="about"><b>Where this comes from:</b> the RTTNews FDA calendar, checked against MJH's own coverage (OncLive, HCPLive, Targeted Oncology, CancerNetwork, CURE and 11 other MJH brands). Drugs MJH has reported approved or rejected come off the list, extensions MJH reported move the date, and filings MJH reported that RTTNews does not list are included. Updated nightly. <a href="pipeline-2.0.html" target="_blank">Full MJH pipeline report and method</a>.</p>
    </section>

    <!-- Trials Tab -->
    <section id="trials-tab" class="tab-content">
      <p class="explain">Active Phase 3 and Phase 2/3 drug trials on ClinicalTrials.gov that have not yet reached their primary completion date. The estimated FDA decision adds a typical filing and review time for the disease area to the completion date; see Reference.</p>
      <div class="charts-grid">
        <div class="chart-container"><h3>Trials by therapeutic area</h3><div class="chart-wrapper"><canvas id="areaChart"></canvas></div></div>
        <div class="chart-container"><h3>Primary completions by quarter</h3><div class="chart-wrapper"><canvas id="timelineChart"></canvas></div></div>
      </div>

      <div class="panel">
        <h3>Top sponsors <span class="hint">· click to filter</span></h3>
        <div class="sponsor-items">
          ${trialStats.topSponsors.map(([s, c]) => `<button type="button" class="sponsor-item" data-sponsor="${escapeHtml(s)}">${escapeHtml(s)}<span class="sponsor-count">${c}</span></button>`).join('')}
        </div>
      </div>

      <div class="filters">
        <div class="filter-group"><label for="trialSearch">Search</label><input type="search" id="trialSearch" class="search-input" placeholder="Therapy, sponsor, condition, NCT ID…"></div>
        <div class="filter-group"><label>Therapeutic area</label>
          <div class="multi-select" id="areaFilterWrap">
            <button class="multi-select-btn" type="button" onclick="toggleMulti('areaFilter')"><span id="areaFilterLabel">All areas</span></button>
            <div class="multi-select-dropdown" id="areaFilterDrop">
              ${areas.map(a => `<label class="multi-select-option"><input type="checkbox" value="${escapeHtml(a)}" onchange="updateMulti('areaFilter')">${escapeHtml(a)}</label>`).join('')}
            </div>
          </div>
        </div>
        <div class="filter-group"><label>Approval type</label>
          <div class="multi-select" id="approvalFilterWrap">
            <button class="multi-select-btn" type="button" onclick="toggleMulti('approvalFilter')"><span id="approvalFilterLabel">All types</span></button>
            <div class="multi-select-dropdown" id="approvalFilterDrop">
              <label class="multi-select-option"><input type="checkbox" value="New Approval" onchange="updateMulti('approvalFilter')">New drug</label>
              <label class="multi-select-option"><input type="checkbox" value="Supplemental" onchange="updateMulti('approvalFilter')">New use of an approved drug</label>
            </div>
          </div>
        </div>
        <div class="filter-group"><label>Completion year</label>
          <div class="multi-select" id="yearFilterWrap">
            <button class="multi-select-btn" type="button" onclick="toggleMulti('yearFilter')"><span id="yearFilterLabel">All years</span></button>
            <div class="multi-select-dropdown" id="yearFilterDrop">
              ${completionYears.map(y => `<label class="multi-select-option"><input type="checkbox" value="${y}" onchange="updateMulti('yearFilter')">${y}</label>`).join('')}
            </div>
          </div>
        </div>
        <div class="filter-group"><label>Est. FDA decision year</label>
          <div class="multi-select" id="fdaYearFilterWrap">
            <button class="multi-select-btn" type="button" onclick="toggleMulti('fdaYearFilter')"><span id="fdaYearFilterLabel">All years</span></button>
            <div class="multi-select-dropdown" id="fdaYearFilterDrop">
              ${fdaYears.map(y => `<label class="multi-select-option"><input type="checkbox" value="${y}" onchange="updateMulti('fdaYearFilter')">${y}</label>`).join('')}
            </div>
          </div>
        </div>
        <div class="filter-group"><label for="trialSuccessFilter">Min. success rate</label>
          <select id="trialSuccessFilter" onchange="filterTrials()">
            <option value="">Any</option><option value="0.6">60% or more</option><option value="0.5">50% or more</option><option value="0.4">40% or more</option>
          </select>
        </div>
        <button class="btn reset-btn" type="button" onclick="resetTrialFilters()">Reset</button>
      </div>

      <div class="table-container">
        <div class="table-header"><span class="result-count"><span id="trialCount">${trials.length}</span> of ${n(trials.length)} trials</span><button class="btn export-btn" type="button" onclick="exportTrialsCSV()">Export CSV</button></div>
        <div class="table-wrapper">
          <table id="trialsTable">
            <thead><tr>
              <th data-sort="investigationalIntervention">Therapy</th>
              <th data-sort="approvalType">Type</th>
              <th data-sort="therapeuticArea">Disease area</th>
              <th data-sort="leadSponsor">Sponsor</th>
              <th data-sort="conditionDisplay">Indication</th>
              <th data-sort="nctId">NCT ID</th>
              <th data-sort="successRate">P(success)</th>
              <th data-sort="primaryCompletionDate">Completion</th>
              <th data-sort="estimatedApprovalDate">Est. FDA decision</th>
            </tr></thead>
            <tbody id="trialsBody"></tbody>
          </table>
        </div>
      </div>
    </section>

    <!-- Reference Tab -->
    <section id="reference-tab" class="tab-content">
      <div class="panel">
        <h3>Phase 3 success rates by therapeutic area</h3>
        <div class="rates-grid">
          ${Object.entries(successRates).map(([area, data]) => `<div class="rate-item"><span>${escapeHtml(area)}</span><span class="${data.rate >= 0.6 ? 'rate-hi' : data.rate >= 0.5 ? 'rate-mid' : 'rate-lo'}">${data.range}</span></div>`).join('')}
        </div>
        <p class="about" style="margin-bottom:0">Source: BIO Industry Analysis, Nature Communications.</p>
      </div>
      <div class="panel">
        <h3>Estimated time from Phase 3 completion to FDA decision</h3>
        <ul class="ref-list">
          <li><b>High urgency</b> (oncology, rare disease): about 9 months</li>
          <li><b>Elevated</b> (hematology, infectious disease, neurology): about 12 months</li>
          <li><b>Standard</b> (cardiology, pulmonology, endocrinology): about 15 months</li>
          <li><b>Lower urgency</b> (dermatology, urology, orthopedics): about 18 months</li>
        </ul>
      </div>
      <div class="panel">
        <h3>Approval type</h3>
        <ul class="ref-list">
          <li><b>New drug (NDA/BLA):</b> a drug the FDA has not approved before</li>
          <li><b>New use (sNDA/sBLA):</b> an approved drug seeking a new indication</li>
        </ul>
      </div>
    </section>
  </div>

  <dialog id="detail" aria-labelledby="dTitle"><button type="button" class="close" aria-label="Close">×</button><div id="detailBody"></div></dialog>

  <script>
    const trials = ${JSON.stringify(trials)};
    const catalysts = ${JSON.stringify(catalysts)};
    let trialSortCol = 'therapeuticArea', trialSortDir = 'asc';
    let catalystSortCol = 'daysUntilPDUFA', catalystSortDir = 'asc';
    const multiState = { areaFilter: [], approvalFilter: [], yearFilter: [], fdaYearFilter: [], catalystAreaFilter: [] };
    const MULTI_DEFAULT = { areaFilter: 'All areas', approvalFilter: 'All types', yearFilter: 'All years', fdaYearFilter: 'All years', catalystAreaFilter: 'All areas' };

    const DAY = 864e5;
    const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const pad = x => (x < 10 ? '0' : '') + x;
    const iso = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
    const TODAY = iso(new Date());
    const asDay = s => new Date(s.slice(0, 10) + 'T12:00:00');
    const fmtDay = (s, o) => asDay(s).toLocaleDateString('en-US', o || { month: 'short', day: 'numeric', year: 'numeric' });
    const weekday = s => fmtDay(s, { weekday: 'short' });
    const plural = (k, w) => k + ' ' + (k === 1 ? w : w === 'story' ? 'stories' : w + 's');
    function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]); }
    const escapeHtml = esc;

    // Days are counted from the reader's today, not the night the page was built.
    catalysts.forEach((c, i) => {
      c._i = i;
      if (c.pdufaDate) c.daysUntilPDUFA = Math.round((asDay(c.pdufaDate) - asDay(TODAY)) / DAY);
    });
    let shown = catalysts.slice();
    document.getElementById('next30').textContent = catalysts.filter(c => c.daysUntilPDUFA != null && c.daysUntilPDUFA >= 0 && c.daysUntilPDUFA <= 30).length;
    document.getElementById('next30By').textContent = fmtDay(iso(new Date(asDay(TODAY).getTime() + 30 * DAY)), { month: 'short', day: 'numeric' });

    // ---- Tabs and views ----
    let chartsReady = false;
    function showTab(name, opts) {
      document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
      document.querySelectorAll('.tab-content').forEach(t => t.classList.toggle('active', t.id === name + '-tab'));
      if (name === 'trials' && !chartsReady) { chartsReady = true; drawCharts(); }
      if (!(opts && opts.keepHash)) setHash(name === 'catalysts' && view === 'calendar' ? 'calendar' : name);
    }
    function setHash(h) { try { history.replaceState(null, '', '#' + h); } catch (e) {} }
    document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => showTab(t.dataset.tab)));

    let view = 'list';
    function setView(v) {
      view = v;
      document.querySelectorAll('.seg button').forEach(b => { const on = b.dataset.view === v; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); });
      document.getElementById('listView').hidden = v !== 'list';
      document.getElementById('calView').hidden = v !== 'calendar';
      try { localStorage.setItem('fdaView', v); } catch (e) {}
      setHash(v === 'calendar' ? 'calendar' : 'catalysts');
      renderCatalystView();
    }
    document.querySelectorAll('.seg button').forEach(b => b.addEventListener('click', () => setView(b.dataset.view)));

    document.querySelectorAll('.summary-card').forEach(card => card.addEventListener('click', () => {
      const go = card.dataset.go;
      if (go === 'trials') { showTab('trials'); return; }
      showTab('catalysts');
      if (card.dataset.days) { document.getElementById('catalystTimeFilter').value = card.dataset.days; filterCatalysts(); }
      const target = document.getElementById(go === 'decided' ? 'decided' : 'catalysts-tab');
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }));

    // ---- Multi-select ----
    function toggleMulti(id) {
      const drop = document.getElementById(id + 'Drop');
      document.querySelectorAll('.multi-select-dropdown').forEach(d => { if (d !== drop) d.classList.remove('show'); });
      drop.classList.toggle('show');
    }
    function updateMulti(id) {
      const drop = document.getElementById(id + 'Drop');
      const vals = Array.from(drop.querySelectorAll('input:checked')).map(i => i.value);
      multiState[id] = vals;
      document.getElementById(id + 'Label').innerHTML = vals.length === 0 ? MULTI_DEFAULT[id] : vals.length === 1 ? esc(vals[0]) : vals.length + ' selected<span class="multi-select-count">' + vals.length + '</span>';
      drop.querySelectorAll('.multi-select-option').forEach(o => o.classList.toggle('selected', o.querySelector('input').checked));
      if (id === 'catalystAreaFilter') filterCatalysts(); else filterTrials();
    }
    function clearMulti(id) {
      multiState[id] = [];
      const drop = document.getElementById(id + 'Drop');
      drop.querySelectorAll('input').forEach(i => i.checked = false);
      drop.querySelectorAll('.multi-select-option').forEach(o => o.classList.remove('selected'));
      document.getElementById(id + 'Label').innerHTML = MULTI_DEFAULT[id];
    }
    document.addEventListener('click', e => { if (!e.target.closest('.multi-select')) document.querySelectorAll('.multi-select-dropdown').forEach(d => d.classList.remove('show')); });

    // ---- Shared catalyst pieces ----
    const SOURCES = ${JSON.stringify(SOURCE_NAMES)};
    function sourceName(url) {
      let host = '';
      try { host = new URL(url).hostname.replace(/^www[.]/, ''); } catch (e) { return 'Source'; }
      if (host.indexOf('google.') === 0) return 'Search only';
      return SOURCES[host] || host;
    }
    function sourceLink(c) {
      if (!c.sourceUrl) return '—';
      const name = sourceName(c.sourceUrl);
      return '<a class="src-link' + (name === 'Search only' ? ' dim' : '') + '" href="' + esc(c.sourceUrl) + '" target="_blank" rel="noopener" title="' + esc(c.sourceTitle || c.sourceUrl) + '">' + esc(name) + ' ↗</a>';
    }
    const isWindow = c => c.dateBasis === 'Company guidance' && !!c.dateLabel;
    const isEst = c => c.dateBasis === 'Estimated';
    const isOver = c => c.status === 'Overdue' || (c.daysUntilPDUFA !== null && c.daysUntilPDUFA !== undefined && c.daysUntilPDUFA < 0);
    // Flags that describe the application go in grey tags; anything that
    // questions the date is a note.
    const tagsOf = c => (c.flags || []).filter(f => f.indexOf('still lists') < 0);
    const notesOf = c => (c.flags || []).filter(f => f.indexOf('still lists') >= 0).concat(c.reviewNote ? [c.reviewNote] : []);

    // A company window ("Q4 2026", "Nov 2026") covers these calendar months.
    function windowMonths(c) {
      const m = (c.dateLabel || '').match(/^(Q[1-4]|H[12]|[A-Z][a-z][a-z]) ([0-9]{4})$/);
      if (!m) return c.pdufaDate ? [c.pdufaDate.slice(0, 7)] : [];
      let from, to;
      if (m[1][0] === 'Q') { from = (+m[1][1]) * 3 - 2; to = from + 2; }
      else if (m[1] === 'H1' || m[1] === 'H2') { from = m[1] === 'H1' ? 1 : 7; to = from + 5; }
      else { from = to = MON.indexOf(m[1]) + 1; }
      if (from < 1) return c.pdufaDate ? [c.pdufaDate.slice(0, 7)] : [];
      const out = [];
      for (let k = from; k <= to; k++) out.push(m[2] + '-' + pad(k));
      return out;
    }

    function relText(c) {
      const d = c.daysUntilPDUFA;
      if (d === null || d === undefined) return '';
      if (isWindow(c)) return d < 0 ? 'Window closed ' + plural(-d, 'day') + ' ago with no decision reported' : 'Window ends in ' + plural(d, 'day');
      if (d === 0) return 'Today';
      return d < 0 ? plural(-d, 'day') + ' past, no decision reported yet' : 'In ' + plural(d, 'day');
    }

    function openDetail(c) {
      const facts = [
        ['Company', c.company ? esc(c.company) : '<span class="muted">Not named in the coverage</span>'],
        ['Application', esc(c.submissionType || '—') + (tagsOf(c).length ? '<div class="tags">' + tagsOf(c).map(t => '<span class="tag">' + esc(t) + '</span>').join('') + '</div>' : '')],
        ['Disease area', esc(c.therapeuticArea || '—')],
        ['Status', esc(c.status || 'Pending')],
      ];
      if (c.mjhStories > 1) facts.push(['MJH coverage', plural(c.mjhStories, 'story')]);
      const big = isWindow(c) ? 'Expected ' + esc(c.dateLabel) : c.pdufaDate ? fmtDay(c.pdufaDate, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }) : 'Date not set';
      const basis = isWindow(c) ? 'Company guidance, no exact date announced' : isEst(c) ? 'Estimated: projected from the filing date on the FDA review clock' : 'Announced PDUFA date';
      const dow = !isWindow(c) && c.pdufaDate ? asDay(c.pdufaDate).getDay() : -1;
      const weekend = dow === 0 || dow === 6 ? '<div class="rel">Falls on a ' + (dow === 0 ? 'Sunday' : 'Saturday') + ', so the decision may come the Friday before.</div>' : '';
      const notes = notesOf(c);
      document.getElementById('detailBody').innerHTML =
        '<h2 id="dTitle">' + esc(c.drug) + (c.brandName ? ' <span class="brand">' + esc(c.brandName) + '</span>' : '') + '</h2>' +
        '<div class="dsub">' + esc(c.indication || '') + '</div>' +
        '<div class="when-box' + (isOver(c) ? ' over' : '') + '"><div class="big">' + big + '</div><div class="rel">' + esc(relText(c)) + ' · ' + esc(basis) + '</div>' + weekend + '</div>' +
        '<dl class="facts">' + facts.map(f => '<dt>' + f[0] + '</dt><dd>' + f[1] + '</dd>').join('') + '</dl>' +
        notes.map(t => '<span class="note">' + esc(t) + '</span>').join('') +
        (c.sourceUrl ? '<a class="read" href="' + esc(c.sourceUrl) + '" target="_blank" rel="noopener">Read on ' + esc(sourceName(c.sourceUrl)) + ' ↗</a>' + (c.sourceTitle ? '<div class="read-title">' + esc(c.sourceTitle) + '</div>' : '') : '');
      const dlg = document.getElementById('detail');
      if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', '');
    }
    document.querySelector('#detail .close').addEventListener('click', () => document.getElementById('detail').close());
    document.getElementById('detail').addEventListener('click', e => { if (e.target.id === 'detail') e.target.close(); });

    // ---- List view ----
    function dateCell(c) {
      if (isWindow(c)) return '<b class="nowrap">' + esc(c.dateLabel) + '</b><span class="sub">company guidance</span>';
      if (!c.pdufaDate) return '—';
      return '<span class="nowrap"><span class="dw">' + weekday(c.pdufaDate) + '</span>' + fmtDay(c.pdufaDate) + '</span>' + (isEst(c) ? '<span class="sub" title="' + esc(c.dateBasisDetail || '') + '">est.</span>' : '');
    }
    function daysCell(c) {
      const d = c.daysUntilPDUFA;
      if (d === null || d === undefined) return '—';
      if (d < 0) return '<span class="badge b-over">' + (-d) + 'd past</span>';
      if (d === 0) return '<span class="badge b-soon">Today</span>';
      if (d <= 30) return '<span class="badge b-soon">' + d + 'd</span>';
      return '<span class="days">' + d + 'd</span>';
    }
    function catalystRows(data) {
      if (!data.length) return '<tr><td colspan="9" class="empty">No decisions match these filters.</td></tr>';
      return data.map(c => {
        const tags = tagsOf(c), notes = notesOf(c);
        return '<tr class="crow" data-i="' + c._i + '">' +
          '<td><span class="drug">' + esc(c.drug) + '</span>' + (c.brandName ? ' <span class="brand">' + esc(c.brandName) + '</span>' : '') +
            (tags.length ? '<div class="tags">' + tags.map(t => '<span class="tag">' + esc(t) + '</span>').join('') + '</div>' : '') +
            notes.map(t => '<span class="note">' + esc(t) + '</span>').join('') + '</td>' +
          '<td class="ind-cell">' + (esc(c.indication) || '—') + '</td>' +
          '<td>' + dateCell(c) + '</td>' +
          '<td>' + daysCell(c) + '</td>' +
          '<td>' + (c.status === 'Overdue' ? '<span class="badge b-over">Overdue</span>' : '<span class="muted">' + esc(c.status || 'Pending') + '</span>') + (c.reviewNote ? '<span class="certainty">needs review</span>' : '') + '</td>' +
          '<td class="nowrap">' + (esc(c.submissionType) || '<span class="muted">—</span>') + '</td>' +
          '<td>' + (esc(c.therapeuticArea) || '—') + '</td>' +
          '<td class="truncate" title="' + esc(c.company) + '">' + (esc(c.company) || '<span class="muted">—</span>') + '</td>' +
          '<td>' + sourceLink(c) + '</td></tr>';
      }).join('');
    }

    // ---- Calendar view ----
    const now = new Date();
    let calMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthKey = d => d.getFullYear() + '-' + pad(d.getMonth() + 1);
    function chip(c, cls, extra) {
      const k = 'chip' + (isEst(c) ? ' est' : '') + (isOver(c) ? ' over' : '') + (cls ? ' ' + cls : '');
      const tip = [c.drug + (c.brandName ? ' (' + c.brandName + ')' : ''), c.indication, c.company].filter(Boolean).join(' · ');
      return '<button type="button" class="' + k + '" data-i="' + c._i + '" title="' + esc(tip) + '">' + esc(c.drug) +
        (c.brandName ? ' <span class="brand">' + esc(c.brandName) + '</span>' : '') + (extra || '') + '</button>';
    }
    function monthCounts() {
      const counts = {};
      shown.forEach(c => {
        if (!c.pdufaDate) return;
        (isWindow(c) ? windowMonths(c) : [c.pdufaDate.slice(0, 7)]).forEach(k => { counts[k] = (counts[k] || 0) + 1; });
      });
      return counts;
    }
    function renderMonths(counts) {
      const keys = Object.keys(counts).concat([monthKey(now), monthKey(calMonth)]).sort();
      const [fy, fm] = keys[0].split('-').map(Number), [ly, lm] = keys[keys.length - 1].split('-').map(Number);
      const max = Math.max(1, ...Object.values(counts));
      const cur = monthKey(calMonth);
      let html = '';
      for (let d = new Date(fy, fm - 1, 1); d <= new Date(ly, lm - 1, 1); d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) {
        const k = monthKey(d), v = counts[k] || 0;
        const yr = d.getMonth() === 0 || html === '' ? String(d.getFullYear()) : '';
        html += '<button type="button" class="mon' + (k === cur ? ' on' : '') + (v ? '' : ' zero') + '" data-m="' + k + '" title="' + plural(v, 'decision') + '">' +
          '<small>' + yr + '</small><span class="bar"><i style="height:' + Math.max(v ? 3 : 0, Math.round(22 * v / max)) + 'px"></i></span><b>' + v + '</b><span>' + MON[d.getMonth()] + '</span></button>';
      }
      const el = document.getElementById('calMonths');
      el.innerHTML = html;
      const on = el.querySelector('.mon.on');
      if (on) el.scrollLeft = Math.max(0, on.offsetLeft - el.clientWidth / 2);
    }
    function renderCalendar() {
      const y = calMonth.getFullYear(), m = calMonth.getMonth(), key = monthKey(calMonth);
      const counts = monthCounts();
      document.getElementById('calTitle').textContent = calMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
      document.getElementById('calCount').textContent = plural(counts[key] || 0, 'decision');
      renderMonths(counts);

      const byDay = {}, windows = [];
      shown.forEach(c => {
        if (!c.pdufaDate) return;
        if (isWindow(c)) { if (windowMonths(c).indexOf(key) >= 0) windows.push(c); }
        else (byDay[c.pdufaDate] = byDay[c.pdufaDate] || []).push(c);
      });
      document.getElementById('calWindow').innerHTML = windows.length
        ? '<span class="wlabel">Expected this month, no exact day announced:</span>' + windows.map(c => chip(c, '', '<span class="when">' + esc(c.dateLabel) + '</span>')).join('')
        : '';

      const first = new Date(y, m, 1), last = new Date(y, m + 1, 0);
      let html = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => '<div class="dow">' + d + '</div>').join('');
      for (let d = new Date(y, m, 1 - first.getDay()); d <= new Date(y, m, last.getDate() + 6 - last.getDay()); d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) {
        const k = iso(d), list = byDay[k] || [];
        const cls = 'day' + (d.getMonth() !== m ? ' out' : '') + (d.getDay() === 0 || d.getDay() === 6 ? ' wkend' : '') + (k === TODAY ? ' today' : k < TODAY ? ' past' : '');
        html += '<div class="' + cls + '" aria-label="' + esc(fmtDay(k, { weekday: 'long', month: 'long', day: 'numeric' }) + ', ' + plural(list.length, 'decision')) + '"><div class="num">' + d.getDate() + '</div>' +
          list.map((c, j) => chip(c, j >= 3 ? 'xtra' : '')).join('') +
          (list.length > 3 ? '<button type="button" class="more">+' + (list.length - 3) + ' more</button>' : '') + '</div>';
      }
      document.getElementById('calGrid').innerHTML = html;

      // Narrow screens get the month as a list of days instead of a grid.
      const days = Object.keys(byDay).filter(k => k.slice(0, 7) === key).sort();
      document.getElementById('calAgenda').innerHTML = days.length ? days.map(k =>
        '<div class="aday' + (k === TODAY ? ' today' : '') + '"><h4>' + fmtDay(k, { weekday: 'long', month: 'short', day: 'numeric' }) + '</h4>' +
        byDay[k].map(c => chip(c, '', '<span class="ind">' + esc([c.indication, c.company].filter(Boolean).join(' · ')) + '</span>')).join('') + '</div>').join('')
        : '<div class="none">No exact-date decisions this month' + (windows.length ? ' (see the month-only ones above).' : '.') + '</div>';
    }
    function moveMonth(delta) { calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() + delta, 1); renderCalendar(); }
    document.getElementById('calPrev').addEventListener('click', () => moveMonth(-1));
    document.getElementById('calNext').addEventListener('click', () => moveMonth(1));
    document.getElementById('calToday').addEventListener('click', () => { calMonth = new Date(now.getFullYear(), now.getMonth(), 1); renderCalendar(); });
    document.addEventListener('keydown', e => {
      if (view !== 'calendar' || document.getElementById('detail').open || /INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
      if (!document.getElementById('catalysts-tab').classList.contains('active')) return;
      if (e.key === 'ArrowLeft') moveMonth(-1);
      if (e.key === 'ArrowRight') moveMonth(1);
    });

    document.addEventListener('click', e => {
      const mon = e.target.closest('.mon');
      if (mon) { const p = mon.dataset.m.split('-'); calMonth = new Date(+p[0], +p[1] - 1, 1); renderCalendar(); return; }
      const more = e.target.closest('.more');
      if (more) { const day = more.parentElement; day.classList.toggle('open'); more.textContent = day.classList.contains('open') ? 'Show fewer' : '+' + day.querySelectorAll('.xtra').length + ' more'; return; }
      if (e.target.closest('a')) return;
      const hit = e.target.closest('[data-i]');
      if (hit && !hit.closest('.legend')) openDetail(catalysts[+hit.dataset.i]);
    });

    // ---- Filtering ----
    function renderCatalystView() {
      const total = catalysts.length;
      document.getElementById('catalystCount').textContent = (shown.length === total ? '' : shown.length + ' of ') + plural(total, 'decision');
      if (view === 'calendar') renderCalendar();
      else document.getElementById('catalystsBody').innerHTML = catalystRows(shown);
    }
    function filterCatalysts() {
      const search = document.getElementById('catalystSearch').value.toLowerCase();
      const areas = multiState.catalystAreaFilter;
      const status = document.getElementById('catalystStatusFilter').value;
      const type = document.getElementById('catalystTypeFilter').value;
      const time = parseInt(document.getElementById('catalystTimeFilter').value) || 0;

      shown = catalysts.filter(c => {
        if (search && (c.drug + ' ' + (c.company || '') + ' ' + (c.indication || '') + ' ' + (c.brandName || '')).toLowerCase().indexOf(search) < 0) return false;
        if (areas.length && areas.indexOf(c.therapeuticArea) < 0) return false;
        if (status && c.status !== status) return false;
        if (type && c.submissionType !== type) return false;
        if (time && (c.daysUntilPDUFA === null || c.daysUntilPDUFA < 0 || c.daysUntilPDUFA > time)) return false;
        return true;
      });
      shown.sort((a, b) => {
        let av = a[catalystSortCol], bv = b[catalystSortCol];
        if (av == null && bv == null) return 0;
        if (av == null) return 1;
        if (bv == null) return -1;
        if (typeof av === 'string') { av = av.toLowerCase(); bv = bv.toLowerCase(); }
        return catalystSortDir === 'asc' ? (av < bv ? -1 : av > bv ? 1 : 0) : (av > bv ? -1 : av < bv ? 1 : 0);
      });
      renderCatalystView();
    }
    function resetCatalystFilters() {
      document.getElementById('catalystSearch').value = '';
      document.getElementById('catalystStatusFilter').value = '';
      document.getElementById('catalystTypeFilter').value = '';
      document.getElementById('catalystTimeFilter').value = '';
      clearMulti('catalystAreaFilter');
      filterCatalysts();
    }

    // ---- Exports ----
    const csvCell = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
    function exportCatalystsCSV() {
      const h = ['Drug', 'Brand name', 'Company', 'PDUFA date', 'Day of week', 'Date basis', 'Days until', 'Status', 'Application', 'Disease area', 'Indication', 'Source URL'];
      const r = shown.map(c => [c.drug, c.brandName, c.company, isWindow(c) ? c.dateLabel : c.pdufaDate, isWindow(c) || !c.pdufaDate ? '' : weekday(c.pdufaDate),
        c.dateBasis || 'Announced', c.daysUntilPDUFA, c.status || 'Pending', c.submissionType, c.therapeuticArea, c.indication, c.sourceUrl].map(csvCell));
      downloadFile([h.map(csvCell)].concat(r).map(x => x.join(',')).join(String.fromCharCode(10)), 'fda-catalysts.csv', 'text/csv');
    }
    function exportTrialsCSV() {
      const h = ['Therapy', 'Type', 'Disease area', 'Sponsor', 'Indication', 'NCT ID', 'Success rate', 'Completion', 'Est. FDA decision'];
      const r = trials.map(t => [t.investigationalIntervention, t.approvalType, t.therapeuticArea, t.leadSponsor, t.conditionDisplay, t.nctId, t.successRateRange, t.formattedCompletionDate, t.formattedApprovalDate].map(csvCell));
      downloadFile([h.map(csvCell)].concat(r).map(x => x.join(',')).join(String.fromCharCode(10)), 'fda-trials.csv', 'text/csv');
    }
    // All-day events for decisions with an exact date. Month-only company
    // windows are left out rather than pinned to a day they were never given.
    function exportICS() {
      const BS = String.fromCharCode(92), NL = String.fromCharCode(13, 10);
      const e = s => String(s || '').split(BS).join(BS + BS).split(';').join(BS + ';').split(',').join(BS + ',').split(String.fromCharCode(10)).join(BS + 'n');
      const fold = l => { let out = l.slice(0, 74); for (let i = 74; i < l.length; i += 73) out += NL + ' ' + l.slice(i, i + 73); return out; };
      const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
      const list = shown.filter(c => c.pdufaDate && !isWindow(c));
      const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//MJH Life Sciences//FDA Pipeline//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:FDA decisions'];
      list.forEach(c => {
        const next = iso(new Date(asDay(c.pdufaDate).getTime() + DAY));
        lines.push('BEGIN:VEVENT',
          'UID:' + (c.drug + '-' + c.pdufaDate).toLowerCase().replace(/[^a-z0-9]+/g, '-') + '@fda-pipeline',
          'DTSTAMP:' + stamp,
          'DTSTART;VALUE=DATE:' + c.pdufaDate.split('-').join(''),
          'DTEND;VALUE=DATE:' + next.split('-').join(''),
          'SUMMARY:' + e('PDUFA' + (isEst(c) ? ' (est.)' : '') + ': ' + c.drug + (c.brandName ? ' (' + c.brandName + ')' : '') + (c.company ? ', ' + c.company : '')),
          'DESCRIPTION:' + e([c.indication, isEst(c) ? 'Estimated date, projected from the filing on the FDA review clock.' : 'Announced PDUFA date.', c.sourceUrl].filter(Boolean).join(String.fromCharCode(10))),
          c.sourceUrl ? 'URL:' + c.sourceUrl : '',
          'TRANSP:TRANSPARENT', 'END:VEVENT');
      });
      lines.push('END:VCALENDAR');
      downloadFile(lines.filter(Boolean).map(fold).join(NL) + NL, 'fda-decisions.ics', 'text/calendar');
    }
    document.getElementById('icsBtn').addEventListener('click', exportICS);
    function downloadFile(text, fn, type) {
      const u = URL.createObjectURL(new Blob([text], { type: type + ';charset=utf-8' }));
      const a = document.createElement('a');
      a.href = u; a.download = fn; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(u), 1000);
    }

    // ---- Trials ----
    function renderTrials(data) {
      document.getElementById('trialsBody').innerHTML = data.map(t => '<tr>' +
        '<td class="truncate" title="' + esc(t.investigationalIntervention) + '"><span class="drug">' + esc(t.investigationalIntervention) + '</span></td>' +
        '<td>' + (t.approvalType === 'New Approval' ? '<span class="badge b-new">New</span>' : '<span class="badge b-gray">New use</span>') + '</td>' +
        '<td>' + esc(t.therapeuticArea) + '</td>' +
        '<td class="truncate" title="' + esc(t.leadSponsor) + '">' + esc(t.leadSponsor) + '</td>' +
        '<td class="truncate" title="' + esc(t.conditionDisplay) + '">' + esc(t.conditionDisplay) + '</td>' +
        '<td><a class="nct-link" href="https://clinicaltrials.gov/study/' + esc(t.nctId) + '" target="_blank" rel="noopener">' + esc(t.nctId) + '</a></td>' +
        '<td class="' + (t.successRate >= 0.6 ? 'rate-hi' : t.successRate >= 0.5 ? 'rate-mid' : 'rate-lo') + '">' + esc(t.successRateRange) + '</td>' +
        '<td class="nowrap">' + esc(t.formattedCompletionDate) + '</td>' +
        '<td class="nowrap muted">' + esc(t.formattedApprovalDate) + '</td></tr>').join('');
      document.getElementById('trialCount').textContent = data.length.toLocaleString('en-US');
    }
    document.querySelectorAll('.sponsor-item').forEach(b => b.addEventListener('click', () => { document.getElementById('trialSearch').value = b.dataset.sponsor; filterTrials(); }));

    function filterTrials() {
      const search = document.getElementById('trialSearch').value.toLowerCase();
      const areas = multiState.areaFilter, approvals = multiState.approvalFilter, years = multiState.yearFilter, fdaYears = multiState.fdaYearFilter;
      const minSuccess = parseFloat(document.getElementById('trialSuccessFilter').value) || 0;
      const filtered = trials.filter(t => {
        if (search && (t.nctId + ' ' + t.title + ' ' + t.leadSponsor + ' ' + t.conditionDisplay + ' ' + t.investigationalIntervention).toLowerCase().indexOf(search) < 0) return false;
        if (areas.length && areas.indexOf(t.therapeuticArea) < 0) return false;
        if (approvals.length && approvals.indexOf(t.approvalType) < 0) return false;
        if (minSuccess && t.successRate < minSuccess) return false;
        if (years.length && (!t.primaryCompletionDate || years.indexOf(String(new Date(t.primaryCompletionDate).getFullYear())) < 0)) return false;
        if (fdaYears.length && (!t.estimatedApprovalDate || fdaYears.indexOf(String(new Date(t.estimatedApprovalDate).getFullYear())) < 0)) return false;
        return true;
      });
      filtered.sort((a, b) => {
        let av = a[trialSortCol] || '', bv = b[trialSortCol] || '';
        if (trialSortCol.indexOf('Date') >= 0) { av = av ? new Date(av).getTime() : 0; bv = bv ? new Date(bv).getTime() : 0; }
        else if (typeof av === 'string') { av = av.toLowerCase(); bv = String(bv).toLowerCase(); }
        return trialSortDir === 'asc' ? (av < bv ? -1 : av > bv ? 1 : 0) : (av > bv ? -1 : av < bv ? 1 : 0);
      });
      renderTrials(filtered);
    }
    function resetTrialFilters() {
      document.getElementById('trialSearch').value = '';
      document.getElementById('trialSuccessFilter').value = '';
      ['areaFilter', 'approvalFilter', 'yearFilter', 'fdaYearFilter'].forEach(clearMulti);
      filterTrials();
    }

    function sortable(tableId, get, set, refilter) {
      document.querySelectorAll('#' + tableId + ' th[data-sort]').forEach(th => th.addEventListener('click', () => {
        const s = get(), col = th.dataset.sort;
        const dir = s.col === col && s.dir === 'asc' ? 'desc' : 'asc';
        set(col, dir);
        document.querySelectorAll('#' + tableId + ' th').forEach(h => h.classList.remove('sorted-asc', 'sorted-desc'));
        th.classList.add(dir === 'asc' ? 'sorted-asc' : 'sorted-desc');
        refilter();
      }));
    }
    sortable('trialsTable', () => ({ col: trialSortCol, dir: trialSortDir }), (c, d) => { trialSortCol = c; trialSortDir = d; }, filterTrials);
    sortable('catalystsTable', () => ({ col: catalystSortCol, dir: catalystSortDir }), (c, d) => { catalystSortCol = c; catalystSortDir = d; }, filterCatalysts);
    document.getElementById('trialSearch').addEventListener('input', filterTrials);
    document.getElementById('catalystSearch').addEventListener('input', filterCatalysts);

    // ---- Charts (drawn when the trials tab is first opened) ----
    function drawCharts() {
      if (typeof Chart === 'undefined') return;
      Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
      Chart.defaults.color = '#6b7280';
      const grid = { color: '#f1f5f9' };
      new Chart(document.getElementById('areaChart'), {
        type: 'bar',
        data: { labels: ${JSON.stringify(areaLabels)}, datasets: [{ label: 'Trials', data: ${JSON.stringify(areaCounts)}, backgroundColor: '#93c5fd', hoverBackgroundColor: '#1d4ed8', borderRadius: 3 }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { grid: { display: false } }, y: { beginAtZero: true, grid } } }
      });
      new Chart(document.getElementById('timelineChart'), {
        type: 'line',
        data: { labels: ${JSON.stringify(timelineLabels)}, datasets: [{ label: 'Completions', data: ${JSON.stringify(timelineData)}, borderColor: '#1d4ed8', backgroundColor: 'rgba(29,78,216,0.08)', fill: true, tension: 0.3, pointRadius: 0, pointHoverRadius: 4, borderWidth: 2 }] },
        options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, plugins: { legend: { display: false } }, scales: { x: { grid: { display: false } }, y: { beginAtZero: true, grid } } }
      });
    }

    // ---- Start ----
    try { const v = localStorage.getItem('fdaView'); if (v === 'calendar') view = 'calendar'; } catch (e) {}
    const start = (location.hash || '').slice(1);
    if (start === 'calendar') view = 'calendar';
    if (start === 'catalysts') view = 'list';
    filterTrials();
    filterCatalysts();
    setView(view);
    showTab(start === 'trials' || start === 'reference' ? start : 'catalysts');
  </script>
</body>
</html>`;
}

// Server-side helpers for the parts of the page built here rather than in the browser.
function shortDay(s) {
  const d = new Date(String(s).slice(0, 10) + 'T12:00:00');
  return isNaN(d) ? String(s) : d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}
const SOURCE_NAMES = { 'onclive.com': 'OncLive', 'hcplive.com': 'HCPLive', 'psychiatrictimes.com': 'Psychiatric Times', 'rttnews.com': 'RTTNews',
  'neurologylive.com': 'NeurologyLive', 'contagionlive.com': 'Contagion Live', 'cancernetwork.com': 'CancerNetwork', 'targetedonc.com': 'Targeted Oncology',
  'pharmacytimes.com': 'Pharmacy Times', 'pharmexec.com': 'Pharmaceutical Executive', 'contemporarypediatrics.com': 'Contemporary Pediatrics',
  'ophthalmologytimes.com': 'Ophthalmology Times', 'dermatologytimes.com': 'Dermatology Times', 'curetoday.com': 'CURE', 'ajmc.com': 'AJMC',
  'urologytimes.com': 'Urology Times', 'drugtopics.com': 'Drug Topics', 'sec.gov': 'SEC filing', 'fda.gov': 'FDA' };
function sourceName(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    return host.startsWith('google.') ? 'Search only' : SOURCE_NAMES[host] || host;
  } catch { return 'Source'; }
}

async function generateIntegratedReport(options = {}) {
  const { outputPath = path.join(REPORTS_DIR, 'fda-pipeline-report.html'), verbose = true, forceRefresh = false } = options;

  if (verbose) console.log('Fetching clinical trials...');
  let trials = await fetchAllTrials({ forceRefresh, verbose });
  trials = filterStaleTrials(trials);
  trials = filterNonDrugTrials(trials);

  if (verbose) console.log('Processing trials...');
  const approvedDrugs = await fetchApprovedDrugs({ verbose });
  const processedTrials = await processTrials(trials, approvedDrugs, verbose);
  const trialStats = generateTrialStats(processedTrials);

  if (verbose) console.log('Loading PDUFA catalysts...');
  const allCatalysts = await getPDUFACatalysts({ forceRefresh, verbose });
  // Pipeline 2.0 returns recent decisions alongside upcoming ones; they belong in "Recently decided".
  const fromP2 = allCatalysts.some(c => c.confidence || c.dateBasis);
  const catalysts = fromP2 ? allCatalysts.filter(c => c.status !== 'Approved' && c.status !== 'CRL') : allCatalysts;
  const catalystStats = getCatalystStats(catalysts);

  // What came off the list recently, and on what evidence. Shown in the report
  // so a removal is auditable rather than an entry quietly disappearing.
  let recentOutcomes = [];
  if (fromP2) recentOutcomes = allCatalysts.filter(c => c.status === 'Approved' || c.status === 'CRL')
    .sort((a, b) => b.pdufaDate.localeCompare(a.pdufaDate))
    .map(c => ({
      drug: c.drug, company: c.company, pdufaDate: c.scheduledDate || null, outcome: c.status, resolvedDate: c.pdufaDate,
      certainty: 'resolved', evidence: [{ source: c.source === 'FDA' ? 'FDA record' : 'MJH', detail: c.decisionTitle || '' }], sourceUrl: c.sourceUrl,
    }));
  else try {
    const log = JSON.parse(fs.readFileSync(path.join(__dirname, 'state', 'outcomes.json'), 'utf8'));
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 30);
    const cutoffStr = cutoff.toISOString().slice(0, 10);
    recentOutcomes = log
      .filter(o => (o.recordedAt || '') >= cutoffStr)
      .sort((a, b) => String(b.resolvedDate || b.recordedAt).localeCompare(String(a.resolvedDate || a.recordedAt)));
  } catch { /* no log yet */ }

  if (verbose) console.log('Generating integrated report...');
  const html = generateHTML(processedTrials, trialStats, catalysts, catalystStats, recentOutcomes);

  if (!fs.existsSync(REPORTS_DIR)) fs.mkdirSync(REPORTS_DIR, { recursive: true });
  fs.writeFileSync(outputPath, html);

  if (verbose) console.log(`Report saved to: ${outputPath}`);
  return { trials: processedTrials, trialStats, catalysts, catalystStats, outputPath };
}

module.exports = { generateIntegratedReport, generateHTML, generateTrialStats };
