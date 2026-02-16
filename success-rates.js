/**
 * Historical Phase 3 success rates by therapeutic area
 * Based on published research (Nature Communications, BIO Industry Analysis)
 */

const SUCCESS_RATES = {
  'Oncology': { rate: 0.375, range: '35-40%', description: 'Cancer, tumor, carcinoma, leukemia, lymphoma, melanoma' },
  'Cardiology': { rate: 0.525, range: '50-55%', description: 'Heart, cardiac, hypertension, arrhythmia' },
  'Neurology': { rate: 0.475, range: '45-50%', description: 'Alzheimer\'s, Parkinson\'s, MS, epilepsy, stroke' },
  'Psychiatry': { rate: 0.45, range: '40-50%', description: 'Schizophrenia, depression, anxiety, addiction' },
  'Rheumatology': { rate: 0.525, range: '50-55%', description: 'Rheumatoid arthritis, lupus, scleroderma, vasculitis' },
  'Allergy/Immunology': { rate: 0.55, range: '50-60%', description: 'Allergies, urticaria, angioedema, immunodeficiency' },
  'Infectious Disease': { rate: 0.625, range: '60-65%', description: 'HIV, hepatitis, bacterial, viral infections' },
  'Vaccines': { rate: 0.85, range: '80-90%', description: 'Preventive vaccines and immunizations' },
  'Dermatology': { rate: 0.575, range: '55-60%', description: 'Eczema, dermatitis, psoriasis, acne' },
  'Endocrinology': { rate: 0.575, range: '55-60%', description: 'Diabetes, thyroid, obesity, NASH' },
  'Pulmonology': { rate: 0.525, range: '50-55%', description: 'Asthma, COPD, pulmonary fibrosis' },
  'Otolaryngology': { rate: 0.55, range: '50-60%', description: 'ENT - ear, nose, throat conditions' },
  'Ophthalmology': { rate: 0.55, range: '50-60%', description: 'Macular degeneration, glaucoma, retinal diseases' },
  'Hematology': { rate: 0.55, range: '50-60%', description: 'Anemia, hemophilia, blood disorders' },
  'Gastroenterology': { rate: 0.525, range: '50-55%', description: 'IBS, GERD, liver disease' },
  'Nephrology': { rate: 0.50, range: '45-55%', description: 'Chronic kidney disease, transplant' },
  'Urology': { rate: 0.55, range: '50-60%', description: 'Bladder, prostate conditions' },
  'OB/GYN': { rate: 0.55, range: '50-60%', description: 'Endometriosis, menopause, fertility' },
  'Orthopedics': { rate: 0.525, range: '50-55%', description: 'Osteoarthritis, osteoporosis, bone disorders' },
  'Rare/Genetic Disease': { rate: 0.625, range: '60-65%', description: 'Orphan and genetic disorders' },
  'Other': { rate: 0.50, range: '50%', description: 'Other therapeutic areas' }
};

// FDA review timeline estimates (in months)
// Based on expedited pathways: Breakthrough Therapy, Fast Track, Accelerated Approval, Priority Review
const FDA_TIMELINE = {
  // Time from Phase 3 completion to NDA/BLA submission
  submissionPrep: {
    expedited: 3,   // Breakthrough/Fast Track with rolling submission
    standard: 6,    // Typical timeline
    description: 'Data analysis, report writing, application preparation'
  },
  // FDA review times (PDUFA)
  review: {
    accelerated: 2,  // Accelerated approval (surrogate endpoints)
    priority: 6,     // Priority review
    standard: 10,    // Standard review
    description: 'FDA review period'
  },
  // Total estimates by urgency level
  totalMonths: {
    highUrgency: 9,    // Breakthrough + accelerated (3 + 2 + buffer) - oncology, rare disease
    elevated: 12,      // Priority review pathway (3 + 6 + buffer)
    standard: 15,      // Standard pathway (6 + 6-10)
    low: 18            // Less urgent indications
  }
};

// Urgency levels by therapeutic area
// Based on typical FDA expedited designation patterns
const URGENCY_LEVEL = {
  'Oncology': 'highUrgency',           // ~70% get breakthrough/priority
  'Rare/Genetic Disease': 'highUrgency', // Orphan drugs get expedited review
  'Hematology': 'elevated',            // Often serious conditions
  'Infectious Disease': 'elevated',    // Public health priority
  'Neurology': 'elevated',             // Serious unmet needs (ALS, Alzheimer's)
  'Pulmonology': 'standard',
  'Cardiology': 'standard',
  'Nephrology': 'standard',
  'Rheumatology': 'standard',
  'Allergy/Immunology': 'standard',
  'Gastroenterology': 'standard',
  'Endocrinology': 'standard',
  'Ophthalmology': 'standard',
  'Psychiatry': 'standard',
  'Vaccines': 'elevated',              // Public health
  'Dermatology': 'low',
  'Urology': 'low',
  'OB/GYN': 'standard',
  'Orthopedics': 'low',
  'Otolaryngology': 'low',
  'Other': 'standard'
};

function getSuccessRate(therapeuticArea) {
  return SUCCESS_RATES[therapeuticArea] || SUCCESS_RATES['Other'];
}

function getAllSuccessRates() {
  return SUCCESS_RATES;
}

function getFDATimeline() {
  return FDA_TIMELINE;
}

function getUrgencyLevel(therapeuticArea) {
  return URGENCY_LEVEL[therapeuticArea] || 'standard';
}

// Estimate FDA approval date based on completion date and therapeutic area
function estimateApprovalDate(primaryCompletionDate, therapeuticArea) {
  if (!primaryCompletionDate) return null;

  try {
    const completionDate = new Date(primaryCompletionDate);
    if (isNaN(completionDate.getTime())) return null;

    // Get urgency level for this therapeutic area
    const urgency = getUrgencyLevel(therapeuticArea);
    const monthsToAdd = FDA_TIMELINE.totalMonths[urgency];

    const approvalDate = new Date(completionDate);
    approvalDate.setMonth(approvalDate.getMonth() + monthsToAdd);

    return approvalDate;
  } catch {
    return null;
  }
}

module.exports = {
  getSuccessRate,
  getAllSuccessRates,
  getFDATimeline,
  getUrgencyLevel,
  estimateApprovalDate,
  SUCCESS_RATES,
  FDA_TIMELINE,
  URGENCY_LEVEL
};
