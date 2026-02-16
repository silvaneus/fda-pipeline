/**
 * Company Lookup Module
 * Maps SEC CIK codes to company names and filters for pharma/biotech companies
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const DATA_DIR = path.join(__dirname, 'data');
const COMPANY_TICKERS_FILE = path.join(DATA_DIR, 'company-tickers.json');
const COMPANY_LAST_FETCH_FILE = path.join(DATA_DIR, 'company-tickers-last-fetch.txt');

// SEC Company Tickers JSON URL
const SEC_COMPANY_TICKERS_URL = 'https://www.sec.gov/files/company_tickers.json';

// Pharma/Biotech SIC codes
const PHARMA_BIOTECH_SIC_CODES = [
  '2833', // Medicinal Chemicals and Botanical Products
  '2834', // Pharmaceutical Preparations
  '2835', // In Vitro & In Vivo Diagnostic Substances
  '2836', // Biological Products (No Diagnostic Substances)
  '3826', // Laboratory Analytical Instruments
  '3841', // Surgical & Medical Instruments
  '3845', // Electromedical & Electrotherapeutic Apparatus
  '8731', // Services-Commercial Physical & Biological Research
  '8734'  // Services-Testing Laboratories
];

function httpsGet(url, options = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const reqOptions = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: 'GET',
      headers: {
        'User-Agent': 'FDA-Pipeline Research Tool (contact@example.com)',
        'Accept': 'application/json',
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
            reject(new Error(`Failed to parse JSON: ${e.message}`));
          }
        } else {
          reject(new Error(`HTTP ${response.statusCode}: ${data.substring(0, 500)}`));
        }
      });
    });
    request.on('error', reject);
    request.setTimeout(30000, () => {
      request.destroy();
      reject(new Error('Request timeout'));
    });
    request.end();
  });
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Fetch company tickers from SEC and cache locally
 */
async function fetchCompanyTickers(options = {}) {
  const { forceRefresh = false, verbose = true } = options;

  // Check cache (refresh weekly)
  if (!forceRefresh && fs.existsSync(COMPANY_TICKERS_FILE)) {
    const lastFetch = fs.existsSync(COMPANY_LAST_FETCH_FILE)
      ? fs.readFileSync(COMPANY_LAST_FETCH_FILE, 'utf-8').trim()
      : null;

    if (lastFetch) {
      const lastFetchDate = new Date(lastFetch);
      const daysSinceFetch = (Date.now() - lastFetchDate.getTime()) / (1000 * 60 * 60 * 24);

      if (daysSinceFetch < 7) {
        if (verbose) console.log(`Using cached company tickers (${daysSinceFetch.toFixed(1)} days old)`);
        return JSON.parse(fs.readFileSync(COMPANY_TICKERS_FILE, 'utf-8'));
      }
    }
  }

  if (verbose) console.log('Fetching company tickers from SEC...');

  try {
    const data = await httpsGet(SEC_COMPANY_TICKERS_URL);

    // Convert to a more usable format: CIK -> company info
    const companies = {};
    for (const key of Object.keys(data)) {
      const company = data[key];
      const cik = String(company.cik_str).padStart(10, '0');
      companies[cik] = {
        name: company.title,
        ticker: company.ticker,
        cik: cik
      };
    }

    if (verbose) console.log(`  Fetched ${Object.keys(companies).length} companies`);

    // Ensure data directory exists
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }

    // Save to cache
    fs.writeFileSync(COMPANY_TICKERS_FILE, JSON.stringify(companies, null, 2));
    fs.writeFileSync(COMPANY_LAST_FETCH_FILE, new Date().toISOString());

    return companies;
  } catch (error) {
    if (verbose) console.log(`  Error fetching company tickers: ${error.message}`);

    // Try to use cached data if available
    if (fs.existsSync(COMPANY_TICKERS_FILE)) {
      if (verbose) console.log('  Using stale cached data');
      return JSON.parse(fs.readFileSync(COMPANY_TICKERS_FILE, 'utf-8'));
    }

    throw error;
  }
}

/**
 * Look up company name by CIK
 */
function getCompanyByCIK(cik, companies) {
  const paddedCik = String(cik).padStart(10, '0');
  return companies[paddedCik] || null;
}

/**
 * Look up company by ticker symbol
 */
function getCompanyByTicker(ticker, companies) {
  const tickerUpper = ticker.toUpperCase();
  for (const company of Object.values(companies)) {
    if (company.ticker === tickerUpper) {
      return company;
    }
  }
  return null;
}

/**
 * Search companies by name (partial match)
 */
function searchCompaniesByName(searchTerm, companies, limit = 10) {
  const term = searchTerm.toLowerCase();
  const results = [];

  for (const company of Object.values(companies)) {
    if (company.name.toLowerCase().includes(term)) {
      results.push(company);
      if (results.length >= limit) break;
    }
  }

  return results;
}

/**
 * Known pharma/biotech companies (for filtering SEC filings)
 * This supplements SIC code filtering
 */
const KNOWN_PHARMA_BIOTECH = new Set([
  // Big Pharma
  'pfizer', 'johnson & johnson', 'merck', 'abbvie', 'bristol-myers squibb',
  'eli lilly', 'roche', 'novartis', 'sanofi', 'astrazeneca', 'glaxosmithkline',
  'gilead', 'amgen', 'regeneron', 'vertex', 'moderna', 'biogen', 'takeda',
  'bayer', 'boehringer', 'novo nordisk', 'gsk', 'bms',
  // Mid-cap Biotech
  'alnylam', 'alexion', 'biomarin', 'bluebird', 'crispr', 'editas',
  'intellia', 'ionis', 'neurocrine', 'seagen', 'seattle genetics',
  'ultragenyx', 'exact sciences', 'illumina', 'guardant', 'grail',
  'horizon', 'jazz', 'sarepta', 'incyte', 'exelixis', 'argenx',
  'karuna', 'blueprint', 'mirati', 'revolution', 'turning point',
  // Common keywords
  'pharma', 'therapeutics', 'biosciences', 'biotech', 'oncology',
  'genomics', 'medicines', 'biopharma', 'vaccine'
]);

/**
 * Check if a company name suggests pharma/biotech
 */
function isPharmaOrBiotech(companyName) {
  if (!companyName) return false;
  const nameLower = companyName.toLowerCase();

  for (const keyword of KNOWN_PHARMA_BIOTECH) {
    if (nameLower.includes(keyword)) {
      return true;
    }
  }

  return false;
}

/**
 * Extract company name from SEC filing entity text
 */
function extractCompanyName(entityText) {
  if (!entityText) return null;

  // Remove common suffixes
  return entityText
    .replace(/\s*(inc\.?|corp\.?|corporation|llc|ltd\.?|plc|limited|co\.?|company)\s*$/i, '')
    .replace(/\s*\/[A-Z]{2}\/?$/i, '') // Remove state codes like /DE/
    .trim();
}

module.exports = {
  fetchCompanyTickers,
  getCompanyByCIK,
  getCompanyByTicker,
  searchCompaniesByName,
  isPharmaOrBiotech,
  extractCompanyName,
  PHARMA_BIOTECH_SIC_CODES,
  KNOWN_PHARMA_BIOTECH
};
