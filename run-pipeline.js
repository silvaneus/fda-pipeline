#!/usr/bin/env node

/**
 * FDA Pipeline - Integrated Report Generator
 *
 * Generates a single integrated HTML report containing:
 * - Phase 3 (and Phase 2/3) clinical trials currently recruiting in the US
 * - Near-term FDA catalysts (PDUFA dates, approvals) from SEC filings
 *
 * Usage:
 *   node run-pipeline.js           # Use cached data if available
 *   node run-pipeline.js --force   # Force refresh from all APIs
 *   node run-pipeline.js --help    # Show help
 */

const path = require('path');
const { generateIntegratedReport } = require('./generate-integrated-report');
const { main: scrapeRTTNews } = require('./scrape-rttnews');

async function runPipeline(options = {}) {
  const startTime = Date.now();

  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║     FDA Pipeline - Clinical Trials & Catalysts             ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');

  try {
    // Scrape RTTNews FDA Calendar first (primary PDUFA source)
    console.log('── Scraping RTTNews FDA Calendar ──');
    try {
      await scrapeRTTNews();
    } catch (err) {
      console.log(`  Warning: RTTNews scrape failed (${err.message}), using cached data`);
    }
    console.log('');

    const result = await generateIntegratedReport(options);

    // Summary
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log('\n' + '═'.repeat(50));
    console.log('Pipeline Complete!');
    console.log('═'.repeat(50));
    console.log(`\nClinical Trials: ${result.trialStats.total}`);
    console.log(`  - New Approvals: ${result.trialStats.byApprovalType['New Approval'] || 0}`);
    console.log(`  - Supplemental: ${result.trialStats.byApprovalType['Supplemental'] || 0}`);
    console.log(`  - Therapeutic Areas: ${Object.keys(result.trialStats.byArea).length}`);
    console.log(`\nFDA Catalysts: ${result.catalystStats.total}`);
    console.log(`  - With PDUFA dates: ${result.catalystStats.withDate}`);
    console.log(`  - Imminent (30 days): ${result.catalystStats.imminent}`);
    console.log(`\nReport saved to:\n  ${result.outputPath}`);
    console.log(`\nElapsed time: ${elapsed}s`);
    console.log('\nOpen the report in a browser to view and interact with the data.');

    return result;
  } catch (error) {
    console.error('\n✗ Pipeline failed:', error.message);
    console.error('\nStack trace:', error.stack);
    process.exit(1);
  }
}

// CLI handling
if (require.main === module) {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
FDA Pipeline - Integrated Report Generator

Generates a single interactive HTML report containing:
  1. Phase 3 clinical trials currently recruiting in the US (industry-sponsored)
  2. Near-term FDA catalysts (PDUFA dates, approvals) from SEC filings

Usage:
  node run-pipeline.js [options]

Options:
  --force    Force refresh data from all APIs
             (by default, uses cached data if available)
  --help     Show this help message

Output:
  Creates an interactive HTML report at:
  reports/fda-pipeline-report.html

Data Sources:
  - ClinicalTrials.gov API v2 (clinical trials)
  - SEC EDGAR API (8-K filings for FDA catalysts)
  - OpenFDA API (approved drugs database)
  - Historical success rates from BIO Industry Analysis

Features:
  - Tabbed interface: Clinical Trials | FDA Catalysts | Reference
  - Filtering by therapeutic area, approval type, success rate
  - Sortable tables with search
  - Charts and visualizations
  - CSV export

Examples:
  node run-pipeline.js           # Use cached data
  node run-pipeline.js --force   # Force fresh API fetch
`);
    process.exit(0);
  }

  const forceRefresh = args.includes('--force');

  runPipeline({ forceRefresh, verbose: true })
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}

module.exports = { runPipeline };
