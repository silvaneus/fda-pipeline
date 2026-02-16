/**
 * Generates interactive HTML report for FDA clinical trials pipeline
 */

const fs = require('fs');
const path = require('path');
const { classifyCondition, getAllTherapeuticAreas } = require('./classify-disease');
const { getSuccessRate, getAllSuccessRates, estimateApprovalDate, getFDATimeline } = require('./success-rates');
const { fetchApprovedDrugs, determineApprovalTypeAsync, getBestInterventionName } = require('./approved-drugs');

const REPORTS_DIR = path.join(__dirname, 'reports');

// Terms to filter out from interventions (non-investigational)
// These must match as whole words to avoid false positives (e.g., "soc" in "Zasocitinib")
const EXCLUDED_INTERVENTION_PATTERNS = [
  /\bplacebo\b/i,
  /\bsham\b/i,
  /\bstandard of care\b/i,
  /\busual care\b/i,
  /\bbest supportive care\b/i,
  /\bactive comparator\b/i,
  /\bcontrol\s*(arm|group)?\b/i,
  /\bno treatment\b/i,
  /\bobservation(al)?\b/i,
  /\bwatchful waiting\b/i,
  /^soc$/i,  // Only match "SOC" as standalone
  /^bsc$/i   // Only match "BSC" as standalone
];

function formatDate(dateStr) {
  if (!dateStr) return 'Not specified';
  try {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return dateStr;
    return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short' });
  } catch {
    return dateStr;
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Filter to get only investigational/unique interventions (no placebo, etc.)
function getInvestigationalInterventions(interventions) {
  if (!interventions || interventions.length === 0) return [];

  const results = [];

  for (const intervention of interventions) {
    // Check if the ENTIRE intervention is just a control/placebo
    const isExcluded = EXCLUDED_INTERVENTION_PATTERNS.some(pattern => pattern.test(intervention));

    if (!isExcluded) {
      results.push(intervention);
    } else {
      // Try to extract the drug name from complex descriptions
      // e.g., "TR987 0.1% gel + Standard of Care" -> "TR987 0.1% gel"
      // e.g., "balcinrenone/dapagliflozin 15 mg/10 mg and matching placebo" -> "balcinrenone/dapagliflozin"

      // Split on common separators and check each part
      const parts = intervention.split(/\s*[\+\&]\s*|\s+and\s+|\s+with\s+|\s+plus\s+/i);
      for (const part of parts) {
        const trimmed = part.trim();
        if (trimmed.length > 3) {
          const partIsExcluded = EXCLUDED_INTERVENTION_PATTERNS.some(pattern => pattern.test(trimmed));
          if (!partIsExcluded && !trimmed.toLowerCase().includes('placebo') && !trimmed.toLowerCase().includes('matching')) {
            // Extract drug name before dosage/formulation details if needed
            const drugMatch = trimmed.match(/^([a-z]+(?:\/[a-z]+)?)/i);
            if (drugMatch) {
              results.push(drugMatch[0]);
              break; // Only take first valid drug from compound name
            }
          }
        }
      }
    }
  }

  return results;
}

// Filter out stale trials (those with past completion dates)
function filterStaleTrials(trials) {
  const now = new Date();
  return trials.filter(trial => {
    if (!trial.primaryCompletionDate) return true; // Keep if no date
    const completionDate = new Date(trial.primaryCompletionDate);
    if (isNaN(completionDate.getTime())) return true; // Keep if invalid date
    return completionDate >= now; // Only keep future completion dates
  });
}

// Filter out non-drug trials (devices, procedures, diagnostics, radiation)
function filterNonDrugTrials(trials) {
  const excludePatterns = [
    /\b(prosthesis|prosthetic|implant|device)\b/i,
    /\b(surgery|surgical|procedure|operation)\b/i,
    /\b(radiation|radiotherapy|brachytherapy)\b/i,
    /\b(diagnostic|imaging|mri|ct scan|pet scan)\b/i,
    /\b(bioavailability|healthy volunteer|pharmacokinetic)\b/i,
    /\b(anesthesia|anaesthesia|sedation)\b/i,
    /\b(bunion|hernia|postoperative)\b/i
  ];

  return trials.filter(trial => {
    const conditionText = (trial.conditions || []).join(' ').toLowerCase();
    const interventionText = (trial.interventions || []).join(' ').toLowerCase();
    const combinedText = conditionText + ' ' + interventionText;

    // Exclude if matches any non-drug pattern
    for (const pattern of excludePatterns) {
      if (pattern.test(combinedText)) {
        return false;
      }
    }
    return true;
  });
}

async function processTrials(trials, approvedDrugs = {}, verbose = false) {
  const results = [];
  let lookupCount = 0;

  for (let i = 0; i < trials.length; i++) {
    const trial = trials[i];
    const therapeuticArea = classifyCondition(trial.conditions);
    const successRate = getSuccessRate(therapeuticArea);

    // Get investigational interventions only
    const investigationalInterventions = getInvestigationalInterventions(trial.interventions);

    // Get best/shortest intervention name for display
    const bestName = getBestInterventionName(investigationalInterventions);

    // Determine if new approval or supplemental indication (with live lookup)
    const approvalTypeInfo = await determineApprovalTypeAsync(investigationalInterventions, approvedDrugs);

    // Estimate FDA approval date
    const approvalDateEstimate = estimateApprovalDate(trial.primaryCompletionDate, therapeuticArea);

    // Progress indicator for live lookups
    if (verbose && (i + 1) % 100 === 0) {
      console.log(`  Processed ${i + 1}/${trials.length} trials...`);
    }

    results.push({
      ...trial,
      therapeuticArea,
      successRate: successRate.rate,
      successRateRange: successRate.range,
      formattedCompletionDate: formatDate(trial.primaryCompletionDate),
      formattedStartDate: formatDate(trial.startDate),
      estimatedApprovalDate: approvalDateEstimate,
      formattedApprovalDate: approvalDateEstimate ? formatDate(approvalDateEstimate.toISOString()) : 'TBD',
      investigationalIntervention: bestName || investigationalInterventions.slice(0, 2).join(', ') || 'Not specified',
      investigationalInterventions, // Keep array for approval check
      conditionDisplay: trial.conditions?.slice(0, 2).join(', ') || 'Not specified',
      approvalType: approvalTypeInfo.type, // 'New Approval' or 'Supplemental'
      approvalTypeDetails: approvalTypeInfo.details
    });
  }

  return results;
}

function generateSummaryStats(processedTrials) {
  const byArea = {};
  const byStatus = {};
  const bySponsor = {};
  const byApprovalType = { 'New Approval': 0, 'Supplemental': 0, 'Unknown': 0 };

  for (const trial of processedTrials) {
    // By therapeutic area
    byArea[trial.therapeuticArea] = (byArea[trial.therapeuticArea] || 0) + 1;

    // By status
    byStatus[trial.overallStatus] = (byStatus[trial.overallStatus] || 0) + 1;

    // By sponsor (top sponsors)
    const sponsor = trial.leadSponsor || 'Unknown';
    bySponsor[sponsor] = (bySponsor[sponsor] || 0) + 1;

    // By approval type
    byApprovalType[trial.approvalType] = (byApprovalType[trial.approvalType] || 0) + 1;
  }

  // Sort sponsors by count
  const topSponsors = Object.entries(bySponsor)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20);

  // Timeline data - group by completion quarter
  const timeline = {};
  for (const trial of processedTrials) {
    if (trial.primaryCompletionDate) {
      try {
        const date = new Date(trial.primaryCompletionDate);
        if (!isNaN(date.getTime())) {
          const quarter = `${date.getFullYear()} Q${Math.ceil((date.getMonth() + 1) / 3)}`;
          timeline[quarter] = (timeline[quarter] || 0) + 1;
        }
      } catch {}
    }
  }

  return {
    total: processedTrials.length,
    byArea,
    byStatus,
    topSponsors,
    timeline,
    byApprovalType
  };
}

function generateHTML(processedTrials, stats) {
  const successRates = getAllSuccessRates();
  const areas = getAllTherapeuticAreas();
  const fdaTimeline = getFDATimeline();

  // Sort timeline chronologically
  const timelineLabels = Object.keys(stats.timeline).sort();
  const timelineData = timelineLabels.map(q => stats.timeline[q]);

  // Sort areas by count for chart
  const sortedAreas = Object.entries(stats.byArea)
    .sort((a, b) => b[1] - a[1]);
  const areaLabels = sortedAreas.map(([area]) => area);
  const areaCounts = sortedAreas.map(([, count]) => count);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>FDA Phase 3 Clinical Trials Pipeline Report</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
      margin: 0;
      padding: 20px;
      background: #f5f7fa;
      color: #333;
    }
    .container { max-width: 1800px; margin: 0 auto; }
    h1 { color: #1a365d; margin-bottom: 5px; }
    .subtitle { color: #666; margin-bottom: 30px; }
    .generated-date { color: #888; font-size: 0.9em; margin-bottom: 20px; }

    /* Summary Cards */
    .summary-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 20px;
      margin-bottom: 30px;
    }
    .summary-card {
      background: white;
      padding: 20px;
      border-radius: 10px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    .summary-card h3 { margin: 0 0 10px 0; color: #666; font-size: 0.9em; text-transform: uppercase; }
    .summary-card .value { font-size: 2em; font-weight: bold; color: #2563eb; }
    .summary-card .subtext { color: #888; font-size: 0.85em; margin-top: 5px; }
    .summary-card.new-approval .value { color: #7c3aed; }
    .summary-card.supplemental .value { color: #0891b2; }

    /* Charts */
    .charts-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(500px, 1fr));
      gap: 20px;
      margin-bottom: 30px;
    }
    .chart-container {
      background: white;
      padding: 20px;
      border-radius: 10px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    .chart-container h3 { margin: 0 0 15px 0; color: #333; }
    .chart-wrapper { position: relative; height: 300px; }

    /* Filters */
    .filters {
      background: white;
      padding: 20px;
      border-radius: 10px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
      margin-bottom: 20px;
      display: flex;
      flex-wrap: wrap;
      gap: 15px;
      align-items: center;
    }
    .filter-group { display: flex; flex-direction: column; gap: 5px; }
    .filter-group label { font-size: 0.85em; color: #666; font-weight: 500; }
    .filter-group input, .filter-group select {
      padding: 8px 12px;
      border: 1px solid #ddd;
      border-radius: 5px;
      font-size: 0.95em;
    }
    .filter-group input:focus, .filter-group select:focus {
      outline: none;
      border-color: #2563eb;
    }
    #searchInput { min-width: 250px; }
    .reset-btn {
      background: #e5e7eb;
      border: none;
      padding: 8px 16px;
      border-radius: 5px;
      cursor: pointer;
      font-size: 0.95em;
      margin-top: 20px;
    }
    .reset-btn:hover { background: #d1d5db; }
    .active-filter-indicator {
      background: #dbeafe;
      color: #1e40af;
      padding: 6px 12px;
      border-radius: 5px;
      font-size: 0.9em;
      display: none;
      align-items: center;
      gap: 8px;
      margin-top: 20px;
    }
    .active-filter-indicator.visible { display: flex; }
    .clear-sponsor-filter {
      background: none;
      border: none;
      cursor: pointer;
      font-size: 1.1em;
      color: #1e40af;
    }

    /* Table */
    .table-container {
      background: white;
      border-radius: 10px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
      overflow: hidden;
    }
    .table-header {
      padding: 15px 20px;
      border-bottom: 1px solid #eee;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .table-header h3 { margin: 0; }
    .result-count { color: #666; font-size: 0.9em; }
    .table-wrapper { overflow-x: auto; }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.9em;
    }
    th, td { padding: 12px 15px; text-align: left; border-bottom: 1px solid #eee; }
    th {
      background: #f8fafc;
      font-weight: 600;
      color: #374151;
      cursor: pointer;
      user-select: none;
      white-space: nowrap;
    }
    th:hover { background: #f1f5f9; }
    th.sorted-asc::after { content: ' ▲'; color: #2563eb; }
    th.sorted-desc::after { content: ' ▼'; color: #2563eb; }
    tr:hover { background: #f8fafc; }
    .nct-link { color: #2563eb; text-decoration: none; }
    .nct-link:hover { text-decoration: underline; }
    .success-rate {
      display: inline-block;
      padding: 3px 8px;
      border-radius: 4px;
      font-weight: 500;
      font-size: 0.85em;
    }
    .success-high { background: #dcfce7; color: #166534; }
    .success-medium { background: #fef3c7; color: #92400e; }
    .success-low { background: #fee2e2; color: #991b1b; }
    .therapeutic-area {
      display: inline-block;
      padding: 3px 8px;
      border-radius: 4px;
      font-size: 0.85em;
      background: #e0e7ff;
      color: #3730a3;
    }
    .truncate {
      max-width: 220px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .intervention-cell {
      max-width: 280px;
      font-weight: 500;
      color: #1e40af;
    }
    .date-cell {
      white-space: nowrap;
      font-size: 0.85em;
    }
    .approval-estimate {
      color: #059669;
      font-style: italic;
    }
    .approval-type {
      display: inline-block;
      padding: 3px 8px;
      border-radius: 4px;
      font-size: 0.8em;
      font-weight: 500;
    }
    .approval-new {
      background: #f3e8ff;
      color: #7c3aed;
    }
    .approval-supplemental {
      background: #cffafe;
      color: #0891b2;
    }
    .approval-unknown {
      background: #f1f5f9;
      color: #64748b;
    }

    /* Success Rates Reference */
    .success-rates-ref {
      background: white;
      padding: 20px;
      border-radius: 10px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
      margin-top: 30px;
    }
    .success-rates-ref h3 { margin: 0 0 15px 0; }
    .rates-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 10px;
    }
    .rate-item {
      padding: 10px;
      background: #f8fafc;
      border-radius: 5px;
      display: flex;
      justify-content: space-between;
    }

    /* Export */
    .export-btn {
      background: #2563eb;
      color: white;
      border: none;
      padding: 8px 16px;
      border-radius: 5px;
      cursor: pointer;
      font-size: 0.95em;
    }
    .export-btn:hover { background: #1d4ed8; }

    /* Multi-select dropdown */
    .multi-select {
      position: relative;
      min-width: 150px;
    }
    .multi-select-btn {
      width: 100%;
      padding: 8px 12px;
      border: 1px solid #ddd;
      border-radius: 5px;
      background: white;
      cursor: pointer;
      text-align: left;
      font-size: 0.95em;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .multi-select-btn:hover { border-color: #2563eb; }
    .multi-select-btn::after {
      content: '▼';
      font-size: 0.7em;
      margin-left: 8px;
      color: #666;
    }
    .multi-select-btn.active { border-color: #2563eb; }
    .multi-select-btn.active::after { content: '▲'; }
    .multi-select-dropdown {
      display: none;
      position: absolute;
      top: 100%;
      left: 0;
      right: 0;
      background: white;
      border: 1px solid #ddd;
      border-radius: 5px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      z-index: 100;
      max-height: 300px;
      overflow-y: auto;
      margin-top: 2px;
    }
    .multi-select-dropdown.show { display: block; }
    .multi-select-option {
      padding: 8px 12px;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .multi-select-option:hover { background: #f0f9ff; }
    .multi-select-option input {
      margin: 0;
      cursor: pointer;
    }
    .multi-select-option.selected { background: #eff6ff; }
    .multi-select-count {
      background: #2563eb;
      color: white;
      font-size: 0.75em;
      padding: 2px 6px;
      border-radius: 10px;
      margin-left: 4px;
    }
    .multi-select-divider {
      border-top: 1px solid #eee;
      margin: 4px 0;
    }
    .multi-select-special {
      font-style: italic;
      color: #666;
    }

    /* Top Sponsors */
    .sponsors-list {
      background: white;
      padding: 20px;
      border-radius: 10px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
      margin-bottom: 30px;
    }
    .sponsors-list h3 { margin: 0 0 15px 0; }
    .sponsor-items { display: flex; flex-wrap: wrap; gap: 10px; }
    .sponsor-item {
      background: #f1f5f9;
      padding: 8px 12px;
      border-radius: 5px;
      font-size: 0.9em;
      cursor: pointer;
      transition: all 0.2s;
    }
    .sponsor-item:hover {
      background: #dbeafe;
    }
    .sponsor-item .sponsor-name {
      color: #2563eb;
      font-weight: 500;
      text-decoration: none;
    }
    .sponsor-item .sponsor-name:hover {
      text-decoration: underline;
    }
    .sponsor-count { color: #64748b; margin-left: 5px; }

    /* FDA Timeline Info */
    .fda-info {
      background: #f0fdf4;
      border: 1px solid #86efac;
      padding: 15px;
      border-radius: 8px;
      margin-top: 15px;
      font-size: 0.85em;
      color: #166534;
    }
    .fda-info strong { color: #14532d; }

    /* Approval Type Legend */
    .approval-legend {
      background: #faf5ff;
      border: 1px solid #d8b4fe;
      padding: 15px;
      border-radius: 8px;
      margin-top: 15px;
      font-size: 0.85em;
      color: #6b21a8;
    }

    @media (max-width: 768px) {
      .charts-grid { grid-template-columns: 1fr; }
      .filters { flex-direction: column; }
      .filter-group { width: 100%; }
      #searchInput { min-width: auto; width: 100%; }
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>FDA Phase 3 Clinical Trials Pipeline</h1>
    <p class="subtitle">Industry-Sponsored Interventional Trials Currently Recruiting in the United States</p>
    <p class="generated-date">Generated: ${new Date().toLocaleString('en-US', { dateStyle: 'full', timeStyle: 'short' })}</p>

    <!-- Summary Cards -->
    <div class="summary-grid">
      <div class="summary-card">
        <h3>Total Trials</h3>
        <div class="value">${stats.total.toLocaleString()}</div>
        <div class="subtext">Phase 3 & Phase 2/3</div>
      </div>
      <div class="summary-card new-approval">
        <h3>New Approvals</h3>
        <div class="value">${(stats.byApprovalType['New Approval'] || 0).toLocaleString()}</div>
        <div class="subtext">Novel drugs/biologics</div>
      </div>
      <div class="summary-card supplemental">
        <h3>Supplemental</h3>
        <div class="value">${(stats.byApprovalType['Supplemental'] || 0).toLocaleString()}</div>
        <div class="subtext">New indications</div>
      </div>
      <div class="summary-card">
        <h3>Therapeutic Areas</h3>
        <div class="value">${Object.keys(stats.byArea).length}</div>
        <div class="subtext">Categories covered</div>
      </div>
      <div class="summary-card">
        <h3>Top Area</h3>
        <div class="value" style="font-size:1.3em">${sortedAreas[0]?.[0] || 'N/A'}</div>
        <div class="subtext">${sortedAreas[0]?.[1] || 0} trials</div>
      </div>
      <div class="summary-card">
        <h3>Unique Sponsors</h3>
        <div class="value">${Object.keys(stats.topSponsors.reduce((acc, [s]) => ({ ...acc, [s]: 1 }), {})).length}+</div>
        <div class="subtext">Industry sponsors</div>
      </div>
    </div>

    <!-- Charts -->
    <div class="charts-grid">
      <div class="chart-container">
        <h3>Trials by Therapeutic Area</h3>
        <div class="chart-wrapper">
          <canvas id="areaChart"></canvas>
        </div>
      </div>
      <div class="chart-container">
        <h3>Expected Completion Timeline</h3>
        <div class="chart-wrapper">
          <canvas id="timelineChart"></canvas>
        </div>
      </div>
    </div>

    <!-- Top Sponsors -->
    <div class="sponsors-list">
      <h3>Top Sponsors by Number of Trials <span style="font-weight:normal;color:#666;font-size:0.8em;">(click to filter)</span></h3>
      <div class="sponsor-items">
        ${stats.topSponsors.map(([sponsor, count]) =>
          `<div class="sponsor-item" onclick="filterBySponsor('${escapeHtml(sponsor.replace(/'/g, "\\'"))}')">
            <span class="sponsor-name">${escapeHtml(sponsor)}</span><span class="sponsor-count">(${count})</span>
          </div>`
        ).join('')}
      </div>
    </div>

    <!-- Filters -->
    <div class="filters">
      <div class="filter-group">
        <label>Search</label>
        <input type="text" id="searchInput" placeholder="Search by intervention, sponsor, condition, NCT ID...">
      </div>
      <div class="filter-group">
        <label>Therapeutic Area</label>
        <div class="multi-select" id="areaFilterContainer">
          <button class="multi-select-btn" onclick="toggleMultiSelect('areaFilter')">
            <span id="areaFilterLabel">All Areas</span>
          </button>
          <div class="multi-select-dropdown" id="areaFilterDropdown">
            ${areas.map(area => `
              <label class="multi-select-option" data-value="${area}">
                <input type="checkbox" value="${area}" onchange="updateMultiSelect('areaFilter')">
                ${area}
              </label>
            `).join('')}
          </div>
        </div>
      </div>
      <div class="filter-group">
        <label>Approval Type</label>
        <div class="multi-select" id="approvalTypeFilterContainer">
          <button class="multi-select-btn" onclick="toggleMultiSelect('approvalTypeFilter')">
            <span id="approvalTypeFilterLabel">All Types</span>
          </button>
          <div class="multi-select-dropdown" id="approvalTypeFilterDropdown">
            <label class="multi-select-option" data-value="New Approval">
              <input type="checkbox" value="New Approval" onchange="updateMultiSelect('approvalTypeFilter')">
              New Approval
            </label>
            <label class="multi-select-option" data-value="Supplemental">
              <input type="checkbox" value="Supplemental" onchange="updateMultiSelect('approvalTypeFilter')">
              Supplemental (New Indication)
            </label>
          </div>
        </div>
      </div>
      <div class="filter-group">
        <label>Min Success Rate</label>
        <select id="successFilter">
          <option value="">Any</option>
          <option value="0.6">≥60%</option>
          <option value="0.5">≥50%</option>
          <option value="0.4">≥40%</option>
        </select>
      </div>
      <div class="filter-group">
        <label>Completion Year</label>
        <div class="multi-select" id="yearFilterContainer">
          <button class="multi-select-btn" onclick="toggleMultiSelect('yearFilter')">
            <span id="yearFilterLabel">All Years</span>
          </button>
          <div class="multi-select-dropdown" id="yearFilterDropdown">
            ${[...new Set(processedTrials
              .filter(t => t.primaryCompletionDate)
              .map(t => new Date(t.primaryCompletionDate).getFullYear())
              .filter(y => !isNaN(y))
            )].sort().map(y => `
              <label class="multi-select-option" data-value="${y}">
                <input type="checkbox" value="${y}" onchange="updateMultiSelect('yearFilter')">
                ${y}
              </label>
            `).join('')}
          </div>
        </div>
      </div>
      <div class="filter-group">
        <label>FDA Decision Year</label>
        <div class="multi-select" id="fdaYearFilterContainer">
          <button class="multi-select-btn" onclick="toggleMultiSelect('fdaYearFilter')">
            <span id="fdaYearFilterLabel">All Years</span>
          </button>
          <div class="multi-select-dropdown" id="fdaYearFilterDropdown">
            ${(() => {
              const years = [...new Set(processedTrials
                .filter(t => t.estimatedApprovalDate)
                .map(t => new Date(t.estimatedApprovalDate).getFullYear())
                .filter(y => !isNaN(y))
              )].sort();
              let options = years.map(y => `
                <label class="multi-select-option" data-value="${y}">
                  <input type="checkbox" value="${y}" onchange="updateMultiSelect('fdaYearFilter')">
                  ${y}
                </label>
              `).join('');
              // Add special "after year" options
              options += '<div class="multi-select-divider"></div>';
              years.forEach(y => {
                options += `
                  <label class="multi-select-option multi-select-special" data-value=">${y}">
                    <input type="checkbox" value=">${y}" onchange="updateMultiSelect('fdaYearFilter')">
                    After ${y}
                  </label>
                `;
              });
              return options;
            })()}
          </div>
        </div>
      </div>
      <button class="reset-btn" onclick="resetFilters()">Reset Filters</button>
      <button class="export-btn" onclick="exportCSV()">Export CSV</button>
      <div class="active-filter-indicator" id="sponsorFilterIndicator">
        <span>Sponsor: <strong id="activeSponsorName"></strong></span>
        <button class="clear-sponsor-filter" onclick="clearSponsorFilter()">×</button>
      </div>
    </div>

    <!-- Table -->
    <div class="table-container">
      <div class="table-header">
        <h3>Clinical Trials</h3>
        <span class="result-count"><span id="visibleCount">${processedTrials.length}</span> of ${processedTrials.length} trials</span>
      </div>
      <div class="table-wrapper">
        <table id="trialsTable">
          <thead>
            <tr>
              <th data-sort="investigationalIntervention">Investigational Therapy</th>
              <th data-sort="approvalType">Type</th>
              <th data-sort="therapeuticArea">Disease Area</th>
              <th data-sort="leadSponsor">Sponsor</th>
              <th data-sort="conditionDisplay">Indication</th>
              <th data-sort="nctId">NCT ID</th>
              <th data-sort="successRate">P(Success)</th>
              <th data-sort="primaryCompletionDate">Trial Completion</th>
              <th data-sort="estimatedApprovalDate">Est. FDA Decision</th>
            </tr>
          </thead>
          <tbody id="trialsBody">
          </tbody>
        </table>
      </div>
    </div>

    <!-- Success Rates Reference -->
    <div class="success-rates-ref">
      <h3>Phase 3 Success Rates by Therapeutic Area (Historical Reference)</h3>
      <div class="rates-grid">
        ${Object.entries(successRates).map(([area, data]) =>
          `<div class="rate-item">
            <span>${area}</span>
            <span class="success-rate ${data.rate >= 0.6 ? 'success-high' : data.rate >= 0.5 ? 'success-medium' : 'success-low'}">${data.range}</span>
          </div>`
        ).join('')}
      </div>
      <div class="approval-legend">
        <strong>Approval Type Classification:</strong>
        <ul style="margin: 5px 0 0 20px; padding: 0;">
          <li><strong>New Approval (NDA/BLA):</strong> Novel drug or biologic not yet approved by FDA</li>
          <li><strong>Supplemental (sNDA/sBLA):</strong> Already-approved drug seeking new indication</li>
        </ul>
        <em style="font-size:0.9em;">Classification based on FDA Drugs@FDA database. Some novel formulations of approved drugs may be classified as supplemental.</em>
      </div>
      <div class="fda-info">
        <strong>FDA Approval Timeline Estimates:</strong> Est. FDA Decision dates are calculated from trial completion based on therapeutic area urgency:
        <ul style="margin: 5px 0 0 20px; padding: 0;">
          <li><strong>High urgency</strong> (Oncology, Rare/Genetic Disease): ~9 months (Breakthrough/Fast Track + Accelerated Approval)</li>
          <li><strong>Elevated</strong> (Hematology, Infectious Disease, Neurology, Vaccines): ~12 months (Priority Review pathway)</li>
          <li><strong>Standard</strong> (Cardiology, Pulmonology, Endocrinology, etc.): ~15 months</li>
          <li><strong>Lower urgency</strong> (Dermatology, Urology, Orthopedics, ENT): ~18 months</li>
        </ul>
        <em style="font-size:0.9em;">Based on ~3 months application prep + 2-10 months FDA review depending on expedited designation. Actual timelines vary.</em>
      </div>
      <p style="margin-top:15px;color:#666;font-size:0.85em;">
        <em>Success rate source: BIO Industry Analysis, Nature Communications. These represent historical Phase 3 → Approval success rates.</em>
      </p>
    </div>
  </div>

  <script>
    // Trial data
    const trials = ${JSON.stringify(processedTrials)};

    // Current sort state
    let sortColumn = 'therapeuticArea';
    let sortDirection = 'asc';

    // Active sponsor filter
    let activeSponsorFilter = '';

    // Render table
    function renderTable(data) {
      const tbody = document.getElementById('trialsBody');
      tbody.innerHTML = data.map(trial => \`
        <tr>
          <td class="intervention-cell truncate" title="\${escapeAttr(trial.investigationalIntervention)}">\${escapeHtml(trial.investigationalIntervention)}</td>
          <td><span class="approval-type \${trial.approvalType === 'New Approval' ? 'approval-new' : trial.approvalType === 'Supplemental' ? 'approval-supplemental' : 'approval-unknown'}">\${trial.approvalType === 'New Approval' ? 'New' : trial.approvalType === 'Supplemental' ? 'Suppl' : '?'}</span></td>
          <td><span class="therapeutic-area">\${trial.therapeuticArea}</span></td>
          <td class="truncate" title="\${escapeAttr(trial.leadSponsor)}">\${escapeHtml(trial.leadSponsor)}</td>
          <td class="truncate" title="\${escapeAttr(trial.conditionDisplay)}">\${escapeHtml(trial.conditionDisplay)}</td>
          <td><a class="nct-link" href="https://clinicaltrials.gov/study/\${trial.nctId}" target="_blank">\${trial.nctId}</a></td>
          <td><span class="success-rate \${trial.successRate >= 0.6 ? 'success-high' : trial.successRate >= 0.5 ? 'success-medium' : 'success-low'}">\${trial.successRateRange}</span></td>
          <td class="date-cell">\${trial.formattedCompletionDate}</td>
          <td class="date-cell approval-estimate">\${trial.formattedApprovalDate}</td>
        </tr>
      \`).join('');
      document.getElementById('visibleCount').textContent = data.length;
    }

    function escapeHtml(str) {
      if (!str) return '';
      return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    function escapeAttr(str) {
      if (!str) return '';
      return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
    }

    // Filter by sponsor (from clicking on sponsor badges)
    function filterBySponsor(sponsor) {
      activeSponsorFilter = sponsor;
      document.getElementById('sponsorFilterIndicator').classList.add('visible');
      document.getElementById('activeSponsorName').textContent = sponsor;
      filterAndSort();
    }

    function clearSponsorFilter() {
      activeSponsorFilter = '';
      document.getElementById('sponsorFilterIndicator').classList.remove('visible');
      filterAndSort();
    }

    // Multi-select state
    const multiSelectState = {
      areaFilter: [],
      approvalTypeFilter: [],
      yearFilter: [],
      fdaYearFilter: []
    };

    // Toggle multi-select dropdown
    function toggleMultiSelect(filterId) {
      const dropdown = document.getElementById(filterId + 'Dropdown');
      const btn = dropdown.previousElementSibling;
      const isOpen = dropdown.classList.contains('show');

      // Close all dropdowns first
      document.querySelectorAll('.multi-select-dropdown').forEach(d => d.classList.remove('show'));
      document.querySelectorAll('.multi-select-btn').forEach(b => b.classList.remove('active'));

      if (!isOpen) {
        dropdown.classList.add('show');
        btn.classList.add('active');
      }
    }

    // Update multi-select state and label
    function updateMultiSelect(filterId) {
      const dropdown = document.getElementById(filterId + 'Dropdown');
      const checkboxes = dropdown.querySelectorAll('input[type="checkbox"]:checked');
      const values = Array.from(checkboxes).map(cb => cb.value);

      multiSelectState[filterId] = values;

      // Update label
      const label = document.getElementById(filterId + 'Label');
      if (values.length === 0) {
        const defaults = { areaFilter: 'All Areas', approvalTypeFilter: 'All Types', yearFilter: 'All Years', fdaYearFilter: 'All Years' };
        label.innerHTML = defaults[filterId];
      } else if (values.length === 1) {
        label.innerHTML = values[0].replace('>', 'After ');
      } else {
        label.innerHTML = values.length + ' selected<span class="multi-select-count">' + values.length + '</span>';
      }

      // Update option highlighting
      dropdown.querySelectorAll('.multi-select-option').forEach(opt => {
        opt.classList.toggle('selected', opt.querySelector('input').checked);
      });

      filterAndSort();
    }

    // Close dropdowns when clicking outside
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.multi-select')) {
        document.querySelectorAll('.multi-select-dropdown').forEach(d => d.classList.remove('show'));
        document.querySelectorAll('.multi-select-btn').forEach(b => b.classList.remove('active'));
      }
    });

    // Get selected values for a multi-select filter
    function getMultiSelectValues(filterId) {
      return multiSelectState[filterId] || [];
    }

    // Filter and sort
    function filterAndSort() {
      const search = document.getElementById('searchInput').value.toLowerCase();
      const areas = getMultiSelectValues('areaFilter');
      const approvalTypes = getMultiSelectValues('approvalTypeFilter');
      const minSuccess = parseFloat(document.getElementById('successFilter').value) || 0;
      const years = getMultiSelectValues('yearFilter');
      const fdaYears = getMultiSelectValues('fdaYearFilter');

      let filtered = trials.filter(t => {
        // Sponsor filter from clicking badges
        if (activeSponsorFilter && t.leadSponsor !== activeSponsorFilter) return false;

        if (search && !(\`\${t.nctId} \${t.title} \${t.leadSponsor} \${t.conditionDisplay} \${t.investigationalIntervention}\`.toLowerCase().includes(search))) {
          return false;
        }

        // Multi-select: if any selected, must match one
        if (areas.length > 0 && !areas.includes(t.therapeuticArea)) return false;
        if (approvalTypes.length > 0 && !approvalTypes.includes(t.approvalType)) return false;
        if (minSuccess && t.successRate < minSuccess) return false;

        // Completion year filter
        if (years.length > 0) {
          if (!t.primaryCompletionDate) return false;
          const trialYear = new Date(t.primaryCompletionDate).getFullYear().toString();
          if (!years.includes(trialYear)) return false;
        }

        // FDA year filter with "after" support
        if (fdaYears.length > 0 && t.estimatedApprovalDate) {
          const estYear = new Date(t.estimatedApprovalDate).getFullYear();
          let matches = false;
          for (const fy of fdaYears) {
            if (fy.startsWith('>')) {
              const afterYear = parseInt(fy.substring(1));
              if (estYear > afterYear) matches = true;
            } else {
              if (estYear === parseInt(fy)) matches = true;
            }
          }
          if (!matches) return false;
        }
        return true;
      });

      // Sort
      filtered.sort((a, b) => {
        let aVal = a[sortColumn] || '';
        let bVal = b[sortColumn] || '';

        // Handle date sorting
        if (sortColumn === 'primaryCompletionDate' || sortColumn === 'estimatedApprovalDate') {
          aVal = aVal ? new Date(aVal).getTime() : 0;
          bVal = bVal ? new Date(bVal).getTime() : 0;
        } else if (typeof aVal === 'string') {
          aVal = aVal.toLowerCase();
          bVal = bVal.toLowerCase();
        }

        if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
        if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
        return 0;
      });

      renderTable(filtered);
    }

    // Sort handler
    document.querySelectorAll('th[data-sort]').forEach(th => {
      th.addEventListener('click', () => {
        const col = th.dataset.sort;
        if (sortColumn === col) {
          sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
        } else {
          sortColumn = col;
          sortDirection = 'asc';
        }
        document.querySelectorAll('th').forEach(h => h.classList.remove('sorted-asc', 'sorted-desc'));
        th.classList.add(sortDirection === 'asc' ? 'sorted-asc' : 'sorted-desc');
        filterAndSort();
      });
    });

    // Filter handlers
    document.getElementById('searchInput').addEventListener('input', filterAndSort);
    document.getElementById('successFilter').addEventListener('change', filterAndSort);

    function resetFilters() {
      document.getElementById('searchInput').value = '';
      document.getElementById('successFilter').value = '';

      // Reset multi-selects
      ['areaFilter', 'approvalTypeFilter', 'yearFilter', 'fdaYearFilter'].forEach(filterId => {
        multiSelectState[filterId] = [];
        const dropdown = document.getElementById(filterId + 'Dropdown');
        dropdown.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = false);
        dropdown.querySelectorAll('.multi-select-option').forEach(opt => opt.classList.remove('selected'));
        const defaults = { areaFilter: 'All Areas', approvalTypeFilter: 'All Types', yearFilter: 'All Years', fdaYearFilter: 'All Years' };
        document.getElementById(filterId + 'Label').innerHTML = defaults[filterId];
      });

      clearSponsorFilter();
    }

    // Export CSV
    function exportCSV() {
      const headers = ['Investigational Therapy', 'Approval Type', 'Disease Area', 'Sponsor', 'Indication', 'NCT ID', 'Success Rate', 'Trial Completion', 'Est. FDA Decision'];
      const rows = trials.map(t => [
        '"' + (t.investigationalIntervention || '').replace(/"/g, '""') + '"',
        t.approvalType,
        t.therapeuticArea,
        '"' + (t.leadSponsor || '').replace(/"/g, '""') + '"',
        '"' + (t.conditionDisplay || '').replace(/"/g, '""') + '"',
        t.nctId,
        t.successRateRange,
        t.formattedCompletionDate,
        t.formattedApprovalDate
      ]);
      const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\\n');
      const blob = new Blob([csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'fda-trials-pipeline.csv';
      a.click();
      URL.revokeObjectURL(url);
    }

    // Charts
    const areaChart = new Chart(document.getElementById('areaChart'), {
      type: 'bar',
      data: {
        labels: ${JSON.stringify(areaLabels)},
        datasets: [{
          label: 'Number of Trials',
          data: ${JSON.stringify(areaCounts)},
          backgroundColor: 'rgba(37, 99, 235, 0.7)',
          borderColor: 'rgba(37, 99, 235, 1)',
          borderWidth: 1
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          y: { beginAtZero: true, ticks: { stepSize: 1 } }
        }
      }
    });

    const timelineChart = new Chart(document.getElementById('timelineChart'), {
      type: 'line',
      data: {
        labels: ${JSON.stringify(timelineLabels)},
        datasets: [{
          label: 'Expected Completions',
          data: ${JSON.stringify(timelineData)},
          borderColor: 'rgba(37, 99, 235, 1)',
          backgroundColor: 'rgba(37, 99, 235, 0.1)',
          fill: true,
          tension: 0.3
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          y: { beginAtZero: true, ticks: { stepSize: 1 } }
        }
      }
    });

    // Initial render
    filterAndSort();
  </script>
</body>
</html>`;
}

async function generateReport(trials, options = {}) {
  const { outputPath = path.join(REPORTS_DIR, 'fda-pipeline-report.html'), verbose = true } = options;

  // Filter out stale trials (past completion dates)
  const originalCount = trials.length;
  let activeTrials = filterStaleTrials(trials);
  if (verbose && originalCount !== activeTrials.length) {
    console.log(`Filtered out ${originalCount - activeTrials.length} stale trials (past completion dates)`);
  }

  // Filter out non-drug trials (devices, procedures, etc.)
  const preFilterCount = activeTrials.length;
  activeTrials = filterNonDrugTrials(activeTrials);
  if (verbose && preFilterCount !== activeTrials.length) {
    console.log(`Filtered out ${preFilterCount - activeTrials.length} non-drug trials (devices, procedures, etc.)`);
  }

  // Fetch approved drugs database
  if (verbose) console.log('Fetching FDA approved drugs database...');
  const approvedDrugs = await fetchApprovedDrugs({ verbose });

  if (verbose) console.log('Processing trials (with live FDA lookup for unknown drugs)...');
  const processedTrials = await processTrials(activeTrials, approvedDrugs, verbose);

  if (verbose) console.log('Generating statistics...');
  const stats = generateSummaryStats(processedTrials);

  if (verbose) {
    console.log('\nSummary by Therapeutic Area:');
    Object.entries(stats.byArea)
      .sort((a, b) => b[1] - a[1])
      .forEach(([area, count]) => {
        console.log(`  ${area}: ${count} trials`);
      });

    console.log('\nApproval Type Breakdown:');
    console.log(`  New Approvals: ${stats.byApprovalType['New Approval'] || 0}`);
    console.log(`  Supplemental (New Indications): ${stats.byApprovalType['Supplemental'] || 0}`);
  }

  if (verbose) console.log('\nGenerating HTML report...');
  const html = generateHTML(processedTrials, stats);

  // Ensure reports directory exists
  if (!fs.existsSync(REPORTS_DIR)) {
    fs.mkdirSync(REPORTS_DIR, { recursive: true });
  }

  fs.writeFileSync(outputPath, html);
  if (verbose) console.log(`Report saved to: ${outputPath}`);

  return { processedTrials, stats, outputPath };
}

module.exports = { generateReport, processTrials, generateSummaryStats };
