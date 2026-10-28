/**
 * ClinicalTrials.gov API v2 client: paged fetch of studies matching an
 * advanced filter, flattened to the fields the tracker uses.
 */

const BASE_URL = 'https://clinicaltrials.gov/api/v2/studies';
const PAGE_SIZE = 1000;

const FIELDS = [
  'NCTId', 'BriefTitle', 'OfficialTitle', 'LeadSponsorName', 'LeadSponsorClass', 'Phase',
  'StudyType', 'OverallStatus', 'StudyFirstPostDate', 'StartDate', 'CompletionDate',
  'PrimaryCompletionDate', 'LastUpdatePostDate',
  'Condition', 'InterventionName', 'InterventionType', 'LocationCountry',
  'CentralContactPhone', 'CentralContactEMail',
].join(',');

async function getJson(url, tries = 4) {
  for (let i = 1; ; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(60000) });
      if (res.ok) return await res.json();
      throw new Error(`HTTP ${res.status}`);
    } catch (e) {
      if (i >= tries) throw e;
      await new Promise(r => setTimeout(r, 2000 * i));
    }
  }
}

function flatten(s) {
  const p = s.protocolSection || {};
  const id = p.identificationModule || {};
  const st = p.statusModule || {};
  const sp = p.sponsorCollaboratorsModule || {};
  const d = p.designModule || {};
  const countries = new Set((p.contactsLocationsModule?.locations || []).map(l => l.country).filter(Boolean));
  return {
    nct: id.nctId,
    title: id.briefTitle,
    officialTitle: id.officialTitle || null,
    sponsor: sp.leadSponsor?.name,
    sponsorClass: sp.leadSponsor?.class,
    phases: d.phases || [],
    type: d.studyType,
    status: st.overallStatus,
    firstPosted: st.studyFirstPostDateStruct?.date,
    start: st.startDateStruct?.date,
    completion: st.completionDateStruct?.date || st.primaryCompletionDateStruct?.date || null,
    lastUpdate: st.lastUpdatePostDateStruct?.date || null,
    conditions: p.conditionsModule?.conditions || [],
    interventions: (p.armsInterventionsModule?.interventions || []).map(x => x.name),
    interventionTypes: [...new Set((p.armsInterventionsModule?.interventions || []).map(x => x.type))],
    countries: [...countries],
    contacts: (p.contactsLocationsModule?.centralContacts || [])
      .map(c => ({ phone: c.phone || null, email: c.email || null }))
      .filter(c => c.phone || c.email),
  };
}

/** Fetch every study matching `advanced` (ClinicalTrials.gov Essie syntax). */
async function fetchStudies(advanced, { onPage } = {}) {
  const out = [];
  let token;
  do {
    const u = new URL(BASE_URL);
    u.searchParams.set('filter.advanced', advanced);
    u.searchParams.set('fields', FIELDS);
    u.searchParams.set('pageSize', PAGE_SIZE);
    if (token) u.searchParams.set('pageToken', token);
    const j = await getJson(u);
    out.push(...j.studies.map(flatten));
    token = j.nextPageToken;
    onPage?.(out.length);
  } while (token);
  return out;
}

module.exports = { fetchStudies };
