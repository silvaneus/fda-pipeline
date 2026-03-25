/**
 * RTTNews FDA Calendar Scraper
 *
 * Scrapes all pages of the RTTNews FDA PDUFA calendar to get upcoming
 * FDA decision dates. This is the primary automated source — more
 * comprehensive than wire service scraping for near-term catalysts.
 *
 * Usage:
 *   node scrape-rttnews.js              # Scrape and save
 *   node scrape-rttnews.js --verbose    # Show detailed progress
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const OUTPUT_FILE = path.join(DATA_DIR, 'rttnews-catalysts.json');

/**
 * Fetch a page from RTTNews
 */
function fetchPage(pageNum) {
  return new Promise((resolve, reject) => {
    // Always use explicit PageNum — the default page shows old entries, not page 1
    const pagePath = '/corpinfo/fdacalendar.aspx?PageNum=' + pageNum;
    const options = {
      hostname: 'www.rttnews.com',
      path: pagePath,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'text/html'
      }
    };

    https.get(options, (res) => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => resolve(body));
    }).on('error', reject);
  });
}

/**
 * Parse FDA calendar rows from HTML
 */
function parseRows(body) {
  // Split on grid-row boundaries — use lookahead to keep all rows including last
  const rows = body.match(/<div class="grid-row border-bottom[\s\S]*?(?=<div class="grid-row border-bottom|<div class="paging|<div class="footer|<\/form>)/g) || [];

  return rows.map(row => {
    // Company name
    const companyMatch = row.match(/data-th="Company Name"[^>]*>([^<]+)/);
    const company = companyMatch ? companyMatch[1].trim() : '';

    // Ticker symbol(s)
    const tickers = [];
    const tickerMatches = row.matchAll(/symbolsearch\.aspx\?symbol=([A-Z.]+)/g);
    for (const m of tickerMatches) tickers.push(m[1]);

    // Drug name and submission type
    const drugMatch = row.match(/data-th="Drug"[^>]*>([^<]+)/);
    const drugRaw = drugMatch ? drugMatch[1].trim() : '';
    // Parse "Dupixent (sBLA)" → drug: "Dupixent", submissionType: "sBLA"
    const drugParts = drugRaw.match(/^(.+?)\s*\(([^)]+)\)\s*$/);
    const drug = drugParts ? drugParts[1].trim() : drugRaw;
    const submissionType = drugParts ? drugParts[2].trim() : '';

    // PDUFA date — exact (MM/DD/YYYY) or quarterly (Q1-Q4 YYYY)
    let pdufaDate = '';
    let isQuarterlyEstimate = false;
    const exactDateMatch = row.match(/<span[^>]*>(\d{2}\/\d{2}\/\d{4})<\/span>/);
    const quarterMatch = row.match(/<span[^>]*>\s*(Q[1-4])\s+(\d{4})\s*<\/span>/);

    if (exactDateMatch) {
      const [m, d, y] = exactDateMatch[1].split('/');
      pdufaDate = `${y}-${m}-${d}`;
    } else if (quarterMatch) {
      // Use last day of quarter as estimated date
      const quarterEnd = { 'Q1': '03-31', 'Q2': '06-30', 'Q3': '09-30', 'Q4': '12-31' };
      pdufaDate = `${quarterMatch[2]}-${quarterEnd[quarterMatch[1]]}`;
      isQuarterlyEstimate = true;
    }

    // Event description — match after either exact date or quarterly date
    const eventMatch = row.match(/<span[^>]*>(?:\d{2}\/\d{2}\/\d{4}|Q[1-4]\s+\d{4})<\/span>\s*<br \/>\s*([\s\S]*?)<\/div>/);
    const indication = eventMatch
      ? eventMatch[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
      : '';

    // Outcome — check if FDA has acted
    const outcomeMatch = row.match(/lblOutcome">([^<]*)/);
    const outcomeText = outcomeMatch ? outcomeMatch[1].trim() : '';

    let status = 'Pending';
    if (/approv/i.test(outcomeText)) status = 'Approved';
    else if (/refus|reject|CRL|complete response/i.test(outcomeText)) status = 'Rejected';
    else if (outcomeText.length > 5) status = outcomeText.slice(0, 80);

    // Drug status notes (hidden fields)
    const drugStatusMatch = row.match(/hdnDrugStatus"[^>]*value="([^"]*)"/);
    let notes = drugStatusMatch ? drugStatusMatch[1].replace(/\s+/g, ' ').trim() : '';
    if (isQuarterlyEstimate) notes = (notes ? notes + '; ' : '') + 'PDUFA date is quarterly estimate (exact date TBD)';

    return {
      company,
      tickers,
      drug,
      submissionType,
      pdufaDate,
      isQuarterlyEstimate,
      indication,
      status,
      notes,
      source: 'RTTNews'
    };
  }).filter(r => r.pdufaDate); // Only keep entries with dates
}

/**
 * Main scraper
 */
async function main() {
  const verbose = process.argv.includes('--verbose');
  console.log('Scraping RTTNews FDA Calendar...\n');

  let allEntries = [];

  for (let page = 1; page <= 20; page++) {
    const body = await fetchPage(page);
    const rows = parseRows(body);

    if (rows.length === 0) {
      if (verbose) console.log(`  Page ${page}: empty — stopping`);
      break;
    }

    allEntries.push(...rows);
    if (verbose) console.log(`  Page ${page}: ${rows.length} entries (${allEntries.length} total)`);

    // Rate limit
    await new Promise(r => setTimeout(r, 400));
  }

  // Deduplicate by date + drug + company
  const seen = new Set();
  const unique = allEntries.filter(e => {
    const key = `${e.pdufaDate}|${e.drug}|${e.company}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Sort by PDUFA date
  unique.sort((a, b) => a.pdufaDate.localeCompare(b.pdufaDate));

  // Separate into pending/future vs decided
  const today = new Date().toISOString().split('T')[0];
  const pending = unique.filter(e => e.status === 'Pending' || e.pdufaDate >= today);
  const decided = unique.filter(e => e.status !== 'Pending' && e.pdufaDate < today);

  console.log(`\nTotal: ${unique.length} entries (${pending.length} pending, ${decided.length} decided)`);
  console.log(`Date range: ${unique[0]?.pdufaDate} to ${unique[unique.length - 1]?.pdufaDate}\n`);

  // Display pending
  console.log('═══ UPCOMING PDUFA DATES ═══\n');
  for (const e of pending) {
    const status = e.status === 'Pending' ? '' : ` [${e.status.slice(0, 20)}]`;
    console.log(`  ${e.pdufaDate}  ${e.company.slice(0, 28).padEnd(29)} ${e.drug.padEnd(25)} ${e.submissionType.padEnd(6)}${status}`);
  }

  // Save to JSON
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const output = {
    scrapedAt: new Date().toISOString(),
    source: 'RTTNews FDA Calendar',
    totalEntries: unique.length,
    entries: unique
  };
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));
  console.log(`\nSaved: ${OUTPUT_FILE}`);

  return unique;
}

module.exports = { main, fetchPage, parseRows };

if (require.main === module) {
  main().catch(console.error);
}
