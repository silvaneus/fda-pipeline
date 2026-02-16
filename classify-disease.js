/**
 * Disease classification logic
 * Maps conditions to therapeutic areas aligned with medical specialties
 */

const THERAPEUTIC_AREA_KEYWORDS = {
  'Oncology': [
    'cancer', 'tumor', 'tumour', 'carcinoma', 'leukemia', 'leukaemia', 'lymphoma',
    'melanoma', 'sarcoma', 'myeloma', 'neoplasm', 'malignant', 'metastatic',
    'oncolog', 'glioblastoma', 'glioma', 'neuroblastoma', 'adenocarcinoma',
    'hepatocellular', 'renal cell', 'breast cancer', 'lung cancer', 'prostate cancer',
    'colorectal', 'pancreatic cancer', 'ovarian cancer', 'bladder cancer',
    'gastric cancer', 'esophageal cancer', 'head and neck cancer', 'thyroid cancer',
    'mesothelioma', 'cholangiocarcinoma', 'nsclc', 'sclc',
    'chronic lymphocytic leukemia', 'small lymphocytic', 'acute myeloid', 'acute lymphoblastic',
    'hodgkin', 'non-hodgkin', 'cll/sll', 'cll', 'sll', 'aml', 'dlbcl', 'mcl', 'follicular lymphoma',
    'advanced malignancies', 'solid tumor', 'solid tumour'
  ],
  'Cardiology': [
    'heart', 'cardiac', 'cardiovascular', 'hypertension', 'arrhythmia',
    'atrial fibrillation', 'heart failure', 'coronary', 'myocardial',
    'atherosclerosis', 'thrombosis', 'embolism', 'aneurysm',
    'cardiomyopathy', 'angina', 'hyperlipidemia', 'dyslipidemia',
    'peripheral arterial', 'venous', 'pulmonary hypertension', 'pericarditis',
    'hypertriglyceridemia', 'hypercholesterolemia',
    'aortic valve', 'calcific aortic', 'critical limb ischemia', 'vascular'
  ],
  'Neurology': [
    'alzheimer', 'parkinson', 'multiple sclerosis', 'epilepsy', 'seizure',
    'migraine', 'headache', 'dementia', 'huntington', 'als', 'amyotrophic',
    'neuropathy', 'neurodegenerative', 'cognitive', 'duchenne', 'muscular dystrophy',
    'myasthenia', 'spinal muscular', 'ataxia', 'dystonia', 'dravet', 'lennox',
    'encephalopathy', 'encephalitis', 'meningitis', 'mog-ad', 'nmo', 'neuromyelitis',
    'hereditary spastic', 'charcot', 'peripheral neuropathy',
    // Stroke (treated by neurologists)
    'stroke', 'ischemic stroke', 'hemorrhagic stroke', 'cerebrovascular',
    'transient ischemic', 'tia', 'cerebral infarction', 'intracranial hemorrhage',
    // Pain (often treated by neurology/pain medicine)
    'chronic pain', 'neuropathic pain', 'pain syndrome', 'fibromyalgia',
    'myotonic dystrophy', 'dm1', 'excessive sleepiness', 'grin-related',
    'adrenoleukodystrophy', 'cald'
  ],
  'Psychiatry': [
    'schizophrenia', 'bipolar', 'depression', 'depressive', 'anxiety',
    'psychiatric', 'psychosis', 'attention deficit', 'adhd', 'autism',
    'obsessive compulsive', 'ocd', 'ptsd', 'post-traumatic', 'anorexia',
    'bulimia', 'eating disorder', 'insomnia', 'sleep disorder', 'narcolepsy',
    // Substance use (treated by psychiatrists/addiction medicine)
    'alcohol use', 'alcoholism', 'opioid', 'substance abuse', 'addiction',
    'drug dependence', 'tobacco', 'smoking cessation', 'nicotine'
  ],
  'Rheumatology': [
    'rheumatoid', 'lupus', 'psoriatic arthritis', 'ankylosing spondylitis',
    'spondyloarthritis', 'scleroderma', 'vasculitis',
    'sjögren', 'sjogren', 'graft versus host', 'gvhd',
    'myositis', 'dermatomyositis', 'polymyositis',
    'systemic sclerosis', 'mixed connective tissue', 'polymyalgia',
    'giant cell arteritis', 'takayasu', 'behcet', 'reactive arthritis',
    'connective tissue disease'
  ],
  'Allergy/Immunology': [
    'allergy', 'allergic', 'anaphylaxis', 'angioedema', 'hereditary angioedema',
    'hae', 'urticaria', 'food allergy', 'peanut allergy', 'atopic',
    'allergic rhinitis', 'hay fever', 'eosinophilic', 'mast cell',
    'immunodeficiency', 'primary immunodeficiency', 'autoimmune'
  ],
  'Infectious Disease': [
    'hiv', 'aids', 'hepatitis', 'covid', 'sars-cov', 'coronavirus',
    'influenza', 'flu', 'bacterial', 'viral', 'fungal', 'infection',
    'pneumonia', 'tuberculosis', 'malaria', 'sepsis', 'rsv',
    'respiratory syncytial', 'herpes', 'cmv', 'cytomegalovirus',
    'ebola', 'zika', 'dengue', 'clostrid', 'otomycosis',
    'candida', 'candidemia', 'candidiasis', 'aspergillosis', 'cryptococcal',
    'chikungunya'
  ],
  'Vaccines': [
    'vaccine', 'immunization', 'vaccination', 'immunogenicity', 'chickenpox',
    'varicella', 'pneumococcal', 'meningococcal', 'shingles', 'zoster',
    'pertussis', 'diphtheria', 'tetanus', 'measles', 'mumps', 'rubella',
    'polio', 'rotavirus', 'hpv', 'papillomavirus'
  ],
  'Dermatology': [
    'eczema', 'dermatitis', 'acne', 'alopecia', 'vitiligo',
    'pruritus', 'hidradenitis', 'pemphigus', 'epidermolysis',
    'ichthyosis', 'rosacea', 'wound', 'burn', 'scar', 'psoriasis',
    'prurigo', 'netherton', 'skin', 'hyperpigmentation', 'melasma',
    'pachyonychia', 'keratosis', 'seborrheic'
  ],
  'Endocrinology': [
    'diabetes', 'diabetic', 'thyroid', 'obesity', 'overweight', 'weight loss',
    'metabolic', 'insulin', 'glucagon', 'hyperglycemia', 'hypoglycemia',
    'adrenal', 'pituitary', 'growth hormone', 'acromegaly', 'cushing',
    'hypothyroidism', 'hyperthyroidism', 'nash', 'fatty liver', 'nafld',
    'steatohepatitis', 'mash'
  ],
  'Pulmonology': [
    'asthma', 'copd', 'chronic obstructive', 'pulmonary fibrosis', 'ipf',
    'cystic fibrosis', 'bronchitis', 'emphysema', 'bronchiectasis',
    'interstitial lung', 'sarcoidosis', 'sleep apnea', 'ards',
    'acute respiratory distress', 'pulmonary arterial', 'bronchiolitis',
    'osa', 'obstructive sleep apnea', 'cough', 'chronic cough'
  ],
  'Otolaryngology': [
    'rhinosinusitis', 'sinusitis', 'nasal polyp', 'meniere', 'ménière',
    'hearing loss', 'tinnitus', 'otitis', 'laryngitis', 'pharyngitis',
    'tonsillitis', 'vertigo', 'vestibular', 'ent disorder'
  ],
  'Ophthalmology': [
    'macular degeneration', 'amd', 'glaucoma', 'diabetic retinopathy',
    'retinal', 'uveitis', 'dry eye', 'keratitis', 'conjunctivitis',
    'cataract', 'optic', 'blindness', 'vision loss', 'ocular', 'eye disease',
    'geographic atrophy', 'retinitis pigmentosa', 'stargardt', 'macular edema',
    'keratopathy', 'neurotrophic keratopathy',
    'corneal', 'corneal neovascularization', 'ectasia'
  ],
  'Hematology': [
    'anemia', 'hemophilia', 'haemophilia', 'thalassemia', 'sickle cell',
    'thrombocytopenia', 'neutropenia', 'bleeding disorder', 'von willebrand',
    'myelodysplastic', 'myelofibrosis', 'polycythemia', 'hemoglobin',
    'platelet', 'coagulation', 'blood disorder', 'essential thrombocythemia',
    'factor x', 'factor viii', 'factor ix', 'antithrombin', 'blood loss',
    'leukocyte adhesion',
    // Thrombotic disorders (treated by hematologists)
    'immune thrombocytopenic', 'itp', 'ttp', 'thrombotic thrombocytopenic',
    'thrombotic microangiopathy', 'hus', 'hemolytic uremic',
    'iron deficiency', 'anaemia', 'major bleeding', 'acute bleeding'
  ],
  'Gastroenterology': [
    'irritable bowel', 'ibs', 'gerd', 'reflux', 'gastroparesis',
    'constipation', 'diarrhea', 'celiac', 'pancreatitis', 'cirrhosis',
    'liver disease', 'hepatic', 'biliary', 'gallbladder', 'bowel',
    'gastrointestinal', 'stomach', 'intestinal', 'esophageal', 'dyspepsia',
    // Inflammatory bowel disease (treated by gastroenterologists)
    'crohn', 'colitis', 'ulcerative colitis', 'inflammatory bowel', 'ibd',
    'proctitis', 'ileitis', 'enteritis',
    'erosive esophagitis', 'familial adenomatous polyposis', 'fap',
    'liver injury', 'alagille'
  ],
  'Nephrology': [
    'kidney', 'renal failure', 'chronic kidney', 'ckd', 'dialysis',
    'glomerulonephritis', 'nephropathy', 'polycystic kidney', 'pkd',
    'iga nephropathy', 'nephrotic', 'end-stage renal', 'esrd', 'renal allograft',
    // Transplant (nephrology often handles kidney transplant)
    'transplant', 'graft', 'allograft', 'rejection', 'immunosuppression',
    'transplant rejection',
    'hyperkalemia', 'hyperkalaemia', 'mpgn', 'membranoproliferative',
    'fsgs', 'focal segmental', 'c3g', 'c3 glomerulopathy'
  ],
  'Urology': [
    'urinary', 'bladder', 'prostate', 'benign prostatic', 'bph',
    'overactive bladder', 'incontinence', 'urologic', 'erectile',
    'interstitial cystitis', 'urethral', 'neurogenic detrusor', 'ureter'
  ],
  'OB/GYN': [
    'endometriosis', 'uterine', 'ovarian', 'menopause', 'postmenopausal',
    'polycystic ovary', 'pcos', 'contraception', 'fertility', 'preeclampsia',
    'menstrual', 'vulvovaginal', 'cervical', 'breast', 'pregnancy',
    'maternal', 'postpartum', 'oocyte', 'ivf', 'in vitro',
    'morning sickness', 'hyperemesis', 'endometrial hyperplasia',
    'gestational', 'small for gestational'
  ],
  'Orthopedics': [
    'osteoarthritis', 'arthritis', 'osteoporosis', 'bone', 'joint',
    'back pain', 'spine', 'spinal', 'fracture', 'tendon', 'ligament',
    'cartilage', 'gout', 'skeletal', 'disc disease',
    'pseudarthrosis', 'orthopedic'
  ],
  'Rare/Genetic Disease': [
    'orphan', 'rare disease', 'fabry', 'gaucher', 'pompe', 'hunter syndrome',
    'hurler', 'niemann-pick', 'wilson disease', 'cystinosis', 'progeria',
    'marfan', 'ehlers-danlos', 'osteogenesis imperfecta',
    'epidermolysis bullosa', 'batten', 'rett syndrome', 'fragile x',
    'prader-willi', 'angelman', 'lysosomal', 'mucopolysaccharidosis',
    // Genetic/Metabolic diseases
    'alpha1-antitrypsin', 'homocystinuria', 'phenylketonuria', 'pku',
    'hypochondroplasia', 'achondroplasia', 'phelan-mcdermid', 'protoporphyria',
    'porphyria', 'glycogen storage', 'maple syrup', 'tyrosinemia',
    'urea cycle', 'organic acidemia', 'methylmalonic', 'propionic',
    'gangliosidosis', 'turner syndrome', 'short stature', 'idiopathic short stature',
    'lymphatic malformation', 'choline deficiency', 'igg4 related',
    'adh1', 'autosomal dominant hypocalcemia', 'epp', 'erythropoietic protoporphyria',
    'neurodevelopmental disorder'
  ]
};

function classifyCondition(conditions) {
  if (!conditions || conditions.length === 0) {
    return 'Other';
  }

  const conditionText = conditions.join(' ').toLowerCase();

  // Check each therapeutic area - order matters for specificity
  // Check more specific areas first
  const areaOrder = [
    'Rare/Genetic Disease',
    'Vaccines',
    'Oncology',
    'Ophthalmology',
    'Hematology',
    'Nephrology',
    'Urology',
    'OB/GYN',
    'Otolaryngology',
    'Psychiatry',
    'Neurology',
    'Infectious Disease',
    'Allergy/Immunology',
    'Dermatology',
    'Gastroenterology',
    'Pulmonology',
    'Cardiology',
    'Endocrinology',
    'Rheumatology',
    'Orthopedics'
  ];

  for (const area of areaOrder) {
    const keywords = THERAPEUTIC_AREA_KEYWORDS[area];
    for (const keyword of keywords) {
      if (conditionText.includes(keyword.toLowerCase())) {
        return area;
      }
    }
  }

  return 'Other';
}

function getAllTherapeuticAreas() {
  return Object.keys(THERAPEUTIC_AREA_KEYWORDS).concat(['Other']);
}

module.exports = { classifyCondition, getAllTherapeuticAreas, THERAPEUTIC_AREA_KEYWORDS };
