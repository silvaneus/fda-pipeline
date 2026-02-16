/**
 * Fetches clinical trial data from ClinicalTrials.gov API v2
 * Filters for Phase 3 and Phase 2/3 interventional trials in the US
 * with industry lead sponsors currently recruiting
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const DATA_DIR = path.join(__dirname, 'data');
const TRIALS_FILE = path.join(DATA_DIR, 'trials.json');
const LAST_FETCH_FILE = path.join(DATA_DIR, 'last-fetch.txt');

const BASE_URL = 'https://clinicaltrials.gov/api/v2/studies';
const PAGE_SIZE = 100;

// Fields to request from the API
const FIELDS = [
  'NCTId',
  'BriefTitle',
  'OfficialTitle',
  'LeadSponsorName',
  'LeadSponsorClass',
  'Condition',
  'InterventionName',
  'InterventionType',
  'Phase',
  'OverallStatus',
  'PrimaryCompletionDate',
  'EnrollmentCount',
  'StartDate',
  'LocationCountry'
].join(',');

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
        } else {
          reject(new Error(`HTTP ${response.statusCode}: ${data}`));
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

function extractTrialData(study) {
  const protocol = study.protocolSection || {};
  const identification = protocol.identificationModule || {};
  const sponsor = protocol.sponsorCollaboratorsModule || {};
  const conditions = protocol.conditionsModule || {};
  const interventions = protocol.armsInterventionsModule || {};
  const design = protocol.designModule || {};
  const status = protocol.statusModule || {};
  const contacts = protocol.contactsLocationsModule || {};

  const leadSponsor = sponsor.leadSponsor || {};
  const phases = design.phases || [];

  // Get intervention names
  const interventionList = interventions.interventions || [];
  const interventionNames = interventionList
    .filter(i => ['DRUG', 'BIOLOGICAL', 'GENETIC', 'COMBINATION_PRODUCT'].includes(i.type))
    .map(i => i.name)
    .filter(Boolean);

  // Get primary completion date
  const completionDateStruct = status.primaryCompletionDateStruct || {};
  const startDateStruct = status.startDateStruct || {};

  // Get location countries
  const locations = contacts.locations || [];
  const countries = [...new Set(locations.map(l => l.country).filter(Boolean))];

  return {
    nctId: identification.nctId,
    title: identification.briefTitle || identification.officialTitle,
    leadSponsor: leadSponsor.name,
    sponsorClass: leadSponsor.class,
    conditions: conditions.conditions || [],
    interventions: interventionNames.length > 0 ? interventionNames :
      interventionList.map(i => i.name).filter(Boolean),
    phases: phases,
    overallStatus: status.overallStatus,
    primaryCompletionDate: completionDateStruct.date,
    startDate: startDateStruct.date,
    enrollmentCount: design.enrollmentInfo?.count,
    locationCountries: countries
  };
}

function isPhase3Or2_3(phases) {
  if (!phases || phases.length === 0) return false;
  return phases.includes('PHASE3');
}

function isIndustrySponsored(trial) {
  return trial.sponsorClass === 'INDUSTRY';
}

function hasUSLocation(trial) {
  const countries = trial.locationCountries || [];
  return countries.some(c =>
    c && (c.toLowerCase() === 'united states' || c.toLowerCase() === 'usa' || c.toLowerCase() === 'us')
  );
}

async function fetchAllTrials(options = {}) {
  const { forceRefresh = false, verbose = true } = options;

  // Check cache
  if (!forceRefresh && fs.existsSync(TRIALS_FILE)) {
    const lastFetch = fs.existsSync(LAST_FETCH_FILE)
      ? fs.readFileSync(LAST_FETCH_FILE, 'utf-8').trim()
      : null;

    if (lastFetch) {
      const lastFetchDate = new Date(lastFetch);
      const hoursSinceFetch = (Date.now() - lastFetchDate.getTime()) / (1000 * 60 * 60);

      if (hoursSinceFetch < 24) {
        if (verbose) console.log(`Using cached data from ${lastFetch} (${hoursSinceFetch.toFixed(1)} hours ago)`);
        return JSON.parse(fs.readFileSync(TRIALS_FILE, 'utf-8'));
      }
    }
  }

  if (verbose) console.log('Fetching trials from ClinicalTrials.gov API...');

  const allStudies = [];
  let pageToken = null;
  let pageCount = 0;

  // Use filter.advanced for complex queries
  // Query for Phase 3 interventional trials that are recruiting, in the US
  const advancedFilter = encodeURIComponent(
    'AREA[Phase](PHASE3) AND AREA[OverallStatus](RECRUITING OR ENROLLING_BY_INVITATION) AND AREA[StudyType](INTERVENTIONAL) AND AREA[LocationCountry](United States)'
  );

  do {
    let url = `${BASE_URL}?format=json&pageSize=${PAGE_SIZE}&filter.advanced=${advancedFilter}&fields=${FIELDS}`;
    if (pageToken) {
      url += `&pageToken=${pageToken}`;
    }

    if (verbose) console.log(`Fetching page ${pageCount + 1}...`);

    try {
      const response = await httpsGet(url);
      const studies = response.studies || [];
      allStudies.push(...studies);
      pageToken = response.nextPageToken;
      pageCount++;

      if (verbose) console.log(`  Retrieved ${studies.length} studies (total: ${allStudies.length})`);

      // Rate limiting - wait between requests
      if (pageToken) {
        await delay(1200); // ~50 requests/minute
      }
    } catch (error) {
      console.error(`Error fetching page ${pageCount + 1}:`, error.message);
      if (pageCount === 0) throw error;
      break;
    }
  } while (pageToken);

  if (verbose) console.log(`\nFetched ${allStudies.length} total studies from API`);

  // Extract and filter trials
  const trials = allStudies
    .map(extractTrialData)
    .filter(trial => {
      // Must be industry sponsored (lead sponsor)
      if (!isIndustrySponsored(trial)) return false;

      // Must be Phase 3 or Phase 2/3
      if (!isPhase3Or2_3(trial.phases)) return false;

      // Must have US location
      if (!hasUSLocation(trial)) return false;

      return true;
    });

  if (verbose) {
    console.log(`Filtered to ${trials.length} industry-sponsored Phase 3 trials with US locations`);
  }

  // Ensure data directory exists
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  // Save to cache
  fs.writeFileSync(TRIALS_FILE, JSON.stringify(trials, null, 2));
  fs.writeFileSync(LAST_FETCH_FILE, new Date().toISOString());

  if (verbose) console.log(`Saved ${trials.length} trials to ${TRIALS_FILE}`);

  return trials;
}

// Allow running directly
if (require.main === module) {
  fetchAllTrials({ forceRefresh: process.argv.includes('--force') })
    .then(trials => {
      console.log(`\nCompleted. Total trials: ${trials.length}`);

      // Show sample
      if (trials.length > 0) {
        console.log('\nSample trial:');
        console.log(JSON.stringify(trials[0], null, 2));
      }
    })
    .catch(err => {
      console.error('Error:', err);
      process.exit(1);
    });
}

module.exports = { fetchAllTrials };
