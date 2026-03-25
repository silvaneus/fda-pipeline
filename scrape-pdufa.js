/**
 * FDA Catalyst Scraper - Multi-Source
 *
 * Scrapes multiple sources for FDA catalyst events:
 * - GlobeNewswire
 * - BusinessWire
 * - PR Newswire
 * - SEC EDGAR 8-K filings
 *
 * Detects:
 * 1. FDA acceptance with PDUFA dates
 * 2. NDA/BLA submissions awaiting FDA acceptance
 * 3. FDA approvals (to mark catalysts as approved)
 *
 * Usage:
 *   node scrape-pdufa.js              # Scrape and display results
 *   node scrape-pdufa.js --verbose    # Show detailed progress
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const RESULTS_CACHE_FILE = path.join(DATA_DIR, 'scraped-results.json');

// Wire services to scrape
const WIRE_SERVICES = {
  globenewswire: {
    name: 'GlobeNewswire',
    searchUrl: (term) => `https://www.globenewswire.com/search/keyword/${encodeURIComponent(term)}?pageSize=50`,
    releasePattern: /href="(\/news-release\/\d{4}\/\d{2}\/\d{2}\/[^"]+)"[^>]*>([^<]+)/g,
    headers: {}
  },
  prnewswire: {
    name: 'PR Newswire',
    searchUrl: (term) => `https://www.prnewswire.com/search/news/?keyword=${encodeURIComponent(term)}&pagesize=50`,
    releasePattern: /href="(\/news-releases\/[^"]+)"[^>]*>([^<]+)/g,
    headers: {}
  },
  googlenews: {
    name: 'Google News',
    // Google News RSS aggregates from BusinessWire, PR Newswire, GlobeNewswire, and more
    // Uses RSS feed which returns structured XML - no JS rendering needed
    searchUrl: (term) => `https://news.google.com/rss/search?q=${encodeURIComponent(term)}+when%3A90d&hl=en-US&gl=US&ceid=US:en`,
    // Google News RSS items have <link> and <title> tags, parsed separately in searchGoogleNews()
    releasePattern: null,
    isRSS: true,
    headers: {
      'Accept': 'application/rss+xml,application/xml,text/xml'
    }
  }
};

// Search terms for different event types
const SEARCH_TERMS = {
  pdufa: ['PDUFA date', 'FDA accepts NDA', 'FDA accepts BLA', 'FDA acceptance', 'target action date', 'priority review'],
  submissions: ['submits NDA FDA', 'submits BLA FDA', 'NDA submission', 'BLA submission', 'files NDA', 'files BLA', 'completes BLA submission', 'completes NDA submission'],
  approvals: ['FDA approves', 'FDA approval', 'receives FDA approval']
};

// Additional company/drug-specific search terms
// Covers major pharma, mid-cap biotech with active late-stage pipelines,
// and specific drugs of interest
const SPECIFIC_SEARCHES = [
  // ── Big Pharma (active NDA/BLA filers) ──
  { term: 'Pfizer FDA PDUFA', eventType: 'pdufa' },
  { term: 'Merck FDA PDUFA', eventType: 'pdufa' },
  { term: 'Eli Lilly FDA submission', eventType: 'submissions' },
  { term: 'Novo Nordisk FDA submission', eventType: 'submissions' },
  { term: 'AstraZeneca FDA PDUFA', eventType: 'pdufa' },
  { term: 'Bristol-Myers Squibb FDA submission', eventType: 'submissions' },
  { term: 'Johnson Johnson FDA PDUFA', eventType: 'pdufa' },
  { term: 'Roche FDA PDUFA', eventType: 'pdufa' },
  { term: 'Sanofi FDA submission', eventType: 'submissions' },
  { term: 'AbbVie FDA PDUFA', eventType: 'pdufa' },
  { term: 'Amgen FDA PDUFA', eventType: 'pdufa' },
  { term: 'Gilead Sciences FDA PDUFA', eventType: 'pdufa' },
  { term: 'Regeneron FDA PDUFA', eventType: 'pdufa' },
  { term: 'Takeda FDA submission', eventType: 'submissions' },
  { term: 'Biogen FDA submission', eventType: 'submissions' },
  { term: 'GSK FDA PDUFA', eventType: 'pdufa' },
  { term: 'Bayer FDA PDUFA', eventType: 'pdufa' },
  { term: 'Novartis FDA PDUFA', eventType: 'pdufa' },
  // ── Mid-cap biotech with late-stage pipelines ──
  { term: 'Vertex Pharmaceuticals FDA', eventType: 'pdufa' },
  { term: 'BioMarin FDA', eventType: 'pdufa' },
  { term: 'Alnylam FDA', eventType: 'pdufa' },
  { term: 'Argenx FDA', eventType: 'pdufa' },
  { term: 'Blueprint Medicines FDA', eventType: 'pdufa' },
  { term: 'Corcept Therapeutics FDA', eventType: 'pdufa' },
  { term: 'Daiichi Sankyo FDA', eventType: 'pdufa' },
  { term: 'Exact Sciences FDA', eventType: 'pdufa' },
  { term: 'Halozyme FDA', eventType: 'pdufa' },
  { term: 'Incyte FDA', eventType: 'pdufa' },
  { term: 'Ionis Pharmaceuticals FDA', eventType: 'pdufa' },
  { term: 'Jazz Pharmaceuticals FDA', eventType: 'pdufa' },
  { term: 'Karuna Therapeutics FDA', eventType: 'pdufa' },
  { term: 'Legend Biotech FDA', eventType: 'pdufa' },
  { term: 'Madrigal Pharmaceuticals FDA', eventType: 'pdufa' },
  { term: 'Neurocrine Biosciences FDA', eventType: 'pdufa' },
  { term: 'Rocket Pharmaceuticals FDA', eventType: 'pdufa' },
  { term: 'Sarepta Therapeutics FDA', eventType: 'pdufa' },
  { term: 'Seagen FDA', eventType: 'pdufa' },
  { term: 'SpringWorks Therapeutics FDA', eventType: 'pdufa' },
  { term: 'Ultragenyx FDA', eventType: 'pdufa' },
  { term: 'Viridian Therapeutics FDA', eventType: 'pdufa' },
  { term: 'Xenon Pharmaceuticals FDA', eventType: 'pdufa' },
  // ── Smaller biotech with known upcoming catalysts ──
  { term: 'Axsome Therapeutics FDA', eventType: 'pdufa' },
  { term: 'Celcuity FDA', eventType: 'pdufa' },
  { term: 'Mineralys FDA', eventType: 'submissions' },
  { term: 'Nuvalent FDA', eventType: 'pdufa' },
  { term: 'Summit Therapeutics FDA', eventType: 'pdufa' },
  { term: 'Veru FDA', eventType: 'pdufa' },
  { term: 'Achieve Life Sciences FDA', eventType: 'pdufa' },
  { term: 'Aldeyra Therapeutics FDA', eventType: 'pdufa' },
  { term: 'Ascendis Pharma FDA', eventType: 'pdufa' },
  { term: 'Capricor Therapeutics FDA', eventType: 'pdufa' },
  { term: 'Deciphera Pharmaceuticals FDA', eventType: 'pdufa' },
  { term: 'Geron Corporation FDA', eventType: 'pdufa' },
  { term: 'HUTCHMED FDA', eventType: 'pdufa' },
  { term: 'Inovio Pharmaceuticals FDA', eventType: 'pdufa' },
  { term: 'MannKind FDA', eventType: 'pdufa' },
  { term: 'Moderna FDA', eventType: 'pdufa' },
  { term: 'Orca Bio FDA', eventType: 'pdufa' },
  { term: 'PharmaEssentia FDA', eventType: 'pdufa' },
  { term: 'Travere Therapeutics FDA', eventType: 'pdufa' },
  { term: 'Unicycive Therapeutics FDA', eventType: 'pdufa' },
  { term: 'Vera Therapeutics FDA', eventType: 'pdufa' },
  { term: 'Cogent Biosciences FDA', eventType: 'pdufa' },
  { term: 'Protagonist Therapeutics FDA', eventType: 'pdufa' },
  { term: 'Minerva Neurosciences FDA', eventType: 'pdufa' },
  // ── Specific drugs of interest ──
  { term: 'lorundrostat FDA', eventType: 'submissions' },
  { term: 'relacorilant FDA', eventType: 'pdufa' },
  { term: 'iberdomide FDA', eventType: 'pdufa' },
  { term: 'mRNA-1010 FDA', eventType: 'pdufa' },
  { term: 'Enhertu PDUFA', eventType: 'pdufa' },
  { term: 'trastuzumab deruxtecan FDA', eventType: 'pdufa' },
  { term: 'bezuclastinib FDA', eventType: 'pdufa' },
  { term: 'rusfertide FDA', eventType: 'pdufa' },
];

// Patterns
const PDUFA_DATE_PATTERNS = [
  /PDUFA\s+(?:target\s+)?(?:action\s+)?(?:goal\s+)?date\s+(?:of\s+|is\s+|set\s+for\s+)?(\w+\s+\d{1,2},?\s+\d{4})/gi,
  /target\s+(?:action\s+)?date\s+(?:of\s+|is\s+)?(\w+\s+\d{1,2},?\s+\d{4})/gi,
  /(?:FDA\s+)?decision\s+(?:expected\s+)?by\s+(\w+\s+\d{1,2},?\s+\d{4})/gi,
  /(?:action|goal)\s+date\s+of\s+(\w+\s+\d{1,2},?\s+\d{4})/gi
];

// Quarterly PDUFA patterns — e.g., "PDUFA date in Q3 2026", "target action date in the third quarter of 2026"
const PDUFA_QUARTER_PATTERNS = [
  /PDUFA\s+(?:target\s+)?(?:action\s+)?(?:goal\s+)?date\s+(?:of|in|is)\s+(?:the\s+)?(Q[1-4])\s+(\d{4})/gi,
  /PDUFA\s+(?:target\s+)?(?:action\s+)?(?:goal\s+)?date\s+(?:of|in|is)\s+(?:the\s+)?(first|second|third|fourth)\s+quarter\s+(?:of\s+)?(\d{4})/gi,
  /target\s+(?:action\s+)?date\s+(?:of|in)\s+(?:the\s+)?(Q[1-4])\s+(\d{4})/gi,
  /target\s+(?:action\s+)?date\s+(?:of|in)\s+(?:the\s+)?(first|second|third|fourth)\s+quarter\s+(?:of\s+)?(\d{4})/gi,
  /(?:FDA\s+)?decision\s+(?:expected|anticipated)\s+(?:in|by)\s+(?:the\s+)?(Q[1-4])\s+(\d{4})/gi,
  /(?:FDA\s+)?decision\s+(?:expected|anticipated)\s+(?:in|by)\s+(?:the\s+)?(first|second|third|fourth)\s+quarter\s+(?:of\s+)?(\d{4})/gi,
];

const SUBMISSION_PATTERNS = [
  { pattern: /\bsBLA\b/i, type: 'sBLA' },
  { pattern: /\bsNDA\b/i, type: 'sNDA' },
  { pattern: /\bBLA\b/i, type: 'BLA' },
  { pattern: /\bNDA\b/i, type: 'NDA' }
];

const APPROVAL_PATTERNS = [
  /FDA\s+(?:has\s+)?approv(?:ed|es|al)/i,
  /receiv(?:ed|es)\s+(?:FDA\s+)?approval/i,
  /grant(?:ed|s)\s+(?:FDA\s+)?approval/i
];

const SUBMITTED_PATTERNS = [
  /submit(?:ted|s)\s+(?:a\s+|an\s+|its\s+)?(?:new\s+drug\s+application|biologics?\s+license\s+application|s?NDA|s?BLA)/i,
  /fil(?:ed|es|ing)\s+(?:a\s+|an\s+|its\s+)?(?:s?NDA|s?BLA)/i,
  /announc(?:ed|es)\s+(?:the\s+)?submission/i
];

// Skip words for drug name extraction — checked case-insensitively
const SKIP_WORDS = new Set([
  'FDA', 'NDA', 'BLA', 'PDUFA', 'US', 'USA', 'INC', 'LLC', 'CORP', 'THE', 'FOR', 'AND', 'NEW', 'DRUG', 'APPLICATION',
  'SUPPLEMENTAL', 'FIRST', 'ORAL', 'INJECTABLE', 'TREATMENT', 'PATIENTS', 'ADULTS', 'CHILDREN',
  'ANNOUNCES', 'RECEIVES', 'ACCEPTS', 'GRANTS', 'APPROVAL', 'APPROVED', 'FILING', 'FILED',
  'HYPERSENSITIVITY', 'REACTIONS', 'LABELING', 'CHANGES', 'COMPASSIONATE', 'USE', 'NEXT', 'GENERATION',
  'BEST', 'WEIGHT', 'LOSS', 'PILLS', 'ALTERNATIVE', 'OPTIONS', 'PATCH', 'PATCHES',
  // Regulatory/procedural words that false-positive as drug names
  'ACCEPTANCE', 'ADMINISTRATION', 'BIOLOGICS', 'LICENSE', 'SUBMISSION', 'SUBMITTED',
  'DESIGNATION', 'BREAKTHROUGH', 'PRIORITY', 'REVIEW', 'EXEMPTION', 'NOTIFICATION',
  'GOVERNANCE', 'COMPLIANCE', 'COUNSEL', 'REPORT', 'CLINICAL', 'STAGE', 'PHASE',
  'TRIAL', 'STUDY', 'DATA', 'RESULTS', 'COMPANY', 'CORPORATION', 'THERAPEUTICS',
  'PHARMACEUTICALS', 'BIOSCIENCES', 'SCIENCES', 'MEDICAL', 'HEALTH', 'VALVE',
  'COMBINATION', 'MONOTHERAPY', 'INVESTIGATIONAL', 'PREMARKET', 'MARKETING'
]);

// Known drug name mappings from title keywords
const KNOWN_DRUGS = {
  'vyvgart': { drug: 'efgartigimod alfa', brandName: 'VYVGART' },
  'efgartigimod': { drug: 'efgartigimod alfa', brandName: 'VYVGART' },
  'argenx': { drug: 'efgartigimod alfa', brandName: 'VYVGART' },
  'moderna flu': { drug: 'mRNA-1010', brandName: null },
  'mrna-1010': { drug: 'mRNA-1010', brandName: null },
  'seasonal influenza': { drug: 'mRNA-1010', brandName: null },
  'iberdomide': { drug: 'iberdomide', brandName: null },
  'cc-220': { drug: 'iberdomide', brandName: null },
  'lorundrostat': { drug: 'lorundrostat', brandName: null },
  'mineralys': { drug: 'lorundrostat', brandName: null },
  'zoryve': { drug: 'roflumilast', brandName: 'ZORYVE' },
  'roflumilast': { drug: 'roflumilast', brandName: 'ZORYVE' },
  'cytisinicline': { drug: 'cytisinicline', brandName: null },
  'achieve life': { drug: 'cytisinicline', brandName: null },
  'deucravacitinib': { drug: 'deucravacitinib', brandName: 'SOTYKTU' },
  'sotyktu': { drug: 'deucravacitinib', brandName: 'SOTYKTU' },
  'imlifidase': { drug: 'imlifidase', brandName: 'Idefirix' },
  'hansa biopharma': { drug: 'imlifidase', brandName: 'Idefirix' },
  'ivonescimab': { drug: 'ivonescimab', brandName: null },
  'summit therapeutics': { drug: 'ivonescimab', brandName: null },
  'lirafugratinib': { drug: 'lirafugratinib', brandName: null },
  'elevar therapeutics': { drug: 'lirafugratinib', brandName: null },
  'deramiocel': { drug: 'deramiocel', brandName: null },
  'capricor': { drug: 'deramiocel', brandName: null },
  'leqembi': { drug: 'lecanemab', brandName: 'LEQEMBI' },
  'lecanemab': { drug: 'lecanemab', brandName: 'LEQEMBI' },
  'oxylanthanum': { drug: 'oxylanthanum carbonate', brandName: null },
  'unicycive': { drug: 'oxylanthanum carbonate', brandName: null },
  'gedatolisib': { drug: 'gedatolisib', brandName: null },
  'celcuity': { drug: 'gedatolisib', brandName: null },
  'afrezza': { drug: 'insulin human', brandName: 'Afrezza' },
  'mannkind': { drug: 'furoscix', brandName: null },
  'furoscix': { drug: 'furosemide', brandName: 'Furoscix' },
  'edotreotide': { drug: '177Lu-edotreotide', brandName: null },
  'itm isotope': { drug: '177Lu-edotreotide', brandName: null },
  'zidesamtinib': { drug: 'zidesamtinib', brandName: null },
  'nuvalent': { drug: 'zidesamtinib', brandName: null },
  'ino-3107': { drug: 'INO-3107', brandName: null },
  'inovio': { drug: 'INO-3107', brandName: null },
  'ctx-1301': { drug: 'CTx-1301', brandName: null },
  'cingulate': { drug: 'CTx-1301', brandName: null },
  'dexmethylphenidate': { drug: 'CTx-1301', brandName: null },
  'roluperidone': { drug: 'roluperidone', brandName: null },
  'centanafadine': { drug: 'centanafadine', brandName: null },
  'otsuka': { drug: 'centanafadine', brandName: null },
  'relacorilant': { drug: 'relacorilant', brandName: null },
  'corcept': { drug: 'relacorilant', brandName: null },
  'enhertu': { drug: 'trastuzumab deruxtecan', brandName: 'ENHERTU' },
  'trastuzumab deruxtecan': { drug: 'trastuzumab deruxtecan', brandName: 'ENHERTU' },
  't-dxd': { drug: 'trastuzumab deruxtecan', brandName: 'ENHERTU' },
  'ds-8201': { drug: 'trastuzumab deruxtecan', brandName: 'ENHERTU' },
  'bezuclastinib': { drug: 'bezuclastinib', brandName: null },
  'cogent biosciences': { drug: 'bezuclastinib', brandName: null },
  'rusfertide': { drug: 'rusfertide', brandName: null },
  'protagonist': { drug: 'rusfertide', brandName: null }
};

// Comprehensive INN (International Nonproprietary Name) drug suffixes
// Organized by pharmacological category for maintainability
const DRUG_SUFFIXES = [
  // Monoclonal antibodies & biologics
  'mab', 'zumab', 'ximab', 'umab', 'limab', 'tumab', 'mumab', 'nimab',
  'cimab', 'timab', 'tuzumab', 'vizumab',
  'cept',        // receptor-Fc fusions (e.g., etanercept, aflibercept)
  'fusp',        // fusion proteins (e.g., tividenofusp)
  'cel', 'leucel', 'sel',  // cell therapies (e.g., axicabtagene ciloleucel)
  'gene',        // gene therapies (e.g., onasemnogene)
  // Kinase inhibitors
  'nib', 'tinib', 'rutinib', 'lisib', 'ciclib', 'rafenib', 'metinib',
  'zanib', 'ertinib', 'anib',
  // Antibiotics
  'cillin',      // penicillins
  'mycin',       // aminoglycosides
  'cycline',     // tetracyclines
  'floxacin',    // fluoroquinolones
  'micin',       // aminoglycosides variant
  'sulfa',       // sulfonamides
  'oxacin',      // quinolones
  'penem',       // carbapenems
  'sporin',      // cephalosporins (cefazolin pattern below too)
  // Antivirals
  'vir', 'ovir', 'navir', 'gravir', 'tegravir', 'ciclovir', 'amivir',
  'buvir', 'previr', 'asvir',
  // Cardiovascular
  'sartan',      // ARBs
  'dipine',      // calcium channel blockers
  'olol',        // beta-blockers
  'pril',        // ACE inhibitors
  'statin',      // HMG-CoA reductase inhibitors
  'vastatin',    // statins variant
  'fibrate',     // fibrates
  'semide',      // loop diuretics
  'thiazide',    // thiazide diuretics
  'parin',       // anticoagulants (heparins)
  'gatran',      // direct thrombin inhibitors
  'xaban',       // factor Xa inhibitors
  'grel',        // antiplatelet agents
  'afil',        // PDE5 inhibitors
  // Corticosteroids & hormones
  'sone', 'olone', 'lone', 'onide', 'solone', 'nisolone',
  'androne', 'sterone',
  'pressin',     // vasopressins (e.g., desmopressin)
  'reotide',     // somatostatin analogs
  'relin',       // GnRH related
  'lutamide',    // antiandrogens
  'estrant',     // estrogen receptor modulators
  'corilant',    // cortisol modulators (e.g., relacorilant)
  // Antidiabetics / GLP-1 / metabolic
  'gliptin',     // DPP-4 inhibitors
  'gliflozin',   // SGLT2 inhibitors
  'glutide',     // GLP-1 agonists (e.g., semaglutide, liraglutide)
  'glinide',     // meglitinides
  'formin',      // biguanides
  'tide',        // peptides (general)
  // Oncology
  'platin',      // platinum agents
  'rubicin',     // anthracyclines
  'taxel',       // taxanes
  'tecan',       // topoisomerase inhibitors
  'poside',      // topoisomerase II
  'mustine',     // alkylating agents
  'domide', 'limod', 'glumide',  // IMiDs / cereblon modulators
  'tuxetan', 'vedotin', 'deruxtecan', 'govitecan', 'mafodotin', 'ozogamicin',  // ADC payloads
  // CNS / psychiatric / neurological
  'azepam',      // benzodiazepines
  'zolam',       // benzodiazepines (triazolam pattern)
  'barbital',    // barbiturates
  'azine',       // phenothiazines
  'peridone',    // atypical antipsychotics (e.g., risperidone, milsaperidone)
  'peridol',     // typical antipsychotics
  'pramine',     // tricyclic antidepressants
  'oxetine',     // SSRIs (e.g., fluoxetine, paroxetine)
  'aline',       // SNRIs variant
  'fadine',      // NDSRIs and related (e.g., centanafadine)
  'racetam',     // nootropics
  'triptan',     // migraine (serotonin agonists)
  'pezil',       // cholinesterase inhibitors
  'antine',      // antivirals/NMDA (e.g., amantadine, memantine)
  'bamate',      // anxiolytics (e.g., meprobamate)
  'finil',       // wakefulness agents (e.g., modafinil)
  // Anti-inflammatory / immunology
  'fenac',       // NSAIDs (diclofenac)
  'profen',      // NSAIDs (ibuprofen)
  'oxicam',      // NSAIDs (piroxicam)
  'citinib',     // JAK inhibitors (e.g., tofacitinib, deucravacitinib)
  'milast',      // PDE4 inhibitors (e.g., roflumilast, apremilast)
  'olimus',      // mTOR inhibitors (e.g., sirolimus, everolimus)
  'sporine',     // calcineurin inhibitors
  // Antifungals
  'azole', 'conazole', 'fungin',
  // Respiratory
  'terol',       // beta-2 agonists (e.g., salbutamol, formoterol)
  'lukast',      // leukotriene antagonists (e.g., montelukast)
  'phylline',    // xanthines (e.g., theophylline)
  'tropium',     // anticholinergics
  // GI
  'prazole',     // proton pump inhibitors
  'tidine',      // H2 blockers (e.g., famotidine, ranitidine)
  'setron',      // 5-HT3 antagonists (e.g., ondansetron)
  // Opioids / pain
  'codone',      // opioids (oxycodone, hydrocodone)
  'orphine',     // opioids (morphine)
  'adol',        // analgesics (tramadol)
  'gesia',       // analgesics suffix
  // Other common stems
  'amine',       // amines (general)
  'ximab', 'axomab',  // chimeric antibodies
  'pase',        // enzymes (e.g., pegzilarginase)
  'inase',       // kinase enzymes
  'dase',        // enzyme suffix
  'dronate',     // bisphosphonates
  'parib',       // PARP inhibitors
  'toran',       // endothelin receptor antagonists
  'sentan',      // endothelin receptor antagonists
  'iguat',       // guanylate cyclase stimulators
  'rinone',      // PDE3 inhibitors
  'vaptan',      // vasopressin receptor antagonists
  'netant',      // neurokinin antagonists
  'leukin',      // interleukins
  'feron',       // interferons
  'poetin',      // erythropoietins
  'stim',        // colony-stimulating factors
  'plase',       // fibrinolytics
  'teplase',     // tissue plasminogen activators
  'argine',      // arginase-related
  'aginase',     // enzyme therapies
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
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
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
 * Search a wire service (HTML-based: GlobeNewswire, PR Newswire)
 */
async function searchWireService(service, searchTerm, eventType, options = {}) {
  const { verbose = false } = options;
  const config = WIRE_SERVICES[service];
  if (config.isRSS) return []; // RSS sources handled by searchGoogleNews
  const url = config.searchUrl(searchTerm);

  if (verbose) console.log(`    [${config.name}] Searching: ${searchTerm}...`);

  try {
    const { statusCode, body } = await fetchUrl(url, { headers: config.headers || {} });
    if (statusCode !== 200) {
      if (verbose) console.log(`      Status ${statusCode}`);
      return [];
    }

    const releases = [];
    const pattern = new RegExp(config.releasePattern.source, 'g');
    let match;

    while ((match = pattern.exec(body)) !== null) {
      const [, path, title] = match;
      const titleLower = title.toLowerCase();

      let relevant = false;
      if (eventType === 'pdufa') {
        relevant = titleLower.includes('pdufa') ||
                   titleLower.includes('fda accepts') ||
                   titleLower.includes('fda acceptance') ||
                   titleLower.includes('target date') ||
                   titleLower.includes('action date');
      } else if (eventType === 'submissions') {
        relevant = (titleLower.includes('submit') || titleLower.includes('files') || titleLower.includes('filing')) &&
                   (titleLower.includes('nda') || titleLower.includes('bla') || titleLower.includes('fda'));
      } else if (eventType === 'approvals') {
        relevant = titleLower.includes('fda') &&
                   (titleLower.includes('approv') || titleLower.includes('grants'));
      }

      if (relevant) {
        let fullUrl = path;
        if (!path.startsWith('http')) {
          const baseUrls = {
            globenewswire: 'https://www.globenewswire.com',
            businesswire: 'https://www.businesswire.com',
            prnewswire: 'https://www.prnewswire.com'
          };
          fullUrl = baseUrls[service] + path;
        }

        releases.push({
          url: fullUrl,
          title: title.trim(),
          source: config.name,
          eventType
        });
      }
    }

    if (verbose) console.log(`      Found ${releases.length} relevant`);
    return releases;
  } catch (error) {
    if (verbose) console.log(`      Error: ${error.message}`);
    return [];
  }
}

/**
 * Search Google News RSS feed for FDA-related press releases.
 * Aggregates results from BusinessWire, PR Newswire, GlobeNewswire, and more.
 * Returns releases with links to the original source articles.
 */
async function searchGoogleNews(eventType, options = {}) {
  const { verbose = false } = options;
  const config = WIRE_SERVICES.googlenews;
  if (!config) return [];

  // Build targeted queries per event type
  const queries = [];
  if (eventType === 'pdufa') {
    queries.push('"FDA accepts" "NDA"', '"FDA accepts" "BLA"', '"PDUFA date"', '"FDA acceptance" "priority review"', '"target action date" FDA');
  } else if (eventType === 'submissions') {
    queries.push('"submits NDA" FDA', '"submits BLA" FDA', '"files NDA" FDA', '"files BLA" FDA');
  } else if (eventType === 'approvals') {
    queries.push('"FDA approves"', '"receives FDA approval"');
  }

  const allReleases = new Map();

  for (const query of queries) {
    const url = config.searchUrl(query);
    if (verbose) console.log(`    [Google News] Searching: ${query}...`);

    try {
      const { statusCode, body } = await fetchUrl(url, { headers: config.headers || {} });
      if (statusCode !== 200) {
        if (verbose) console.log(`      Status ${statusCode}`);
        continue;
      }

      // Parse RSS XML items
      const items = body.match(/<item>[\s\S]*?<\/item>/gi) || [];

      for (const item of items) {
        const title = ((item.match(/<title>([\s\S]*?)<\/title>/i) || [])[1] || '').replace(/<!\[CDATA\[|\]\]>/g, '').trim();
        // Google News wraps the real URL; extract from <link> tag
        let link = ((item.match(/<link>([\s\S]*?)<\/link>/i) || [])[1] || '').trim();
        // Some feeds put the link after the tag on a new line
        if (!link) {
          const linkMatch = item.match(/<link\s*\/>\s*(https?:\/\/[^\s<]+)/i);
          if (linkMatch) link = linkMatch[1].trim();
        }

        if (!title || !link) continue;

        const titleLower = title.toLowerCase();

        // Filter for FDA relevance
        let relevant = false;
        if (eventType === 'pdufa') {
          relevant = titleLower.includes('pdufa') ||
                     titleLower.includes('fda accepts') ||
                     titleLower.includes('fda acceptance') ||
                     titleLower.includes('target date') ||
                     titleLower.includes('action date') ||
                     titleLower.includes('priority review');
        } else if (eventType === 'submissions') {
          relevant = (titleLower.includes('submit') || titleLower.includes('files') || titleLower.includes('filing')) &&
                     (titleLower.includes('nda') || titleLower.includes('bla') || titleLower.includes('fda'));
        } else if (eventType === 'approvals') {
          relevant = titleLower.includes('fda') &&
                     (titleLower.includes('approv') || titleLower.includes('grants'));
        }

        if (relevant && !allReleases.has(link)) {
          // Determine original source from title suffix (e.g., "- Business Wire", "- GlobeNewswire")
          const sourceMatch = title.match(/\s+-\s+([^-]+)$/);
          const sourceName = sourceMatch ? sourceMatch[1].trim() : 'Google News';

          allReleases.set(link, {
            url: link,
            title: title.replace(/\s+-\s+[^-]+$/, '').trim(),
            source: sourceName,
            eventType
          });
        }
      }

      await new Promise(resolve => setTimeout(resolve, 300));
    } catch (error) {
      if (verbose) console.log(`      Error: ${error.message}`);
    }
  }

  if (verbose) console.log(`      Found ${allReleases.size} relevant across all queries`);
  return Array.from(allReleases.values());
}

/**
 * Search SEC EDGAR for 8-K filings with FDA-related content
 */
async function searchSECEdgar(options = {}) {
  const { verbose = false } = options;

  if (verbose) console.log('  Searching SEC EDGAR 8-K filings...');

  const results = [];

  // Search SEC full-text for FDA-related 8-K filings
  const searchTerms = ['PDUFA', 'FDA approval', 'NDA submitted', 'BLA submitted'];

  for (const term of searchTerms) {
    try {
      // SEC EDGAR full-text search API
      const url = `https://efts.sec.gov/LATEST/search-index?q="${encodeURIComponent(term)}"&dateRange=custom&startdt=2025-01-01&enddt=2026-12-31&forms=8-K`;

      const { body } = await fetchUrl(url, {
        headers: { 'Accept': 'application/json' }
      });

      const data = JSON.parse(body);
      if (data.hits && data.hits.hits) {
        for (const hit of data.hits.hits.slice(0, 20)) {
          const filing = hit._source;
          if (filing && filing.file_description) {
            results.push({
              url: `https://www.sec.gov/Archives/edgar/data/${filing.cik}/${filing.adsh.replace(/-/g, '')}/${filing.file_name}`,
              title: filing.file_description || 'SEC 8-K Filing',
              company: filing.display_names?.[0] || filing.entity_name || 'Unknown',
              source: 'SEC EDGAR',
              filingDate: filing.file_date
            });
          }
        }
      }
    } catch (error) {
      if (verbose) console.log(`    SEC search error for "${term}": ${error.message}`);
    }

    await new Promise(resolve => setTimeout(resolve, 500));
  }

  if (verbose) console.log(`    Found ${results.length} SEC filings`);
  return results;
}

/**
 * Extract text from HTML
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
    // Rejoin words split by tag stripping (e.g., "<a>A</a>pplication" → "A pplication" → "Application")
    .replace(/\b([A-Z])\s+([a-z])/g, '$1$2')
    .trim();
}

// Common English words/fragments that are NOT drug names — catches false positives from text extraction
const FALSE_POSITIVE_DRUGS = new Set([
  'pplication', 'dministration', 'xemption', 'otification', 'overnance',
  'pproval', 'cienture', 'ksfcounsel', 'eport', 'alve', 'ombination',
  'esignation', 'ubmission', 'cceptance', 'ompliance', 'cancel',
]);

function isValidDrugName(name) {
  if (!name || name === 'Unknown') return false;
  const lower = name.toLowerCase();
  // Reject known false positives
  if (FALSE_POSITIVE_DRUGS.has(lower)) return false;
  // Reject if it's a common English word fragment (starts with lowercase, no vowels in first 3 chars suggests garbled)
  if (SKIP_WORDS.has(name.toUpperCase())) return false;
  // Reject very long "drug names" that are clearly sentence fragments
  if (name.length > 60) return false;
  // Reject names that start with common sentence patterns
  if (/^(a |an |the |as |also |its |in |on |to |for |with |this |that )/i.test(name)) return false;
  return true;
}

/**
 * Extract company name
 */
function extractCompany(body, title, textContent) {
  // 1. Try title - company usually starts the headline
  const titleMatch = title.match(/^([A-Z][a-zA-Z\s&,\.\-]+?)(?:\s+(?:Announces|Reports|Receives|Provides|Submits|Files|to\s|and\s|Granted|Gets|:))/i);
  if (titleMatch && titleMatch[1].length > 3 && titleMatch[1].length < 60) {
    const company = titleMatch[1].trim();
    if (!SKIP_WORDS.has(company.toUpperCase()) && company.length > 3) {
      return company;
    }
  }

  // 2. Try structured data
  const ogMatch = body.match(/<meta[^>]+property="og:site_name"[^>]+content="([^"]+)"/i);
  if (ogMatch && ogMatch[1].length > 3 && !ogMatch[1].includes('Wire')) {
    return ogMatch[1].trim();
  }

  // 3. Look for company in press release header
  if (textContent) {
    const headerMatch = textContent.match(/(?:CITY|[A-Z]{2,},)\s+[A-Z][a-z]+\.?\s+\d{1,2},?\s+\d{4}[^–—-]*[-–—]+\s*([A-Z][a-zA-Z\s&,\.\-]+?)(?:\s+(?:announced|today|\(|,))/i);
    if (headerMatch && headerMatch[1].length > 3) {
      return headerMatch[1].trim();
    }
  }

  return 'Unknown';
}

/**
 * Extract drug name
 */
function extractDrug(textContent, title) {
  const combinedText = (title + ' ' + textContent).toLowerCase();

  // 0. Check known drug mappings first
  for (const [keyword, info] of Object.entries(KNOWN_DRUGS)) {
    if (combinedText.includes(keyword.toLowerCase())) {
      return { drugName: info.drug, brandName: info.brandName };
    }
  }

  // 1. Brand (generic) pattern - e.g., "VYVGART (efgartigimod alfa)"
  const brandGenericMatch = textContent.match(/([A-Z][A-Z]+(?:®|™)?)\s*\(([a-z][a-z\-\s]+)\)/);
  if (brandGenericMatch && !SKIP_WORDS.has(brandGenericMatch[1].toUpperCase())) {
    return {
      drugName: brandGenericMatch[2].trim(),
      brandName: brandGenericMatch[1].replace(/[®™]/g, '')
    };
  }

  // 1b. Reverse pattern - "efgartigimod alfa (VYVGART)"
  const genericBrandMatch = textContent.match(/([a-z][a-z\-\s]+)\s*\(([A-Z][A-Z]+(?:®|™)?)\)/);
  if (genericBrandMatch && genericBrandMatch[1].length > 3) {
    return {
      drugName: genericBrandMatch[1].trim(),
      brandName: genericBrandMatch[2].replace(/[®™]/g, '')
    };
  }

  // 2. "NDA/BLA for DRUG" pattern
  const ndaForMatch = textContent.match(/(?:s?NDA|s?BLA)\s+(?:for\s+)(?:its\s+)?([A-Z][a-z][a-z0-9\-]*)/);
  if (ndaForMatch && !SKIP_WORDS.has(ndaForMatch[1].toUpperCase())) {
    return { drugName: ndaForMatch[1], brandName: null };
  }

  // 3. "accepts/approves DRUG" pattern - improved to skip generic words
  // Note: case-insensitive on the verb portion, but capture group requires actual uppercase start
  const acceptsMatch = textContent.match(/(?:FDA\s+)?(?:[Aa]ccepts|[Aa]pproves|[Aa]pproval\s+of)\s+(?:a\s+|the\s+)?(?:[Ss]upplemental\s+)?(?:[Bb]iologics?\s+[Ll]icense\s+[Aa]pplication|[Nn]ew\s+[Dd]rug\s+[Aa]pplication|s?BLA|s?NDA)?\s*(?:for\s+)?([A-Z][a-z][a-z0-9\-]+)/);
  if (acceptsMatch && !SKIP_WORDS.has(acceptsMatch[1].toUpperCase()) && acceptsMatch[1].length > 3) {
    return { drugName: acceptsMatch[1], brandName: null };
  }

  // 4. Code names (XX-123, mRNA-1010) - prioritize these
  const codeMatch = textContent.match(/\b((?:mRNA|AXS|CTx|UNI|PKI|INO|SCP|ITM|CC|BMS|MK|ABT|GSK)-\d{2,5})\b/i);
  if (codeMatch) {
    return { drugName: codeMatch[1].toUpperCase(), brandName: null };
  }

  // 5. Generic drug suffixes - comprehensive INN (International Nonproprietary Name) stems
  // Match against lowercased text to catch title-case drug names (e.g., "Bezuclastinib")
  // Use word boundaries via whitespace/punctuation to avoid matching inside English words
  const lowerText = textContent.toLowerCase();
  const genericMatch = lowerText.match(new RegExp(
    '(?:^|[\\s(])([a-z]{3,}(?:' + DRUG_SUFFIXES.join('|') + '))(?:[\\s,;.):]|$)'
  ));
  if (genericMatch && !SKIP_WORDS.has(genericMatch[1].toUpperCase())) {
    return { drugName: genericMatch[1], brandName: null };
  }

  // 6. Look in title for all-caps product name (brand names are often all caps)
  const titleBrandMatch = title.match(/\b([A-Z]{4,}(?:®|™)?)\b/);
  if (titleBrandMatch && !SKIP_WORDS.has(titleBrandMatch[1].replace(/[®™]/g, ''))) {
    const brand = titleBrandMatch[1].replace(/[®™]/g, '');
    return { drugName: brand.toLowerCase(), brandName: brand };
  }

  // 7. Look in title for capitalized product after key verbs
  const titleProductMatch = title.match(/(?:for|accepts|approves|of)\s+([A-Z][a-z]+[a-z0-9\-]*)/);
  if (titleProductMatch && !SKIP_WORDS.has(titleProductMatch[1].toUpperCase()) && titleProductMatch[1].length > 3) {
    return { drugName: titleProductMatch[1], brandName: null };
  }

  return { drugName: 'Unknown', brandName: null };
}

/**
 * Extract indication
 */
function extractIndication(textContent) {
  const patterns = [
    /for\s+(?:the\s+)?treatment\s+of\s+(?:patients\s+with\s+)?([^,.;]+)/i,
    /(?:in|for)\s+(?:patients\s+with\s+)?(?:relapsed\s+or\s+refractory\s+)?([A-Z][a-z]+(?:\s+[A-Za-z]+){0,4})/,
    /indicated\s+for\s+([^,.;]+)/i
  ];

  for (const pattern of patterns) {
    const match = textContent.match(pattern);
    if (match && match[1] && match[1].length > 5) {
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
 * Parse date string
 */
function parseDate(dateStr) {
  if (!dateStr) return null;
  const cleaned = dateStr.replace(/,/g, '').trim();

  const months = {
    'january': '01', 'february': '02', 'march': '03', 'april': '04',
    'may': '05', 'june': '06', 'july': '07', 'august': '08',
    'september': '09', 'october': '10', 'november': '11', 'december': '12'
  };

  const match = cleaned.match(/(\w+)\s+(\d{1,2})\s+(\d{4})/);
  if (match) {
    const monthNum = months[match[1].toLowerCase()];
    if (monthNum) return `${match[3]}-${monthNum}-${match[2].padStart(2, '0')}`;
  }

  const parsed = new Date(cleaned + ' 12:00:00');
  if (!isNaN(parsed.getTime())) {
    return parsed.toISOString().split('T')[0];
  }

  return null;
}

/**
 * Parse a quarterly date reference (e.g., "Q3 2026" or "third quarter 2026")
 * Returns the last day of the quarter as the estimated PDUFA date
 */
function parseQuarterDate(quarter, year) {
  const quarterMap = {
    'Q1': '03-31', 'first': '03-31',
    'Q2': '06-30', 'second': '06-30',
    'Q3': '09-30', 'third': '09-30',
    'Q4': '12-31', 'fourth': '12-31',
  };
  const suffix = quarterMap[quarter];
  if (!suffix || !year) return null;
  return `${year}-${suffix}`;
}

/**
 * Extract release date from URL
 */
function extractReleaseDate(url) {
  // GlobeNewswire: /news-release/2026/02/15/...
  let match = url.match(/\/(?:news-release|news\/home)\/(\d{4})\/(\d{2})\/(\d{2})\//);
  if (match) return `${match[1]}-${match[2]}-${match[3]}`;

  // BusinessWire: /news/home/20260217...
  match = url.match(/\/(\d{4})(\d{2})(\d{2})/);
  if (match) return `${match[1]}-${match[2]}-${match[3]}`;

  return new Date().toISOString().split('T')[0];
}

/**
 * Parse a press release
 */
async function parseRelease(release, options = {}) {
  const { verbose = false } = options;

  try {
    const { body } = await fetchUrl(release.url);
    const textContent = extractText(body);
    const titleMatch = body.match(/<title>([^<]+)<\/title>/i);
    const title = titleMatch ? titleMatch[1].replace(/\s*[|\-–].*$/, '').trim() : release.title;

    const company = extractCompany(body, title, textContent);
    const { drugName, brandName } = extractDrug(textContent, title);
    const indication = extractIndication(textContent);
    const submissionType = extractSubmissionType(textContent);
    const releaseDate = extractReleaseDate(release.url);

    // Check event type
    const hasApproval = APPROVAL_PATTERNS.some(p => p.test(textContent));
    const hasSubmission = SUBMITTED_PATTERNS.some(p => p.test(textContent));
    const hasAcceptance = /FDA\s+accept/i.test(textContent) || /PDUFA/i.test(textContent);

    // Extract PDUFA date if present
    let pdufaDate = null;
    let isQuarterlyEstimate = false;
    for (const pattern of PDUFA_DATE_PATTERNS) {
      pattern.lastIndex = 0;
      const match = pattern.exec(textContent);
      if (match && match[1]) {
        pdufaDate = parseDate(match[1]);
        if (pdufaDate) break;
      }
    }
    // Fall back to quarterly PDUFA patterns (e.g., "Q3 2026", "third quarter of 2026")
    if (!pdufaDate) {
      for (const pattern of PDUFA_QUARTER_PATTERNS) {
        pattern.lastIndex = 0;
        const match = pattern.exec(textContent);
        if (match && match[1] && match[2]) {
          pdufaDate = parseQuarterDate(match[1], match[2]);
          if (pdufaDate) {
            isQuarterlyEstimate = true;
            break;
          }
        }
      }
    }

    // Determine event type
    let eventType = release.eventType;
    let status = 'Pending';

    if (hasApproval && !hasAcceptance) {
      eventType = 'approval';
      status = 'Approved';
    } else if (pdufaDate || hasAcceptance) {
      eventType = 'pdufa';
      status = 'Pending';
    } else if (hasSubmission && !hasAcceptance && !hasApproval) {
      eventType = 'submission';
      status = 'Submitted - Awaiting PDUFA';
    }

    // Skip if drug name couldn't be extracted or is a false positive
    if ((drugName === 'Unknown' && !brandName) || !isValidDrugName(drugName)) {
      return null;
    }

    const result = {
      drug: drugName,
      brandName,
      company,
      indication,
      submissionType,
      status,
      eventType,
      source: release.source,
      sourceUrl: release.url,
      releaseDate,
      scrapedAt: new Date().toISOString()
    };

    if (pdufaDate) {
      result.pdufaDate = pdufaDate;
      if (isQuarterlyEstimate) {
        result.notes = (result.notes || '') + 'PDUFA date is quarterly estimate (exact date TBD)';
      }
    }

    if (eventType === 'submission') {
      result.submissionDate = releaseDate;
      // Calculate expected FDA response (60 days)
      const subDate = new Date(releaseDate + 'T12:00:00');
      result.expectedAcceptanceBy = new Date(subDate.getTime() + 60 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    }

    if (eventType === 'approval') {
      result.approvalDate = releaseDate;
    }

    return result;

  } catch (error) {
    if (verbose) console.log(`    Error parsing ${release.url}: ${error.message}`);
    return null;
  }
}

/**
 * Main scraping function
 */
async function scrapeAll(options = {}) {
  const { verbose = false, maxPerTerm = 30 } = options;

  console.log('═'.repeat(60));
  console.log('FDA Catalyst Scraper - Multi-Source');
  console.log('═'.repeat(60));

  const allReleases = new Map();

  // 1. Google News RSS — aggregates from all wire services (BusinessWire, PR Newswire, GlobeNewswire)
  console.log('\nGoogle News RSS:');
  for (const eventType of Object.keys(SEARCH_TERMS)) {
    const releases = await searchGoogleNews(eventType, { verbose });
    for (const r of releases) {
      if (!allReleases.has(r.url)) {
        allReleases.set(r.url, r);
      }
    }
  }

  // 2. Direct wire service searches for additional coverage
  for (const [service, config] of Object.entries(WIRE_SERVICES)) {
    if (config.isRSS) continue; // Skip RSS sources (handled above)
    console.log(`\n${config.name}:`);

    // Standard search terms
    for (const [eventType, terms] of Object.entries(SEARCH_TERMS)) {
      for (const term of terms) {
        const releases = await searchWireService(service, term, eventType, { verbose });
        for (const r of releases) {
          if (!allReleases.has(r.url)) {
            allReleases.set(r.url, r);
          }
        }
        await new Promise(resolve => setTimeout(resolve, 300));
      }
    }

    // Specific drug/company searches
    if (verbose) console.log('  Specific drug searches:');
    for (const { term, eventType } of SPECIFIC_SEARCHES) {
      const releases = await searchWireService(service, term, eventType, { verbose });
      for (const r of releases) {
        if (!allReleases.has(r.url)) {
          allReleases.set(r.url, r);
        }
      }
      await new Promise(resolve => setTimeout(resolve, 300));
    }
  }

  // Search SEC EDGAR
  console.log('\nSEC EDGAR:');
  const secResults = await searchSECEdgar({ verbose });
  // Note: SEC results need different parsing, skip for now

  console.log(`\nTotal unique releases found: ${allReleases.size}`);
  console.log('Parsing releases...\n');

  // Parse all releases
  const results = {
    pdufa: [],
    submissions: [],
    approvals: []
  };

  let processed = 0;
  for (const [url, release] of allReleases) {
    processed++;
    if (verbose) console.log(`[${processed}/${allReleases.size}] ${release.title.substring(0, 50)}...`);

    const parsed = await parseRelease(release, { verbose });
    if (parsed) {
      if (parsed.eventType === 'pdufa' && parsed.pdufaDate) {
        // Only include future PDUFA dates
        if (new Date(parsed.pdufaDate + 'T12:00:00') >= new Date()) {
          results.pdufa.push(parsed);
          if (verbose) console.log(`  ✓ PDUFA: ${parsed.drug} - ${parsed.pdufaDate}`);
        }
      } else if (parsed.eventType === 'submission') {
        results.submissions.push(parsed);
        if (verbose) console.log(`  ✓ Submission: ${parsed.drug}`);
      } else if (parsed.eventType === 'approval') {
        results.approvals.push(parsed);
        if (verbose) console.log(`  ✓ Approval: ${parsed.drug}`);
      }
    }

    await new Promise(resolve => setTimeout(resolve, 200));
  }

  // Sort results
  results.pdufa.sort((a, b) => new Date(a.pdufaDate) - new Date(b.pdufaDate));
  results.submissions.sort((a, b) => new Date(b.releaseDate) - new Date(a.releaseDate));
  results.approvals.sort((a, b) => new Date(b.approvalDate) - new Date(a.approvalDate));

  // Cache results
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(RESULTS_CACHE_FILE, JSON.stringify(results, null, 2));

  return results;
}

/**
 * Compare with curated list
 */
function analyzeUpdates(scraped, curated) {
  const updates = { newPDUFA: [], newSubmissions: [], toMarkApproved: [] };

  const curatedDrugs = new Set(curated.map(c => c.drug?.toLowerCase()));
  const approvedDrugs = new Set(scraped.approvals.map(a => a.drug?.toLowerCase()));

  for (const p of scraped.pdufa) {
    if (!curatedDrugs.has(p.drug?.toLowerCase())) {
      updates.newPDUFA.push(p);
    }
  }

  for (const s of scraped.submissions) {
    if (!curatedDrugs.has(s.drug?.toLowerCase())) {
      updates.newSubmissions.push(s);
    }
  }

  for (const c of curated) {
    if (c.status === 'Pending' && approvedDrugs.has(c.drug?.toLowerCase())) {
      const approval = scraped.approvals.find(a => a.drug?.toLowerCase() === c.drug?.toLowerCase());
      updates.toMarkApproved.push({ ...c, approvalDate: approval?.approvalDate });
    }
  }

  return updates;
}

/**
 * Display results
 */
function displayResults(results) {
  console.log(`\n${'═'.repeat(70)}`);
  console.log('RESULTS SUMMARY');
  console.log('═'.repeat(70));

  console.log(`\n📅 PDUFA DATES (${results.pdufa.length} found)`);
  if (results.pdufa.length > 0) {
    console.log('─'.repeat(70));
    console.log(`${'Drug'.padEnd(22)} ${'PDUFA'.padEnd(12)} ${'Company'.padEnd(25)} ${'Source'.padEnd(10)}`);
    console.log('─'.repeat(70));
    for (const p of results.pdufa.slice(0, 20)) {
      console.log(`${(p.drug || '?').substring(0, 21).padEnd(22)} ${(p.pdufaDate || '').padEnd(12)} ${(p.company || '?').substring(0, 24).padEnd(25)} ${(p.source || '').substring(0, 9)}`);
    }
  }

  console.log(`\n📝 SUBMISSIONS AWAITING FDA (${results.submissions.length} found)`);
  if (results.submissions.length > 0) {
    console.log('─'.repeat(70));
    for (const s of results.submissions.slice(0, 10)) {
      console.log(`  ${s.drug} (${s.company}) - Submitted ${s.releaseDate}`);
    }
  }

  console.log(`\n✅ RECENT APPROVALS (${results.approvals.length} found)`);
  if (results.approvals.length > 0) {
    console.log('─'.repeat(70));
    for (const a of results.approvals.slice(0, 10)) {
      console.log(`  ${a.drug} (${a.company}) - Approved ${a.approvalDate}`);
    }
  }
}

// CLI
if (require.main === module) {
  const args = process.argv.slice(2);
  const verbose = args.includes('--verbose') || args.includes('-v');

  scrapeAll({ verbose })
    .then(results => {
      displayResults(results);

      try {
        const { CURATED_CATALYSTS } = require('./pdufa-catalysts');
        const updates = analyzeUpdates(results, CURATED_CATALYSTS);

        console.log(`\n${'═'.repeat(70)}`);
        console.log('RECOMMENDED UPDATES TO CURATED LIST');
        console.log('═'.repeat(70));

        if (updates.newPDUFA.length > 0) {
          console.log(`\n🆕 ADD THESE PDUFA DATES (${updates.newPDUFA.length}):\n`);
          for (const p of updates.newPDUFA) {
            console.log(`  {
    drug: '${p.drug}',
    brandName: ${p.brandName ? `'${p.brandName}'` : 'null'},
    company: '${p.company}',
    indication: '${p.indication || 'TBD'}',
    pdufaDate: '${p.pdufaDate}',
    submissionType: '${p.submissionType}',
    status: 'Pending',
    notes: 'Source: ${p.source}'
  },`);
          }
        }

        if (updates.newSubmissions.length > 0) {
          console.log(`\n📝 PENDING SUBMISSIONS (${updates.newSubmissions.length}):`);
          for (const s of updates.newSubmissions) {
            console.log(`  - ${s.drug} (${s.company}) - Submitted ${s.submissionDate || s.releaseDate}`);
          }
        }

        if (updates.toMarkApproved.length > 0) {
          console.log(`\n✅ MARK AS APPROVED (${updates.toMarkApproved.length}):`);
          for (const a of updates.toMarkApproved) {
            console.log(`  - ${a.drug} (${a.company})`);
          }
        }

        if (!updates.newPDUFA.length && !updates.newSubmissions.length && !updates.toMarkApproved.length) {
          console.log('\n✓ Curated list appears up to date!\n');
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

module.exports = { scrapeAll, analyzeUpdates, parseRelease };
