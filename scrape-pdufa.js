/**
 * PDUFA Date Scraper
 *
 * Scrapes GlobeNewswire for FDA acceptance press releases containing PDUFA dates.
 * This provides a more reliable, primary-source approach to tracking FDA catalysts.
 *
 * Usage:
 *   node scrape-pdufa.js              # Scrape and display new PDUFA dates
 *   node scrape-pdufa.js --update     # Update the curated catalysts file
 *   node scrape-pdufa.js --verbose    # Show detailed progress
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const SCRAPED_CACHE_FILE = path.join(DATA_DIR, 'scraped-pdufa.json');

// Search terms that indicate FDA acceptance with PDUFA date
const SEARCH_TERMS = [
  'PDUFA+date',
  'FDA+accepts+NDA',
  'FDA+accepts+BLA',
  'FDA+acceptance+NDA',
  'FDA+acceptance+BLA',
  'target+action+date+FDA'
];

// Patterns to extract PDUFA dates from press release text
const PDUFA_DATE_PATTERNS = [
  // "PDUFA date of June 29, 2026"
  /PDUFA\s+(?:target\s+)?(?:action\s+)?date\s+(?:of\s+|is\s+|set\s+for\s+)?(\w+\s+\d{1,2},?\s+\d{4})/gi,
  // "PDUFA goal date of June 29, 2026"
  /PDUFA\s+goal\s+date\s+(?:of\s+)?(\w+\s+\d{1,2},?\s+\d{4})/gi,
  // "target action date of June 29, 2026"
  /target\s+(?:action\s+)?date\s+(?:of\s+|is\s+)?(\w+\s+\d{1,2},?\s+\d{4})/gi,
  // "action date under PDUFA is June 29, 2026"
  /action\s+date\s+under\s+PDUFA\s+is\s+(\w+\s+\d{1,2},?\s+\d{4})/gi,
  // "decision by June 29, 2026"
  /(?:FDA\s+)?decision\s+(?:expected\s+)?by\s+(\w+\s+\d{1,2},?\s+\d{4})/gi
];

// Patterns to extract drug names
const DRUG_NAME_PATTERNS = [
  // "NDA for drugname" or "BLA for drugname"
  /(?:s?NDA|s?BLA)\s+(?:for\s+)?([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/g,
  // "drugname (BRANDNAME)"
  /([a-z]+(?:mab|nib|tinib|ciclib|rafenib|lisib|zumab|ximab|lumab|tuzumab|vezumab|limumab|cillin|mycin|avir|parin|statin|prazole|tidine|sartan|dipine|olol|lol|pril|floxacin|cycline|sporin|fentanil|codone|morphone|zepam|zolam|barbital|ridone|apine|etine|amine|pramine|triptyline|oxetine|traline|opram|italopram|afil|denafil))/gi,
  // Generic patterns for drug candidates
  /([A-Z]{2,4}-\d{3,5})/g  // e.g., ET-600, RGX-121
];

// Patterns to extract submission type
const SUBMISSION_PATTERNS = [
  { pattern: /\bsBLA\b/i, type: 'sBLA' },
  { pattern: /\bsNDA\b/i, type: 'sNDA' },
  { pattern: /\bBLA\b/i, type: 'BLA' },
  { pattern: /\bNDA\b/i, type: 'NDA' }
];

/**
 * Make an HTTPS request and return the response body
 */
function fetchUrl(url, options = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const reqOptions = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        ...options.headers
      },
      timeout: 30000
    };

    const req = https.request(reqOptions, (res) => {
      // Handle redirects
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const redirectUrl = res.headers.location.startsWith('http')
          ? res.headers.location
          : `https://${urlObj.hostname}${res.headers.location}`;
        return resolve(fetchUrl(redirectUrl, options));
      }

      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ statusCode: res.statusCode, body: data }));
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    req.end();
  });
}

/**
 * Search GlobeNewswire for PDUFA-related press releases
 */
async function searchGlobeNewswire(searchTerm, options = {}) {
  const { verbose = false, maxResults = 50 } = options;

  const url = `https://www.globenewswire.com/search/keyword/${encodeURIComponent(searchTerm)}?pageSize=${maxResults}`;

  if (verbose) console.log(`  Searching: ${searchTerm}...`);

  try {
    const { body } = await fetchUrl(url);

    // Extract press release links and metadata from search results
    const releases = [];

    // Pattern to match news release entries
    const releasePattern = /href="(\/news-release\/\d{4}\/\d{2}\/\d{2}\/[^"]+)"[^>]*>([^<]+)/g;
    let match;

    while ((match = releasePattern.exec(body)) !== null) {
      const [, path, title] = match;
      if (title.toLowerCase().includes('pdufa') ||
          title.toLowerCase().includes('fda accepts') ||
          title.toLowerCase().includes('fda acceptance') ||
          title.toLowerCase().includes('target date')) {
        releases.push({
          url: `https://www.globenewswire.com${path}`,
          title: title.trim()
        });
      }
    }

    if (verbose) console.log(`    Found ${releases.length} relevant releases`);
    return releases;

  } catch (error) {
    if (verbose) console.log(`    Error searching: ${error.message}`);
    return [];
  }
}

/**
 * Parse a press release page to extract PDUFA details
 */
async function parseRelease(releaseUrl, options = {}) {
  const { verbose = false } = options;

  try {
    const { body } = await fetchUrl(releaseUrl);

    // Extract the press release text
    const textContent = body
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#\d+;/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    // Try to extract PDUFA date
    let pdufaDate = null;
    for (const pattern of PDUFA_DATE_PATTERNS) {
      pattern.lastIndex = 0;
      const match = pattern.exec(textContent);
      if (match && match[1]) {
        pdufaDate = parseDate(match[1]);
        if (pdufaDate) break;
      }
    }

    if (!pdufaDate) return null;

    // Extract title first - it often contains the best info
    const titleMatch = body.match(/<title>([^<]+)<\/title>/i);
    const title = titleMatch ? titleMatch[1].replace(/\s*\|.*$/, '').trim() : '';

    // Extract company name - try multiple approaches
    let company = null;

    // 1. Look for company name in the title (e.g., "Arcutis Biotherapeutics Announces...")
    const titleCompanyMatch = title.match(/^([A-Z][a-zA-Z\s&,]+(?:Inc\.?|Corp\.?|Ltd\.?|LLC|Therapeutics|Pharmaceuticals|Pharma|Biotech|Sciences|Bio)?)/);
    if (titleCompanyMatch && titleCompanyMatch[1].length > 3 && titleCompanyMatch[1].length < 50) {
      company = titleCompanyMatch[1].replace(/\s+(Announces|Reports|Receives|Provides).*$/i, '').trim();
    }

    // 2. Look for "CITY, State (GLOBE NEWSWIRE) -- Company Name" pattern
    if (!company || company.length < 3) {
      const cityLineMatch = textContent.match(/[A-Z]{2,},?\s+[A-Z][a-z]+\.?\s+\d{1,2},?\s+\d{4}\s+\(GLOBE\s*NEWSWIRE\)\s*[-–—]\s*([A-Z][a-zA-Z\s&,\.]+?)(?:\s+(?:announced|today|has|received|,))/i);
      if (cityLineMatch) {
        company = cityLineMatch[1].trim();
      }
    }

    // 3. Look for company in source span
    if (!company || company.length < 3) {
      const sourceMatch = body.match(/class="[^"]*article-source[^"]*"[^>]*>([^<]+)/i);
      if (sourceMatch && !sourceMatch[1].includes('GlobeNewswire')) {
        company = sourceMatch[1].trim();
      }
    }

    // 4. Extract from URL path if contains company ticker
    if (!company || company.length < 3) {
      const urlMatch = releaseUrl.match(/\/([A-Z]{2,5})[-\/]/);
      if (urlMatch) company = urlMatch[1];
    }

    if (!company || company === 'GlobeNewswire News Room' || company.length < 3) {
      company = 'Unknown';
    }

    // Extract drug name - try multiple approaches
    let drugName = null;
    let brandName = null;

    // 1. Look for drug name pattern in title: "DRUGNAME®" or "DRUGNAME (generic)"
    const titleDrugMatch = title.match(/([A-Z][A-Z0-9-]+(?:®|™)?)\s*(?:\(([a-z][a-z\s-]+)\))?/);
    if (titleDrugMatch) {
      brandName = titleDrugMatch[1].replace(/[®™]/g, '');
      drugName = titleDrugMatch[2] || brandName;
    }

    // 2. Look for "NDA/BLA for DRUG" pattern
    if (!drugName) {
      const ndaMatch = textContent.match(/(?:s?NDA|s?BLA)\s+(?:for\s+)?(?:its\s+)?([A-Z][A-Za-z0-9-]+(?:®|™)?)/);
      if (ndaMatch) {
        drugName = ndaMatch[1].replace(/[®™]/g, '');
      }
    }

    // 3. Look for code names (XX-123, XXX-1234)
    if (!drugName) {
      const codeMatch = textContent.match(/\b([A-Z]{2,4}-\d{2,5})\b/);
      if (codeMatch) drugName = codeMatch[1];
    }

    // 4. Look for generic drug names (ending in -mab, -nib, etc.)
    if (!drugName) {
      const genericMatch = textContent.match(/\b([a-z]{4,}(?:mab|nib|tinib|rafenib|lisib|cillin|mycin|vir|parin|sartan|pril|afil))\b/i);
      if (genericMatch) drugName = genericMatch[1].toLowerCase();
    }

    if (!drugName || drugName.length < 2) drugName = 'Unknown';

    // Extract submission type
    let submissionType = 'NDA';
    for (const { pattern, type } of SUBMISSION_PATTERNS) {
      if (pattern.test(textContent)) {
        submissionType = type;
        break;
      }
    }

    // Extract indication (look for "for the treatment of" or similar)
    let indication = null;
    const indicationPatterns = [
      /for\s+(?:the\s+)?treatment\s+of\s+(?:patients\s+with\s+)?([^,.]+)/i,
      /to\s+treat\s+([^,.]+)/i,
      /for\s+(?:adult\s+)?patients\s+with\s+([^,.]+)/i,
      /in\s+(?:adult\s+)?patients\s+with\s+([^,.]+)/i,
      /indicated\s+for\s+([^,.]+)/i
    ];

    for (const pattern of indicationPatterns) {
      const match = textContent.match(pattern);
      if (match && match[1]) {
        indication = match[1].trim().substring(0, 100);
        break;
      }
    }

    return {
      drug: drugName,
      brandName: brandName !== drugName ? brandName : null,
      company: company,
      indication: indication,
      pdufaDate: pdufaDate,
      submissionType: submissionType,
      sourceUrl: releaseUrl,
      scrapedAt: new Date().toISOString()
    };

  } catch (error) {
    if (verbose) console.log(`    Error parsing ${releaseUrl}: ${error.message}`);
    return null;
  }
}

/**
 * Parse a date string into ISO format
 */
function parseDate(dateStr) {
  if (!dateStr) return null;

  // Clean up the string
  const cleaned = dateStr.replace(/,/g, '').trim();

  // Try to parse with Date
  const parsed = new Date(cleaned);
  if (!isNaN(parsed.getTime())) {
    return parsed.toISOString().split('T')[0];
  }

  // Try manual parsing for "Month DD YYYY" format
  const match = cleaned.match(/(\w+)\s+(\d{1,2})\s+(\d{4})/);
  if (match) {
    const [, month, day, year] = match;
    const months = {
      'january': '01', 'february': '02', 'march': '03', 'april': '04',
      'may': '05', 'june': '06', 'july': '07', 'august': '08',
      'september': '09', 'october': '10', 'november': '11', 'december': '12'
    };
    const monthNum = months[month.toLowerCase()];
    if (monthNum) {
      return `${year}-${monthNum}-${day.padStart(2, '0')}`;
    }
  }

  return null;
}

/**
 * Main scraping function
 */
async function scrapePDUFADates(options = {}) {
  const { verbose = false, maxPerTerm = 20 } = options;

  console.log('Scraping GlobeNewswire for PDUFA announcements...\n');

  const allReleases = new Map(); // Use URL as key to dedupe

  // Search for each term
  for (const term of SEARCH_TERMS) {
    const releases = await searchGlobeNewswire(term, { verbose, maxResults: maxPerTerm });
    for (const r of releases) {
      if (!allReleases.has(r.url)) {
        allReleases.set(r.url, r);
      }
    }
    // Rate limiting
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  console.log(`\nFound ${allReleases.size} unique press releases to analyze...\n`);

  // Parse each release
  const catalysts = [];
  let processed = 0;

  for (const [url, release] of allReleases) {
    processed++;
    if (verbose) console.log(`[${processed}/${allReleases.size}] Parsing: ${release.title.substring(0, 60)}...`);

    const catalyst = await parseRelease(url, { verbose });
    if (catalyst && catalyst.pdufaDate) {
      // Only include future dates
      const pdufaDateObj = new Date(catalyst.pdufaDate);
      if (pdufaDateObj >= new Date()) {
        catalysts.push(catalyst);
        if (verbose) {
          console.log(`    ✓ Found: ${catalyst.drug} - ${catalyst.pdufaDate} (${catalyst.company})`);
        }
      }
    }

    // Rate limiting
    await new Promise(resolve => setTimeout(resolve, 300));
  }

  // Sort by PDUFA date
  catalysts.sort((a, b) => new Date(a.pdufaDate) - new Date(b.pdufaDate));

  // Cache results
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  fs.writeFileSync(SCRAPED_CACHE_FILE, JSON.stringify(catalysts, null, 2));

  return catalysts;
}

/**
 * Compare scraped catalysts with curated list to find new ones
 */
function findNewCatalysts(scraped, curated) {
  const curatedDates = new Set(
    curated.map(c => `${c.company?.toLowerCase()}-${c.pdufaDate}`)
  );

  return scraped.filter(s => {
    const key = `${s.company?.toLowerCase()}-${s.pdufaDate}`;
    return !curatedDates.has(key);
  });
}

/**
 * Display results in a formatted table
 */
function displayResults(catalysts, title) {
  console.log(`\n${'═'.repeat(80)}`);
  console.log(title);
  console.log('═'.repeat(80));

  if (catalysts.length === 0) {
    console.log('No catalysts found.\n');
    return;
  }

  console.log(`\n${'Drug'.padEnd(25)} ${'Date'.padEnd(12)} ${'Type'.padEnd(6)} ${'Company'.padEnd(30)}`);
  console.log('─'.repeat(80));

  for (const c of catalysts) {
    const drug = (c.drug || 'Unknown').substring(0, 24).padEnd(25);
    const date = (c.pdufaDate || 'TBD').padEnd(12);
    const type = (c.submissionType || 'NDA').padEnd(6);
    const company = (c.company || 'Unknown').substring(0, 29).padEnd(30);
    console.log(`${drug} ${date} ${type} ${company}`);
  }

  console.log(`\nTotal: ${catalysts.length} catalysts\n`);
}

// CLI
if (require.main === module) {
  const args = process.argv.slice(2);
  const verbose = args.includes('--verbose') || args.includes('-v');
  const update = args.includes('--update') || args.includes('-u');

  scrapePDUFADates({ verbose })
    .then(scraped => {
      displayResults(scraped, 'Scraped PDUFA Dates from GlobeNewswire');

      // Load curated list for comparison
      try {
        const { CURATED_CATALYSTS } = require('./pdufa-catalysts');
        const newCatalysts = findNewCatalysts(scraped, CURATED_CATALYSTS);

        if (newCatalysts.length > 0) {
          displayResults(newCatalysts, 'NEW Catalysts (not in curated list)');

          console.log('To add these to the curated list, copy the following:\n');
          for (const c of newCatalysts) {
            console.log(`  {
    drug: '${c.drug}',
    brandName: null,
    company: '${c.company}',
    indication: '${c.indication || 'TBD'}',
    pdufaDate: '${c.pdufaDate}',
    submissionType: '${c.submissionType}',
    status: 'Pending',
    notes: 'Scraped from GlobeNewswire'
  },`);
          }
        } else {
          console.log('✓ All scraped catalysts are already in the curated list.\n');
        }
      } catch (e) {
        console.log('Could not compare with curated list:', e.message);
      }
    })
    .catch(err => {
      console.error('Scraping failed:', err);
      process.exit(1);
    });
}

module.exports = {
  scrapePDUFADates,
  searchGlobeNewswire,
  parseRelease,
  findNewCatalysts
};
