/**
 * Checks if drugs are already FDA-approved using OpenFDA API
 * Determines if a trial is for a new approval (NDA/BLA) or supplemental indication (sNDA/sBLA)
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const DATA_DIR = path.join(__dirname, 'data');
const APPROVED_DRUGS_FILE = path.join(DATA_DIR, 'approved-drugs.json');
const DRUGS_LAST_FETCH_FILE = path.join(DATA_DIR, 'approved-drugs-last-fetch.txt');
const LIVE_LOOKUP_CACHE_FILE = path.join(DATA_DIR, 'live-lookup-cache.json');

// OpenFDA API for approved drugs
const OPENFDA_BASE = 'https://api.fda.gov/drug/drugsfda.json';

// Cache for live lookups (persisted to disk)
let liveLookupCache = {};
try {
  if (fs.existsSync(LIVE_LOOKUP_CACHE_FILE)) {
    liveLookupCache = JSON.parse(fs.readFileSync(LIVE_LOOKUP_CACHE_FILE, 'utf-8'));
  }
} catch (e) {
  liveLookupCache = {};
}

function saveLiveLookupCache() {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(LIVE_LOOKUP_CACHE_FILE, JSON.stringify(liveLookupCache, null, 2));
  } catch (e) {
    // Ignore cache save errors
  }
}

// Live lookup a drug in OpenFDA
async function liveCheckFDA(drugName) {
  const normalized = normalizeDrugName(drugName);

  // Check cache first
  if (liveLookupCache[normalized] !== undefined) {
    return liveLookupCache[normalized];
  }

  try {
    // Search OpenFDA for this drug
    const searchTerm = encodeURIComponent(drugName.toLowerCase());
    const url = `${OPENFDA_BASE}?search=(openfda.brand_name:"${searchTerm}"+openfda.generic_name:"${searchTerm}"+openfda.substance_name:"${searchTerm}")&limit=1`;

    const response = await httpsGet(url);
    const isApproved = response.results && response.results.length > 0;

    // Cache the result
    liveLookupCache[normalized] = isApproved;
    saveLiveLookupCache();

    return isApproved;
  } catch (e) {
    // On error, assume not approved (conservative)
    liveLookupCache[normalized] = false;
    return false;
  }
}

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, (response) => {
      let data = '';
      response.on('data', chunk => data += chunk);
      response.on('end', () => {
        if (response.statusCode === 200) {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error(`Failed to parse JSON: ${e.message}`));
          }
        } else if (response.statusCode === 404) {
          resolve({ results: [] });
        } else {
          reject(new Error(`HTTP ${response.statusCode}: ${data.substring(0, 200)}`));
        }
      });
    });
    request.on('error', reject);
    request.setTimeout(30000, () => {
      request.destroy();
      reject(new Error('Request timeout'));
    });
  });
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Known approved drugs - maps brand names, generics, and variants to a canonical name
// This supplements the OpenFDA database which has a 25K record limit
const KNOWN_APPROVED_DRUGS = new Set([
  // Migraine/CGRP drugs
  'rimegepant', 'nurtec', 'ubrogepant', 'ubrelvy', 'atogepant', 'qulipta',
  'erenumab', 'aimovig', 'fremanezumab', 'ajovy', 'galcanezumab', 'emgality',
  'eptinezumab', 'vyepti', 'lasmiditan', 'reyvow',
  // Immunoglobulins
  'panzyga', 'immuneglobulin', 'ivig', 'gammagard', 'gamunex', 'privigen',
  'octagam', 'flebogamma', 'bivigam', 'asceniv', 'cutaquig', 'hizentra',
  'cuvitru', 'xembify', 'hyqvia',
  // More oncology
  'pembrolizumab', 'nivolumab', 'atezolizumab', 'durvalumab', 'avelumab',
  'cemiplimab', 'dostarlimab', 'retifanlimab', 'toripalimab', 'tislelizumab',
  'palbociclib', 'ribociclib', 'abemaciclib', 'osimertinib', 'sotorasib',
  'adagrasib', 'lorlatinib', 'alectinib', 'brigatinib', 'ceritinib',
  'entrectinib', 'larotrectinib', 'selpercatinib', 'pralsetinib',
  'capmatinib', 'tepotinib', 'mobocertinib', 'amivantamab',
  'trastuzumab', 'pertuzumab', 'tucatinib', 'neratinib', 'margetuximab',
  'sacituzumabgovitecan', 'trastuzumabderuxtecan', 'enfortumabvedotin',
  'brentuximabvedotin', 'polatuzumabvedotin', 'loncastuximabtesirine',
  'belantamabmafodotin', 'tisotumabvedotin', 'mirvetuximabsoravtansine',
  'olaparib', 'rucaparib', 'niraparib', 'talazoparib',
  'venetoclax', 'ibrutinib', 'acalabrutinib', 'zanubrutinib', 'pirtobrutinib',
  'idelalisib', 'duvelisib', 'umbralisib', 'copanlisib',
  'selinexor', 'belzutifan', 'tazemetostat', 'ivosidenib', 'enasidenib',
  'gilteritinib', 'midostaurin', 'quizartinib', 'avapritinib', 'ripretinib',
  'regorafenib', 'cabozantinib', 'lenvatinib', 'axitinib', 'pazopanib',
  'sunitinib', 'sorafenib', 'tivozanib', 'erdafitinib', 'pemigatinib',
  'infigratinib', 'futibatinib', 'dabrafenib', 'trametinib', 'vemurafenib',
  'cobimetinib', 'binimetinib', 'encorafenib',
  // CAR-T and cell therapies
  'tisagenlecleucel', 'axicabtageneciloleucel', 'brexucabtageneautoleucel',
  'lisocabtagenemaraleucel', 'idecabtagenevicleucel', 'ciltacabtageneautoleucel',
  // Immunology/Rheumatology
  'adalimumab', 'etanercept', 'infliximab', 'golimumab', 'certolizumab',
  'ustekinumab', 'secukinumab', 'ixekizumab', 'brodalumab', 'guselkumab',
  'risankizumab', 'tildrakizumab', 'bimekizumab', 'spesolimab',
  'dupilumab', 'tralokinumab', 'lebrikizumab', 'nemolizumab',
  'tofacitinib', 'baricitinib', 'upadacitinib', 'abrocitinib', 'ruxolitinib',
  'fedratinib', 'pacritinib', 'deucravacitinib',
  'vedolizumab', 'natalizumab', 'ozanimod', 'etrasimod',
  'belimumab', 'anifrolumab', 'rituximab', 'obinutuzumab', 'ofatumumab',
  'ocrelizumab', 'ublituximab', 'inebilizumab',
  'sarilumab', 'tocilizumab', 'siltuximab',
  'canakinumab', 'anakinra', 'rilonacept',
  'omalizumab', 'mepolizumab', 'benralizumab', 'tezepelumab',
  // Neurology
  'eculizumab', 'ravulizumab', 'zilucoplan', 'rozanolixizumab', 'efgartigimod',
  'nusinersen', 'onasemnogeneabeparvovec', 'risdiplam',
  'aducanumab', 'lecanemab', 'donanemab',
  'fremanezumab', 'erenumab', 'galcanezumab', 'eptinezumab',
  // GLP-1/Obesity/Diabetes
  'semaglutide', 'wegovy', 'ozempic', 'rybelsus', 'tirzepatide', 'mounjaro',
  'zepbound', 'liraglutide', 'victoza', 'saxenda', 'dulaglutide', 'trulicity',
  'exenatide', 'bydureon', 'byetta',
  // Cardiovascular
  'inclisiran', 'evolocumab', 'alirocumab', 'evinacumab',
  'mavacamten', 'aficamten', 'tafamidis', 'patisiran', 'inotersen', 'vutrisiran',
  // Other commonly used
  'tezepelumab', 'itepekimab', 'astegolimab'
]);

// Known brand/code name aliases (development names -> approved generic names)
const BRAND_ALIASES = {
  'karxt': 'xanomeline',
  'cobenfy': 'xanomeline',
  'nurtec': 'rimegepant',
  'nurtecodt': 'rimegepant',
  'ubrelvy': 'ubrogepant',
  'qulipta': 'atogepant',
  'keytruda': 'pembrolizumab',
  'opdivo': 'nivolumab',
  'tecentriq': 'atezolizumab',
  'imfinzi': 'durvalumab',
  'bavencio': 'avelumab',
  'libtayo': 'cemiplimab',
  'jemperli': 'dostarlimab',
  'trodelvy': 'sacituzumabgovitecan',
  'enhertu': 'trastuzumabderuxtecan',
  'tdxd': 'trastuzumabderuxtecan',
  't-dxd': 'trastuzumabderuxtecan',
  'ds8201': 'trastuzumabderuxtecan',
  'ds-8201': 'trastuzumabderuxtecan',
  'padcev': 'enfortumabvedotin',
  'ev': 'enfortumabvedotin',
  'adcetris': 'brentuximabvedotin',
  'polivy': 'polatuzumabvedotin',
  'elahere': 'mirvetuximabsoravtansine',
  // Common ADC and drug abbreviations
  'sg': 'sacituzumabgovitecan',
  'sgtrop2': 'sacituzumabgovitecan',
  'ocrevus': 'ocrelizumab',
  'kesimpta': 'ofatumumab',
  'briumvi': 'ublituximab',
  'humira': 'adalimumab',
  'enbrel': 'etanercept',
  'remicade': 'infliximab',
  'simponi': 'golimumab',
  'cimzia': 'certolizumab',
  'stelara': 'ustekinumab',
  'cosentyx': 'secukinumab',
  'taltz': 'ixekizumab',
  'siliq': 'brodalumab',
  'tremfya': 'guselkumab',
  'skyrizi': 'risankizumab',
  'ilumya': 'tildrakizumab',
  'bimzelx': 'bimekizumab',
  'spevigo': 'spesolimab',
  'dupixent': 'dupilumab',
  'adbry': 'tralokinumab',
  'ebglyss': 'lebrikizumab',
  'rinvoq': 'upadacitinib',
  'xeljanz': 'tofacitinib',
  'olumiant': 'baricitinib',
  'cibinqo': 'abrocitinib',
  'jakafi': 'ruxolitinib',
  'sotyktu': 'deucravacitinib',
  'entyvio': 'vedolizumab',
  'tysabri': 'natalizumab',
  'zeposia': 'ozanimod',
  'velsipity': 'etrasimod',
  'benlysta': 'belimumab',
  'saphnelo': 'anifrolumab',
  'rituxan': 'rituximab',
  'gazyva': 'obinutuzumab',
  'kevzara': 'sarilumab',
  'actemra': 'tocilizumab',
  'ilaris': 'canakinumab',
  'kineret': 'anakinra',
  'arcalyst': 'rilonacept',
  'xolair': 'omalizumab',
  'nucala': 'mepolizumab',
  'fasenra': 'benralizumab',
  'tezspire': 'tezepelumab',
  'soliris': 'eculizumab',
  'ultomiris': 'ravulizumab',
  'vyvgart': 'efgartigimod',
  'spinraza': 'nusinersen',
  'zolgensma': 'onasemnogeneabeparvovec',
  'evrysdi': 'risdiplam',
  'aduhelm': 'aducanumab',
  'leqembi': 'lecanemab',
  'kisunla': 'donanemab',
  'aimovig': 'erenumab',
  'ajovy': 'fremanezumab',
  'emgality': 'galcanezumab',
  'vyepti': 'eptinezumab',
  'revlimid': 'lenalidomide',
  'pomalyst': 'pomalidomide',
  'ibrance': 'palbociclib',
  'kisqali': 'ribociclib',
  'verzenio': 'abemaciclib',
  'tagrisso': 'osimertinib',
  'lumakras': 'sotorasib',
  'krazati': 'adagrasib',
  'lorbrena': 'lorlatinib',
  'alecensa': 'alectinib',
  'alunbrig': 'brigatinib',
  'zykadia': 'ceritinib',
  'rozlytrek': 'entrectinib',
  'vitrakvi': 'larotrectinib',
  'retevmo': 'selpercatinib',
  'gavreto': 'pralsetinib',
  'tabrecta': 'capmatinib',
  'tepmetko': 'tepotinib',
  'exkivity': 'mobocertinib',
  'rybrevant': 'amivantamab',
  'herceptin': 'trastuzumab',
  'perjeta': 'pertuzumab',
  'tukysa': 'tucatinib',
  'nerlynx': 'neratinib',
  'margenza': 'margetuximab',
  'lynparza': 'olaparib',
  'rubraca': 'rucaparib',
  'zejula': 'niraparib',
  'talzenna': 'talazoparib',
  'venclexta': 'venetoclax',
  'imbruvica': 'ibrutinib',
  'calquence': 'acalabrutinib',
  'brukinsa': 'zanubrutinib',
  'jaypirca': 'pirtobrutinib',
  'zydelig': 'idelalisib',
  'copiktra': 'duvelisib',
  'xpovio': 'selinexor',
  'welireg': 'belzutifan',
  'tazverik': 'tazemetostat',
  'tibsovo': 'ivosidenib',
  'idhifa': 'enasidenib',
  'xospata': 'gilteritinib',
  'rydapt': 'midostaurin',
  'vanflyta': 'quizartinib',
  'ayvakit': 'avapritinib',
  'qinlock': 'ripretinib',
  'stivarga': 'regorafenib',
  'cabometyx': 'cabozantinib',
  'cometriq': 'cabozantinib',
  'lenvima': 'lenvatinib',
  'inlyta': 'axitinib',
  'votrient': 'pazopanib',
  'sutent': 'sunitinib',
  'nexavar': 'sorafenib',
  'fotivda': 'tivozanib',
  'balversa': 'erdafitinib',
  'pemazyre': 'pemigatinib',
  'truseltiq': 'infigratinib',
  'lytgobi': 'futibatinib',
  'tafinlar': 'dabrafenib',
  'mekinist': 'trametinib',
  'zelboraf': 'vemurafenib',
  'cotellic': 'cobimetinib',
  'mektovi': 'binimetinib',
  'braftovi': 'encorafenib',
  'kymriah': 'tisagenlecleucel',
  'yescarta': 'axicabtageneciloleucel',
  'tecartus': 'brexucabtageneautoleucel',
  'breyanzi': 'lisocabtagenemaraleucel',
  'abecma': 'idecabtagenevicleucel',
  'carvykti': 'ciltacabtageneautoleucel',
  'darzalex': 'daratumumab',
  'ozempic': 'semaglutide',
  'wegovy': 'semaglutide',
  'rybelsus': 'semaglutide',
  'mounjaro': 'tirzepatide',
  'zepbound': 'tirzepatide',
  'victoza': 'liraglutide',
  'saxenda': 'liraglutide',
  'trulicity': 'dulaglutide',
  'bydureon': 'exenatide',
  'byetta': 'exenatide',
  'leqvio': 'inclisiran',
  'repatha': 'evolocumab',
  'praluent': 'alirocumab',
  'evkeeza': 'evinacumab',
  'camzyos': 'mavacamten',
  'vyndaqel': 'tafamidis',
  'vyndamax': 'tafamidis',
  'onpattro': 'patisiran',
  'tegsedi': 'inotersen',
  'amvuttra': 'vutrisiran',
  'gammagard': 'immuneglobulin',
  'gamunex': 'immuneglobulin',
  'privigen': 'immuneglobulin',
  'octagam': 'immuneglobulin',
  'flebogamma': 'immuneglobulin',
  'panzyga': 'immuneglobulin',
  'bivigam': 'immuneglobulin',
  'asceniv': 'immuneglobulin',
  'hizentra': 'immuneglobulin',
  'cuvitru': 'immuneglobulin',
  'xembify': 'immuneglobulin',
  'hyqvia': 'immuneglobulin',
  'cutaquig': 'immuneglobulin'
};

// Normalize drug name for comparison
function normalizeDrugName(name) {
  if (!name) return '';
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '') // Remove non-alphanumeric
    .replace(/\d+mg|\d+ml|\d+mcg|\d+iu/g, '') // Remove dosages
    .trim();
}

// Extract the core drug name (first word often)
function extractCoreName(name) {
  if (!name) return '';
  // Remove common suffixes and get core name
  const cleaned = name
    .toLowerCase()
    .replace(/\s*(injection|tablet|capsule|solution|suspension|cream|ointment|patch|inhaler|spray|drops|gel|lotion|powder|extended.release|delayed.release|immediate.release|er|sr|cr|xl|xr)\s*/gi, ' ')
    .replace(/\s*(hydrochloride|hcl|sodium|potassium|acetate|sulfate|phosphate|citrate|maleate|besylate|mesylate|fumarate|tartrate|succinate)\s*/gi, ' ')
    .replace(/\d+\s*(mg|ml|mcg|iu|%)/gi, '')
    .trim();

  // Get first meaningful word (often the drug name)
  const words = cleaned.split(/\s+/).filter(w => w.length > 2);
  return words[0] || cleaned;
}

async function fetchApprovedDrugs(options = {}) {
  const { forceRefresh = false, verbose = true } = options;

  // Check cache (refresh weekly)
  if (!forceRefresh && fs.existsSync(APPROVED_DRUGS_FILE)) {
    const lastFetch = fs.existsSync(DRUGS_LAST_FETCH_FILE)
      ? fs.readFileSync(DRUGS_LAST_FETCH_FILE, 'utf-8').trim()
      : null;

    if (lastFetch) {
      const lastFetchDate = new Date(lastFetch);
      const daysSinceFetch = (Date.now() - lastFetchDate.getTime()) / (1000 * 60 * 60 * 24);

      if (daysSinceFetch < 7) {
        if (verbose) console.log(`Using cached approved drugs data (${daysSinceFetch.toFixed(1)} days old)`);
        return JSON.parse(fs.readFileSync(APPROVED_DRUGS_FILE, 'utf-8'));
      }
    }
  }

  if (verbose) console.log('Fetching approved drugs from OpenFDA...');

  const approvedDrugs = new Map();
  let skip = 0;
  const limit = 1000;
  let totalFetched = 0;

  try {
    // Fetch approved drugs in batches
    // Need ~30 batches to get all ~29K drugs from OpenFDA
    for (let batch = 0; batch < 35; batch++) {
      const url = `${OPENFDA_BASE}?limit=${limit}&skip=${skip}`;

      if (verbose && batch % 5 === 0) {
        console.log(`  Fetching batch ${batch + 1}...`);
      }

      try {
        const response = await httpsGet(url);
        const results = response.results || [];

        if (results.length === 0) break;

        for (const drug of results) {
          // Get brand names
          const brandNames = drug.openfda?.brand_name || [];
          const genericNames = drug.openfda?.generic_name || [];
          const substanceNames = drug.openfda?.substance_name || [];

          // Get application number and type
          const appNumber = drug.application_number || '';
          const submissions = drug.submissions || [];
          const approvalDate = submissions[0]?.submission_status_date || '';

          // Store all name variations
          const allNames = [...brandNames, ...genericNames, ...substanceNames];

          for (const name of allNames) {
            const normalized = normalizeDrugName(name);
            const core = extractCoreName(name);

            if (normalized && normalized.length > 2) {
              if (!approvedDrugs.has(normalized)) {
                approvedDrugs.set(normalized, {
                  brandNames: brandNames.slice(0, 3),
                  genericNames: genericNames.slice(0, 2),
                  appNumber,
                  approvalDate
                });
              }
            }
            if (core && core.length > 2 && core !== normalized) {
              if (!approvedDrugs.has(core)) {
                approvedDrugs.set(core, {
                  brandNames: brandNames.slice(0, 3),
                  genericNames: genericNames.slice(0, 2),
                  appNumber,
                  approvalDate
                });
              }
            }
          }
        }

        totalFetched += results.length;
        skip += limit;

        // Rate limiting
        await delay(200);

      } catch (err) {
        if (verbose) console.log(`  Warning: ${err.message}`);
        break;
      }
    }
  } catch (err) {
    if (verbose) console.log(`  Error fetching drugs: ${err.message}`);
  }

  // Convert Map to object for JSON storage
  const drugsObject = Object.fromEntries(approvedDrugs);

  if (verbose) {
    console.log(`  Fetched ${totalFetched} drug records, ${Object.keys(drugsObject).length} unique names`);
  }

  // Ensure data directory exists
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  // Save to cache
  fs.writeFileSync(APPROVED_DRUGS_FILE, JSON.stringify(drugsObject, null, 2));
  fs.writeFileSync(DRUGS_LAST_FETCH_FILE, new Date().toISOString());

  return drugsObject;
}

// Check if an intervention is already FDA-approved
function checkApprovalStatus(interventionName, approvedDrugs) {
  if (!interventionName || !approvedDrugs) {
    return { isApproved: false, status: 'Unknown' };
  }

  // Clean up the intervention name - remove suffixes like (US), (EU), dosages
  const cleanedName = interventionName
    .replace(/\s*\([^)]*\)\s*/g, ' ')  // Remove parenthetical suffixes
    .replace(/\s+/g, ' ')
    .trim();

  const normalized = normalizeDrugName(cleanedName);
  const core = extractCoreName(cleanedName);

  // Check brand name aliases first
  if (BRAND_ALIASES[normalized]) {
    return {
      isApproved: true,
      status: 'Supplemental',
      matchedName: BRAND_ALIASES[normalized],
      details: null
    };
  }
  if (BRAND_ALIASES[core]) {
    return {
      isApproved: true,
      status: 'Supplemental',
      matchedName: BRAND_ALIASES[core],
      details: null
    };
  }

  // Check known approved drugs list (supplements OpenFDA database)
  if (KNOWN_APPROVED_DRUGS.has(normalized)) {
    return {
      isApproved: true,
      status: 'Supplemental',
      matchedName: normalized,
      details: null
    };
  }
  if (KNOWN_APPROVED_DRUGS.has(core)) {
    return {
      isApproved: true,
      status: 'Supplemental',
      matchedName: core,
      details: null
    };
  }

  // Check direct match (full normalized name)
  if (approvedDrugs[normalized]) {
    return {
      isApproved: true,
      status: 'Supplemental',
      matchedName: normalized,
      details: approvedDrugs[normalized]
    };
  }

  // Detect ADC-like multi-word drug names (e.g., "sacituzumab tirumotecan")
  // These should NOT match partial names - they are distinct drugs
  const words = cleanedName.toLowerCase().split(/\s+/);
  const isCombinationProduct = cleanedName.includes('/') || cleanedName.toLowerCase().includes(' and ');
  const isLikelyADC = words.length === 2 && !isCombinationProduct &&
    (words[1].endsWith('tecan') || words[1].endsWith('vedotin') ||
     words[1].endsWith('mab') || words[1].endsWith('tinib') ||
     words[1].endsWith('ciclib') || words[1].endsWith('sertib'));

  // For single-word drugs or non-ADC multi-word, check core name
  if (!isLikelyADC && approvedDrugs[core] && core.length > 3) {
    return {
      isApproved: true,
      status: 'Supplemental',
      matchedName: core,
      details: approvedDrugs[core]
    };
  }

  // For combination products (Drug A/Drug B or Drug A and Drug B), check each component
  if (isCombinationProduct) {
    const components = cleanedName.split(/\s*[\/\+]\s*|\s+and\s+/i);
    for (const component of components) {
      const compNormalized = normalizeDrugName(component);
      const compCore = extractCoreName(component);

      // Check aliases for components
      if (BRAND_ALIASES[compNormalized] && approvedDrugs[BRAND_ALIASES[compNormalized]]) {
        return {
          isApproved: true,
          status: 'Supplemental',
          matchedName: BRAND_ALIASES[compNormalized],
          details: approvedDrugs[BRAND_ALIASES[compNormalized]]
        };
      }

      if (compNormalized.length > 3 && approvedDrugs[compNormalized]) {
        return {
          isApproved: true,
          status: 'Supplemental',
          matchedName: compNormalized,
          details: approvedDrugs[compNormalized]
        };
      }
      if (compCore.length > 3 && approvedDrugs[compCore]) {
        return {
          isApproved: true,
          status: 'Supplemental',
          matchedName: compCore,
          details: approvedDrugs[compCore]
        };
      }
    }
  }

  // Not found in local data - return not approved for sync version
  return {
    isApproved: false,
    status: 'New Approval'
  };
}

// Async version with live FDA lookup fallback
async function checkApprovalStatusAsync(interventionName, approvedDrugs) {
  // First try the sync check
  const syncResult = checkApprovalStatus(interventionName, approvedDrugs);
  if (syncResult.isApproved) {
    return syncResult;
  }

  // If not found locally, try live FDA lookup
  const cleanedName = interventionName
    .replace(/\s*\([^)]*\)\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Extract potential drug names to check
  const namesToCheck = [cleanedName];

  // Also extract code names (e.g., DM199, BMS-986xxx)
  const codeMatch = cleanedName.match(/\b([A-Z]{2,4}[-\s]?\d{2,6}[A-Z]?)\b/i);
  if (codeMatch) {
    namesToCheck.push(codeMatch[1]);
  }

  // Try live lookup for each name
  for (const name of namesToCheck) {
    if (name.length < 3) continue;

    const isApproved = await liveCheckFDA(name);
    if (isApproved) {
      return {
        isApproved: true,
        status: 'Supplemental',
        matchedName: name,
        details: null
      };
    }
  }

  return {
    isApproved: false,
    status: 'New Approval'
  };
}

// Determine approval type for a trial based on its interventions
function determineApprovalType(interventions, approvedDrugs) {
  if (!interventions || interventions.length === 0) {
    return { type: 'Unknown', details: null };
  }

  // Check each intervention
  for (const intervention of interventions) {
    const status = checkApprovalStatus(intervention, approvedDrugs);
    if (status.isApproved) {
      return {
        type: 'Supplemental',
        details: status.details,
        matchedDrug: intervention
      };
    }
  }

  // No approved drugs found - likely new approval
  return {
    type: 'New Approval',
    details: null
  };
}

// Async version with live lookup
async function determineApprovalTypeAsync(interventions, approvedDrugs) {
  if (!interventions || interventions.length === 0) {
    return { type: 'Unknown', details: null };
  }

  // Check each intervention with async lookup
  for (const intervention of interventions) {
    const status = await checkApprovalStatusAsync(intervention, approvedDrugs);
    if (status.isApproved) {
      return {
        type: 'Supplemental',
        details: status.details,
        matchedDrug: intervention
      };
    }
  }

  return {
    type: 'New Approval',
    details: null
  };
}

// Extract the best/shortest intervention name from a list
// Prefers code names (DM199, LY123456) over long descriptive names
function getBestInterventionName(interventions) {
  if (!interventions || interventions.length === 0) return null;

  // Patterns for code names (company prefixes + numbers)
  const codePatterns = [
    /^[A-Z]{2,5}[-\s]?\d{3,6}[A-Z]?$/i,  // DM199, BMS-986xxx, LY3456
    /^[A-Z]{2,4}\d{2,4}$/i,               // AB123
    /^\d{3,4}[-\s]?[A-Z]{2,4}$/i,         // 123-ABC
  ];

  // First, look for code names
  for (const intervention of interventions) {
    const cleaned = intervention.trim();
    for (const pattern of codePatterns) {
      if (pattern.test(cleaned)) {
        return cleaned;
      }
    }
  }

  // Next, look for code names within longer strings
  for (const intervention of interventions) {
    const match = intervention.match(/\b([A-Z]{2,5}[-\s]?\d{3,6}[A-Z]?)\b/i);
    if (match) {
      return match[1];
    }
  }

  // Fall back to shortest non-trivial intervention name
  const validInterventions = interventions.filter(i =>
    i.length > 2 &&
    !/placebo|sham|control|standard of care/i.test(i)
  );

  if (validInterventions.length === 0) return interventions[0];

  return validInterventions.sort((a, b) => a.length - b.length)[0];
}

module.exports = {
  fetchApprovedDrugs,
  checkApprovalStatus,
  checkApprovalStatusAsync,
  determineApprovalType,
  determineApprovalTypeAsync,
  normalizeDrugName,
  extractCoreName,
  getBestInterventionName,
  liveCheckFDA
};
