/**
 * SEC Filing Fetcher
 * Queries SEC EDGAR for FDA-related 8-K filings from pharma/biotech companies
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const { isPharmaOrBiotech, extractCompanyName } = require('./company-lookup');

const DATA_DIR = path.join(__dirname, 'data');
const SEC_FILINGS_FILE = path.join(DATA_DIR, 'sec-filings.json');
const SEC_LAST_FETCH_FILE = path.join(DATA_DIR, 'sec-filings-last-fetch.txt');

// SEC EDGAR Full-Text Search API
const SEC_SEARCH_URL = 'https://efts.sec.gov/LATEST/search-index';

// FDA-related search terms
const FDA_SEARCH_TERMS = [
  'PDUFA',
  'FDA approval',
  'NDA submission',
  'BLA submission',
  'sNDA',
  'sBLA',
  'Complete Response Letter',
  'CRL',
  'Advisory Committee',
  'AdComm'
];

function httpsRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const reqOptions = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: options.method || 'GET',
      headers: {
        'User-Agent': 'FDA-Pipeline Research Tool research@example.com',
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        ...options.headers
      }
    };

    const request = https.request(reqOptions, (response) => {
      let data = '';
      response.on('data', chunk => data += chunk);
      response.on('end', () => {
        if (response.statusCode === 200) {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            // Return raw data if not JSON
            resolve({ raw: data });
          }
        } else {
          reject(new Error(`HTTP ${response.statusCode}: ${data.substring(0, 500)}`));
        }
      });
    });

    request.on('error', reject);
    request.setTimeout(60000, () => {
      request.destroy();
      reject(new Error('Request timeout'));
    });

    if (options.body) {
      request.write(options.body);
    }
    request.end();
  });
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Search SEC EDGAR full-text search for FDA-related filings
 */
async function searchSECFilings(searchTerm, options = {}) {
  const {
    startDate = getDefaultStartDate(),
    endDate = new Date().toISOString().split('T')[0],
    forms = ['8-K', '8-K/A'],
    limit = 100,
    verbose = true
  } = options;

  // Build search URL
  const params = new URLSearchParams({
    q: `"${searchTerm}"`,
    dateRange: 'custom',
    startdt: startDate,
    enddt: endDate,
    forms: forms.join(','),
    from: '0',
    size: String(limit)
  });

  const url = `${SEC_SEARCH_URL}?${params.toString()}`;

  try {
    const response = await httpsRequest(url);
    return response.hits?.hits || [];
  } catch (error) {
    if (verbose) console.log(`  Error searching for "${searchTerm}": ${error.message}`);
    return [];
  }
}

/**
 * Get default start date (18 months ago)
 */
function getDefaultStartDate() {
  const date = new Date();
  date.setMonth(date.getMonth() - 18);
  return date.toISOString().split('T')[0];
}

/**
 * Fetch SEC filing details
 */
async function fetchFilingContent(accessionNumber, cik) {
  // Format accession number for URL (remove dashes)
  const accessionFormatted = accessionNumber.replace(/-/g, '');
  const cikPadded = String(cik).padStart(10, '0');

  // Try to get the primary document (usually the 8-K filing itself)
  const baseUrl = `https://www.sec.gov/Archives/edgar/data/${cik}/${accessionFormatted}`;

  try {
    // Get the filing index
    const indexUrl = `${baseUrl}/index.json`;
    const indexResponse = await httpsRequest(indexUrl);

    // Find the primary document
    const items = indexResponse.directory?.item || [];
    const primaryDoc = items.find(item =>
      item.name && (
        item.name.endsWith('.htm') ||
        item.name.endsWith('.html') ||
        item.name.includes('8-k')
      )
    );

    if (primaryDoc) {
      // Fetch the actual filing content
      const docUrl = `${baseUrl}/${primaryDoc.name}`;
      const docResponse = await httpsRequest(docUrl);
      return docResponse.raw || '';
    }

    return '';
  } catch (error) {
    return '';
  }
}

/**
 * Extract relevant text snippets from filing content
 */
function extractRelevantSnippets(content, searchTerms) {
  if (!content) return [];

  const snippets = [];
  const contentLower = content.toLowerCase();

  for (const term of searchTerms) {
    const termLower = term.toLowerCase();
    let index = contentLower.indexOf(termLower);

    while (index !== -1) {
      // Extract surrounding context (500 chars each side)
      const start = Math.max(0, index - 500);
      const end = Math.min(content.length, index + term.length + 500);
      const snippet = content.substring(start, end)
        .replace(/<[^>]*>/g, ' ')  // Remove HTML tags
        .replace(/\s+/g, ' ')      // Normalize whitespace
        .trim();

      if (snippet.length > 50) {
        snippets.push({
          term,
          snippet,
          position: index
        });
      }

      // Find next occurrence
      index = contentLower.indexOf(termLower, index + term.length);
    }
  }

  return snippets;
}

/**
 * Process a single SEC filing hit
 */
function processFilingHit(hit) {
  const source = hit._source || {};

  return {
    accessionNumber: source.adsh || hit._id,
    filingDate: source.file_date,
    formType: source.form,
    companyName: extractCompanyName(source.entity || source.display_names?.[0]),
    cik: source.cik,
    ticker: source.tickers?.[0] || null,
    sic: source.sics?.[0] || null,
    fileUrl: source.file_url,
    snippet: source.text_snippet || null,
    headline: source.headline || source.display_names?.[0] || null
  };
}

/**
 * Fetch all FDA-related SEC filings
 */
async function fetchAllFDAFilings(options = {}) {
  const {
    forceRefresh = false,
    verbose = true,
    startDate,
    endDate
  } = options;

  // Check cache (refresh daily)
  if (!forceRefresh && fs.existsSync(SEC_FILINGS_FILE)) {
    const lastFetch = fs.existsSync(SEC_LAST_FETCH_FILE)
      ? fs.readFileSync(SEC_LAST_FETCH_FILE, 'utf-8').trim()
      : null;

    if (lastFetch) {
      const lastFetchDate = new Date(lastFetch);
      const hoursSinceFetch = (Date.now() - lastFetchDate.getTime()) / (1000 * 60 * 60);

      if (hoursSinceFetch < 24) {
        if (verbose) console.log(`Using cached SEC filings (${hoursSinceFetch.toFixed(1)} hours old)`);
        return JSON.parse(fs.readFileSync(SEC_FILINGS_FILE, 'utf-8'));
      }
    }
  }

  if (verbose) console.log('Fetching FDA-related SEC filings...');

  const allFilings = new Map(); // Use Map to dedupe by accession number

  // Search for each FDA-related term
  for (const searchTerm of FDA_SEARCH_TERMS) {
    if (verbose) console.log(`  Searching for "${searchTerm}"...`);

    try {
      const hits = await searchSECFilings(searchTerm, {
        startDate,
        endDate,
        verbose,
        limit: 200  // Get more results per term
      });

      for (const hit of hits) {
        const filing = processFilingHit(hit);

        // Filter for pharma/biotech companies
        if (filing.companyName && isPharmaOrBiotech(filing.companyName)) {
          // Store with search term that matched
          if (!allFilings.has(filing.accessionNumber)) {
            filing.matchedTerms = [searchTerm];
            allFilings.set(filing.accessionNumber, filing);
          } else {
            // Add this search term to existing filing
            const existing = allFilings.get(filing.accessionNumber);
            if (!existing.matchedTerms.includes(searchTerm)) {
              existing.matchedTerms.push(searchTerm);
            }
          }
        }
      }

      if (verbose) console.log(`    Found ${hits.length} results, ${allFilings.size} pharma/biotech total`);

      // Rate limiting
      await delay(500);
    } catch (error) {
      if (verbose) console.log(`    Error: ${error.message}`);
    }
  }

  const filings = Array.from(allFilings.values());

  // Sort by filing date (most recent first)
  filings.sort((a, b) => {
    const dateA = a.filingDate ? new Date(a.filingDate) : new Date(0);
    const dateB = b.filingDate ? new Date(b.filingDate) : new Date(0);
    return dateB - dateA;
  });

  if (verbose) console.log(`\nTotal unique FDA-related filings: ${filings.length}`);

  // Ensure data directory exists
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  // Save to cache
  fs.writeFileSync(SEC_FILINGS_FILE, JSON.stringify(filings, null, 2));
  fs.writeFileSync(SEC_LAST_FETCH_FILE, new Date().toISOString());

  return filings;
}

// Allow running directly
if (require.main === module) {
  fetchAllFDAFilings({ forceRefresh: process.argv.includes('--force'), verbose: true })
    .then(filings => {
      console.log(`\nFetched ${filings.length} filings`);
      if (filings.length > 0) {
        console.log('\nSample filings:');
        filings.slice(0, 5).forEach(f => {
          console.log(`  ${f.filingDate} | ${f.companyName} | ${f.formType} | ${f.matchedTerms?.join(', ')}`);
        });
      }
    })
    .catch(err => {
      console.error('Error:', err.message);
      process.exit(1);
    });
}

module.exports = {
  fetchAllFDAFilings,
  searchSECFilings,
  fetchFilingContent,
  extractRelevantSnippets,
  FDA_SEARCH_TERMS
};
