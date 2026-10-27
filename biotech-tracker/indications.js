/**
 * Second-level indication tags under each therapeutic area, so a user can go
 * from "Oncology" to "Lung cancer". Matched against ClinicalTrials.gov
 * condition text. A study can carry several tags (a basket trial in lung and
 * breast cancer gets both).
 *
 * Patterns are case-insensitive regexes; abbreviations need \b on both sides
 * or "aml" matches "amlodipine".
 */

const TAXONOMY = {
  Oncology: {
    'Lung cancer': /lung (cancer|carcinoma|neoplasm|adenocarcinoma)|\bn?sclc\b|non-small[- ]cell|small[- ]cell lung|lung tumou?r|mesothelioma|thoracic (cancer|tumou?r)/,
    'Breast cancer': /breast (cancer|carcinoma|neoplasm|tumou?r)|\btnbc\b|her2[- ]positive breast|mammary carcinoma/,
    'Prostate cancer': /prostat(e|ic) (cancer|carcinoma|adenocarcinoma|neoplasm)|\bm?crpc\b|castrat(e|ion)[- ]resistant/,
    'Colorectal cancer': /colorectal|colon (cancer|carcinoma|adenocarcinoma)|rectal (cancer|carcinoma)|\bcrc\b/,
    'Pancreatic cancer': /pancrea\w* (cancer|carcinoma|adenocarcinoma|ductal)|\bpdac\b/,
    'Liver & biliary cancer': /hepatocellular|\bhcc\b|liver (cancer|carcinoma)|cholangiocarcinoma|biliary tract (cancer|carcinoma)|gallbladder (cancer|carcinoma)/,
    'Gastric & esophageal cancer': /gastric (cancer|carcinoma|adenocarcinoma)|stomach (cancer|neoplasm)|esophag\w* (cancer|carcinoma|adenocarcinoma|squamous)|gastro-?esophageal junction|\bgej\b/,
    'Gynecologic cancer': /ovarian (cancer|carcinoma|neoplasm)|endometrial (cancer|carcinoma)|cervical (cancer|carcinoma)|uterine (cancer|carcinoma|sarcoma)|fallopian|primary peritoneal/,
    'Bladder & kidney cancer': /bladder (cancer|carcinoma)|urothelial|renal cell|\brcc\b|kidney (cancer|carcinoma)|upper tract/,
    'Head & neck cancer': /head and neck|\bhnscc\b|\bscchn\b|oral (cavity )?(cancer|squamous)|nasopharyn|laryn\w* (cancer|carcinoma)|oropharyn/,
    'Brain & CNS tumors': /glioblastoma|glioma|\bgbm\b|astrocytoma|brain (tumou?r|cancer|metastas)|\bdipg\b|medulloblastoma|ependymoma|meningioma|cns tumou?r/,
    'Skin cancer': /melanoma|merkel cell|cutaneous squamous|basal cell carcinoma|\bcscc\b/,
    'Sarcoma': /sarcoma|\bgist\b|gastrointestinal stromal|desmoid/,
    'Thyroid & neuroendocrine': /thyroid (cancer|carcinoma)|neuroendocrine (tumou?r|carcinoma|neoplasm)|\bnet\b|carcinoid|pheochromocytoma|paraganglioma/,
    Leukemia: /leuka?emia|\baml\b|\bcll\b|\bcml\b|\bb-all\b|acute lymphoblastic|acute myeloid|myelodysplastic|\bmds\b/,
    Lymphoma: /lymphoma|\bdlbcl\b|hodgkin|\bmcl\b|\bfl\b|waldenstr/,
    'Multiple myeloma': /myeloma|plasma cell (neoplasm|leuka?emia)|amyloidosis/,
    'Myeloproliferative neoplasms': /myelofibrosis|polycythemia vera|essential thrombocyth|myeloproliferative|\bmpn\b|mastocytosis/,
    'Solid tumors (any)': /solid (tumou?r|malignanc|cancer|neoplasm)|advanced (cancer|malignan)|malignant (tumou?r|neoplasm)|^cancers?$|^neoplasms?$/,
  },
  Neurology: {
    "Alzheimer's & dementia": /alzheimer|dementia|cognitive impairment|\bmci\b/,
    "Parkinson's": /parkinson/,
    ALS: /amyotrophic|\bals\b|motor neuron disease/,
    'Multiple sclerosis': /multiple sclerosis|\brms\b|\bspms\b|\bppms\b/,
    'Epilepsy & seizures': /epilep|seizure|dravet|lennox|tuberous sclerosis|infantile spasm/,
    'Migraine & headache': /migraine|headache|cluster/,
    'Pain': /pain|neuropath|fibromyalgia|postherpetic/,
    'Neuromuscular': /duchenne|muscular dystrophy|\bdmd\b|spinal muscular|\bsma\b|myasthenia|myotonic|charcot|friedreich|ataxia|\bcidp\b/,
    "Huntington's & movement disorders": /huntington|dystonia|tremor|tardive|tourette/,
    Stroke: /stroke|cerebrovascular|intracerebral hemorrhage|subarachnoid/,
    'Sleep disorders': /narcolepsy|insomnia|sleep apnea|hypersomnia/,
  },
  Psychiatry: {
    Depression: /depress/,
    'Schizophrenia & psychosis': /schizophren|psychos|psychotic/,
    'Bipolar disorder': /bipolar|mania/,
    'Anxiety & PTSD': /anxiety|\bptsd\b|post-?traumatic|panic|obsessive/,
    'Substance use': /opioid use|alcohol use|substance|addiction|cocaine|methamphetamine|nicotine|smoking/,
    'ADHD & autism': /\badhd\b|attention deficit|autism|\basd\b/,
  },
  Endocrinology: {
    Obesity: /obes|overweight|weight (loss|management)/,
    'Type 2 diabetes': /type (2|ii) diabetes|\bt2d\b|\bt2dm\b|diabetes mellitus,? type (2|ii)/,
    'Diabetes (unspecified)': /^diabetes( mellitus)?$/,
    'Type 1 diabetes': /type 1 diabetes|\bt1d\b|diabetes mellitus, type 1/,
    'Thyroid & adrenal': /thyroid|graves|adrenal|cushing|hypoparathyroid/,
    'Growth & rare metabolic': /growth hormone|acromegaly|achondroplasia|hypophosphat|lipodystrophy|hyperinsulin/,
  },
  Cardiology: {
    'Heart failure': /heart failure|\bhfref\b|\bhfpef\b|cardiomyopathy/,
    'Structural heart & vascular': /valve|valvular|regurgitation|aortic stenosis|peripheral arter|aneurysm/,
    'Lipids & atherosclerosis': /cholesterol|lipid|\blp\(a\)|lipoprotein|triglycerid|atheroscler|coronary/,
    Hypertension: /^(?!.*(pulmonary|ocular|portal|intracranial)).*hypertension/,
    Arrhythmia: /atrial fibrillation|arrhythm|tachycardia/,
    Thrombosis: /thrombo|embolism|anticoagul/,
  },
  'Infectious Disease': {
    HIV: /\bhiv\b|human immunodeficiency/,
    'Hepatitis B & D': /hepatitis b|hepatitis d|\bhbv\b|\bhdv\b/,
    'COVID-19 & respiratory viruses': /covid|sars-cov|influenza|\brsv\b|respiratory syncytial/,
    'Herpes, CMV & other viral': /herpes|zoster|cytomegalovirus|\bcmv\b|hepatitis c|\bhcv\b|\bhpv\b|epstein-barr/,
    'Bacterial & fungal infections': /bacteri|infection|pneumonia|sepsis|fungal|candid|aspergill|tubercul|urinary tract infection|c\. ?diff|clostridi/,
  },
  Vaccines: {
    'Respiratory vaccines': /covid|influenza|\brsv\b|pneumococc/,
    'Other vaccines': /vaccin/,
  },
  'Allergy/Immunology': {
    'Food & environmental allergy': /allerg|peanut|anaphyla/,
    'Lupus': /lupus|\bsle\b/,
    'Immune deficiency & other': /immunodeficien|hereditary angioedema|\bhae\b/,
  },
  Rheumatology: {
    'Rheumatoid arthritis': /rheumatoid/,
    'Lupus': /lupus|\bsle\b/,
    "Sjögren's & systemic sclerosis": /sj[oö]gren|systemic sclerosis|scleroderma/,
    'Myositis & vasculitis': /myositis|vasculitis|giant cell arteritis/,
    'Spondyloarthritis & gout': /spondyl|gout|psoriatic arthritis/,
  },
  Dermatology: {
    'Atopic dermatitis & eczema': /atopic dermatitis|dermatitis,? atopic|eczema/,
    Psoriasis: /psoria/,
    'Alopecia & vitiligo': /alopecia|vitiligo/,
    'Hidradenitis suppurativa': /hidradenitis/,
    'Acne & rosacea': /acne|rosacea/,
    'Itch & urticaria': /prurit|urticaria|itch/,
    'Wounds & ulcers': /\bulcers?\b|wound|burns?\b|epidermolysis/,
    Aesthetics: /wrinkle|glabellar|skin (aging|laxity)|photoaging|cellulite|submental|crow'?s feet/,
  },
  Gastroenterology: {
    'Ulcerative colitis & Crohn\'s': /ulcerative colitis|crohn|inflammatory bowel|\bibd\b/,
    'MASH & liver disease': /\bmash\b|\bnash\b|steatohepatitis|steatotic|fatty liver|\bmasld\b|\bnafld\b|cirrhosis|primary biliary|primary sclerosing|\bpbc\b|\bpsc\b/,
    'Celiac & eosinophilic': /celiac|eosinophilic esophagitis|\beoe\b/,
    'Motility & IBS': /irritable bowel|\bibs\b|gastroparesis|constipation/,
  },
  Pulmonology: {
    COPD: /\bcopd\b|chronic obstructive/,
    Asthma: /asthma/,
    'Pulmonary fibrosis & ILD': /pulmonary fibrosis|\bipf\b|interstitial lung|\bild\b|\bppf\b/,
    'Pulmonary hypertension': /pulmonary (arterial )?hypertension|\bpah\b/,
    'Cystic fibrosis & bronchiectasis': /cystic fibrosis|bronchiectasis/,
  },
  Ophthalmology: {
    'Macular degeneration & GA': /macular degeneration|\bamd\b|geographic atrophy|neovascular/,
    'Diabetic eye disease': /diabetic (macular|retinopathy)|\bdme\b/,
    'Inherited retinal disease': /retinitis pigmentosa|stargardt|inherited retinal|leber|choroideremia|achromatopsia/,
    Glaucoma: /glaucoma|ocular hypertension/,
    'Dry eye & surface disease': /dry eye|keratitis|conjunctivitis|blepharitis|keratopathy/,
    'Thyroid eye disease': /thyroid eye|graves.{0,10}orbitopathy/,
    'Myopia, presbyopia & cataract': /myopia|presbyopia|astigmatism|refractive|cataract/,
  },
  Hematology: {
    'Sickle cell & thalassemia': /sickle|thalassemi/,
    Hemophilia: /hemophilia|haemophilia|von willebrand/,
    'Anemia & iron': /anemi|anaemi|iron/,
    'ITP & complement disorders': /\bitp\b|immune thrombocytop|\bpnh\b|paroxysmal nocturnal|hemolytic uremic|\bahus\b|cold agglutinin/,
  },
  Nephrology: {
    'IgA nephropathy & glomerular disease': /iga nephropathy|glomerul|\bfsgs\b|nephrotic|lupus nephritis|\bc3g\b|membranous/,
    'Chronic kidney disease': /chronic kidney|\bckd\b|dialysis|end[- ]stage renal|\besrd\b/,
    'Polycystic kidney disease': /polycystic kidney|\badpkd\b/,
    Transplant: /transplant|graft|rejection/,
  },
  'Rare/Genetic Disease': {
    'Lysosomal storage': /fabry|gaucher|pompe|mucopolysacchar|niemann|lysosomal|batten|hunter|hurler/,
    'Metabolic disorders': /phenylketon|\bpku\b|urea cycle|homocystin|methylmalon|propionic|glycogen storage|porphyri/,
    'Neurodevelopmental syndromes': /rett|angelman|fragile x|prader|phelan/,
  },
};

Object.assign(TAXONOMY, {
  Orthopedics: {
    Osteoarthritis: /osteoarthritis/,
    'Osteoporosis & bone': /osteoporosis|bone (loss|density)|fracture|osteogenesis/,
    'Musculoskeletal pain & injury': /back pain|tendin|rotator cuff|sarcopenia|muscle (atrophy|wasting)/,
  },
  Otolaryngology: {
    'Hearing loss & tinnitus': /hearing loss|tinnitus|meni[eè]re|otitis/,
    'Sinus & nasal disease': /rhinosinusitis|nasal polyp|rhinitis/,
  },
  'OB/GYN': {
    'Endometriosis & fibroids': /endometriosis|fibroid|leiomyoma|adenomyosis/,
    'Menopause': /menopaus|hot flash|vasomotor/,
    'Fertility & pregnancy': /infertil|\bivf\b|oocyte|preterm|pre-?eclampsia|postpartum/,
    'Vaginal & sexual health': /vagin|bacterial vaginosis|hypoactive sexual|contracept/,
  },
  Urology: {
    'BPH & bladder': /benign prostatic|\bbph\b|overactive bladder|incontinence|interstitial cystitis|nocturia/,
    'Erectile dysfunction': /erectile/,
  },
});

const COMPILED = Object.entries(TAXONOMY).flatMap(([area, subs]) =>
  Object.entries(subs).map(([name, re]) => ({ area, name, re: new RegExp(re.source, 'i') })));

/** Tags ("Oncology › Lung cancer") for a list of condition strings. */
function tagIndications(conditions) {
  const tags = new Set();
  for (const c of conditions) {
    const text = c.toLowerCase();
    for (const t of COMPILED) if (t.re.test(text)) tags.add(`${t.area} › ${t.name}`);
  }
  // A generic "solid tumors" tag adds nothing when a specific tumor type is named.
  const onc = [...tags].filter(t => t.startsWith('Oncology › ') && t !== 'Oncology › Solid tumors (any)');
  if (onc.length) tags.delete('Oncology › Solid tumors (any)');
  return [...tags];
}

module.exports = { tagIndications, TAXONOMY };
