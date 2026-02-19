/**
 * FDA Catalyst Scraper
 *
 * Scrapes GlobeNewswire for:
 * 1. FDA acceptance press releases with PDUFA dates
 * 2. NDA/BLA submissions awaiting FDA acceptance (60-day review)
 * 3. FDA approvals (to mark catalysts as approved)
 *
 * Usage:
 *   node scrape-pdufa.js              # Scrape and display results
 *   node scrape-pdufa.js --verbose    # Show detailed progress
 *   node scrape-pdufa.js --update     # Auto-update pdufa-catalysts.js
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const SCRAPED_CACHE_FILE = path.join(DATA_DIR, 'scraped-pdufa.json');
const APPROVALS_CACHE_FILE = path.join(DATA_DIR, 'scraped-approvals.json');
const SUBMISSIONS_CACHE_FILE = path.join(DATA_DIR, 'scraped-submissions.json');

// Search terms for different event types
const SEARCH_TERMS = {
  pdufa: [
    'PDUFA+date',
    'FDA+accepts+NDA',
    'FDA+accepts+BLA',
    'FDA+acceptance+NDA',
    'FDA+acceptance+BLA',
    'target+action+date+FDA'
  ],
  submissions: [
    'submits+NDA+FDA',
    'submits+BLA+FDA',
    'NDA+submission+FDA',
    'BLA+submission+FDA',
    'submitted+NDA',
    'submitted+BLA',
    'files+NDA',
    'files+BLA'
  ],
  approvals: [
    'FDA+approves',
    'FDA+approval',
    'receives+FDA+approval',
    'granted+FDA+approval'
  ]
};

// Patterns to extract PDUFA dates
const PDUFA_DATE_PATTERNS = [
  /PDUFA\s+(?:target\s+)?(?:action\s+)?date\s+(?:of\s+|is\s+|set\s+for\s+)?(\w+\s+\d{1,2},?\s+\d{4})/gi,
  /PDUFA\s+goal\s+date\s+(?:of\s+)?(\w+\s+\d{1,2},?\s+\d{4})/gi,
  /target\s+(?:action\s+)?date\s+(?:of\s+|is\s+)?(\w+\s+\d{1,2},?\s+\d{4})/gi,
  /action\s+date\s+under\s+PDUFA\s+is\s+(\w+\s+\d{1,2},?\s+\d{4})/gi,
  /(?:FDA\s+)?decision\s+(?:expected\s+)?by\s+(\w+\s+\d{1,2},?\s+\d{4})/gi
];

// Patterns for submissions
const SUBMISSION_PATTERNS = [
  { pattern: /\bsBLA\b/i, type: 'sBLA' },
  { pattern: /\bsNDA\b/i, type: 'sNDA' },
  { pattern: /\bBLA\b/i, type: 'BLA' },
  { pattern: /\bNDA\b/i, type: 'NDA' }
];

// Patterns for approval detection
const APPROVAL_PATTERNS = [
  /FDA\s+(?:has\s+)?approv(?:ed|es|al)/i,
  /receiv(?:ed|es)\s+(?:FDA\s+)?approval/i,
  /grant(?:ed|s)\s+(?:FDA\s+)?approval/i,
  /approv(?:ed|al)\s+by\s+(?:the\s+)?FDA/i,
  /U\.?S\.?\s+Food\s+and\s+Drug\s+Administration.*approv/i
];

// Patterns for submission detection (not yet accepted)
const SUBMITTED_PATTERNS = [
  /submit(?:ted|s)\s+(?:a\s+|an\s+|its\s+)?(?:new\s+drug\s+application|biologics?\s+license\s+application|s?NDA|s?BLA)/i,
  /(?:NDA|BLA|sNDA|sBLA)\s+(?:has\s+been\s+)?submit(?:ted|s)/i,
  /fil(?:ed|es|ing)\s+(?:a\s+|an\s+|its\s+)?(?:s?NDA|s?BLA)/i,
  /announc(?:ed|es)\s+(?:the\s+)?submission\s+of/i
];

/**
 * Make an HTTPS request
 */
function fetchUrl(url, options = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const reqOptions = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        ...options.headers
      },
      timeout: 30000
    };

    const req = https.request(reqOptions, (res) => {
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
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
    req.end();
  });
}

/**
 * Search GlobeNewswire
 */
async function searchGlobeNewswire(searchTerm, eventType, options = {}) {
  const { verbose = false, maxResults = 50 } = options;
  const url = `https://www.globenewswire.com/search/keyword/${encodeURIComponent(searchTerm)}?pageSize=${maxResults}`;

  if (verbose) console.log(`  Searching: ${searchTerm}...`);

  try {
    const { body } = await fetchUrl(url);
    const releases = [];
    const releasePattern = /href="(\/news-release\/\d{4}\/\d{2}\/\d{2}\/[^"]+)"[^>]*>([^<]+)/g;
    let match;

    while ((match = releasePattern.exec(body)) !== null) {
      const [, path, title] = match;
      const titleLower = title.toLowerCase();

      let relevant = false;
      if (eventType === 'pdufa') {
        relevant = titleLower.includes('pdufa') ||
                   titleLower.includes('fda accepts') ||
                   titleLower.includes('fda acceptance') ||
                   titleLower.includes('target date');
      } else if (eventType === 'submissions') {
        relevant = (titleLower.includes('submit') || titleLower.includes('files') || titleLower.includes('filing')) &&
                   (titleLower.includes('nda') || titleLower.includes('bla') || titleLower.includes('fda'));
      } else if (eventType === 'approvals') {
        relevant = titleLower.includes('fda') &&
                   (titleLower.includes('approv') || titleLower.includes('grants'));
      }

      if (relevant) {
        releases.push({
          url: `https://www.globenewswire.com${path}`,
          title: title.trim(),
          eventType
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
 * Extract text content from HTML
 */
function extractText(body) {
  return body
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#\d+;/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Extract company name from press release
 */
function extractCompany(body, title, textContent) {
  const skipWords = ['FDA', 'US', 'USA', 'The'];

  // 1. Try title - company name usually starts the headline
  const titleMatch = title.match(/^([A-Z][a-zA-Z\s&,\.]+?)(?:\s+(?:Announces|Reports|Receives|Provides|Submits|Files|to\s|and\s|Granted|Gets))/i);
  if (titleMatch && titleMatch[1].length > 3 && titleMatch[1].length < 60) {
    const company = titleMatch[1].trim();
    if (!skipWords.includes(company.toUpperCase()) && company.length > 3) {
      return company;
    }
  }

  // 2. Try CITY, Date (GLOBE NEWSWIRE) -- Company pattern
  if (textContent) {
    const cityMatch = textContent.match(/[A-Z]{2,},?\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4}\s+\(GLOBE\s*NEWSWIRE\)\s*[-–—]+\s*([A-Z][a-zA-Z\s&,\.]+?)(?:\s+(?:announced|today|has|received|\(|,))/i;
    if (cityMatch && cityMatch[1].length > 3) {
      return cityMatch[1].trim();
    }
  }

  // 3. Try article source span
  const sourceMatch = body.match(/class="[^"]*(?:article-source|pagenav-vertical-menu__organization-link)[^"]*"[^>]*>([^<]+)/i);
  if (sourceMatch && !sourceMatch[1].includes('GlobeNewswire') && sourceMatch[1].length > 3) {
    return sourceMatch[1].trim();
  }

  // 4. Try og:site_name meta tag
  const metaMatch = body.match(/<meta[^>]+property="og:site_name"[^>]+content="([^"]+)"/i);
  if (metaMatch && !metaMatch[1].includes('GlobeNewswire') && metaMatch[1].length > 3) {
    return metaMatch[1].trim();
  }

  return 'Unknown';
}

/**
 * Extract drug name from press release
 */
function extractDrug(textContent, title) {
  let drugName = null;
  let brandName = null;

  // Skip common false positives
  const skipWords = ['FDA', 'NDA', 'BLA', 'PDUFA', 'US', 'USA', 'INC', 'LLC', 'CORP', 'THE', 'FOR', 'AND', 'NEW'];

  // 1. Look for brand name pattern: BRANDNAME® (generic) or BRANDNAME (generic)
  const brandGenericMatch = title.match(/([A-Z][A-Za-z]+(?:®|™)?)\s*\(([a-z][a-z\-\s]+)\)/);
  if (brandGenericMatch) {
    brandName = brandGenericMatch[1].replace(/[®™]/g, '');
    drugName = brandGenericMatch[2].trim();
    if (!skipWords.includes(brandName.toUpperCase())) {
      return { drugName, brandName };
    }
  }

  // 2. Look for "NDA/BLA for DRUGNAME" in text
  const ndaForMatch = textContent.match(/(?:s?NDA|s?BLA)\s+(?:for\s+)(?:its\s+)?([A-Z][a-z]+[a-z0-9\-]*)/);
  if (ndaForMatch && !skipWords.includes(ndaForMatch[1].toUpperCase())) {
    drugName = ndaForMatch[1];
  }

  // 3. Look for code names (XX-123, XXX-1234)
  if (!drugName) {
    const codeMatch = textContent.match(/\b([A-Z]{2,4}-\d{2,5})\b/);
    if (codeMatch) drugName = codeMatch[1];
  }

  // 4. Look for generic drug names (ending in -mab, -nib, etc.)
  if (!drugName) {
    const genericMatch = textContent.match(/\b([a-z]{4,}(?:mab|nib|tinib|rafenib|lisib|cillin|mycin|vir|parin|sartan|pril|afil|glumide|gliptin|tide|acetam|vastatin|erone|olone|asone|etine|oxetine|azole|tadine|zumab|ximab))\b/i);
    if (genericMatch) drugName = genericMatch[1].toLowerCase();
  }

  // 5. Look for capitalized product name after company announces
  if (!drugName) {
    const announcesMatch = textContent.match(/(?:announces|received|granted).{0,30}?([A-Z][a-z]+[a-z0-9\-]+)(?:®|™)?/i);
    if (announcesMatch && !skipWords.includes(announcesMatch[1].toUpperCase()) && announcesMatch[1].length > 3) {
      drugName = announcesMatch[1];
    }
  }

  // 6. Look for "approval of DRUGNAME" or "approves DRUGNAME"
  if (!drugName) {
    const approvalOfMatch = textContent.match(/approv(?:al\s+of|es)\s+([A-Z][a-z]+[a-z0-9\-]*)/i);
    if (approvalOfMatch && !skipWords.includes(approvalOfMatch[1].toUpperCase())) {
      drugName = approvalOfMatch[1];
    }
  }

  return { drugName: drugName || 'Unknown', brandName: brandName !== drugName ? brandName : null };
}

/**
 * Extract indication from text
 */
function extractIndication(textContent) {
  const patterns = [
    /for\s+(?:the\s+)?treatment\s+of\s+(?:patients\s+with\s+)?([^,.]+)/i,
    /to\s+treat\s+([^,.]+)/i,
    /for\s+(?:adult\s+)?patients\s+with\s+([^,.]+)/i,
    /in\s+(?:adult\s+)?patients\s+with\s+([^,.]+)/i,
    /indicated\s+for\s+([^,.]+)/i
  ];

  for (const pattern of patterns) {
    const match = textContent.match(pattern);
    if (match && match[1]) {
      return match[1].trim().substring(0, 100);
    }
  }
  return null;
}

/**
 * Extract submission type
 */
function extractSubmissionType(textContent) {
  for (const { pattern, type } of SUBMISSION_PATTERNS) {
    if (pattern.test(textContent)) return type;
  }
  return 'NDA';
}

/**
 * Parse date string to ISO format
 */
function parseDate(dateStr) {
  if (!dateStr) return null;
  const cleaned = dateStr.replace(/,/g, '').trim();

  const parsed = new Date(cleaned + ' 12:00:00');
  if (!isNaN(parsed.getTime())) {
    return parsed.toISOString().split('T')[0];
  }

  const match = cleaned.match(/(\w+)\s+(\d{1,2})\s+(\d{4})/);
  if (match) {
    const months = {
      'january': '01', 'february': '02', 'march': '03', 'april': '04',
      'may': '05', 'june': '06', 'july': '07', 'august': '08',
      'september': '09', 'october': '10', 'november': '11', 'december': '12'
    };
    const monthNum = months[match[1].toLowerCase()];
    if (monthNum) return `${match[3]}-${monthNum}-${match[2].padStart(2, '0')}`;
  }
  return null;
}

/**
 * Extract release date from URL or content
 */
function extractReleaseDate(releaseUrl, body) {
  // Try URL pattern: /news-release/2026/02/15/...
  const urlMatch = releaseUrl.match(/\/news-release\/(\d{4})\/(\d{2})\/(\d{2})\//);
  if (urlMatch) {
    return `${urlMatch[1]}-${urlMatch[2]}-${urlMatch[3]}`;
  }
  return new Date().toISOString().split('T')[0];
}

/**
 * Parse a PDUFA acceptance press release
 */
async function parsePDUFARelease(releaseUrl, options = {}) {
  const { verbose = false } = options;

  try {
    const { body } = await fetchUrl(releaseUrl);
    const textContent = extractText(body);
    const titleMatch = body.match(/<title>([^<]+)<\/title>/i);
    const title = titleMatch ? titleMatch[1].replace(/\s*\|.*$/, '').trim() : '';

    // Extract PDUFA date
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

    const company = extractCompany(body, title, textContent);
    const { drugName, brandName } = extractDrug(textContent, title);

    return {
      drug: drugName,
      brandName,
      company,
      indication: extractIndication(textContent),
      pdufaDate,
      submissionType: extractSubmissionType(textContent),
      status: 'Pending',
      sourceUrl: releaseUrl,
      scrapedAt: new Date().toISOString()
    };
  } catch (error) {
    if (verbose) console.log(`    Error parsing PDUFA release: ${error.message}`);
    return null;
  }
}

/**
 * Parse a submission press release (awaiting FDA acceptance)
 */
async function parseSubmissionRelease(releaseUrl, options = {}) {
  const { verbose = false } = options;

  try {
    const { body } = await fetchUrl(releaseUrl);
    const textContent = extractText(body);
    const titleMatch = body.match(/<title>([^<]+)<\/title>/i);
    const title = titleMatch ? titleMatch[1].replace(/\s*\|.*$/, '').trim() : '';

    // Check if this is actually a submission (not an acceptance or approval)
    const isSubmission = SUBMITTED_PATTERNS.some(p => p.test(textContent));
    const isAcceptance = /FDA\s+accept/i.test(textContent) || /PDUFA/i.test(textContent);
    const isApproval = APPROVAL_PATTERNS.some(p => p.test(textContent));

    if (!isSubmission || isAcceptance || isApproval) return null;

    const company = extractCompany(body, title, textContent);
    const { drugName, brandName } = extractDrug(textContent, title);
    const submissionDate = extractReleaseDate(releaseUrl, body);

    // Calculate expected PDUFA assignment (FDA has 60 days to accept/refuse)
    const subDate = new Date(submissionDate + 'T12:00:00');
    const expectedAcceptance = new Date(subDate.getTime() + 60 * 24 * 60 * 60 * 1000);

    return {
      drug: drugName,
      brandName,
      company,
      indication: extractIndication(textContent),
      submissionDate,
      expectedAcceptanceBy: expectedAcceptance.toISOString().split('T')[0],
      submissionType: extractSubmissionType(textContent),
      status: 'Submitted - Awaiting FDA Review',
      sourceUrl: releaseUrl,
      scrapedAt: new Date().toISOString()
    };
  } catch (error) {
    if (verbose) console.log(`    Error parsing submission: ${error.message}`);
    return null;
  }
}

/**
 * Parse an approval press release
 */
async function parseApprovalRelease(releaseUrl, options = {}) {
  const { verbose = false } = options;

  try {
    const { body } = await fetchUrl(releaseUrl);
    const textContent = extractText(body);
    const titleMatch = body.match(/<title>([^<]+)<\/title>/i);
    const title = titleMatch ? titleMatch[1].replace(/\s*\|.*$/, '').trim() : '';

    // Verify this is actually an approval
    const isApproval = APPROVAL_PATTERNS.some(p => p.test(textContent));
    if (!isApproval) return null;

    const company = extractCompany(body, title, textContent);
    const { drugName, brandName } = extractDrug(textContent, title);
    const approvalDate = extractReleaseDate(releaseUrl, body);

    return {
      drug: drugName,
      brandName,
      company,
      indication: extractIndication(textContent),
      approvalDate,
      submissionType: extractSubmissionType(textContent),
      status: 'Approved',
      sourceUrl: releaseUrl,
      scrapedAt: new Date().toISOString()
    };
  } catch (error) {
    if (verbose) console.log(`    Error parsing approval: ${error.message}`);
    return null;
  }
}

/**
 * Main scraping function
 */
async function scrapeAll(options = {}) {
  const { verbose = false, maxPerTerm = 30 } = options;

  console.log('Scraping GlobeNewswire for FDA catalysts...\n');

  const results = {
    pdufa: [],
    submissions: [],
    approvals: []
  };

  // Scrape each category
  for (const [eventType, terms] of Object.entries(SEARCH_TERMS)) {
    console.log(`\n${eventType.toUpperCase()}:`);
    console.log('─'.repeat(40));

    const allReleases = new Map();

    for (const term of terms) {
      const releases = await searchGlobeNewswire(term, eventType, { verbose, maxResults: maxPerTerm });
      for (const r of releases) {
        if (!allReleases.has(r.url)) allReleases.set(r.url, r);
      }
      await new Promise(resolve => setTimeout(resolve, 400));
    }

    console.log(`  Found ${allReleases.size} unique releases to analyze`);

    let processed = 0;
    for (const [url, release] of allReleases) {
      processed++;
      if (verbose) console.log(`  [${processed}/${allReleases.size}] ${release.title.substring(0, 50)}...`);

      let result = null;
      if (eventType === 'pdufa') {
        result = await parsePDUFARelease(url, { verbose });
        if (result && new Date(result.pdufaDate + 'T12:00:00') >= new Date()) {
          results.pdufa.push(result);
          if (verbose) console.log(`    ✓ PDUFA: ${result.drug} - ${result.pdufaDate}`);
        }
      } else if (eventType === 'submissions') {
        result = await parseSubmissionRelease(url, { verbose });
        if (result) {
          results.submissions.push(result);
          if (verbose) console.log(`    ✓ Submission: ${result.drug} - ${result.submissionDate}`);
        }
      } else if (eventType === 'approvals') {
        result = await parseApprovalRelease(url, { verbose });
        if (result) {
          results.approvals.push(result);
          if (verbose) console.log(`    ✓ Approved: ${result.drug} - ${result.approvalDate}`);
        }
      }

      await new Promise(resolve => setTimeout(resolve, 250));
    }
  }

  // Sort results
  results.pdufa.sort((a, b) => new Date(a.pdufaDate) - new Date(b.pdufaDate));
  results.submissions.sort((a, b) => new Date(b.submissionDate) - new Date(a.submissionDate));
  results.approvals.sort((a, b) => new Date(b.approvalDate) - new Date(a.approvalDate));

  // Cache results
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(SCRAPED_CACHE_FILE, JSON.stringify(results.pdufa, null, 2));
  fs.writeFileSync(SUBMISSIONS_CACHE_FILE, JSON.stringify(results.submissions, null, 2));
  fs.writeFileSync(APPROVALS_CACHE_FILE, JSON.stringify(results.approvals, null, 2));

  return results;
}

/**
 * Compare with curated list and find updates needed
 */
function analyzeUpdates(scraped, curated) {
  const updates = {
    newPDUFA: [],
    newSubmissions: [],
    toMarkApproved: []
  };

  // Find new PDUFA dates not in curated list
  const curatedDrugs = new Set(curated.map(c => c.drug?.toLowerCase()));

  for (const p of scraped.pdufa) {
    if (!curatedDrugs.has(p.drug?.toLowerCase())) {
      updates.newPDUFA.push(p);
    }
  }

  // Submissions not yet in curated list
  for (const s of scraped.submissions) {
    if (!curatedDrugs.has(s.drug?.toLowerCase())) {
      updates.newSubmissions.push(s);
    }
  }

  // Find drugs that have been approved
  const approvedDrugs = new Set(scraped.approvals.map(a => a.drug?.toLowerCase()));

  for (const c of curated) {
    if (c.status === 'Pending' && approvedDrugs.has(c.drug?.toLowerCase())) {
      const approval = scraped.approvals.find(a => a.drug?.toLowerCase() === c.drug?.toLowerCase());
      updates.toMarkApproved.push({
        ...c,
        approvalDate: approval?.approvalDate,
        approvalSource: approval?.sourceUrl
      });
    }
  }

  return updates;
}

/**
 * Display results
 */
function displayResults(results) {
  console.log(`\n${'═'.repeat(80)}`);
  console.log('SCRAPING RESULTS');
  console.log('═'.repeat(80));

  // PDUFA dates
  console.log(`\n📅 PDUFA DATES (${results.pdufa.length} found)`);
  console.log('─'.repeat(60));
  if (results.pdufa.length > 0) {
    console.log(`${'Drug'.padEnd(25)} ${'PDUFA Date'.padEnd(12)} ${'Company'.padEnd(25)}`);
    for (const p of results.pdufa.slice(0, 15)) {
      console.log(`${(p.drug || '?').substring(0, 24).padEnd(25)} ${p.pdufaDate.padEnd(12)} ${(p.company || '?').substring(0, 24)}`);
    }
    if (results.pdufa.length > 15) console.log(`  ... and ${results.pdufa.length - 15} more`);
  }

  // Submissions
  console.log(`\n📝 PENDING SUBMISSIONS (${results.submissions.length} found)`);
  console.log('─'.repeat(60));
  if (results.submissions.length > 0) {
    console.log(`${'Drug'.padEnd(25)} ${'Submitted'.padEnd(12)} ${'Accept By'.padEnd(12)} ${'Company'.padEnd(20)}`);
    for (const s of results.submissions.slice(0, 10)) {
      console.log(`${(s.drug || '?').substring(0, 24).padEnd(25)} ${s.submissionDate.padEnd(12)} ${s.expectedAcceptanceBy.padEnd(12)} ${(s.company || '?').substring(0, 19)}`);
    }
    if (results.submissions.length > 10) console.log(`  ... and ${results.submissions.length - 10} more`);
  }

  // Approvals
  console.log(`\n✅ RECENT APPROVALS (${results.approvals.length} found)`);
  console.log('─'.repeat(60));
  if (results.approvals.length > 0) {
    console.log(`${'Drug'.padEnd(25)} ${'Approved'.padEnd(12)} ${'Company'.padEnd(25)}`);
    for (const a of results.approvals.slice(0, 10)) {
      console.log(`${(a.drug || '?').substring(0, 24).padEnd(25)} ${a.approvalDate.padEnd(12)} ${(a.company || '?').substring(0, 24)}`);
    }
    if (results.approvals.length > 10) console.log(`  ... and ${results.approvals.length - 10} more`);
  }
}

// CLI
if (require.main === module) {
  const args = process.argv.slice(2);
  const verbose = args.includes('--verbose') || args.includes('-v');
  const update = args.includes('--update') || args.includes('-u');

  scrapeAll({ verbose })
    .then(results => {
      displayResults(results);

      // Compare with curated list
      try {
        const { CURATED_CATALYSTS } = require('./pdufa-catalysts');
        const updates = analyzeUpdates(results, CURATED_CATALYSTS);

        console.log(`\n${'═'.repeat(80)}`);
        console.log('RECOMMENDED UPDATES');
        console.log('═'.repeat(80));

        if (updates.newPDUFA.length > 0) {
          console.log(`\n🆕 NEW PDUFA DATES TO ADD (${updates.newPDUFA.length}):`);
          for (const p of updates.newPDUFA) {
            console.log(`\n  {
    drug: '${p.drug}',
    brandName: ${p.brandName ? `'${p.brandName}'` : 'null'},
    company: '${p.company}',
    indication: '${p.indication || 'TBD'}',
    pdufaDate: '${p.pdufaDate}',
    submissionType: '${p.submissionType}',
    status: 'Pending',
    notes: 'Scraped from GlobeNewswire'
  },`);
          }
        }

        if (updates.newSubmissions.length > 0) {
          console.log(`\n📝 PENDING SUBMISSIONS (awaiting PDUFA) (${updates.newSubmissions.length}):`);
          for (const s of updates.newSubmissions) {
            console.log(`  - ${s.drug} (${s.company}) - Submitted ${s.submissionDate}, expect FDA response by ${s.expectedAcceptanceBy}`);
          }
        }

        if (updates.toMarkApproved.length > 0) {
          console.log(`\n✅ MARK AS APPROVED (${updates.toMarkApproved.length}):`);
          for (const a of updates.toMarkApproved) {
            console.log(`  - ${a.drug} (${a.company}) - Approved ${a.approvalDate || 'recently'}`);
          }
        }

        if (updates.newPDUFA.length === 0 && updates.newSubmissions.length === 0 && updates.toMarkApproved.length === 0) {
          console.log('\n✓ Curated list is up to date!\n');
        }

      } catch (e) {
        console.log('\nCould not compare with curated list:', e.message);
      }
    })
    .catch(err => {
      console.error('Scraping failed:', err);
      process.exit(1);
    });
}

module.exports = {
  scrapeAll,
  analyzeUpdates,
  parsePDUFARelease,
  parseSubmissionRelease,
  parseApprovalRelease
};
