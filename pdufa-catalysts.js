/**
 * PDUFA Catalysts Data Source
 * Curated list of upcoming FDA decision dates + web scraping from reliable sources
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const { classifyCondition } = require('./classify-disease');
const { getSuccessRate } = require('./success-rates');

const DATA_DIR = path.join(__dirname, 'data');
const CATALYSTS_CACHE_FILE = path.join(DATA_DIR, 'pdufa-catalysts.json');
const CATALYSTS_LAST_FETCH = path.join(DATA_DIR, 'pdufa-catalysts-last-fetch.txt');
const SCRAPED_RESULTS_FILE = path.join(DATA_DIR, 'scraped-results.json');

/**
 * Curated list of known upcoming PDUFA dates
 * This should be updated periodically with new catalyst data
 * Sources: Company press releases, SEC filings, FDA announcements
 */
const CURATED_CATALYSTS = [
  // Submitted - Awaiting FDA Acceptance (PDUFA TBD)
  {
    drug: 'lorundrostat',
    brandName: null,
    company: 'Mineralys Therapeutics',
    indication: 'Uncontrolled/Resistant Hypertension',
    pdufaDate: null,
    submissionDate: '2025-12-15',
    submissionType: 'NDA',
    status: 'Submitted - Awaiting PDUFA',
    notes: 'Aldosterone synthase inhibitor; FDA has 60 days to accept'
  },
  {
    drug: 'lirafugratinib',
    brandName: null,
    company: 'Elevar Therapeutics',
    indication: 'Cholangiocarcinoma (Second-line)',
    pdufaDate: null,
    submissionDate: '2026-01-15',
    submissionType: 'NDA',
    status: 'Submitted - Awaiting PDUFA',
    notes: 'FGFR inhibitor; previously submitted for HCC'
  },
  {
    drug: 'deramiocel',
    brandName: null,
    company: 'Capricor Therapeutics',
    indication: 'Duchenne Muscular Dystrophy',
    pdufaDate: null,
    submissionDate: '2026-02-01',
    submissionType: 'BLA',
    status: 'Submitted - Awaiting PDUFA',
    notes: 'Cell therapy; HOPE-3 CSR submitted Feb 2026'
  },
  // February 2026
  {
    drug: 'milsaperidone',
    brandName: 'Bysanti',
    company: 'Vanda Pharmaceuticals',
    indication: 'Schizophrenia and Bipolar I Disorder',
    pdufaDate: '2026-02-21',
    submissionType: 'NDA',
    status: 'Pending',
    notes: 'Novel antipsychotic'
  },
  {
    drug: 'pegzilarginase',
    brandName: null,
    company: 'Immedica Pharma',
    indication: 'Arginase 1 Deficiency',
    pdufaDate: '2026-02-23',
    submissionType: 'BLA',
    status: 'Pending',
    notes: 'Enzyme replacement therapy'
  },
  {
    drug: 'ET-600',
    brandName: null,
    company: 'Eton Pharmaceuticals',
    indication: 'Central Diabetes Insipidus',
    pdufaDate: '2026-02-25',
    submissionType: 'NDA',
    status: 'Pending',
    notes: 'Arginine vasopressin deficiency'
  },
  {
    drug: 'decitabine/cedazuridine + venetoclax',
    brandName: 'INQOVI + Venclexta',
    company: 'Otsuka/Taiho Oncology',
    indication: 'Acute Myeloid Leukemia (AML)',
    pdufaDate: '2026-02-25',
    submissionType: 'sNDA',
    status: 'Pending',
    notes: 'Combination therapy for newly diagnosed AML'
  },
  {
    drug: 'pegvaliase-pqpz',
    brandName: 'Palynziq',
    company: 'BioMarin Pharmaceutical',
    indication: 'Phenylketonuria (PKU) - Adolescents',
    pdufaDate: '2026-02-28',
    submissionType: 'sBLA',
    status: 'Pending',
    notes: 'Expansion to ages 12-17'
  },
  {
    drug: 'navepegritide',
    brandName: 'TransCon CNP',
    company: 'Ascendis Pharma',
    indication: 'Achondroplasia',
    pdufaDate: '2026-02-28',
    submissionType: 'NDA',
    status: 'Pending',
    notes: 'C-type natriuretic peptide for children'
  },
  {
    drug: 'dupilumab',
    brandName: 'Dupixent',
    company: 'Sanofi/Regeneron',
    indication: 'Allergic Fungal Rhinosinusitis',
    pdufaDate: '2026-02-28',
    submissionType: 'sBLA',
    status: 'Pending',
    notes: 'Adults and children 6+'
  },
  {
    drug: 'idebenone',
    brandName: null,
    company: 'Chiesi',
    indication: 'Leber Hereditary Optic Neuropathy',
    pdufaDate: '2026-02-28',
    submissionType: 'NDA',
    status: 'Pending',
    notes: 'Mitochondrial disease therapy'
  },
  // March 2026
  {
    drug: 'deucravacitinib',
    brandName: 'Sotyktu',
    company: 'Bristol Myers Squibb',
    indication: 'Psoriatic Arthritis',
    pdufaDate: '2026-03-06',
    submissionType: 'sNDA',
    status: 'Pending',
    notes: 'First TYK2 inhibitor for PsA'
  },
  {
    drug: 'vanzacaftor/tezacaftor/deutivacaftor',
    brandName: 'Alyftrek',
    company: 'Vertex Pharmaceuticals',
    indication: 'Cystic Fibrosis',
    pdufaDate: '2026-03-08',
    submissionType: 'NDA',
    status: 'Pending',
    notes: 'Next-gen CF triple combo'
  },
  {
    drug: 'pirtobrutinib',
    brandName: 'Jaypirca',
    company: 'Eli Lilly',
    indication: 'Chronic Lymphocytic Leukemia (CLL)',
    pdufaDate: '2026-03-15',
    submissionType: 'sBLA',
    status: 'Pending',
    notes: 'First-line CLL indication'
  },
  {
    drug: 'reproxalap',
    brandName: null,
    company: 'Aldeyra Therapeutics',
    indication: 'Dry Eye Disease',
    pdufaDate: '2026-03-16',
    submissionType: 'NDA',
    status: 'Pending',
    notes: 'RASP inhibitor'
  },
  {
    drug: 'linerixibat',
    brandName: null,
    company: 'GSK',
    indication: 'Primary Biliary Cholangitis',
    pdufaDate: '2026-03-24',
    submissionType: 'NDA',
    status: 'Pending',
    notes: 'IBAT inhibitor for pruritus'
  },
  {
    drug: 'marnetegragene autotemcel',
    brandName: 'Kresladi',
    company: 'Rocket Pharmaceuticals',
    indication: 'Leukocyte Adhesion Deficiency-I (LAD-I)',
    pdufaDate: '2026-03-28',
    submissionType: 'BLA',
    status: 'Pending',
    notes: 'Gene therapy for rare immune disorder'
  },
  {
    drug: 'suzetrigine',
    brandName: null,
    company: 'Vertex Pharmaceuticals',
    indication: 'Acute Pain',
    pdufaDate: '2026-03-30',
    submissionType: 'NDA',
    status: 'Pending',
    notes: 'Non-opioid NaV1.8 inhibitor'
  },
  // April 2026
  {
    drug: 'tividenofusp alfa',
    brandName: null,
    company: 'Denali Therapeutics',
    indication: 'Hunter Syndrome (MPS II)',
    pdufaDate: '2026-04-05',
    submissionType: 'BLA',
    status: 'Pending',
    notes: 'Enzyme replacement with brain penetration'
  },
  {
    drug: 'Orca-T',
    brandName: null,
    company: 'Orca Bio',
    indication: 'Acute Myeloid Leukemia / Acute Lymphoblastic Leukemia',
    pdufaDate: '2026-04-06',
    submissionType: 'BLA',
    status: 'Pending',
    notes: 'High-precision allogeneic cell therapy'
  },
  {
    drug: 'nivolumab',
    brandName: 'Opdivo',
    company: 'Bristol Myers Squibb',
    indication: 'Classical Hodgkin Lymphoma',
    pdufaDate: '2026-04-08',
    submissionType: 'sBLA',
    status: 'Pending',
    notes: 'Expanded indication'
  },
  {
    drug: 'sparsentan',
    brandName: 'Filspari',
    company: 'Travere Therapeutics',
    indication: 'Focal Segmental Glomerulosclerosis (FSGS)',
    pdufaDate: '2026-04-13',
    submissionType: 'sNDA',
    status: 'Pending',
    notes: 'Dual endothelin/angiotensin receptor antagonist'
  },
  {
    drug: 'orforglipron',
    brandName: null,
    company: 'Eli Lilly',
    indication: 'Type 2 Diabetes',
    pdufaDate: '2026-04-15',
    submissionType: 'NDA',
    status: 'Pending',
    notes: 'Oral GLP-1 receptor agonist'
  },
  {
    drug: 'isatuximab',
    brandName: 'Sarclisa',
    company: 'Sanofi',
    indication: 'Multiple Myeloma',
    pdufaDate: '2026-04-23',
    submissionType: 'sBLA',
    status: 'Pending',
    notes: 'Earlier line indication'
  },
  {
    drug: 'cagrilintide/semaglutide',
    brandName: null,
    company: 'Novo Nordisk',
    indication: 'Obesity',
    pdufaDate: '2026-04-30',
    submissionType: 'NDA',
    status: 'Pending',
    notes: 'Amylin analog + GLP-1'
  },
  // May 2026
  {
    drug: 'efgartigimod alfa',
    brandName: 'Vyvgart',
    company: 'Argenx',
    indication: 'Seronegative Generalized Myasthenia Gravis',
    pdufaDate: '2026-05-10',
    submissionType: 'sBLA',
    status: 'Pending',
    notes: 'AChR-Ab seronegative expansion'
  },
  {
    drug: 'lecanemab-irmb',
    brandName: 'LEQEMBI IQLIK',
    company: 'Eisai/Biogen',
    indication: 'Early Alzheimer\'s Disease (SC Starting Dose)',
    pdufaDate: '2026-05-24',
    submissionType: 'sBLA',
    status: 'Pending',
    notes: 'Subcutaneous autoinjector starting dose; Priority Review'
  },
  {
    drug: 'CTx-1301',
    brandName: null,
    company: 'Cingulate',
    indication: 'Attention-Deficit/Hyperactivity Disorder (ADHD)',
    pdufaDate: '2026-05-31',
    submissionType: 'NDA',
    status: 'Pending',
    notes: 'Dexmethylphenidate with PTR technology; once-daily tablet'
  },
  {
    drug: 'talquetamab',
    brandName: 'Talvey',
    company: 'Johnson & Johnson',
    indication: 'Multiple Myeloma',
    pdufaDate: '2026-05-12',
    submissionType: 'sBLA',
    status: 'Pending',
    notes: 'Earlier line indication'
  },
  {
    drug: 'datopotamab deruxtecan',
    brandName: null,
    company: 'AstraZeneca/Daiichi Sankyo',
    indication: 'Non-Small Cell Lung Cancer',
    pdufaDate: '2026-05-20',
    submissionType: 'BLA',
    status: 'Pending',
    notes: 'TROP2-directed ADC'
  },
  // June 2026
  {
    drug: 'octreotide subcutaneous depot',
    brandName: 'Oclaiz (CAM2029)',
    company: 'Camurus',
    indication: 'Acromegaly',
    pdufaDate: '2026-06-10',
    submissionType: 'NDA',
    status: 'Pending',
    notes: 'Long-acting subcutaneous formulation'
  },
  {
    drug: 'resmetirom',
    brandName: 'Rezdiffra',
    company: 'Madrigal Pharmaceuticals',
    indication: 'MASH with Fibrosis',
    pdufaDate: '2026-06-14',
    submissionType: 'sNDA',
    status: 'Pending',
    notes: 'F2/F3 fibrosis expansion'
  },
  {
    drug: 'nilotinib',
    brandName: 'XS003',
    company: 'Xspray Pharma',
    indication: 'Chronic Myeloid Leukemia',
    pdufaDate: '2026-06-18',
    submissionType: 'NDA',
    status: 'Pending',
    notes: 'Amorphous formulation'
  },
  {
    drug: 'cytisinicline',
    brandName: null,
    company: 'Achieve Life Sciences',
    indication: 'Smoking Cessation',
    pdufaDate: '2026-06-20',
    submissionType: 'NDA',
    status: 'Pending',
    notes: 'First new smoking cessation drug in 20 years'
  },
  {
    drug: 'nemtabrutinib',
    brandName: null,
    company: 'Merck',
    indication: 'Chronic Lymphocytic Leukemia',
    pdufaDate: '2026-06-25',
    submissionType: 'NDA',
    status: 'Pending',
    notes: 'Non-covalent BTK inhibitor'
  },
  {
    drug: 'roflumilast cream',
    brandName: 'Zoryve',
    company: 'Arcutis Biotherapeutics',
    indication: 'Plaque Psoriasis (Children 2-5 years)',
    pdufaDate: '2026-06-29',
    submissionType: 'sNDA',
    status: 'Pending',
    notes: 'First PDE4 inhibitor for young pediatric psoriasis'
  },
  {
    drug: 'veligrotug',
    brandName: null,
    company: 'Viridian Therapeutics',
    indication: 'Thyroid Eye Disease',
    pdufaDate: '2026-06-30',
    submissionType: 'BLA',
    status: 'Pending',
    notes: 'Anti-IGF-1R antibody'
  },
  // July 2026
  {
    drug: 'atacicept',
    brandName: null,
    company: 'Vera Therapeutics',
    indication: 'IgA Nephropathy',
    pdufaDate: '2026-07-07',
    submissionType: 'BLA',
    status: 'Pending',
    notes: 'TACI-Fc fusion protein'
  },
  {
    drug: 'imetelstat',
    brandName: 'Rytelo',
    company: 'Geron Corporation',
    indication: 'Lower-Risk MDS',
    pdufaDate: '2026-07-08',
    submissionType: 'sNDA',
    status: 'Pending',
    notes: 'Expanded indication'
  },
  {
    drug: 'crovalimab',
    brandName: null,
    company: 'Roche',
    indication: 'Paroxysmal Nocturnal Hemoglobinuria',
    pdufaDate: '2026-07-22',
    submissionType: 'BLA',
    status: 'Pending',
    notes: 'Anti-C5 antibody, subcutaneous'
  },
  // August 2026
  {
    drug: 'mRNA-1010',
    brandName: null,
    company: 'Moderna',
    indication: 'Seasonal Influenza (Adults)',
    pdufaDate: '2026-08-05',
    submissionType: 'BLA',
    status: 'Pending',
    notes: 'mRNA-based flu vaccine; split approval: full for 50-64, accelerated for 65+'
  },
  {
    drug: 'oveporexton',
    brandName: null,
    company: 'Takeda',
    indication: 'Narcolepsy Type 1',
    pdufaDate: '2026-08-10',
    submissionType: 'NDA',
    status: 'Pending',
    notes: 'First-in-class OX2R agonist; Priority Review; Q3 2026 target'
  },
  {
    drug: 'retatrutide',
    brandName: null,
    company: 'Eli Lilly',
    indication: 'Obesity',
    pdufaDate: '2026-08-15',
    submissionType: 'NDA',
    status: 'Pending',
    notes: 'Triple agonist (GIP/GLP-1/glucagon)'
  },
  {
    drug: 'iberdomide',
    brandName: null,
    company: 'Bristol Myers Squibb',
    indication: 'Relapsed/Refractory Multiple Myeloma',
    pdufaDate: '2026-08-17',
    submissionType: 'NDA',
    status: 'Pending',
    notes: 'CELMoD agent; Breakthrough Therapy + Priority Review'
  },
  {
    drug: 'imlifidase',
    brandName: 'Idefirix',
    company: 'Hansa Biopharma',
    indication: 'Kidney Transplant Desensitization',
    pdufaDate: '2026-08-18',
    submissionType: 'BLA',
    status: 'Pending',
    notes: 'IgG antibody-cleaving enzyme; Priority Review requested; FDA accepted Feb 18, 2026'
  },
  {
    drug: '177Lu-edotreotide',
    brandName: null,
    company: 'ITM Isotope Technologies',
    indication: 'Gastroenteropancreatic Neuroendocrine Tumors',
    pdufaDate: '2026-08-28',
    submissionType: 'NDA',
    status: 'Pending',
    notes: 'Peptide receptor radionuclide therapy'
  },
  {
    drug: 'capivasertib',
    brandName: 'Truqap',
    company: 'AstraZeneca',
    indication: 'Prostate Cancer',
    pdufaDate: '2026-08-28',
    submissionType: 'sNDA',
    status: 'Pending',
    notes: 'AKT inhibitor expansion'
  },
  {
    drug: 'ropeginterferon alfa-2b',
    brandName: 'Besremi',
    company: 'PharmaEssentia',
    indication: 'Essential Thrombocythemia',
    pdufaDate: '2026-08-30',
    submissionType: 'sBLA',
    status: 'Pending',
    notes: 'Myeloproliferative neoplasm expansion'
  },
  // September 2026
  {
    drug: 'omaveloxolone',
    brandName: 'Skyclarys',
    company: 'Biogen',
    indication: 'Friedreich Ataxia',
    pdufaDate: '2026-09-10',
    submissionType: 'sNDA',
    status: 'Pending',
    notes: 'Pediatric expansion'
  },
  {
    drug: 'zidesamtinib',
    brandName: null,
    company: 'Nuvalent',
    indication: 'ROS1-Positive Non-Small Cell Lung Cancer',
    pdufaDate: '2026-09-18',
    submissionType: 'NDA',
    status: 'Pending',
    notes: 'Brain-penetrant ROS1 inhibitor'
  },
  // October 2026
  {
    drug: 'sisunatovir',
    brandName: null,
    company: 'Pfizer',
    indication: 'RSV Infection',
    pdufaDate: '2026-10-05',
    submissionType: 'NDA',
    status: 'Pending',
    notes: 'RSV fusion inhibitor'
  },
  {
    drug: 'tabelecleucel',
    brandName: 'Ebvallo',
    company: 'Pierre Fabre Pharmaceuticals',
    indication: 'EBV+ Post-Transplant Lymphoproliferative Disease',
    pdufaDate: '2026-10-10',
    submissionType: 'BLA',
    status: 'Pending',
    notes: 'Allogeneic EBV-specific T-cell immunotherapy; Orphan Drug'
  },
  {
    drug: 'surufatinib',
    brandName: null,
    company: 'HUTCHMED',
    indication: 'Neuroendocrine Tumors',
    pdufaDate: '2026-10-20',
    submissionType: 'NDA',
    status: 'Pending',
    notes: 'Multi-kinase inhibitor'
  },
  {
    drug: 'INO-3107',
    brandName: null,
    company: 'Inovio Pharmaceuticals',
    indication: 'Recurrent Respiratory Papillomatosis',
    pdufaDate: '2026-10-30',
    submissionType: 'BLA',
    status: 'Pending',
    notes: 'DNA immunotherapy for HPV disease'
  },
  // November 2026
  {
    drug: 'trastuzumab duocarmazine',
    brandName: null,
    company: 'AstraZeneca',
    indication: 'HER2+ Breast Cancer',
    pdufaDate: '2026-11-12',
    submissionType: 'BLA',
    status: 'Pending',
    notes: 'HER2-targeting ADC'
  },
  {
    drug: 'ivonescimab',
    brandName: null,
    company: 'Summit Therapeutics',
    indication: 'Non-Small Cell Lung Cancer (NSCLC)',
    pdufaDate: '2026-11-14',
    submissionType: 'BLA',
    status: 'Pending',
    notes: 'PD-1/VEGF bispecific antibody; combination with chemo'
  },
  // December 2026
  {
    drug: 'sabizabulin',
    brandName: null,
    company: 'Veru Inc',
    indication: 'Metastatic Prostate Cancer',
    pdufaDate: '2026-12-08',
    submissionType: 'NDA',
    status: 'Pending',
    notes: 'Microtubule inhibitor'
  },
  {
    drug: 'tirabrutinib',
    brandName: null,
    company: 'Deciphera Pharmaceuticals',
    indication: 'Primary CNS Lymphoma',
    pdufaDate: '2026-12-18',
    submissionType: 'NDA',
    status: 'Pending',
    notes: 'BTK inhibitor; Orphan Drug for R/R PCNSL'
  },
  // 2027 - Early
  {
    drug: 'berdazimer gel',
    brandName: null,
    company: 'Novan Inc',
    indication: 'Molluscum Contagiosum',
    pdufaDate: '2027-01-15',
    submissionType: 'NDA',
    status: 'Pending',
    notes: 'Nitric oxide-releasing'
  },
  {
    drug: 'lazertinib',
    brandName: null,
    company: 'Johnson & Johnson',
    indication: 'EGFR+ NSCLC',
    pdufaDate: '2027-02-10',
    submissionType: 'NDA',
    status: 'Pending',
    notes: 'Third-gen EGFR TKI'
  },
  {
    drug: 'amivantamab + lazertinib',
    brandName: null,
    company: 'Johnson & Johnson',
    indication: 'EGFR+ NSCLC (1L)',
    pdufaDate: '2027-02-28',
    submissionType: 'sBLA',
    status: 'Pending',
    notes: 'Combination first-line'
  }
];

/**
 * Fetch catalysts from BioPharmCatalyst (web scraping)
 * Note: This may break if the website structure changes
 */
async function fetchBioPharmCatalyst(options = {}) {
  const { verbose = false } = options;

  // BioPharmCatalyst has a calendar at https://www.biopharmcatalyst.com/calendars/pdufa-calendar
  // We'll try to fetch and parse it

  try {
    const url = 'https://www.biopharmcatalyst.com/calendars/pdufa-calendar';

    if (verbose) console.log('  Attempting to fetch from BioPharmCatalyst...');

    const html = await new Promise((resolve, reject) => {
      const request = https.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
          'Accept': 'text/html'
        }
      }, (response) => {
        if (response.statusCode === 301 || response.statusCode === 302) {
          // Follow redirect
          https.get(response.headers.location, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
              'Accept': 'text/html'
            }
          }, (res2) => {
            let data = '';
            res2.on('data', chunk => data += chunk);
            res2.on('end', () => resolve(data));
          }).on('error', reject);
          return;
        }

        let data = '';
        response.on('data', chunk => data += chunk);
        response.on('end', () => resolve(data));
      });
      request.on('error', reject);
      request.setTimeout(15000, () => {
        request.destroy();
        reject(new Error('Timeout'));
      });
    });

    // Parse the HTML for PDUFA entries
    // This is a basic parser - may need adjustment based on actual HTML structure
    const catalysts = [];

    // Look for table rows with PDUFA data
    const rowPattern = /<tr[^>]*>[\s\S]*?<\/tr>/gi;
    const rows = html.match(rowPattern) || [];

    for (const row of rows) {
      // Extract date, drug, company, indication
      const dateMatch = row.match(/(\d{1,2}\/\d{1,2}\/\d{4}|\w+\s+\d{1,2},?\s+\d{4})/);
      const drugMatch = row.match(/<td[^>]*>([^<]+)<\/td>/);

      if (dateMatch && drugMatch) {
        // Basic extraction - would need more sophisticated parsing for production
        catalysts.push({
          drug: drugMatch[1].trim(),
          pdufaDate: dateMatch[1],
          source: 'BioPharmCatalyst'
        });
      }
    }

    if (verbose) console.log(`    Found ${catalysts.length} entries from BioPharmCatalyst`);
    return catalysts;

  } catch (error) {
    if (verbose) console.log(`    BioPharmCatalyst fetch failed: ${error.message}`);
    return [];
  }
}

/**
 * Calculate days until PDUFA date
 */
function calculateDaysUntil(pdufaDate) {
  if (!pdufaDate) return null;

  const today = new Date();
  today.setHours(12, 0, 0, 0); // Use noon to avoid timezone edge cases

  // Parse YYYY-MM-DD as local date by adding noon time
  const pdufa = new Date(pdufaDate + 'T12:00:00');
  if (isNaN(pdufa.getTime())) return null;

  const diffTime = pdufa.getTime() - today.getTime();
  return Math.round(diffTime / (1000 * 60 * 60 * 24));
}

/**
 * Enrich catalyst with therapeutic area and success rate
 */
function enrichCatalyst(catalyst) {
  // Classify therapeutic area
  if (catalyst.indication && !catalyst.therapeuticArea) {
    catalyst.therapeuticArea = classifyCondition([catalyst.indication]);
  }

  // Add success rate
  if (catalyst.therapeuticArea && !catalyst.successRate) {
    const rate = getSuccessRate(catalyst.therapeuticArea);
    catalyst.successRate = rate.rate;
    catalyst.successRateRange = rate.range;
  }

  // Calculate days until
  catalyst.daysUntilPDUFA = calculateDaysUntil(catalyst.pdufaDate);

  // Format date for display (parse as local date to avoid timezone issues)
  if (catalyst.pdufaDate) {
    // Parse YYYY-MM-DD as local date by adding noon time
    const date = new Date(catalyst.pdufaDate + 'T12:00:00');
    if (!isNaN(date.getTime())) {
      catalyst.formattedDate = date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      });
    }
  }

  return catalyst;
}

/**
 * Fetch JSON from a URL (for OpenFDA API calls)
 */
function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, {
      headers: { 'User-Agent': 'FDA-Pipeline/1.0' }
    }, (response) => {
      let data = '';
      response.on('data', chunk => data += chunk);
      response.on('end', () => {
        if (response.statusCode === 200) {
          try { resolve(JSON.parse(data)); }
          catch (e) { reject(new Error(`JSON parse error: ${e.message}`)); }
        } else if (response.statusCode === 404) {
          resolve({ results: [] });
        } else {
          reject(new Error(`HTTP ${response.statusCode}`));
        }
      });
    });
    request.on('error', reject);
    request.setTimeout(15000, () => { request.destroy(); reject(new Error('Timeout')); });
  });
}

/**
 * Check if a past-PDUFA catalyst has been approved by the FDA.
 * Queries OpenFDA drugs@fda for recent approval actions matching the drug.
 */
async function checkRecentFDAApproval(catalyst, verbose = false) {
  const { drug, brandName, pdufaDate } = catalyst;
  if (!pdufaDate) return false;

  const daysUntil = calculateDaysUntil(pdufaDate);
  if (daysUntil === null || daysUntil >= 0) return false;

  const pdufaMs = new Date(pdufaDate + 'T12:00:00').getTime();

  // Build search terms - brand name first (more specific), then drug name
  const searchTerms = [];
  if (brandName) {
    const cleanBrand = brandName.split(/[\(\+\/]/)[0].trim();
    if (cleanBrand.length >= 3) searchTerms.push(cleanBrand);
  }
  if (drug) {
    const cleanDrug = drug.split(/[\+\/]/)[0].trim();
    if (cleanDrug.length >= 3) searchTerms.push(cleanDrug);
  }

  for (const term of searchTerms) {
    try {
      const encoded = encodeURIComponent(term.toLowerCase());
      const url = `https://api.fda.gov/drug/drugsfda.json?search=(openfda.brand_name:"${encoded}"+openfda.generic_name:"${encoded}")&limit=10`;

      const data = await fetchJSON(url);
      if (!data.results || data.results.length === 0) continue;

      // Look for AP (Approved) submissions near the PDUFA date
      for (const result of data.results) {
        for (const sub of (result.submissions || [])) {
          if (sub.submission_status === 'AP' && sub.submission_status_date) {
            const ds = sub.submission_status_date;
            const approvalMs = new Date(
              `${ds.slice(0, 4)}-${ds.slice(4, 6)}-${ds.slice(6, 8)}T12:00:00`
            ).getTime();

            // Approval within 90 days before to 30 days after PDUFA date
            const daysDiff = (approvalMs - pdufaMs) / 86400000;
            if (daysDiff >= -90 && daysDiff <= 30) {
              if (verbose) {
                console.log(`    ✓ ${drug}: approved ${ds.slice(0, 4)}-${ds.slice(4, 6)}-${ds.slice(6, 8)} (PDUFA: ${pdufaDate})`);
              }
              return true;
            }
          }
        }
      }
    } catch (e) {
      if (verbose) console.log(`    Warning: FDA lookup failed for "${term}": ${e.message}`);
    }

    // Small delay between API calls to avoid rate limiting
    await new Promise(r => setTimeout(r, 250));
  }

  return false;
}

/**
 * Filter out past-PDUFA catalysts that have been confirmed approved by FDA
 */
async function filterApprovedCatalysts(catalysts, verbose = false) {
  const results = [];
  let removedCount = 0;

  for (const catalyst of catalysts) {
    const daysUntil = calculateDaysUntil(catalyst.pdufaDate);

    // Keep future catalysts and ones without dates
    if (!catalyst.pdufaDate || daysUntil === null || daysUntil >= 0) {
      results.push(catalyst);
      continue;
    }

    // For past-PDUFA entries still marked Pending, check FDA for approval
    const status = (catalyst.status || 'Pending').toLowerCase();
    if (status === 'pending') {
      const isApproved = await checkRecentFDAApproval(catalyst, verbose);
      if (isApproved) {
        removedCount++;
        continue; // Remove approved entry from results
      }
    }

    results.push(catalyst);
  }

  if (verbose && removedCount > 0) {
    console.log(`  Removed ${removedCount} approved past-PDUFA catalyst(s)`);
  }

  return results;
}

/**
 * Get all PDUFA catalysts
 */
async function getPDUFACatalysts(options = {}) {
  const { forceRefresh = false, verbose = true, includeWebScrape = false } = options;

  // Check cache
  if (!forceRefresh && fs.existsSync(CATALYSTS_CACHE_FILE)) {
    const lastFetch = fs.existsSync(CATALYSTS_LAST_FETCH)
      ? fs.readFileSync(CATALYSTS_LAST_FETCH, 'utf-8').trim()
      : null;

    if (lastFetch) {
      const hoursSinceFetch = (Date.now() - new Date(lastFetch).getTime()) / (1000 * 60 * 60);
      if (hoursSinceFetch < 24) {
        if (verbose) console.log(`Using cached PDUFA catalysts (${hoursSinceFetch.toFixed(1)} hours old)`);
        return JSON.parse(fs.readFileSync(CATALYSTS_CACHE_FILE, 'utf-8'));
      }
    }
  }

  if (verbose) console.log('Loading PDUFA catalysts...');

  // Start with curated list
  let allCatalysts = CURATED_CATALYSTS.map(c => ({ ...c, source: 'Curated' }));

  // Merge scraped results from scrape-pdufa.js output
  try {
    if (fs.existsSync(SCRAPED_RESULTS_FILE)) {
      const scrapedData = JSON.parse(fs.readFileSync(SCRAPED_RESULTS_FILE, 'utf-8'));
      const existingDrugs = new Set(allCatalysts.map(c => c.drug.toLowerCase()));

      // Add PDUFA dates from scraped results
      if (scrapedData.pdufa && Array.isArray(scrapedData.pdufa)) {
        for (const scraped of scrapedData.pdufa) {
          // Skip if drug name looks invalid (too short, or common false positives)
          if (!scraped.drug || scraped.drug.length < 4) continue;
          if (scraped.drug.toLowerCase().includes('unknown')) continue;

          // Skip if already in curated list
          if (existingDrugs.has(scraped.drug.toLowerCase())) continue;

          // Add scraped catalyst
          allCatalysts.push({
            drug: scraped.drug,
            brandName: scraped.brandName || null,
            company: scraped.company || 'Unknown',
            indication: scraped.indication || null,
            pdufaDate: scraped.pdufaDate,
            submissionType: scraped.submissionType || 'NDA',
            status: scraped.status || 'Pending',
            source: 'Scraped',
            sourceUrl: scraped.sourceUrl,
            notes: `Auto-detected from ${scraped.source || 'press release'}`
          });
          existingDrugs.add(scraped.drug.toLowerCase());

          if (verbose) console.log(`  + Added from scraper: ${scraped.drug} (${scraped.pdufaDate})`);
        }
      }

      // Add submissions awaiting PDUFA (only recent ones - within last 18 months)
      // FDA timeline: 60 days to accept + 10 months (standard) or 6 months (priority) review
      if (scrapedData.submissions && Array.isArray(scrapedData.submissions)) {
        const cutoffDate = new Date();
        cutoffDate.setMonth(cutoffDate.getMonth() - 18); // 18 months covers full PDUFA timeline

        // Skip malformed drug names (parsing errors)
        const invalidDrugPatterns = ['eport', 'pplication', 'dministration', 'ompany'];

        for (const sub of scrapedData.submissions) {
          if (!sub.drug || sub.drug.length < 4) continue;
          if (existingDrugs.has(sub.drug.toLowerCase())) continue;

          // Skip malformed drug names from parsing errors
          if (invalidDrugPatterns.some(p => sub.drug.toLowerCase().includes(p))) continue;

          // Skip old submissions (likely already resolved - approved, rejected, or withdrawn)
          const subDate = new Date(sub.submissionDate || sub.releaseDate);
          if (subDate < cutoffDate) {
            if (verbose) console.log(`  - Skipping old submission: ${sub.drug} (${sub.submissionDate || sub.releaseDate})`);
            continue;
          }

          allCatalysts.push({
            drug: sub.drug,
            brandName: sub.brandName || null,
            company: sub.company || 'Unknown',
            indication: sub.indication || null,
            pdufaDate: null,
            submissionDate: sub.submissionDate || sub.releaseDate,
            submissionType: sub.submissionType || 'NDA',
            status: 'Submitted - Awaiting PDUFA',
            source: 'Scraped',
            sourceUrl: sub.sourceUrl,
            notes: `Auto-detected submission from ${sub.source || 'press release'}`
          });
          existingDrugs.add(sub.drug.toLowerCase());
        }
      }
    }
  } catch (err) {
    if (verbose) console.log(`  Warning: Could not load scraped results: ${err.message}`);
  }

  // Optionally fetch from web sources
  if (includeWebScrape) {
    const webCatalysts = await fetchBioPharmCatalyst({ verbose });

    // Merge web catalysts (avoid duplicates)
    const existingDrugs = new Set(allCatalysts.map(c => c.drug.toLowerCase()));
    for (const wc of webCatalysts) {
      if (!existingDrugs.has(wc.drug.toLowerCase())) {
        allCatalysts.push(wc);
      }
    }
  }

  // Enrich all catalysts
  allCatalysts = allCatalysts.map(enrichCatalyst);

  // Filter out past-PDUFA entries that have been approved by FDA
  if (verbose) console.log('  Checking past-PDUFA entries for FDA approval status...');
  allCatalysts = await filterApprovedCatalysts(allCatalysts, verbose);

  // Filter to future dates only (or within past 30 days for recent decisions)
  allCatalysts = allCatalysts.filter(c => {
    if (!c.pdufaDate) return true;
    const daysUntil = c.daysUntilPDUFA;
    return daysUntil === null || daysUntil >= -30; // Include recent past for context
  });

  // Sort by PDUFA date
  allCatalysts.sort((a, b) => {
    if (!a.pdufaDate && !b.pdufaDate) return 0;
    if (!a.pdufaDate) return 1;
    if (!b.pdufaDate) return -1;
    return new Date(a.pdufaDate) - new Date(b.pdufaDate);
  });

  if (verbose) {
    console.log(`  Total catalysts: ${allCatalysts.length}`);
    const imminent = allCatalysts.filter(c => c.daysUntilPDUFA !== null && c.daysUntilPDUFA >= 0 && c.daysUntilPDUFA <= 30);
    console.log(`  Imminent (30 days): ${imminent.length}`);
  }

  // Cache results
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  fs.writeFileSync(CATALYSTS_CACHE_FILE, JSON.stringify(allCatalysts, null, 2));
  fs.writeFileSync(CATALYSTS_LAST_FETCH, new Date().toISOString());

  return allCatalysts;
}

/**
 * Get summary statistics for catalysts
 */
function getCatalystStats(catalysts) {
  const stats = {
    total: catalysts.length,
    withDate: catalysts.filter(c => c.pdufaDate).length,
    byStatus: {},
    bySubmissionType: {},
    byTherapeuticArea: {},
    byMonth: {},
    imminent: 0,
    soon: 0,
    thisYear: 0
  };

  const today = new Date();
  const currentYear = today.getFullYear();

  for (const c of catalysts) {
    // By status
    const status = c.status || 'Pending';
    stats.byStatus[status] = (stats.byStatus[status] || 0) + 1;

    // By submission type
    const subType = c.submissionType || 'Unknown';
    stats.bySubmissionType[subType] = (stats.bySubmissionType[subType] || 0) + 1;

    // By therapeutic area
    const area = c.therapeuticArea || 'Unknown';
    stats.byTherapeuticArea[area] = (stats.byTherapeuticArea[area] || 0) + 1;

    // Timeline stats
    if (c.pdufaDate) {
      const date = new Date(c.pdufaDate);
      if (!isNaN(date.getTime())) {
        // By month
        const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        stats.byMonth[monthKey] = (stats.byMonth[monthKey] || 0) + 1;

        // Urgency
        const days = c.daysUntilPDUFA;
        if (days !== null && days >= 0) {
          if (days <= 30) stats.imminent++;
          else if (days <= 90) stats.soon++;
        }

        // This year
        if (date.getFullYear() === currentYear) {
          stats.thisYear++;
        }
      }
    }
  }

  return stats;
}

// CLI
if (require.main === module) {
  getPDUFACatalysts({ verbose: true, forceRefresh: process.argv.includes('--force') })
    .then(catalysts => {
      console.log(`\nLoaded ${catalysts.length} PDUFA catalysts\n`);

      // Show upcoming
      const upcoming = catalysts.filter(c => c.daysUntilPDUFA !== null && c.daysUntilPDUFA >= 0).slice(0, 10);
      console.log('Upcoming PDUFA dates:');
      upcoming.forEach(c => {
        console.log(`  ${c.formattedDate} (${c.daysUntilPDUFA}d) | ${c.drug} | ${c.company} | ${c.indication}`);
      });
    })
    .catch(err => {
      console.error('Error:', err);
      process.exit(1);
    });
}

module.exports = {
  getPDUFACatalysts,
  getCatalystStats,
  calculateDaysUntil,
  enrichCatalyst,
  filterApprovedCatalysts,
  CURATED_CATALYSTS
};
