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

function generateHTML(trials, trialStats, catalysts, catalystStats) {
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

  const catalystMonths = Object.keys(catalystStats.byMonth).sort();
  const catalystMonthLabels = catalystMonths.map(m => {
    const [y, mo] = m.split('-');
    return new Date(y, parseInt(mo) - 1).toLocaleDateString('en-US', { year: '2-digit', month: 'short' });
  });
  const catalystMonthCounts = catalystMonths.map(m => catalystStats.byMonth[m]);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>FDA Pipeline Report - Clinical Trials & Catalysts</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <style>
    * { box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 20px; background: #f5f7fa; color: #333; }
    .container { max-width: 1800px; margin: 0 auto; }
    h1 { color: #1a365d; margin-bottom: 5px; }
    .subtitle { color: #666; margin-bottom: 30px; }
    .generated-date { color: #888; font-size: 0.9em; margin-bottom: 20px; }
    .tabs { display: flex; gap: 5px; margin-bottom: 20px; border-bottom: 2px solid #e5e7eb; }
    .tab { padding: 12px 24px; background: none; border: none; cursor: pointer; font-size: 1em; font-weight: 500; color: #666; border-bottom: 3px solid transparent; margin-bottom: -2px; }
    .tab:hover { color: #2563eb; }
    .tab.active { color: #2563eb; border-bottom-color: #2563eb; }
    .tab-content { display: none; }
    .tab-content.active { display: block; }
    .summary-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 15px; margin-bottom: 30px; }
    .summary-card { background: white; padding: 20px; border-radius: 10px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
    .summary-card h3 { margin: 0 0 10px 0; color: #666; font-size: 0.85em; text-transform: uppercase; }
    .summary-card .value { font-size: 1.8em; font-weight: bold; color: #2563eb; }
    .summary-card .subtext { color: #888; font-size: 0.85em; margin-top: 5px; }
    .summary-card.highlight .value { color: #7c3aed; }
    .summary-card.warning .value { color: #dc2626; }
    .summary-card.success .value { color: #059669; }
    .charts-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(450px, 1fr)); gap: 20px; margin-bottom: 30px; }
    .chart-container { background: white; padding: 20px; border-radius: 10px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
    .chart-container h3 { margin: 0 0 15px 0; }
    .chart-wrapper { position: relative; height: 280px; }
    .filters { background: white; padding: 20px; border-radius: 10px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); margin-bottom: 20px; display: flex; flex-wrap: wrap; gap: 15px; align-items: flex-end; }
    .filter-group { display: flex; flex-direction: column; gap: 5px; }
    .filter-group label { font-size: 0.85em; color: #666; font-weight: 500; }
    .filter-group input, .filter-group select { padding: 8px 12px; border: 1px solid #ddd; border-radius: 5px; font-size: 0.95em; }
    .filter-group input:focus, .filter-group select:focus { outline: none; border-color: #2563eb; }
    .search-input { min-width: 220px; }
    .btn { border: none; padding: 8px 16px; border-radius: 5px; cursor: pointer; font-size: 0.95em; }
    .reset-btn { background: #e5e7eb; }
    .reset-btn:hover { background: #d1d5db; }
    .export-btn { background: #2563eb; color: white; }
    .export-btn:hover { background: #1d4ed8; }
    .multi-select { position: relative; min-width: 140px; }
    .multi-select-btn { width: 100%; padding: 8px 12px; border: 1px solid #ddd; border-radius: 5px; background: white; cursor: pointer; text-align: left; font-size: 0.95em; display: flex; justify-content: space-between; align-items: center; }
    .multi-select-btn:hover { border-color: #2563eb; }
    .multi-select-btn::after { content: '▼'; font-size: 0.7em; color: #666; }
    .multi-select-btn.active::after { content: '▲'; }
    .multi-select-dropdown { display: none; position: absolute; top: 100%; left: 0; right: 0; background: white; border: 1px solid #ddd; border-radius: 5px; box-shadow: 0 4px 12px rgba(0,0,0,0.15); z-index: 100; max-height: 250px; overflow-y: auto; margin-top: 2px; }
    .multi-select-dropdown.show { display: block; }
    .multi-select-option { padding: 8px 12px; cursor: pointer; display: flex; align-items: center; gap: 8px; }
    .multi-select-option:hover { background: #f0f9ff; }
    .multi-select-option input { margin: 0; cursor: pointer; }
    .multi-select-option.selected { background: #eff6ff; }
    .multi-select-count { background: #2563eb; color: white; font-size: 0.75em; padding: 2px 6px; border-radius: 10px; margin-left: 4px; }
    .table-container { background: white; border-radius: 10px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); overflow: hidden; }
    .table-header { padding: 15px 20px; border-bottom: 1px solid #eee; display: flex; justify-content: space-between; align-items: center; }
    .table-header h3 { margin: 0; }
    .result-count { color: #666; font-size: 0.9em; }
    .table-wrapper { overflow-x: auto; max-height: 600px; overflow-y: auto; }
    table { width: 100%; border-collapse: collapse; font-size: 0.9em; }
    th, td { padding: 12px 15px; text-align: left; border-bottom: 1px solid #eee; }
    th { background: #f8fafc; font-weight: 600; color: #374151; cursor: pointer; white-space: nowrap; position: sticky; top: 0; z-index: 10; }
    th:hover { background: #f1f5f9; }
    th.sorted-asc::after { content: ' ▲'; color: #2563eb; }
    th.sorted-desc::after { content: ' ▼'; color: #2563eb; }
    tr:hover { background: #f8fafc; }
    .nct-link { color: #2563eb; text-decoration: none; }
    .nct-link:hover { text-decoration: underline; }
    .badge { display: inline-block; padding: 3px 8px; border-radius: 4px; font-size: 0.85em; font-weight: 500; }
    .badge-success { background: #dcfce7; color: #166534; }
    .badge-warning { background: #fef3c7; color: #92400e; }
    .badge-danger { background: #fee2e2; color: #991b1b; }
    .badge-info { background: #e0e7ff; color: #3730a3; }
    .badge-purple { background: #f3e8ff; color: #7c3aed; }
    .badge-cyan { background: #cffafe; color: #0891b2; }
    .badge-gray { background: #f3f4f6; color: #6b7280; }
    .truncate { max-width: 200px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .drug-name { font-weight: 600; color: #1e40af; }
    .sponsors-list { background: white; padding: 20px; border-radius: 10px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); margin-bottom: 30px; }
    .sponsors-list h3 { margin: 0 0 15px 0; }
    .sponsor-items { display: flex; flex-wrap: wrap; gap: 10px; }
    .sponsor-item { background: #f1f5f9; padding: 8px 12px; border-radius: 5px; font-size: 0.9em; cursor: pointer; }
    .sponsor-item:hover { background: #dbeafe; }
    .sponsor-item .sponsor-name { color: #2563eb; font-weight: 500; }
    .sponsor-count { color: #64748b; margin-left: 5px; }
    .info-box { background: #eff6ff; border: 1px solid #bfdbfe; padding: 15px; border-radius: 8px; margin-top: 20px; font-size: 0.9em; color: #1e40af; }
    .info-box strong { color: #1e3a8a; }
    .success-rates-ref { background: white; padding: 20px; border-radius: 10px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); margin-top: 30px; }
    .rates-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 10px; }
    .rate-item { padding: 10px; background: #f8fafc; border-radius: 5px; display: flex; justify-content: space-between; }
    @media (max-width: 768px) { .charts-grid { grid-template-columns: 1fr; } .filters { flex-direction: column; } }
  </style>
</head>
<body>
  <div class="container">
    <h1>FDA Pipeline Report</h1>
    <p class="subtitle">Phase 3 Clinical Trials & Near-Term Regulatory Catalysts</p>
    <p class="generated-date">Generated: ${new Date().toLocaleString('en-US', { dateStyle: 'full', timeStyle: 'short' })}</p>

    <div class="summary-grid">
      <div class="summary-card"><h3>Active Trials</h3><div class="value">${trialStats.total.toLocaleString()}</div><div class="subtext">Phase 3 & Phase 2/3</div></div>
      <div class="summary-card highlight"><h3>New Drug Candidates</h3><div class="value">${(trialStats.byApprovalType['New Approval'] || 0).toLocaleString()}</div><div class="subtext">Novel therapies</div></div>
      <div class="summary-card"><h3>Line Extensions</h3><div class="value">${(trialStats.byApprovalType['Supplemental'] || 0).toLocaleString()}</div><div class="subtext">New indications</div></div>
      <div class="summary-card warning"><h3>PDUFA Catalysts</h3><div class="value">${catalystStats.total}</div><div class="subtext">FDA decisions tracked</div></div>
      <div class="summary-card success"><h3>Imminent (30d)</h3><div class="value">${catalystStats.imminent}</div><div class="subtext">Near-term decisions</div></div>
      <div class="summary-card"><h3>Therapeutic Areas</h3><div class="value">${Object.keys(trialStats.byArea).length}</div><div class="subtext">Disease categories</div></div>
    </div>

    <div class="tabs">
      <button class="tab active" onclick="showTab('trials')">Clinical Trials (${trialStats.total})</button>
      <button class="tab" onclick="showTab('catalysts')">FDA Catalysts (${catalystStats.total})</button>
      <button class="tab" onclick="showTab('reference')">Reference Data</button>
    </div>

    <!-- Trials Tab -->
    <div id="trials-tab" class="tab-content active">
      <div class="charts-grid">
        <div class="chart-container"><h3>Trials by Therapeutic Area</h3><div class="chart-wrapper"><canvas id="areaChart"></canvas></div></div>
        <div class="chart-container"><h3>Trial Completion Timeline</h3><div class="chart-wrapper"><canvas id="timelineChart"></canvas></div></div>
      </div>

      <div class="sponsors-list">
        <h3>Top Sponsors <span style="font-weight:normal;color:#666;font-size:0.8em;">(click to filter)</span></h3>
        <div class="sponsor-items">
          ${trialStats.topSponsors.map(([s, c]) => `<div class="sponsor-item" onclick="filterTrialsBySponsor('${escapeHtml(s.replace(/'/g, "\\'"))}')"><span class="sponsor-name">${escapeHtml(s)}</span><span class="sponsor-count">(${c})</span></div>`).join('')}
        </div>
      </div>

      <div class="filters">
        <div class="filter-group"><label>Search</label><input type="text" id="trialSearch" class="search-input" placeholder="Therapy, sponsor, condition, NCT ID..."></div>
        <div class="filter-group"><label>Therapeutic Area</label>
          <div class="multi-select" id="areaFilterWrap">
            <button class="multi-select-btn" onclick="toggleMulti('areaFilter')"><span id="areaFilterLabel">All Areas</span></button>
            <div class="multi-select-dropdown" id="areaFilterDrop">
              ${areas.map(a => `<label class="multi-select-option"><input type="checkbox" value="${a}" onchange="updateMulti('areaFilter')">${a}</label>`).join('')}
            </div>
          </div>
        </div>
        <div class="filter-group"><label>Approval Type</label>
          <div class="multi-select" id="approvalFilterWrap">
            <button class="multi-select-btn" onclick="toggleMulti('approvalFilter')"><span id="approvalFilterLabel">All Types</span></button>
            <div class="multi-select-dropdown" id="approvalFilterDrop">
              <label class="multi-select-option"><input type="checkbox" value="New Approval" onchange="updateMulti('approvalFilter')">New Approval</label>
              <label class="multi-select-option"><input type="checkbox" value="Supplemental" onchange="updateMulti('approvalFilter')">Supplemental</label>
            </div>
          </div>
        </div>
        <div class="filter-group"><label>Completion Year</label>
          <div class="multi-select" id="yearFilterWrap">
            <button class="multi-select-btn" onclick="toggleMulti('yearFilter')"><span id="yearFilterLabel">All Years</span></button>
            <div class="multi-select-dropdown" id="yearFilterDrop">
              ${completionYears.map(y => `<label class="multi-select-option"><input type="checkbox" value="${y}" onchange="updateMulti('yearFilter')">${y}</label>`).join('')}
            </div>
          </div>
        </div>
        <div class="filter-group"><label>FDA Decision Year</label>
          <div class="multi-select" id="fdaYearFilterWrap">
            <button class="multi-select-btn" onclick="toggleMulti('fdaYearFilter')"><span id="fdaYearFilterLabel">All Years</span></button>
            <div class="multi-select-dropdown" id="fdaYearFilterDrop">
              ${fdaYears.map(y => `<label class="multi-select-option"><input type="checkbox" value="${y}" onchange="updateMulti('fdaYearFilter')">${y}</label>`).join('')}
            </div>
          </div>
        </div>
        <div class="filter-group"><label>Min Success Rate</label>
          <select id="trialSuccessFilter" onchange="filterTrials()">
            <option value="">Any</option><option value="0.6">≥60%</option><option value="0.5">≥50%</option><option value="0.4">≥40%</option>
          </select>
        </div>
        <button class="btn reset-btn" onclick="resetTrialFilters()">Reset</button>
        <button class="btn export-btn" onclick="exportTrialsCSV()">Export CSV</button>
      </div>

      <div class="table-container">
        <div class="table-header"><h3>Clinical Trials</h3><span class="result-count"><span id="trialCount">${trials.length}</span> of ${trials.length} trials</span></div>
        <div class="table-wrapper">
          <table id="trialsTable">
            <thead><tr>
              <th data-sort="investigationalIntervention">Therapy</th>
              <th data-sort="approvalType">Type</th>
              <th data-sort="therapeuticArea">Disease Area</th>
              <th data-sort="leadSponsor">Sponsor</th>
              <th data-sort="conditionDisplay">Indication</th>
              <th data-sort="nctId">NCT ID</th>
              <th data-sort="successRate">P(Success)</th>
              <th data-sort="primaryCompletionDate">Completion</th>
              <th data-sort="estimatedApprovalDate">Est. FDA Decision</th>
            </tr></thead>
            <tbody id="trialsBody"></tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- Catalysts Tab -->
    <div id="catalysts-tab" class="tab-content">
      <div class="charts-grid">
        <div class="chart-container"><h3>PDUFA Timeline</h3><div class="chart-wrapper"><canvas id="catalystTimelineChart"></canvas></div></div>
        <div class="chart-container"><h3>By Submission Type</h3><div class="chart-wrapper"><canvas id="catalystTypeChart"></canvas></div></div>
      </div>

      <div class="filters">
        <div class="filter-group"><label>Search</label><input type="text" id="catalystSearch" class="search-input" placeholder="Drug, company, indication..."></div>
        <div class="filter-group"><label>Disease Area</label>
          <div class="multi-select" id="catalystAreaFilterWrap">
            <button class="multi-select-btn" onclick="toggleMulti('catalystAreaFilter')"><span id="catalystAreaFilterLabel">All Areas</span></button>
            <div class="multi-select-dropdown" id="catalystAreaFilterDrop">
              ${Object.keys(catalystStats.byTherapeuticArea).filter(a => a !== 'Unknown').sort().map(a => `<label class="multi-select-option"><input type="checkbox" value="${a}" onchange="updateCatalystMulti('catalystAreaFilter')">${a} (${catalystStats.byTherapeuticArea[a]})</label>`).join('')}
            </div>
          </div>
        </div>
        <div class="filter-group"><label>Status</label>
          <select id="catalystStatusFilter" onchange="filterCatalysts()">
            <option value="">All Statuses</option>
            ${Object.keys(catalystStats.byStatus).map(s => `<option value="${s}">${s}</option>`).join('')}
          </select>
        </div>
        <div class="filter-group"><label>Submission Type</label>
          <select id="catalystTypeFilter" onchange="filterCatalysts()">
            <option value="">All Types</option>
            ${Object.keys(catalystStats.bySubmissionType).filter(t => t !== 'Unknown').map(t => `<option value="${t}">${t}</option>`).join('')}
          </select>
        </div>
        <div class="filter-group"><label>Timeframe</label>
          <select id="catalystTimeFilter" onchange="filterCatalysts()">
            <option value="">All</option><option value="30">Next 30 days</option><option value="90">Next 90 days</option><option value="180">Next 6 months</option><option value="365">Next year</option>
          </select>
        </div>
        <button class="btn reset-btn" onclick="resetCatalystFilters()">Reset</button>
        <button class="btn export-btn" onclick="exportCatalystsCSV()">Export CSV</button>
      </div>

      <div class="table-container">
        <div class="table-header"><h3>PDUFA Dates & FDA Catalysts</h3><span class="result-count"><span id="catalystCount">${catalysts.length}</span> of ${catalysts.length}</span></div>
        <div class="table-wrapper">
          <table id="catalystsTable">
            <thead><tr>
              <th data-sort="drug">Drug</th>
              <th data-sort="company">Company</th>
              <th data-sort="pdufaDate">PDUFA Date</th>
              <th data-sort="daysUntilPDUFA">Days Until</th>
              <th data-sort="status">Status</th>
              <th data-sort="submissionType">Type</th>
              <th data-sort="therapeuticArea">Disease Area</th>
              <th data-sort="indication">Indication</th>
              <th>Source</th>
            </tr></thead>
            <tbody id="catalystsBody"></tbody>
          </table>
        </div>
      </div>

      <div class="info-box">
        <strong>Data Source:</strong> Curated PDUFA dates from company press releases, SEC filings, and FDA announcements.
        <br><em>This list is updated periodically. Cross-reference with company investor relations for the latest information.</em>
      </div>
    </div>

    <!-- Reference Tab -->
    <div id="reference-tab" class="tab-content">
      <div class="success-rates-ref">
        <h3>Phase 3 Success Rates by Therapeutic Area</h3>
        <div class="rates-grid">
          ${Object.entries(successRates).map(([area, data]) => `<div class="rate-item"><span>${area}</span><span class="badge ${data.rate >= 0.6 ? 'badge-success' : data.rate >= 0.5 ? 'badge-warning' : 'badge-danger'}">${data.range}</span></div>`).join('')}
        </div>
        <p style="margin-top:15px;color:#666;font-size:0.85em;"><em>Source: BIO Industry Analysis, Nature Communications.</em></p>
      </div>
      <div class="info-box" style="margin-top:20px;">
        <strong>FDA Approval Timeline Estimates:</strong>
        <ul style="margin:10px 0 0 20px;padding:0;">
          <li><strong>High urgency</strong> (Oncology, Rare Disease): ~9 months</li>
          <li><strong>Elevated</strong> (Hematology, Infectious Disease, Neurology): ~12 months</li>
          <li><strong>Standard</strong> (Cardiology, Pulmonology, Endocrinology): ~15 months</li>
          <li><strong>Lower urgency</strong> (Dermatology, Urology, Orthopedics): ~18 months</li>
        </ul>
      </div>
      <div class="info-box" style="margin-top:20px;background:#f0fdf4;border-color:#86efac;color:#166534;">
        <strong>Approval Type:</strong>
        <ul style="margin:10px 0 0 20px;padding:0;">
          <li><strong>New Approval (NDA/BLA):</strong> Novel drug not yet FDA-approved</li>
          <li><strong>Supplemental (sNDA/sBLA):</strong> Already-approved drug, new indication</li>
        </ul>
      </div>
    </div>
  </div>

  <script>
    const trials = ${JSON.stringify(trials)};
    const catalysts = ${JSON.stringify(catalysts)};
    let trialSortCol = 'therapeuticArea', trialSortDir = 'asc';
    let catalystSortCol = 'daysUntilPDUFA', catalystSortDir = 'asc';
    const multiState = { areaFilter: [], approvalFilter: [], yearFilter: [], fdaYearFilter: [], catalystAreaFilter: [] };

    function showTab(name) {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
      document.getElementById(name + '-tab').classList.add('active');
      event.target.classList.add('active');
    }

    function escapeHtml(s) { return s ? s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') : ''; }
    function formatDate(d) { if (!d) return 'TBD'; const normalized = d.includes('T') ? d : d + 'T12:00:00'; const dt = new Date(normalized); return isNaN(dt) ? d : dt.toLocaleDateString('en-US',{year:'numeric',month:'short',day:'numeric'}); }

    // Multi-select
    function toggleMulti(id) {
      const drop = document.getElementById(id + 'Drop');
      const btn = drop.previousElementSibling;
      document.querySelectorAll('.multi-select-dropdown').forEach(d => { if (d.id !== id + 'Drop') d.classList.remove('show'); });
      document.querySelectorAll('.multi-select-btn').forEach(b => { if (b !== btn) b.classList.remove('active'); });
      drop.classList.toggle('show');
      btn.classList.toggle('active');
    }
    function updateMulti(id) {
      const drop = document.getElementById(id + 'Drop');
      const vals = Array.from(drop.querySelectorAll('input:checked')).map(i => i.value);
      multiState[id] = vals;
      const label = document.getElementById(id + 'Label');
      const defaults = { areaFilter: 'All Areas', approvalFilter: 'All Types', yearFilter: 'All Years', fdaYearFilter: 'All Years' };
      label.innerHTML = vals.length === 0 ? defaults[id] : vals.length === 1 ? vals[0] : vals.length + ' selected<span class="multi-select-count">' + vals.length + '</span>';
      drop.querySelectorAll('.multi-select-option').forEach(o => o.classList.toggle('selected', o.querySelector('input').checked));
      filterTrials();
    }
    function updateCatalystMulti(id) {
      const drop = document.getElementById(id + 'Drop');
      const vals = Array.from(drop.querySelectorAll('input:checked')).map(i => i.value);
      multiState[id] = vals;
      const label = document.getElementById(id + 'Label');
      label.innerHTML = vals.length === 0 ? 'All Areas' : vals.length === 1 ? vals[0] : vals.length + ' selected<span class="multi-select-count">' + vals.length + '</span>';
      drop.querySelectorAll('.multi-select-option').forEach(o => o.classList.toggle('selected', o.querySelector('input').checked));
      filterCatalysts();
    }
    document.addEventListener('click', e => { if (!e.target.closest('.multi-select')) { document.querySelectorAll('.multi-select-dropdown').forEach(d => d.classList.remove('show')); document.querySelectorAll('.multi-select-btn').forEach(b => b.classList.remove('active')); }});

    function renderTrials(data) {
      document.getElementById('trialsBody').innerHTML = data.map(t => \`<tr>
        <td class="drug-name truncate" title="\${escapeHtml(t.investigationalIntervention)}">\${escapeHtml(t.investigationalIntervention)}</td>
        <td><span class="badge \${t.approvalType==='New Approval'?'badge-purple':'badge-cyan'}">\${t.approvalType==='New Approval'?'New':'Suppl'}</span></td>
        <td><span class="badge badge-info">\${t.therapeuticArea}</span></td>
        <td class="truncate" title="\${escapeHtml(t.leadSponsor)}">\${escapeHtml(t.leadSponsor)}</td>
        <td class="truncate" title="\${escapeHtml(t.conditionDisplay)}">\${escapeHtml(t.conditionDisplay)}</td>
        <td><a class="nct-link" href="https://clinicaltrials.gov/study/\${t.nctId}" target="_blank">\${t.nctId}</a></td>
        <td><span class="badge \${t.successRate>=0.6?'badge-success':t.successRate>=0.5?'badge-warning':'badge-danger'}">\${t.successRateRange}</span></td>
        <td>\${t.formattedCompletionDate}</td>
        <td style="color:#059669;font-style:italic">\${t.formattedApprovalDate}</td>
      </tr>\`).join('');
      document.getElementById('trialCount').textContent = data.length;
    }

    function filterTrialsBySponsor(s) { document.getElementById('trialSearch').value = s; filterTrials(); }

    function filterTrials() {
      const search = document.getElementById('trialSearch').value.toLowerCase();
      const areas = multiState.areaFilter;
      const approvals = multiState.approvalFilter;
      const years = multiState.yearFilter;
      const fdaYears = multiState.fdaYearFilter;
      const minSuccess = parseFloat(document.getElementById('trialSuccessFilter').value) || 0;

      let filtered = trials.filter(t => {
        if (search && !(\`\${t.nctId} \${t.title} \${t.leadSponsor} \${t.conditionDisplay} \${t.investigationalIntervention}\`.toLowerCase().includes(search))) return false;
        if (areas.length && !areas.includes(t.therapeuticArea)) return false;
        if (approvals.length && !approvals.includes(t.approvalType)) return false;
        if (minSuccess && t.successRate < minSuccess) return false;
        if (years.length) {
          if (!t.primaryCompletionDate) return false;
          const y = new Date(t.primaryCompletionDate).getFullYear().toString();
          if (!years.includes(y)) return false;
        }
        if (fdaYears.length) {
          if (!t.estimatedApprovalDate) return false;
          const y = new Date(t.estimatedApprovalDate).getFullYear().toString();
          if (!fdaYears.includes(y)) return false;
        }
        return true;
      });

      filtered.sort((a, b) => {
        let av = a[trialSortCol] || '', bv = b[trialSortCol] || '';
        if (trialSortCol.includes('Date')) { av = av ? new Date(av).getTime() : 0; bv = bv ? new Date(bv).getTime() : 0; }
        else if (typeof av === 'string') { av = av.toLowerCase(); bv = bv.toLowerCase(); }
        return trialSortDir === 'asc' ? (av < bv ? -1 : av > bv ? 1 : 0) : (av > bv ? -1 : av < bv ? 1 : 0);
      });
      renderTrials(filtered);
    }

    function resetTrialFilters() {
      document.getElementById('trialSearch').value = '';
      document.getElementById('trialSuccessFilter').value = '';
      ['areaFilter','approvalFilter','yearFilter','fdaYearFilter'].forEach(id => {
        multiState[id] = [];
        const drop = document.getElementById(id + 'Drop');
        drop.querySelectorAll('input').forEach(i => i.checked = false);
        drop.querySelectorAll('.multi-select-option').forEach(o => o.classList.remove('selected'));
        const defaults = { areaFilter: 'All Areas', approvalFilter: 'All Types', yearFilter: 'All Years', fdaYearFilter: 'All Years' };
        document.getElementById(id + 'Label').innerHTML = defaults[id];
      });
      filterTrials();
    }

    function renderCatalysts(data) {
      document.getElementById('catalystsBody').innerHTML = data.map(c => {
        const d = c.daysUntilPDUFA;
        const dc = d===null?'badge-gray':d<0?'badge-gray':d<=30?'badge-danger':d<=90?'badge-warning':'badge-success';
        const dl = d===null?'TBD':d<0?\`\${Math.abs(d)}d ago\`:d===0?'Today':\`\${d}d\`;
        const sc = (c.status||'').toLowerCase()==='approved'?'badge-success':(c.status||'').toLowerCase()==='crl'?'badge-danger':'badge-warning';
        return \`<tr>
          <td class="drug-name">\${escapeHtml(c.drug)}\${c.brandName ? ' <span style="color:#666;font-weight:normal">(' + escapeHtml(c.brandName) + ')</span>' : ''}</td>
          <td class="truncate" title="\${escapeHtml(c.company)}">\${escapeHtml(c.company)}</td>
          <td>\${formatDate(c.pdufaDate)}</td>
          <td><span class="badge \${dc}">\${dl}</span></td>
          <td><span class="badge \${sc}">\${c.status||'Pending'}</span></td>
          <td>\${c.submissionType?'<span class="badge badge-info">'+c.submissionType+'</span>':'-'}</td>
          <td>\${c.therapeuticArea?'<span class="badge badge-info">'+c.therapeuticArea+'</span>':'-'}</td>
          <td class="truncate" title="\${escapeHtml(c.indication)}">\${escapeHtml(c.indication)||'-'}</td>
          <td>\${c.sourceUrl ? '<a href="'+escapeHtml(c.sourceUrl)+'" target="_blank" style="color:#2563eb;text-decoration:none" title="'+escapeHtml(c.sourceUrl)+'">🔗</a>' : '-'}</td>
        </tr>\`;
      }).join('');
      document.getElementById('catalystCount').textContent = data.length;
    }

    function filterCatalysts() {
      const search = document.getElementById('catalystSearch').value.toLowerCase();
      const areas = multiState.catalystAreaFilter;
      const status = document.getElementById('catalystStatusFilter').value;
      const type = document.getElementById('catalystTypeFilter').value;
      const time = parseInt(document.getElementById('catalystTimeFilter').value) || 0;

      let filtered = catalysts.filter(c => {
        if (search && !(\`\${c.drug} \${c.company} \${c.indication||''} \${c.brandName||''}\`.toLowerCase().includes(search))) return false;
        if (areas.length && !areas.includes(c.therapeuticArea)) return false;
        if (status && c.status !== status) return false;
        if (type && c.submissionType !== type) return false;
        if (time && (c.daysUntilPDUFA === null || c.daysUntilPDUFA < 0 || c.daysUntilPDUFA > time)) return false;
        return true;
      });

      filtered.sort((a, b) => {
        let av = a[catalystSortCol], bv = b[catalystSortCol];
        if (av === null && bv === null) return 0;
        if (av === null) return 1;
        if (bv === null) return -1;
        if (catalystSortCol.includes('Date')) { av = new Date(av).getTime(); bv = new Date(bv).getTime(); }
        else if (typeof av === 'string') { av = av.toLowerCase(); bv = bv.toLowerCase(); }
        return catalystSortDir === 'asc' ? (av < bv ? -1 : av > bv ? 1 : 0) : (av > bv ? -1 : av < bv ? 1 : 0);
      });
      renderCatalysts(filtered);
    }

    function resetCatalystFilters() {
      document.getElementById('catalystSearch').value = '';
      document.getElementById('catalystStatusFilter').value = '';
      document.getElementById('catalystTypeFilter').value = '';
      document.getElementById('catalystTimeFilter').value = '';
      multiState.catalystAreaFilter = [];
      const drop = document.getElementById('catalystAreaFilterDrop');
      if (drop) {
        drop.querySelectorAll('input').forEach(i => i.checked = false);
        drop.querySelectorAll('.multi-select-option').forEach(o => o.classList.remove('selected'));
      }
      document.getElementById('catalystAreaFilterLabel').innerHTML = 'All Areas';
      filterCatalysts();
    }

    function exportTrialsCSV() {
      const h = ['Therapy','Type','Disease Area','Sponsor','Indication','NCT ID','Success Rate','Completion','Est. FDA Decision'];
      const r = trials.map(t => ['"'+(t.investigationalIntervention||'').replace(/"/g,'""')+'"',t.approvalType,t.therapeuticArea,'"'+(t.leadSponsor||'').replace(/"/g,'""')+'"','"'+(t.conditionDisplay||'').replace(/"/g,'""')+'"',t.nctId,t.successRateRange,t.formattedCompletionDate,t.formattedApprovalDate]);
      downloadCSV([h,...r],'fda-trials.csv');
    }

    function exportCatalystsCSV() {
      const h = ['Drug','Brand Name','Company','PDUFA Date','Days Until','Status','Type','Disease Area','Indication','Source URL'];
      const r = catalysts.map(c => ['"'+(c.drug||'').replace(/"/g,'""')+'"',c.brandName||'','"'+(c.company||'').replace(/"/g,'""')+'"',c.pdufaDate||'',c.daysUntilPDUFA!==null?c.daysUntilPDUFA:'',c.status||'Pending',c.submissionType||'',c.therapeuticArea||'','"'+(c.indication||'').replace(/"/g,'""')+'"',c.sourceUrl||'']);
      downloadCSV([h,...r],'fda-catalysts.csv');
    }

    function downloadCSV(data, fn) {
      const csv = data.map(r => r.join(',')).join('\\n');
      const b = new Blob([csv],{type:'text/csv'});
      const u = URL.createObjectURL(b);
      const a = document.createElement('a');
      a.href = u; a.download = fn; a.click();
      URL.revokeObjectURL(u);
    }

    document.querySelectorAll('#trialsTable th[data-sort]').forEach(th => {
      th.addEventListener('click', () => {
        const c = th.dataset.sort;
        if (trialSortCol === c) trialSortDir = trialSortDir === 'asc' ? 'desc' : 'asc';
        else { trialSortCol = c; trialSortDir = 'asc'; }
        document.querySelectorAll('#trialsTable th').forEach(h => h.classList.remove('sorted-asc','sorted-desc'));
        th.classList.add(trialSortDir === 'asc' ? 'sorted-asc' : 'sorted-desc');
        filterTrials();
      });
    });

    document.querySelectorAll('#catalystsTable th[data-sort]').forEach(th => {
      th.addEventListener('click', () => {
        const c = th.dataset.sort;
        if (catalystSortCol === c) catalystSortDir = catalystSortDir === 'asc' ? 'desc' : 'asc';
        else { catalystSortCol = c; catalystSortDir = 'asc'; }
        document.querySelectorAll('#catalystsTable th').forEach(h => h.classList.remove('sorted-asc','sorted-desc'));
        th.classList.add(catalystSortDir === 'asc' ? 'sorted-asc' : 'sorted-desc');
        filterCatalysts();
      });
    });

    document.getElementById('trialSearch').addEventListener('input', filterTrials);
    document.getElementById('catalystSearch').addEventListener('input', filterCatalysts);

    // Charts
    new Chart(document.getElementById('areaChart'), {
      type: 'bar',
      data: { labels: ${JSON.stringify(areaLabels)}, datasets: [{ label: 'Trials', data: ${JSON.stringify(areaCounts)}, backgroundColor: 'rgba(37,99,235,0.7)', borderColor: 'rgba(37,99,235,1)', borderWidth: 1 }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } }
    });

    new Chart(document.getElementById('timelineChart'), {
      type: 'line',
      data: { labels: ${JSON.stringify(timelineLabels)}, datasets: [{ label: 'Completions', data: ${JSON.stringify(timelineData)}, borderColor: 'rgba(37,99,235,1)', backgroundColor: 'rgba(37,99,235,0.1)', fill: true, tension: 0.3 }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } }
    });

    new Chart(document.getElementById('catalystTimelineChart'), {
      type: 'bar',
      data: { labels: ${JSON.stringify(catalystMonthLabels)}, datasets: [{ label: 'PDUFA Dates', data: ${JSON.stringify(catalystMonthCounts)}, backgroundColor: 'rgba(220,38,38,0.7)', borderColor: 'rgba(220,38,38,1)', borderWidth: 1 }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } } }
    });

    new Chart(document.getElementById('catalystTypeChart'), {
      type: 'doughnut',
      data: { labels: ${JSON.stringify(Object.keys(catalystStats.bySubmissionType))}, datasets: [{ data: ${JSON.stringify(Object.values(catalystStats.bySubmissionType))}, backgroundColor: ['#3b82f6','#8b5cf6','#06b6d4','#10b981','#f59e0b'] }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right' } } }
    });

    filterTrials();
    filterCatalysts();
  </script>
</body>
</html>`;
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
  const catalysts = await getPDUFACatalysts({ forceRefresh, verbose });
  const catalystStats = getCatalystStats(catalysts);

  if (verbose) console.log('Generating integrated report...');
  const html = generateHTML(processedTrials, trialStats, catalysts, catalystStats);

  if (!fs.existsSync(REPORTS_DIR)) fs.mkdirSync(REPORTS_DIR, { recursive: true });
  fs.writeFileSync(outputPath, html);

  if (verbose) console.log(`Report saved to: ${outputPath}`);
  return { trials: processedTrials, trialStats, catalysts, catalystStats, outputPath };
}

module.exports = { generateIntegratedReport };
