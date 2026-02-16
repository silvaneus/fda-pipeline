#!/usr/bin/env node

/**
 * FDA Near-Term Catalysts Pipeline - Main Orchestrator
 *
 * Fetches FDA-related SEC filings, extracts PDUFA dates and drug information,
 * and generates an interactive HTML report of near-term FDA catalysts.
 *
 * Usage:
 *   node run-catalyst-pipeline.js           # Use cached data if available
 *   node run-catalyst-pipeline.js --force   # Force refresh from APIs
 *   node run-catalyst-pipeline.js --help    # Show help
 */

const path = require('path');
const { fetchCompanyTickers } = require('./company-lookup');
const { generateCatalystReport } = require('./generate-catalyst-report');

async function runCatalystPipeline(options = {}) {
  const startTime = Date.now();

  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║     FDA Near-Term Catalysts Pipeline                       ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');

  try {
    // Step 1: Ensure company data is cached
    console.log('Step 1: Loading company data...');
    console.log('─'.repeat(50));
    await fetchCompanyTickers(options);
    console.log('✓ Company data ready\n');

    // Step 2: Generate catalyst report (this runs the full pipeline)
    console.log('Step 2: Processing SEC filings and generating report...');
    console.log('─'.repeat(50));
    const { catalysts, stats, outputPath } = await generateCatalystReport(options);
    console.log(`\n✓ Report generated\n`);

    // Summary
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log('═'.repeat(50));
    console.log('Pipeline Complete!');
    console.log('═'.repeat(50));
    console.log(`\nTotal catalysts found: ${catalysts.length}`);
    console.log(`  - With PDUFA dates: ${stats.withDate}`);
    console.log(`  - Imminent (30 days): ${stats.imminent}`);
    console.log(`  - Soon (90 days): ${stats.soon}`);
    console.log(`\nReport saved to:\n  ${outputPath}`);
    console.log(`\nElapsed time: ${elapsed}s`);
    console.log('\nOpen the report in a browser to view and interact with the data.');

    // Show upcoming catalysts preview
    if (catalysts.length > 0) {
      const upcoming = catalysts
        .filter(c => c.daysUntilPDUFA !== null && c.daysUntilPDUFA >= 0)
        .slice(0, 5);

      if (upcoming.length > 0) {
        console.log('\n─'.repeat(50));
        console.log('Upcoming Catalysts Preview:');
        upcoming.forEach(c => {
          const days = c.daysUntilPDUFA;
          const daysLabel = days === 0 ? 'TODAY' : `${days}d`;
          console.log(`  ${c.pdufaDate || 'TBD'} (${daysLabel}) | ${c.drug} | ${c.company}`);
        });
      }
    }

    return { catalysts, stats, outputPath };
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
FDA Near-Term Catalysts Pipeline

Fetches FDA-related SEC filings (8-K forms) containing PDUFA dates, drug
submissions, and approval announcements. Generates an interactive HTML
report of near-term FDA catalysts.

Usage:
  node run-catalyst-pipeline.js [options]

Options:
  --force    Force refresh data from SEC EDGAR and other sources
             (by default, uses cached data if less than 24 hours old)
  --help     Show this help message

Output:
  Creates an interactive HTML report at:
  reports/fda-catalysts-report.html

Data Sources:
  - SEC EDGAR Full-Text Search API (8-K filings)
  - SEC Company Tickers API (company name resolution)

Search Terms:
  PDUFA, FDA approval, NDA submission, BLA submission, sNDA, sBLA,
  Complete Response Letter, CRL, Advisory Committee, AdComm

Examples:
  node run-catalyst-pipeline.js           # Use cached data
  node run-catalyst-pipeline.js --force   # Force fresh API fetch

Note:
  PDUFA dates are extracted from SEC filings using pattern matching.
  Some dates may be missing or require verification against company
  investor relations materials.
`);
    process.exit(0);
  }

  const forceRefresh = args.includes('--force');

  runCatalystPipeline({ forceRefresh, verbose: true })
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}

module.exports = { runCatalystPipeline };
