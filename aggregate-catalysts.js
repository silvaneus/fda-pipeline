/**
 * Catalyst Aggregator
 * Combines data from multiple sources, deduplicates, and enriches catalyst data
 */

const fs = require('fs');
const path = require('path');
const { fetchAllFDAFilings, fetchFilingContent, extractRelevantSnippets, FDA_SEARCH_TERMS } = require('./fetch-sec-filings');
const { parseFilingForCatalysts, extractPDUFADates, extractDrugNames, extractSubmissionType, extractApprovalStatus } = require('./parse-pdufa');
const { classifyCondition } = require('./classify-disease');
const { getSuccessRate } = require('./success-rates');

const DATA_DIR = path.join(__dirname, 'data');
const CATALYSTS_FILE = path.join(DATA_DIR, 'catalysts.json');

// Known upcoming PDUFA dates (manually curated/supplemental data)
// This provides a baseline of known catalysts to supplement SEC filing parsing
const KNOWN_CATALYSTS = [
  // These are examples - in production, this would be regularly updated
  // Format matches the catalyst object structure
];

/**
 * Create a unique key for deduplication
 */
function getCatalystKey(catalyst) {
  const drug = (catalyst.drug || catalyst.drugName || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const company = (catalyst.company || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  return `${drug}-${company}`;
}

/**
 * Normalize and clean catalyst data
 */
function normalizeCatalyst(catalyst) {
  return {
    drug: catalyst.drug || catalyst.drugName || 'Unknown',
    company: catalyst.company || 'Unknown',
    indication: catalyst.indication || null,
    therapeuticArea: catalyst.therapeuticArea || null,
    pdufaDate: catalyst.pdufaDate || catalyst.date || null,
    submissionType: catalyst.submissionType || null,
    status: catalyst.status || 'Pending',
    successRate: catalyst.successRate || null,
    source: catalyst.source || 'SEC Filing',
    filingDate: catalyst.filingDate || null,
    accessionNumber: catalyst.accessionNumber || null,
    lastUpdated: new Date().toISOString()
  };
}

/**
 * Enrich catalyst with therapeutic area and success rate
 */
function enrichCatalyst(catalyst) {
  // Classify therapeutic area if indication is available
  if (catalyst.indication && !catalyst.therapeuticArea) {
    catalyst.therapeuticArea = classifyCondition([catalyst.indication]);
  }

  // Add success rate if therapeutic area is available
  if (catalyst.therapeuticArea && !catalyst.successRate) {
    const rate = getSuccessRate(catalyst.therapeuticArea);
    catalyst.successRate = rate.rate;
    catalyst.successRateRange = rate.range;
  }

  return catalyst;
}

/**
 * Calculate days until PDUFA date
 */
function calculateDaysUntil(pdufaDate) {
  if (!pdufaDate) return null;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const pdufa = new Date(pdufaDate);
  if (isNaN(pdufa.getTime())) return null;

  const diffTime = pdufa.getTime() - today.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  return diffDays;
}

/**
 * Process SEC filings to extract catalysts
 */
async function extractCatalystsFromFilings(filings, options = {}) {
  const { verbose = true } = options;
  const catalysts = [];

  if (verbose) console.log(`Processing ${filings.length} SEC filings for catalysts...`);

  for (let i = 0; i < filings.length; i++) {
    const filing = filings[i];

    // Use the snippet if available, otherwise the headline
    const textToAnalyze = filing.snippet || filing.headline || '';

    // Extract PDUFA dates and drug info
    const pdufaDates = extractPDUFADates(textToAnalyze);
    const drugNames = extractDrugNames(textToAnalyze);
    const submissionType = extractSubmissionType(textToAnalyze);
    const status = extractApprovalStatus(textToAnalyze);

    // Create catalyst entries
    if (pdufaDates.length > 0 || drugNames.length > 0) {
      for (const drug of drugNames) {
        for (const pdufaInfo of pdufaDates.length > 0 ? pdufaDates : [{ date: null }]) {
          catalysts.push(normalizeCatalyst({
            drug: drug,
            company: filing.companyName,
            pdufaDate: pdufaInfo.date,
            submissionType: submissionType,
            status: status,
            source: 'SEC 8-K Filing',
            filingDate: filing.filingDate,
            accessionNumber: filing.accessionNumber,
            matchedTerms: filing.matchedTerms
          }));
        }
      }

      // If we have PDUFA dates but no drug names, still create entries
      if (drugNames.length === 0 && pdufaDates.length > 0) {
        for (const pdufaInfo of pdufaDates) {
          catalysts.push(normalizeCatalyst({
            drug: 'Unknown Drug',
            company: filing.companyName,
            pdufaDate: pdufaInfo.date,
            submissionType: submissionType,
            status: status,
            source: 'SEC 8-K Filing',
            filingDate: filing.filingDate,
            accessionNumber: filing.accessionNumber,
            matchedTerms: filing.matchedTerms
          }));
        }
      }
    }

    if (verbose && (i + 1) % 50 === 0) {
      console.log(`  Processed ${i + 1}/${filings.length} filings...`);
    }
  }

  if (verbose) console.log(`  Extracted ${catalysts.length} raw catalyst entries`);

  return catalysts;
}

/**
 * Deduplicate catalysts, keeping the most recent/complete entry
 */
function deduplicateCatalysts(catalysts) {
  const catalystMap = new Map();

  for (const catalyst of catalysts) {
    const key = getCatalystKey(catalyst);

    if (!catalystMap.has(key)) {
      catalystMap.set(key, catalyst);
    } else {
      // Merge with existing, preferring newer data
      const existing = catalystMap.get(key);

      // Prefer the one with a PDUFA date if the other doesn't have one
      if (!existing.pdufaDate && catalyst.pdufaDate) {
        catalystMap.set(key, { ...existing, ...catalyst });
      } else if (existing.pdufaDate && !catalyst.pdufaDate) {
        // Keep existing, maybe add new info
        catalystMap.set(key, {
          ...existing,
          indication: existing.indication || catalyst.indication,
          submissionType: existing.submissionType || catalyst.submissionType
        });
      } else {
        // Prefer newer filing date
        const existingDate = existing.filingDate ? new Date(existing.filingDate) : new Date(0);
        const catalystDate = catalyst.filingDate ? new Date(catalyst.filingDate) : new Date(0);

        if (catalystDate > existingDate) {
          catalystMap.set(key, { ...existing, ...catalyst });
        }
      }
    }
  }

  return Array.from(catalystMap.values());
}

/**
 * Sort catalysts by PDUFA date (nearest first)
 */
function sortCatalystsByDate(catalysts) {
  return catalysts.sort((a, b) => {
    // Put entries with PDUFA dates first
    if (a.pdufaDate && !b.pdufaDate) return -1;
    if (!a.pdufaDate && b.pdufaDate) return 1;
    if (!a.pdufaDate && !b.pdufaDate) {
      // Sort by filing date instead
      const dateA = a.filingDate ? new Date(a.filingDate) : new Date(0);
      const dateB = b.filingDate ? new Date(b.filingDate) : new Date(0);
      return dateB - dateA;
    }

    // Both have PDUFA dates - sort by date (nearest first)
    return new Date(a.pdufaDate) - new Date(b.pdufaDate);
  });
}

/**
 * Filter catalysts for actionable near-term events
 */
function filterNearTermCatalysts(catalysts, options = {}) {
  const { maxMonthsOut = 18, includePast = false } = options;

  const today = new Date();
  const maxDate = new Date();
  maxDate.setMonth(maxDate.getMonth() + maxMonthsOut);

  return catalysts.filter(catalyst => {
    if (!catalyst.pdufaDate) return true; // Keep entries without dates for reference

    const pdufaDate = new Date(catalyst.pdufaDate);
    if (isNaN(pdufaDate.getTime())) return false;

    // Filter out past dates unless includePast is true
    if (!includePast && pdufaDate < today) return false;

    // Filter out dates too far in the future
    if (pdufaDate > maxDate) return false;

    return true;
  });
}

/**
 * Main aggregation function
 */
async function aggregateCatalysts(options = {}) {
  const { forceRefresh = false, verbose = true } = options;

  // Step 1: Fetch SEC filings
  if (verbose) console.log('Step 1: Fetching SEC filings...');
  const filings = await fetchAllFDAFilings({ forceRefresh, verbose });

  // Step 2: Extract catalysts from filings
  if (verbose) console.log('\nStep 2: Extracting catalysts from filings...');
  const extractedCatalysts = await extractCatalystsFromFilings(filings, { verbose });

  // Step 3: Combine with known catalysts
  if (verbose) console.log('\nStep 3: Combining with known catalysts...');
  const allCatalysts = [...extractedCatalysts, ...KNOWN_CATALYSTS];

  // Step 4: Deduplicate
  if (verbose) console.log('\nStep 4: Deduplicating catalysts...');
  const dedupedCatalysts = deduplicateCatalysts(allCatalysts);
  if (verbose) console.log(`  ${allCatalysts.length} -> ${dedupedCatalysts.length} after deduplication`);

  // Step 5: Enrich with therapeutic area and success rates
  if (verbose) console.log('\nStep 5: Enriching catalysts...');
  const enrichedCatalysts = dedupedCatalysts.map(enrichCatalyst);

  // Step 6: Add days until PDUFA
  enrichedCatalysts.forEach(catalyst => {
    catalyst.daysUntilPDUFA = calculateDaysUntil(catalyst.pdufaDate);
  });

  // Step 7: Sort by PDUFA date
  if (verbose) console.log('\nStep 6: Sorting by PDUFA date...');
  const sortedCatalysts = sortCatalystsByDate(enrichedCatalysts);

  // Step 8: Filter for near-term (optional based on use case)
  const nearTermCatalysts = filterNearTermCatalysts(sortedCatalysts, {
    maxMonthsOut: 18,
    includePast: false
  });

  if (verbose) {
    console.log(`\nAggregation complete:`);
    console.log(`  Total catalysts: ${sortedCatalysts.length}`);
    console.log(`  Near-term (18 months): ${nearTermCatalysts.length}`);
    console.log(`  With PDUFA dates: ${nearTermCatalysts.filter(c => c.pdufaDate).length}`);
  }

  // Save to file
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  fs.writeFileSync(CATALYSTS_FILE, JSON.stringify({
    allCatalysts: sortedCatalysts,
    nearTermCatalysts,
    lastUpdated: new Date().toISOString(),
    stats: {
      total: sortedCatalysts.length,
      nearTerm: nearTermCatalysts.length,
      withPDUFA: nearTermCatalysts.filter(c => c.pdufaDate).length,
      byStatus: countByField(nearTermCatalysts, 'status'),
      bySubmissionType: countByField(nearTermCatalysts, 'submissionType')
    }
  }, null, 2));

  if (verbose) console.log(`\nSaved to ${CATALYSTS_FILE}`);

  return {
    allCatalysts: sortedCatalysts,
    nearTermCatalysts
  };
}

/**
 * Helper to count by field
 */
function countByField(items, field) {
  const counts = {};
  for (const item of items) {
    const value = item[field] || 'Unknown';
    counts[value] = (counts[value] || 0) + 1;
  }
  return counts;
}

// Allow running directly
if (require.main === module) {
  aggregateCatalysts({
    forceRefresh: process.argv.includes('--force'),
    verbose: true
  })
    .then(result => {
      console.log(`\nCompleted. ${result.nearTermCatalysts.length} near-term catalysts found.`);

      // Show sample
      if (result.nearTermCatalysts.length > 0) {
        console.log('\nSample near-term catalysts:');
        result.nearTermCatalysts.slice(0, 5).forEach(c => {
          console.log(`  ${c.pdufaDate || 'TBD'} | ${c.drug} | ${c.company} | ${c.status}`);
        });
      }
    })
    .catch(err => {
      console.error('Error:', err);
      process.exit(1);
    });
}

module.exports = {
  aggregateCatalysts,
  extractCatalystsFromFilings,
  deduplicateCatalysts,
  enrichCatalyst,
  calculateDaysUntil,
  filterNearTermCatalysts
};
