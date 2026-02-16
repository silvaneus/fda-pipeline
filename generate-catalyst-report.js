/**
 * Generates interactive HTML report for FDA near-term catalysts
 */

const fs = require('fs');
const path = require('path');
const { aggregateCatalysts, calculateDaysUntil } = require('./aggregate-catalysts');

const REPORTS_DIR = path.join(__dirname, 'reports');

function formatDate(dateStr) {
  if (!dateStr) return 'TBD';
  try {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return dateStr;
    return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
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

function getStatusClass(status) {
  switch ((status || '').toLowerCase()) {
    case 'approved': return 'status-approved';
    case 'crl': return 'status-crl';
    case 'rejected': return 'status-rejected';
    case 'withdrawn': return 'status-withdrawn';
    default: return 'status-pending';
  }
}

function getUrgencyClass(daysUntil) {
  if (daysUntil === null) return 'urgency-unknown';
  if (daysUntil < 0) return 'urgency-past';
  if (daysUntil <= 30) return 'urgency-imminent';
  if (daysUntil <= 90) return 'urgency-soon';
  return 'urgency-future';
}

function generateSummaryStats(catalysts) {
  const stats = {
    total: catalysts.length,
    withDate: catalysts.filter(c => c.pdufaDate).length,
    byStatus: {},
    bySubmissionType: {},
    byTherapeuticArea: {},
    byMonth: {},
    imminent: 0,  // Within 30 days
    soon: 0       // Within 90 days
  };

  const today = new Date();

  for (const catalyst of catalysts) {
    // By status
    const status = catalyst.status || 'Pending';
    stats.byStatus[status] = (stats.byStatus[status] || 0) + 1;

    // By submission type
    const subType = catalyst.submissionType || 'Unknown';
    stats.bySubmissionType[subType] = (stats.bySubmissionType[subType] || 0) + 1;

    // By therapeutic area
    const area = catalyst.therapeuticArea || 'Unknown';
    stats.byTherapeuticArea[area] = (stats.byTherapeuticArea[area] || 0) + 1;

    // By month (for timeline)
    if (catalyst.pdufaDate) {
      const date = new Date(catalyst.pdufaDate);
      if (!isNaN(date.getTime())) {
        const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        stats.byMonth[monthKey] = (stats.byMonth[monthKey] || 0) + 1;

        // Calculate days until
        const daysUntil = Math.ceil((date - today) / (1000 * 60 * 60 * 24));
        if (daysUntil >= 0 && daysUntil <= 30) stats.imminent++;
        else if (daysUntil > 30 && daysUntil <= 90) stats.soon++;
      }
    }
  }

  return stats;
}

function generateHTML(catalysts, stats) {
  // Sort months chronologically for timeline
  const sortedMonths = Object.keys(stats.byMonth).sort();
  const monthLabels = sortedMonths.map(m => {
    const [year, month] = m.split('-');
    const date = new Date(year, parseInt(month) - 1);
    return date.toLocaleDateString('en-US', { year: '2-digit', month: 'short' });
  });
  const monthCounts = sortedMonths.map(m => stats.byMonth[m]);

  // Sort therapeutic areas by count
  const sortedAreas = Object.entries(stats.byTherapeuticArea)
    .sort((a, b) => b[1] - a[1]);
  const areaLabels = sortedAreas.map(([area]) => area);
  const areaCounts = sortedAreas.map(([, count]) => count);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>FDA Near-Term Catalysts Report</title>
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
    .container { max-width: 1600px; margin: 0 auto; }
    h1 { color: #1a365d; margin-bottom: 5px; }
    .subtitle { color: #666; margin-bottom: 30px; }
    .generated-date { color: #888; font-size: 0.9em; margin-bottom: 20px; }

    /* Summary Cards */
    .summary-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
      gap: 15px;
      margin-bottom: 30px;
    }
    .summary-card {
      background: white;
      padding: 20px;
      border-radius: 10px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    .summary-card h3 { margin: 0 0 10px 0; color: #666; font-size: 0.85em; text-transform: uppercase; }
    .summary-card .value { font-size: 1.8em; font-weight: bold; color: #2563eb; }
    .summary-card .subtext { color: #888; font-size: 0.85em; margin-top: 5px; }
    .summary-card.imminent .value { color: #dc2626; }
    .summary-card.soon .value { color: #f59e0b; }

    /* Charts */
    .charts-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(450px, 1fr));
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
    .chart-wrapper { position: relative; height: 250px; }

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

    /* Status badges */
    .status-badge {
      display: inline-block;
      padding: 3px 8px;
      border-radius: 4px;
      font-size: 0.85em;
      font-weight: 500;
    }
    .status-pending { background: #fef3c7; color: #92400e; }
    .status-approved { background: #dcfce7; color: #166534; }
    .status-crl { background: #fee2e2; color: #991b1b; }
    .status-rejected { background: #fee2e2; color: #991b1b; }
    .status-withdrawn { background: #e5e7eb; color: #374151; }

    /* Urgency indicators */
    .days-until {
      display: inline-block;
      padding: 3px 8px;
      border-radius: 4px;
      font-size: 0.85em;
      font-weight: 500;
    }
    .urgency-imminent { background: #fee2e2; color: #991b1b; }
    .urgency-soon { background: #fef3c7; color: #92400e; }
    .urgency-future { background: #dcfce7; color: #166534; }
    .urgency-past { background: #e5e7eb; color: #374151; }
    .urgency-unknown { background: #f3f4f6; color: #6b7280; }

    /* Submission type */
    .submission-type {
      display: inline-block;
      padding: 3px 8px;
      border-radius: 4px;
      font-size: 0.8em;
      background: #e0e7ff;
      color: #3730a3;
    }

    /* Therapeutic area */
    .therapeutic-area {
      display: inline-block;
      padding: 3px 8px;
      border-radius: 4px;
      font-size: 0.8em;
      background: #f0fdf4;
      color: #166534;
    }

    .truncate {
      max-width: 200px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .drug-name {
      font-weight: 600;
      color: #1e40af;
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

    /* Info box */
    .info-box {
      background: #eff6ff;
      border: 1px solid #bfdbfe;
      padding: 15px;
      border-radius: 8px;
      margin-top: 20px;
      font-size: 0.9em;
      color: #1e40af;
    }
    .info-box strong { color: #1e3a8a; }

    @media (max-width: 768px) {
      .charts-grid { grid-template-columns: 1fr; }
      .filters { flex-direction: column; }
      #searchInput { min-width: auto; width: 100%; }
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>FDA Near-Term Catalysts</h1>
    <p class="subtitle">Upcoming PDUFA Dates and FDA Decision Events from SEC Filings</p>
    <p class="generated-date">Generated: ${new Date().toLocaleString('en-US', { dateStyle: 'full', timeStyle: 'short' })}</p>

    <!-- Summary Cards -->
    <div class="summary-grid">
      <div class="summary-card">
        <h3>Total Catalysts</h3>
        <div class="value">${stats.total}</div>
        <div class="subtext">From SEC filings</div>
      </div>
      <div class="summary-card imminent">
        <h3>Next 30 Days</h3>
        <div class="value">${stats.imminent}</div>
        <div class="subtext">Imminent decisions</div>
      </div>
      <div class="summary-card soon">
        <h3>30-90 Days</h3>
        <div class="value">${stats.soon}</div>
        <div class="subtext">Upcoming decisions</div>
      </div>
      <div class="summary-card">
        <h3>With PDUFA Date</h3>
        <div class="value">${stats.withDate}</div>
        <div class="subtext">Known dates</div>
      </div>
      <div class="summary-card">
        <h3>Pending</h3>
        <div class="value">${stats.byStatus['Pending'] || 0}</div>
        <div class="subtext">Awaiting decision</div>
      </div>
    </div>

    <!-- Charts -->
    <div class="charts-grid">
      <div class="chart-container">
        <h3>PDUFA Timeline</h3>
        <div class="chart-wrapper">
          <canvas id="timelineChart"></canvas>
        </div>
      </div>
      <div class="chart-container">
        <h3>By Therapeutic Area</h3>
        <div class="chart-wrapper">
          <canvas id="areaChart"></canvas>
        </div>
      </div>
    </div>

    <!-- Filters -->
    <div class="filters">
      <div class="filter-group">
        <label>Search</label>
        <input type="text" id="searchInput" placeholder="Search by drug, company, indication...">
      </div>
      <div class="filter-group">
        <label>Status</label>
        <select id="statusFilter">
          <option value="">All Statuses</option>
          ${Object.keys(stats.byStatus).map(s => `<option value="${s}">${s}</option>`).join('')}
        </select>
      </div>
      <div class="filter-group">
        <label>Submission Type</label>
        <select id="submissionFilter">
          <option value="">All Types</option>
          ${Object.keys(stats.bySubmissionType).filter(t => t !== 'Unknown').map(t => `<option value="${t}">${t}</option>`).join('')}
        </select>
      </div>
      <div class="filter-group">
        <label>Timeframe</label>
        <select id="timeframeFilter">
          <option value="">All</option>
          <option value="30">Next 30 days</option>
          <option value="90">Next 90 days</option>
          <option value="180">Next 6 months</option>
          <option value="365">Next year</option>
        </select>
      </div>
      <button class="reset-btn" onclick="resetFilters()">Reset</button>
      <button class="export-btn" onclick="exportCSV()">Export CSV</button>
    </div>

    <!-- Table -->
    <div class="table-container">
      <div class="table-header">
        <h3>Catalyst Details</h3>
        <span class="result-count"><span id="visibleCount">${catalysts.length}</span> of ${catalysts.length} catalysts</span>
      </div>
      <div class="table-wrapper">
        <table id="catalystsTable">
          <thead>
            <tr>
              <th data-sort="drug">Drug</th>
              <th data-sort="company">Company</th>
              <th data-sort="pdufaDate">PDUFA Date</th>
              <th data-sort="daysUntilPDUFA">Days Until</th>
              <th data-sort="status">Status</th>
              <th data-sort="submissionType">Type</th>
              <th data-sort="therapeuticArea">Disease Area</th>
              <th data-sort="indication">Indication</th>
              <th data-sort="filingDate">Filing Date</th>
            </tr>
          </thead>
          <tbody id="catalystsBody">
          </tbody>
        </table>
      </div>
    </div>

    <!-- Info Box -->
    <div class="info-box">
      <strong>Data Source:</strong> SEC EDGAR 8-K filings containing FDA-related keywords (PDUFA, NDA, BLA, CRL, etc.)
      <br><br>
      <strong>Note:</strong> PDUFA dates are extracted from SEC filings using pattern matching. Some dates may be missing or require verification.
      Cross-reference with company investor relations for confirmation.
    </div>
  </div>

  <script>
    // Catalyst data
    const catalysts = ${JSON.stringify(catalysts)};

    // Sort state
    let sortColumn = 'daysUntilPDUFA';
    let sortDirection = 'asc';

    function escapeHtml(str) {
      if (!str) return '';
      return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    function formatDate(dateStr) {
      if (!dateStr) return 'TBD';
      const date = new Date(dateStr);
      if (isNaN(date.getTime())) return dateStr;
      return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
    }

    function getStatusClass(status) {
      switch ((status || '').toLowerCase()) {
        case 'approved': return 'status-approved';
        case 'crl': return 'status-crl';
        case 'rejected': return 'status-rejected';
        case 'withdrawn': return 'status-withdrawn';
        default: return 'status-pending';
      }
    }

    function getUrgencyClass(daysUntil) {
      if (daysUntil === null) return 'urgency-unknown';
      if (daysUntil < 0) return 'urgency-past';
      if (daysUntil <= 30) return 'urgency-imminent';
      if (daysUntil <= 90) return 'urgency-soon';
      return 'urgency-future';
    }

    function getDaysLabel(daysUntil) {
      if (daysUntil === null) return 'Unknown';
      if (daysUntil < 0) return \`\${Math.abs(daysUntil)}d ago\`;
      if (daysUntil === 0) return 'Today';
      return \`\${daysUntil}d\`;
    }

    function renderTable(data) {
      const tbody = document.getElementById('catalystsBody');
      tbody.innerHTML = data.map(c => \`
        <tr>
          <td class="drug-name">\${escapeHtml(c.drug)}</td>
          <td class="truncate" title="\${escapeHtml(c.company)}">\${escapeHtml(c.company)}</td>
          <td>\${formatDate(c.pdufaDate)}</td>
          <td><span class="days-until \${getUrgencyClass(c.daysUntilPDUFA)}">\${getDaysLabel(c.daysUntilPDUFA)}</span></td>
          <td><span class="status-badge \${getStatusClass(c.status)}">\${c.status || 'Pending'}</span></td>
          <td>\${c.submissionType ? \`<span class="submission-type">\${c.submissionType}</span>\` : '-'}</td>
          <td>\${c.therapeuticArea ? \`<span class="therapeutic-area">\${c.therapeuticArea}</span>\` : '-'}</td>
          <td class="truncate" title="\${escapeHtml(c.indication)}">\${escapeHtml(c.indication) || '-'}</td>
          <td>\${formatDate(c.filingDate)}</td>
        </tr>
      \`).join('');
      document.getElementById('visibleCount').textContent = data.length;
    }

    function filterAndSort() {
      const search = document.getElementById('searchInput').value.toLowerCase();
      const status = document.getElementById('statusFilter').value;
      const submission = document.getElementById('submissionFilter').value;
      const timeframe = parseInt(document.getElementById('timeframeFilter').value) || 0;

      let filtered = catalysts.filter(c => {
        if (search && !(\`\${c.drug} \${c.company} \${c.indication || ''}\`.toLowerCase().includes(search))) {
          return false;
        }
        if (status && c.status !== status) return false;
        if (submission && c.submissionType !== submission) return false;
        if (timeframe && (c.daysUntilPDUFA === null || c.daysUntilPDUFA < 0 || c.daysUntilPDUFA > timeframe)) {
          return false;
        }
        return true;
      });

      // Sort
      filtered.sort((a, b) => {
        let aVal = a[sortColumn];
        let bVal = b[sortColumn];

        // Handle nulls
        if (aVal === null && bVal === null) return 0;
        if (aVal === null) return 1;
        if (bVal === null) return -1;

        // Handle dates
        if (sortColumn === 'pdufaDate' || sortColumn === 'filingDate') {
          aVal = new Date(aVal).getTime();
          bVal = new Date(bVal).getTime();
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

    // Sort handlers
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
    document.getElementById('statusFilter').addEventListener('change', filterAndSort);
    document.getElementById('submissionFilter').addEventListener('change', filterAndSort);
    document.getElementById('timeframeFilter').addEventListener('change', filterAndSort);

    function resetFilters() {
      document.getElementById('searchInput').value = '';
      document.getElementById('statusFilter').value = '';
      document.getElementById('submissionFilter').value = '';
      document.getElementById('timeframeFilter').value = '';
      filterAndSort();
    }

    function exportCSV() {
      const headers = ['Drug', 'Company', 'PDUFA Date', 'Days Until', 'Status', 'Submission Type', 'Therapeutic Area', 'Indication', 'Filing Date'];
      const rows = catalysts.map(c => [
        '"' + (c.drug || '').replace(/"/g, '""') + '"',
        '"' + (c.company || '').replace(/"/g, '""') + '"',
        c.pdufaDate || '',
        c.daysUntilPDUFA !== null ? c.daysUntilPDUFA : '',
        c.status || 'Pending',
        c.submissionType || '',
        c.therapeuticArea || '',
        '"' + (c.indication || '').replace(/"/g, '""') + '"',
        c.filingDate || ''
      ]);
      const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\\n');
      const blob = new Blob([csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'fda-catalysts.csv';
      a.click();
      URL.revokeObjectURL(url);
    }

    // Charts
    new Chart(document.getElementById('timelineChart'), {
      type: 'bar',
      data: {
        labels: ${JSON.stringify(monthLabels)},
        datasets: [{
          label: 'PDUFA Dates',
          data: ${JSON.stringify(monthCounts)},
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

    new Chart(document.getElementById('areaChart'), {
      type: 'doughnut',
      data: {
        labels: ${JSON.stringify(areaLabels)},
        datasets: [{
          data: ${JSON.stringify(areaCounts)},
          backgroundColor: [
            '#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6',
            '#ec4899', '#06b6d4', '#84cc16', '#f97316', '#6366f1',
            '#14b8a6', '#a855f7', '#eab308', '#22c55e'
          ]
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'right', labels: { boxWidth: 12 } }
        }
      }
    });

    // Initial render
    filterAndSort();
  </script>
</body>
</html>`;
}

async function generateCatalystReport(options = {}) {
  const {
    outputPath = path.join(REPORTS_DIR, 'fda-catalysts-report.html'),
    verbose = true,
    forceRefresh = false
  } = options;

  // Aggregate catalysts
  if (verbose) console.log('Aggregating catalyst data...');
  const { nearTermCatalysts } = await aggregateCatalysts({ forceRefresh, verbose });

  // Recalculate days until (in case data was cached)
  nearTermCatalysts.forEach(catalyst => {
    catalyst.daysUntilPDUFA = calculateDaysUntil(catalyst.pdufaDate);
  });

  // Generate statistics
  if (verbose) console.log('Generating statistics...');
  const stats = generateSummaryStats(nearTermCatalysts);

  if (verbose) {
    console.log('\nCatalyst Summary:');
    console.log(`  Total: ${stats.total}`);
    console.log(`  Imminent (30 days): ${stats.imminent}`);
    console.log(`  Soon (90 days): ${stats.soon}`);
    console.log(`  By status: ${JSON.stringify(stats.byStatus)}`);
  }

  // Generate HTML
  if (verbose) console.log('\nGenerating HTML report...');
  const html = generateHTML(nearTermCatalysts, stats);

  // Ensure reports directory exists
  if (!fs.existsSync(REPORTS_DIR)) {
    fs.mkdirSync(REPORTS_DIR, { recursive: true });
  }

  fs.writeFileSync(outputPath, html);
  if (verbose) console.log(`Report saved to: ${outputPath}`);

  return { catalysts: nearTermCatalysts, stats, outputPath };
}

module.exports = { generateCatalystReport, generateSummaryStats };
