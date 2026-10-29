// Rule-based extraction of US regulatory events from MJH articles.
// Every event keeps the sentence it came from, so any row in the tracker can be traced to its source.
import { fileURLToPath } from 'node:url';
import { BRANDS, loadArticles } from './sanity.js';

const MONTHS = 'January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sept|Sep|Oct|Nov|Dec';
const DATE_RE = new RegExp(`\\b(${MONTHS})\\.? (\\d{1,2}),? (20\\d\\d)\\b`, 'g');
const MONTH_YEAR_RE = new RegExp(`\\b(?:in|by|during) (${MONTHS})\\.? (20\\d\\d)\\b`, 'g');
const QUARTER_RE = /\b(first|second|third|fourth|1st|2nd|3rd|4th) quarter (?:of )?(20\d\d)\b|\bQ([1-4]) (20\d\d)\b|\b(first|second) half (?:of )?(20\d\d)\b|\b(early|mid|late|end of)[- ](20\d\d)\b/i;

const NON_US = /\b(Saudi|SFDA|Swiss|Korea\w*|MFDS|Taiwan\w*|Brazil\w*|ANVISA|India\w*|CDSCO|Australia\w*|EMA|European|Europe|EU\b|CHMP|European Commission|NMPA|China|Chinese|Japan|PMDA|MHLW|Health Canada|MHRA|TGA|Swissmedic|marketing authori[sz]ation|MAA)\b/;
const PLAN = /\b(moves? toward|towards?|will determine|will decide|once (the )?(application|submission)|plan(s|ned)?|expect(s|ed)?|anticipat\w*|intend\w*|will (be )?(submit|file)|to (submit|file)|aim\w*|on track|potential(ly)?|could|may|would|later this year|upcoming|seeks? to)\b/i;
const ROUNDUP = /early look|key studies|studies to (watch|know)|abstracts|FDA (news|updates?)\b|news (in|from)|preview|to watch|recap|roundup|round-up|headlines|look(ing)? ahead|decisions|\bfive\b|oncfive|hcpfive|in review|top (news|stories|articles|videos)|you (may have )?missed|highlights|digest|daily:|brief:|at a glance|outlook|pipeline report|month in|week in|year in/i;
// Not a marketing application for a drug: IND, designation requests, devices, EU filings, meetings.
const NOT_FILING = /\b(IND|investigational new drug|orphan drug designation|ODD|rare pediatric disease designation|RPDD|breakthrough (therapy )?designation request|PMA|premarket|510\(k\)|De Novo|MAA|marketing authori[sz]ation application|pre-(BLA|NDA)|type [ABC] meeting|end[- ]of[- ]phase|special protocol|IDE|clinical trial application|CTA|protocol|tentative approval|ANDA|abbreviated new drug|generic version|sunscreen|OTC monograph|dermal filler|filler|hyaluronic acid gel|final module of (the )?PMA)\b/i;
// Headlines about intentions, not filings.
const HEADLINE_PLAN = /\b(plans?|planned|pursues?|intends?|upcoming|positions?|toward|path\b|paves?|prepar\w*|accelerates?|likely|expected|on track|forcing|ahead of|readies|eyes|aims?|support(s|ing)? (a |an )?(future |potential )?(submission|filing)|could|may|recommends against|clears path)\b/i;

const APPL = /\b(s?NDA|s?BLA|new drug application|biologics? license application|supplemental|application|submission|filing)\b/i;
const EV = {
  // A complete response *letter*, never a clinical complete response ("complete response rate").
  crl: /\bcomplete response letters?\b|\bCRLs?\b|\b(issues?|issued|receives?|received|handed|gets?|got)\s+(an?\s+|another\s+|second\s+|third\s+)?complete response\b(?!\s+(rate|rates|in|with|of|to|was|were))/i,
  withdrawn: /\bwithdr[ae]w(s|n)?\b/i,
  extended: /\bextend(s|ed)?\b.*\b(PDUFA|review|action date|goal date)|\b(PDUFA|review|action date|goal date)\b.*\bextend|\bextension\b/i,
  resubmitted: /\bresubmi(t|ts|tted|ssion)\b/i,
  accepted: /\baccept(s|ed|ance)?\b|\bpriority review\b|\bunder (FDA )?(priority )?review\b|\benters? FDA review\b|\bfiled for review\b/i,
  submitted: /\bsubmi(t|ts|tted|ssion)\b|\bFDA (has )?receive[sd]\b|\breceive[sd] (an? )?s?(NDA|BLA)\b|\bfiled\b|\bfiling\b|\bseeks? FDA\b/i,
  approved: /\bapprov(e|es|ed|al)\b|\bclears? (an? |the )?s?(NDA|BLA)\b/i,
  pdufa: /\bPDUFA\b|\btarget action date\b|\bgoal date\b|\baction date\b/i,
};

// Nonproprietary-name stems, for spotting drugs the AI mention list missed.
const INN = /\b[a-z][a-z]{2,}(?:mab|nib|leucel|cel|lisib|rasib|parib|ciclib|tecan|vedotin|mertansine|zomib|lidomide|strant|lutamide|glutide|tide|rsen|sen|siran|gene|vec|cicept|ercept|stat|platin|taxel|rubicin|degib|imod|citinib|tug|mig|bart|kinra|sertib|metinib|fenib|vir|gliflozin|sartan|prazole|parin|orexton|caftor|torsen|aptagene|xaban|gatran)(?:-[a-z]{4})?\b/gi;
const CODE = /\b[A-Z]{1,6}[- ]?\d{2,6}[A-Za-z]?(?:-[A-Za-z0-9]+)?\b/g;
const CODE_STOP = /^(NCT|CD\d|IL|COVID|ECOG|PD-?\d|CTLA|FGFR|ESR|BRCA|TP53|HPV|EBV|CYP|HLA|Q[1-4]|ASCO|ESMO|ASH|AACR|SABCS|EHA|ADA|AHA|ACC|EASD|AAD|DDW|ATS|ERS|ACR|EULAR|AAN|RECIST|G12|HER\d|KRAS|NRAS|EGFR|IDH|FLT3|JAK|BTK|KIT|MET|ALK|ROS|RET|NTRK|PIK3|TROP|DLL|BCMA|GPRC|FcRn|IgA|IgG|IgE|T\d|N\d|M\d|ICD|DSM|CKD|ADHD|PTSD|MDD|HAE)/i;
const NOT_DRUG = /^(phase|stat|gene|tide|corcept|intercept|accept|except|concept|disease|release|extended-release|fda|nda|bla|snda|sbla|pdufa|placebo|chemotherapy|chemo|standard of care|soc|best supportive care|dexamethasone|prednisone|bcg|radiation|radiotherapy|surgery)$/i;

// Disease abbreviations so that "NSCLC" and "non-small cell lung cancer" compare as equal.
export const ABBREV = {
  nsclc: 'nonsmall cell lung cancer', sclc: 'small cell lung cancer', 'es-sclc': 'extensive stage small cell lung cancer',
  crc: 'colorectal cancer', mcrc: 'metastatic colorectal cancer', hcc: 'hepatocellular carcinoma', uhcc: 'unresectable hepatocellular carcinoma', rcc: 'renal cell carcinoma',
  ccrcc: 'clear cell renal cell carcinoma', mm: 'multiple myeloma', cll: 'chronic lymphocytic leukemia', sll: 'small lymphocytic lymphoma',
  aml: 'acute myeloid leukemia', all: 'acute lymphoblastic leukemia', cml: 'chronic myeloid leukemia', mds: 'myelodysplastic syndromes',
  dlbcl: 'diffuse large b cell lymphoma', lbcl: 'large b cell lymphoma', fl: 'follicular lymphoma', mcl: 'mantle cell lymphoma',
  nmibc: 'nonmuscle invasive bladder cancer', mibc: 'muscle invasive bladder cancer', uc: 'urothelial carcinoma',
  pdac: 'pancreatic ductal adenocarcinoma', mpdac: 'metastatic pancreatic ductal adenocarcinoma', crpc: 'castration resistant prostate cancer',
  mcrpc: 'metastatic castration resistant prostate cancer', mcspc: 'metastatic castration sensitive prostate cancer',
  cspc: 'castration sensitive prostate cancer', hspc: 'castration sensitive prostate cancer', mhspc: 'metastatic castration sensitive prostate cancer',
  'hormone-sensitive': 'castration sensitive', 'castration-sensitive': 'castration sensitive', 'castration-resistant': 'castration resistant',
  gist: 'gastrointestinal stromal tumor', net: 'neuroendocrine tumors', nets: 'neuroendocrine tumors', 'gep-nets': 'gastroenteropancreatic neuroendocrine tumors',
  tnbc: 'triple negative breast cancer', mbc: 'metastatic breast cancer', gea: 'gastroesophageal adenocarcinoma', gej: 'gastroesophageal junction',
  btc: 'biliary tract cancer', hnscc: 'head and neck squamous cell carcinoma', scchn: 'head and neck squamous cell carcinoma',
  gvhd: 'graft versus host disease', pv: 'polycythemia vera', et: 'essential thrombocythemia', mf: 'myelofibrosis', sm: 'systemic mastocytosis',
  igan: 'iga nephropathy', ckd: 'chronic kidney disease', hf: 'heart failure', hfref: 'heart failure reduced ejection fraction',
  pah: 'pulmonary arterial hypertension', ipf: 'idiopathic pulmonary fibrosis', copd: 'chronic obstructive pulmonary disease',
  ad: 'atopic dermatitis', pso: 'psoriasis', psa: 'psoriatic arthritis', ra: 'rheumatoid arthritis', sle: 'systemic lupus erythematosus',
  uc_: 'ulcerative colitis', cd: 'crohn disease', hs: 'hidradenitis suppurativa', t2d: 'type 2 diabetes', t1d: 'type 1 diabetes',
  mash: 'metabolic dysfunction associated steatohepatitis', nash: 'nonalcoholic steatohepatitis', pbc: 'primary biliary cholangitis',
  psc: 'primary sclerosing cholangitis', hae: 'hereditary angioedema', hcm: 'hypertrophic cardiomyopathy', ohcm: 'obstructive hypertrophic cardiomyopathy',
  pdcd: 'pyruvate dehydrogenase complex deficiency', copd: 'chronic obstructive pulmonary disease', osa: 'obstructive sleep apnea', cindu: 'chronic inducible urticaria',   mdd: 'major depressive disorder', gad: 'generalized anxiety disorder', ptsd: 'posttraumatic stress disorder', adhd: 'attention deficit hyperactivity disorder',
  dmd: 'duchenne muscular dystrophy', sma: 'spinal muscular atrophy', als: 'amyotrophic lateral sclerosis', ms: 'multiple sclerosis',
  gmg: 'generalized myasthenia gravis', mg: 'myasthenia gravis', cidp: 'chronic inflammatory demyelinating polyneuropathy',
  amd: 'age related macular degeneration', dme: 'diabetic macular edema', ted: 'thyroid eye disease', rsv: 'respiratory syncytial virus',
};
const STOPWORDS = new Set('a an and or the of in for with to as by on at from after before who whose patients patient adults adult adolescents children pediatric aged years older treatment treat therapy previously untreated pretreated advanced metastatic locally unresectable relapsed refractory r/r first-line frontline second-line line setting disease cancer tumors tumor plus versus vs fda decision approval approves approved approve grants granted gains receives earns wins accelerated full traditional regimen combination each who down young age old months month as include including expand expanded indication'.split(' '));

const lc = s => s.toLowerCase();
const isoFrom = (mon, day, year) => {
  const m = new Date(`${mon.replace(/\.$/, '').replace('Sept', 'Sep')} 1, 2000`).getMonth();
  return `${year}-${String(m + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
};

export function normName(s) {
  return lc(s)
    .replace(/[®™*]/g, '')
    .replace(/\b([a-z]{4,})-[a-z]{4}\b/g, '$1')         // biologic 4-letter suffix: zanidatamab-hrii
    .replace(/\b(fam|ado|enfortumab)-(?=[a-z])/g, '')    // fam-trastuzumab deruxtecan
    .replace(/[^a-z0-9]+/g, ' ').trim();
}

export function indicationTokens(s) {
  if (!s) return new Set();
  let t = lc(s).replace(/[–—]/g, '-').replace(/non[–-]?/g, 'non')
    .replace(/-positive\b/g, '+').replace(/-negative\b/g, '-').replace(/\//g, ' ');
  t = t.replace(/hormone[- ]sensitive/g, 'castration sensitive').replace(/\b([a-z0-9]{2,6})[- ](?:gene[- ])?(?:mutated|mutant|altered|mutation)\b/g, '$1+');
  t = t.replace(/kidney cancer/g, 'renal cell carcinoma').replace(/liver cancer/g, 'hepatocellular carcinoma').replace(/bladder cancer/g, 'urothelial bladder carcinoma');
  t = t.replace(/[a-z0-9+-]+/g, w => ABBREV[w] || w);
  return new Set(t.split(/[^a-z0-9+]+/).filter(w => w.length > 1 && !STOPWORDS.has(w)).map(w => w.length > 4 ? w.replace(/s$/, '') : w));
}

// Reference lists cite old press releases ("Accessed May 2, 2026. https://...") and must not become events.
export function bodyOf(text) {
  const t = text || '';
  const cut = t.search(/\n\s*References?\s*\n/i);
  return (cut > 0 ? t.slice(0, cut) : t).replace(/https?:\/\/\S+/g, '');
}

function sentences(text) {
  text = text.replace(/[¹²³⁴⁵⁶⁷⁸⁹⁰†‡]+/g, ' ');
  return text.split(/\n+|(?<=[.!?])\s+(?=[A-Z“"(])/).map(s => s.trim()).filter(s => s.length > 15);
}

// Every drug-like name in a string, earliest first, longest wins on overlap.
function findDrugs(str, mentions) {
  const hits = [];
  const low = lc(str);
  for (const m of mentions) {
    if (m.length < 3 || NOT_DRUG.test(m)) continue;
    const re = new RegExp(`(^|[^a-z0-9])${lc(m).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=$|[^a-z0-9])`, 'g');
    for (let x; (x = re.exec(low));) hits.push({ name: m, at: x.index + x[1].length, len: m.length });
  }
  for (const x of str.matchAll(INN)) if (!NOT_DRUG.test(x[0])) hits.push({ name: x[0], at: x.index, len: x[0].length });
  for (const x of str.matchAll(CODE)) {
    if (CODE_STOP.test(x[0]) || /(^|\D)20\d\d$/.test(x[0])) continue;
    // Codes only count when the AI mention list agrees or they appear in a headline.
    if (mentions.some(m => lc(m).includes(lc(x[0])))) hits.push({ name: x[0], at: x.index, len: x[0].length });
  }
  hits.sort((a, b) => a.at - b.at || b.len - a.len);
  // Companies sometimes appear in the AI mention list ("BioXcel").
  for (let i = hits.length - 1; i >= 0; i--) if (isCompany(hits[i].name.split(/\s+/)[0], str) || COMPANY.test(hits[i].name)) hits.splice(i, 1);
  const out = [];
  for (const h of hits) if (!out.some(o => h.at < o.at + o.len && o.at < h.at + h.len)) out.push(h);
  return out;
}

function titleDrugs(title, mentions) {
  const found = findDrugs(title, mentions);
  if (found.length) return found;
  // Headline codes such as "UGN-103" or "TLX250-CDx" that the mention list missed.
  return [...title.matchAll(CODE)].filter(x => !CODE_STOP.test(x[0]) && !/[ ]20\d\d$/.test(x[0]) && /\d/.test(x[0]) && /[A-Z]/.test(x[0])).map(x => ({ name: x[0], at: x.index, len: x[0].length }));
}

function indicationFromTitle(title, drug) {
  const after = drug ? title.slice(drug.at + drug.len) : title;
  const m = after.match(/\b(?:in|for|as)\s+(.+)$/i);
  if (!m) return null;
  return m[1]
    .replace(/^(the )?(treatment of |patients with |adults with |people with )/i, '')
    .replace(/,? (Is |Are )?(Submitted|Accepted|Resubmitted)\b.*$/i, '')
    .replace(/,? (Following|Based on|Supported by|Backed by|Citing|Due to|Falls|Shows|Improves|Gets|Receives|Accepts)\b.*$/i, '')
    .replace(/\s+to (the )?FDA\b.*$/i, '')
    .replace(/:.*$|,? (Sets|With [A-Z]|Is Proceeding|Pursuing|Over a Decade|in Phase \d|After Positive)\b.*$/i, '')
    .replace(/\s+(Treatment|Therapy)$/i, '')
    .replace(/\s+/g, ' ').trim()
    .replace(/^(over|more than|nearly|almost|about|decades?)\b.*$/i, '') || null;
}

function datesIn(s) {
  return [...s.matchAll(DATE_RE)].map(m => ({ iso: isoFrom(m[1], m[2], m[3]), at: m.index }));
}

// "Expected October" (preview headings), "a decision is expected in November 2026".
const MONTH_GUIDE_RE = new RegExp(`\\b(?:expected|anticipated|due|target(?:\\s+action)?\\s+date|goal\\s+date|PDUFA(?:\\s+date)?)\\s+(?:is\\s+|of\\s+)?(?:in\\s+|by\\s+)?(?:early\\s+|mid-?\\s*|late\\s+)?(${MONTHS})\\.?(?:\\s+(20\\d\\d))?\\b`, 'i');
function monthGuidance(s, published) {
  const m = s.match(MONTH_GUIDE_RE);
  if (!m) return null;
  const mon = new Date(`${m[1].replace(/\.$/, '').replace('Sept', 'Sep')} 1, 2000`).getMonth();
  let year = m[2] ? Number(m[2]) : Number(published.slice(0, 4));
  if (!m[2] && mon < Number(published.slice(5, 7)) - 1) year++;
  const end = new Date(Date.UTC(year, mon + 1, 0)).toISOString().slice(0, 10);
  return end >= published ? { text: m[0], end } : null;
}

function quarterIn(s, published) {
  const m = s.match(QUARTER_RE);
  if (!m) return published ? monthGuidance(s, published) : null;
  const year = m[2] || m[4] || m[6] || m[8];
  let end;
  if (m[1] || m[3]) {
    const q = m[3] ? Number(m[3]) : { first: 1, '1st': 1, second: 2, '2nd': 2, third: 3, '3rd': 3, fourth: 4, '4th': 4 }[lc(m[1])];
    end = `${year}-${['03-31', '06-30', '09-30', '12-31'][q - 1]}`;
  } else if (m[5]) end = `${year}-${lc(m[5]) === 'first' ? '06-30' : '12-31'}`;
  else end = `${year}-${{ early: '04-30', mid: '07-31', late: '12-31', 'end of': '12-31' }[lc(m[7])]}`;
  return { text: m[0], end };
}

// Rejections that never say "complete response".
const REJECT = /\b(passes|passed) (again )?on (approving|approval)|\b(declines?|declined|refuses?|refused|rejects?|rejected|turns? down) (to approve|approval|the application)|\bnot (to )?approve\b/i;

function titleType(t) {
  // Pathway alignment, meetings and course changes are about how to file, not filings or decisions.
  if (/\b(pathway|alignment|aligns?|path to|reverses course|to follow|insufficient)\b/i.test(t)) return null;
  // Advisory committee votes advise; they are not FDA decisions.
  if (/\badvisory (committee|panel)|\badcomm\b|\bpanel votes?\b|\bvotes? (for|against|in favor)/i.test(t)) return null;
  // "After 2 CRLs, FDA Approves X": the CRL is history, the news is the approval.
  if (/\b(after|following|despite|post)\b[^,]*\bCRLs?\b|\bCRLs?\b[^,]*\b(behind|resolved)\b/i.test(t) && /\bapprov/i.test(t)) return 'approved';
  if (EV.crl.test(t) || REJECT.test(t) || /\bdoes not approve\b/i.test(t)) return 'crl';
  if (/\bwithdr[ae]w/i.test(t)) return 'withdrawn';
  if (/\bextends?\b|\bextension\b/i.test(t) && /PDUFA|review|action/i.test(t)) return 'extended';
  if (/\bresubmi/i.test(t)) return /accept/i.test(t) ? 'accepted_resubmission' : 'resubmitted';
  if (/PDUFA (target )?(action )?date|target action date/i.test(t) && !/approv/i.test(t)) return 'pdufa';
  if (/\baccept|priority review|under (FDA )?(priority )?review|enters FDA review|filing acceptance/i.test(t)) return 'accepted';
  if (/\bsubmi|FDA receives|\bfiled\b|seeks FDA|application (is )?(sent|in)\b/i.test(t) && APPL.test(t)) return 'submitted';
  if (/\bsubmi|FDA receives/i.test(t)) return 'submitted';
  // "Seeks FDA Approval", "Files for Approval": a submission, not a decision.
  if (/\b(seeks?|seeking|requests?|requesting|applies|applying|files?|filing)\s+(for\s+)?(FDA\s+|US\s+)?(accelerated\s+|full\s+)?approval\b/i.test(t)) return 'submitted';
  // "Potential First Approved Therapy" describes a hope, not a decision.
  if (/\b(potential(ly)?|could|would|may|first|only)\s+(be\s+)?(the\s+)?(first\s+)?(fda[- ])?approved\b|\bapproved (therapy|treatment|option)s?\b/i.test(t) && !/\bFDA (grants|approves)\b|\breceives?\b[^,]*\bapproval/i.test(t)) return null;
  if (/\bapprov|clears? (an? |the )?s?(NDA|BLA)|\bOK'?s\b|greenlights?/i.test(t)) return 'approved';
  return null;
}

function eventDate(s, published) {
  // An explicit date in the sentence that is not in the future is the action date.
  const ds = datesIn(s).filter(d => d.iso <= published);
  return ds.length === 1 ? ds[0].iso : null;
}

// When the AI mention list is empty, the filing sentence itself usually names the drug:
// "accepted a biologics license application for imlifidase".
const APP_FOR = /\b(?:s?NDA|s?BLA|new drug application|biologics? license application|application|submission)\)?\s+(?:with (?:the )?(?:US )?(?:FDA|Food and Drug Administration)\s+)?(?:for|of|seeking (?:the )?approval (?:of|for))\s+(?:the\s+|its\s+)?(?:investigational\s+)?(?:(?:intrathecal|intravenous|subcutaneous|oral|topical|inhaled|intravitreal|intranasal|sublingual|IV|SC)\s+)?([A-Za-z][A-Za-z0-9-]{3,}(?:\s+[a-z][a-z-]{3,}(?=\s+(?:for|in|as|to|\()))?)/;
// "submitted CagriSema to the FDA", "submitted CagriSema's obesity application to the FDA"
const SUBMITTED_X = /\b(?:submitted|filed|resubmitted)\s+(?:its\s+|the\s+)?([A-Z][A-Za-z0-9-]{3,})(?:['’]s)?\s+(?:[a-z]+\s+){0,2}(?:application\s+)?to\s+(?:the\s+)?(?:US\s+|U\.S\.\s+)?(?:Food and Drug Administration|FDA)\b/;
const APP_FOR_STOP = /^(the|a|an|its|this|their|approval|use|treatment|patients|adults|children|marketing|accelerated|priority|standard|full|traditional|review|people|subcutaneous|intravenous|oral|first|second|label|single|neoadjuvant|adjuvant|pediatric|product|complete|additional|responses|relapsed|refractory|superficial|combination|photodynamic|low-sodium|melanoma|vaccine|expanded|expansion|new|updated|revised|both|each|all|two|three|once|weekly|monthly|daily|chronic|acute|severe|moderate|mild|adolescents|infants|its|which|that|such|further|potential)$/i;
// The fallback name must look like a drug: an INN stem, a development code, or a capitalised
// name the article repeats (brands, coined names).
// "BioXcel Therapeutics", "Cytokinetics Inc": a name the article also writes with a corporate suffix is a company.
const isCompany = (w, text) => new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:['’]s)?\\s+(Therapeutics|Pharmaceuticals?|Pharma|Inc|Biosciences|Biotherapeutics|Bio|Biopharma|Holdings|Laboratories|Labs|Corp|Corporation|Group|AG|plc|SA|NV|Ltd|LLC)\\b`).test(text);

function drugShaped(name, article) {
  const w = name.split(/\s+/)[0];
  if (isCompany(w, article)) return false;
  if (APP_FOR_STOP.test(w) || NOT_DRUG.test(name)) return false;
  if (new RegExp(`^${INN.source}$`, 'i').test(w)) return true;
  if (/^[A-Z]{1,6}-?\d{2,6}/.test(w)) return true;
  const n = (article.match(new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi')) || []).length;
  // Plain or coined mixed-case names ("imlifidase", "CagriSema") the story keeps repeating.
  return (/^[A-Za-z][a-z]{5,}$/.test(w) || /^[A-Z][a-z]+[A-Z][a-z]+$/.test(w)) && n >= 3;
}

const HEADLINE_SLOT_AFTER = /\bFDA\s+(?:Grants?\s+)?(?:Accelerated\s+|Full\s+|Traditional\s+)?(?:Approves|Approval\s+(?:to|for|of)|Expands(?:\s+Approval\s+(?:for|of))?|Accepts\s+(?:an?\s+)?s?(?:NDA|BLA)\s+(?:Resubmission\s+)?for|Grants\s+Priority\s+Review\s+(?:to|for)|Clears|OKs|Receives\s+(?:an?\s+)?s?(?:NDA|BLA)\s+for|Issues\s+(?:a\s+)?CRL\s+(?:to|for))\s+([A-Z][\w-]*(?:\s+[A-Za-z][\w-]*){0,3}?)(?=\s+(?:Plus|for|in|as|With|Indication|Combination|Regimen)\b|,|$)/;
const HEADLINE_SLOT_BEFORE = /^([A-Z][\w-]*(?:\s+[A-Za-z][\w-]*){0,3}?)\s+(?:Receives|Gains|Wins|Earns|Nets|Secures|Lands|Approved|NDA|BLA|sNDA|sBLA)\b/;

// "Updated NMOSD Criteria, Tavapadon NDA Submitted, MIL-62 Shows Promise": three stories in one
// headline. Each comma-separated segment is read as its own headline.
// "Perioperative Durvalumab": the treatment setting, not part of the name.
const SETTING_PREFIX = /^(?:(?:Perioperative|Adjuvant|Neoadjuvant|Frontline|First-Line|Second-Line|Maintenance)\s+)+/i;

function headlineSegments(title) {
  const parts = title.split(/,\s+(?=[A-Z0-9])/);
  // "...Review for ESR1-Mutated, ER+ Advanced Breast Cancer" is one story, not two.
  const STORY_VERB = /\b(approv\w*|submit\w*|accept\w*|shows?|improves?|grants?|receives?|extends?|earns?|boosts?|reduces?|demonstrates?|achieves?|meets?|fails?|misses|launch\w*|announc\w*|is|are|wins?|gets?|yields?|elicits?|prolongs?|enters?|acquires?|issues?|sets?|completes?|halts?|stops?|highlights?)\b/i;
  // A verbless part right after a biomarker ("for ESR1-Mutated", "in MET-Driven") continues that indication.
  const joined = [];
  for (const p of parts) {
    if (joined.length && !STORY_VERB.test(p) && /\b(?:for|in|with)\s+(?:\S+\s+)?\S*(?:Mutated|Mutant|Positive|Negative|Driven|Altered|Amplified|Deficient|\+|Adults|Patients|Children)$/i.test(joined.at(-1))) joined[joined.length - 1] += ', ' + p;
    else joined.push(p);
  }
  return joined.length >= 2 && parts.every(p => p.split(/\s+/).length >= 3) ? joined : [title];
}

export function extractArticle(a) {
  const segs = a._segmented ? [a.title] : headlineSegments(a.title);
  if (segs.length > 1) {
    // Pick the segment with a regulatory event, and read the story as if that were its headline.
    const seg = segs.find(sg => titleType(sg)) || null;
    // "Sac-TMT Improves PFS, Is Under FDA Priority Review": a segment with the event but no drug of
    // its own is the same story continued, not a separate one.
    if (seg && !titleDrugs(seg, a.drugMentions || []).length && !(HEADLINE_SLOT_AFTER.test(seg) || HEADLINE_SLOT_BEFORE.test(seg))) {
      return extractArticle({ ...a, _segmented: true });
    }
    const res = extractArticle({ ...a, title: seg || segs[0], _segmented: true, _fullTitle: a.title });
    for (const e of res.events) e.title = a.title;
    // Without a regulatory segment the headline carries no event of its own.
    if (!seg) res.events = res.events.filter(e => e.where !== 'headline');
    return res;
  }
  const published = a.published.slice(0, 10);
  const mentions = a.drugMentions || [];
  const out = [];
  // A headline carrying two or more regulatory stories ("X Submitted for gMG, EC Approves Y, ...") is a roundup.
  const storyVerbs = (a.title.match(/\b(approv\w*|submit\w*|accept\w*|CRL|complete response|grants?|clears?|extends?)\b/gi) || []).length;
  const isRoundup = ROUNDUP.test(a.title) || /\bwatch\b|eyes on|month of/i.test(a.title) || (!a._segmented && storyVerbs >= 2 && /,/.test(a.title));
  const titleNonUS = NON_US.test(a.title) && !/\bFDA\b/.test(a.title);
  if (titleNonUS) return { primary: null, events: out };

  const fullText = `${a.title} ${a.summary || ''} ${a.text || ''}`;
  let tDrugs = isRoundup ? [] : titleDrugs(a.title, mentions);
  // The drug in the headline's verb slot ("FDA Receives sNDA for Selinexor Plus Ruxolitinib") leads,
  // even when only its partner matched a naming stem.
  if (tDrugs.length && !isRoundup) {
    const slot = a.title.match(HEADLINE_SLOT_AFTER);
    const name = slot?.[1]?.replace(/\s+(Combo|Combination|Regimen|Therapy|Injection|Tablets?)$/i, '').replace(SETTING_PREFIX, '').trim();
    const at = name ? a.title.indexOf(name) : -1;
    if (name && at >= 0 && at < tDrugs[0].at && !tDrugs.some(d => d.at === at) && name.split(/\s+/).length <= 3 && drugShaped(name, fullText)) tDrugs = [{ name, at, len: name.length }, ...tDrugs];
  }
  // Unrecognised names ("Nogapendekin Alfa Inbakicept") still sit in the headline's verb slot.
  if (!tDrugs.length && !isRoundup) {
    const after = a.title.match(HEADLINE_SLOT_AFTER);
    const m = after || a.title.match(HEADLINE_SLOT_BEFORE);
    const name = m?.[1]?.replace(/\s+(Combo|Combination|Regimen|Therapy|Injection|Tablets?)$/i, '').replace(SETTING_PREFIX, '').trim();
    const strongShape = n => !isCompany(n.split(/\s+/)[0], fullText) && new RegExp(`^${INN.source}$`, 'i').test(n.split(/\s+/)[0]) || /^[A-Z]{1,6}-?\d{2,6}/.test(n) || /^[A-Z][a-z]+[A-Z][a-z]+$/.test(n.split(/\s+/)[0]) || mentions.some(x => lc(x) === lc(n));
    // The "X Receives…" slot is looser, so it needs a stronger drug shape than the "FDA Approves X" slot.
    const ok = m && (after ? drugShaped(name, fullText) : strongShape(name));
    if (name && ok && name.split(/\s+/).length <= 4 && !/\b(submits?|developers?|company|announces?)\b/i.test(name)) tDrugs = [{ name, at: a.title.indexOf(name), len: name.length }];
  }
  const primary = tDrugs[0] || null;
  // The indication starts at the first "in/for/as" after the headline drug. Drugs past that
  // point belong to the indication ("Cisplatin-Eligible MIBC"), not to the regimen.
  const prep = primary ? a.title.slice(primary.at + primary.len).search(/\b(?:in|for|as)\s/i) : -1;
  const cut = prep >= 0 ? primary.at + primary.len + prep : Infinity;
  const regimen = tDrugs.filter(d => d.at < cut);
  const partners = [...new Map(regimen.slice(1).map(d => [lc(d.name), d.name])).values()].filter(n => lc(n) !== lc(primary?.name || ''));
  const indication = indicationFromTitle(a.title, regimen.at(-1) || primary);
  const base = { articleId: a._id, brand: a.brand, url: a.url, title: a.title, published };

  // Headline event: the most reliable signal, dated by publication.
  let tt = titleType(a.title);
  if ((tt === 'approved' || tt === 'crl') && NON_US.test(a.title.replace(/\bFDA\b.*$/, ''))) tt = null;
  if (tt === 'approved' && /\bJapan|China|EU\b|Europe|Canada|\bUK\b/.test(a.title)) tt = null;
  if ((tt === 'submitted' || tt === 'accepted' || tt === 'resubmitted') && (HEADLINE_PLAN.test(a.title) || NOT_FILING.test(a._fullTitle || a.title)
    || (/voucher/i.test(a.title) && !/\b(s?NDA|s?BLA)\b/.test(a.title)) || /\b(proceeding|despite)\b/i.test(a.title)
    // A rolling submission that has only begun is not yet a filing; the clock starts when it completes.
    || (/\b(begins?|initiated|initiates?|starts?|rolling)\b/i.test(a.title) && !/\bcomplet/i.test(a.title))
    // "Submits Additional Benefit-Risk Data": material for an existing review, not a new filing.
    || /\b(additional|supplementary|new|updated)\s+([\w-]+\s+){0,2}(data|information|analyses)\b/i.test(a.title)
    || /submitted (for|to) (publication|presentation)|abstract/i.test(a.title))) tt = null;
  if (tt && primary && !isRoundup) {
    const head = `${a.title}. ${a.summary || ''}`;
    const lede = sentences(bodyOf(a.text)).slice(0, 3).join(' ');
    const ctx = `${head} ${lede}`;
    const priority = /priority review/i.test(ctx) && !/previously granted priority review/i.test(ctx);
    const pd = sentences(ctx).filter(s => EV.pdufa.test(s)).flatMap(s => {
      const d = datesIn(s).filter(x => x.iso > published);
      return d.length ? [d[0].iso] : [];
    })[0] || null;
    const q = pd ? null : sentences(ctx).filter(s => /PDUFA|action date|decision/i.test(s)).map(x => quarterIn(x, published)).find(Boolean) || null;
    const types = tt === 'accepted_resubmission' ? ['resubmitted', 'accepted'] : [tt];
    for (const type of types) {
      out.push({
        ...base, drug: primary.name, partners, indication, type,
        date: (type === 'approved' || type === 'crl') ? (eventDate(lede, published) || published) : published,
        pdufaDate: pd, pdufaTimeframe: q?.text || null, pdufaTimeframeEnd: q?.end || null,
        priority, resubClass: /class 1\b/i.test(ctx) ? 1 : /class 2\b/i.test(ctx) ? 2 : null,
        supplemental: /\bs(NDA|BLA)\b|supplemental/i.test(ctx),
        evidence: a.title, where: 'headline',
      });
    }
  }

  // Body: PDUFA dates, acceptances and submissions mentioned anywhere in the article.
  let lastDrug = primary;
  for (const s of sentences(`${a.summary || ''}\n${bodyOf(a.text)}`)) {
    const sd = findDrugs(s, mentions);
    if (!sd.length) {
      const m = s.match(APP_FOR) || s.match(SUBMITTED_X);
      if (m && drugShaped(m[1], fullText)) sd.push({ name: m[1], at: m.index, len: m[1].length });
    }
    if (sd.length) lastDrug = sd[0];
    if (NON_US.test(s) && !/\bFDA\b/.test(s)) continue;
    // A sentence that names no drug is about whatever the story last named.
    const drug = sd[0] || lastDrug;
    if (!drug) continue;
    const future = datesIn(s).filter(d => d.iso > published);

    // "Expected October" as a preview heading, or "a decision is expected in the fourth quarter".
    const decisionGuidance = !/\b(filing acceptance|acceptance of the|whether .* accept|review timelines?)\b/i.test(s) && (/\b(decision|action|approval)\b[^.]{0,40}\b(expected|anticipated)\b|\b(expected|anticipated)\b[^.]{0,20}\b(decision|action)\b/i.test(s)
      || (isRoundup && /^expected\s/i.test(s) && s.length < 40)) && quarterIn(s, published);
    if ((EV.pdufa.test(s) && (future.length || quarterIn(s, published))) || decisionGuidance) {
      const q = future.length ? null : quarterIn(s, published);
      if (q && q.end < published) continue;
      // A sentence listing several decisions: each date belongs to the drug named just before it.
      if (sd.length > 1 && future.length) {
        // Drugs named as context (prior therapy, comparator, background) never own a date.
        const context = d => /\b(after|following|previously treated with|prior|with or without|refractory to|resistant to|than|versus|vs\.?|compared (with|to)|background|on top of|added to|on stable)\s+(\w+\s+){0,2}$/i.test(s.slice(Math.max(0, d.at - 40), d.at));
        // "X plus Y", "X and Y", "X with Y": one regimen, owned by X.
        const head = d => {
          let i = sd.indexOf(d);
          while (i > 0 && /^\s*(plus|\+|and|with|in combination with|combined with|\/|,)\s*$/i.test(s.slice(sd[i - 1].at + sd[i - 1].len, sd[i].at))) i--;
          return sd[i];
        };
        for (const fd of future) {
          const before = sd.filter(d => d.at < fd.at && !context(d));
          const own = primary && before.find(d => lc(d.name) === lc(primary.name));
          const owner = own || (before.length ? head(before.at(-1)) : null);
          if (!owner) continue;
          out.push({
            ...base, drug: owner.name, partners: [], indication: owner === primary ? indication : null,
            type: 'pdufa', date: published, pdufaDate: fd.iso, pdufaTimeframe: null, pdufaTimeframeEnd: null,
            priority: false, resubClass: null, supplemental: /\bs(NDA|BLA)\b|supplemental/i.test(s), evidence: s.slice(0, 400), where: 'body',
          });
        }
        continue;
      }
      out.push({
        ...base, drug: drug.name, partners: drug === primary ? partners : [], indication: drug === primary ? indication : null,
        type: EV.extended.test(s) ? 'extended' : 'pdufa', date: published,
        pdufaDate: future[0]?.iso || null, pdufaTimeframe: q?.text || null, pdufaTimeframeEnd: q?.end || null,
        priority: /priority review/i.test(s), resubClass: null, supplemental: /\bs(NDA|BLA)\b|supplemental/i.test(s),
        evidence: s.slice(0, 400), where: 'body',
      });
      continue;
    }
    if (NOT_FILING.test(s)) continue;
    // A recent "FDA has approved X" inside a story closes X's application; it never opens one.
    if (/\bFDA (has |recently )?(approved|granted (accelerated |full |traditional )?approval)/i.test(s) && !PLAN.test(s)) {
      const d = eventDate(s, published);
      if (d && (Date.parse(published) - Date.parse(d)) / 864e5 <= 45) {
        out.push({ ...base, drug: drug.name, partners: [], indication: null, type: 'approved', date: d, pdufaDate: null, pdufaTimeframe: null, pdufaTimeframeEnd: null, priority: false, resubClass: null, supplemental: false, evidence: s.slice(0, 400), where: 'body', closeOnly: true });
      }
      continue;
    }
    const statesFiling = /\b(submitted|filed|resubmitted|accepted)\b/i.test(s) && !/\b(will|plans? to|intends? to|expects? to|aims? to)\s+(be\s+)?(submit|file)|\bwhether\b|\bwill\s+(determine|decide|review)/i.test(s);
    // Designation stories mention "submission" (of the designation request); without an NDA/BLA it is not a filing.
    if (/\b(fast track|breakthrough therapy|orphan drug|RMAT|rare pediatric)\b/i.test(s) && !/\b(s?NDA|s?BLA|new drug application|biologics? licen[cs]e application)\b/i.test(s)) continue;
    if (!APPL.test(s) || (PLAN.test(s) && !statesFiling)) continue;
    // A rolling submission that has only begun has no review clock yet.
    if (/\brolling\b/i.test(s) && !/\bcomplet/i.test(s)) continue;
    // Restated history ("Rolling submission was initiated in August 2022"): keep it only with its own date.
    const monthYear = [...s.matchAll(MONTH_YEAR_RE)].map(m => isoFrom(m[1], 1, m[2])).filter(d => d <= published);
    const oldYear = [...s.matchAll(/\b(20\d\d)\b/g)].some(m => Number(m[1]) < Number(published.slice(0, 4)) - 0 && !future.length);
    let type = null;
    if (EV.crl.test(s) && /\b(issued|received|announced|letter)\b/i.test(s) && sd.length && !isRoundup) type = 'crl';
    else if (EV.resubmitted.test(s)) type = 'resubmitted';
    else if (EV.accepted.test(s) && /FDA|agency/i.test(s)) type = 'accepted';
    else if (EV.submitted.test(s) && /FDA|agency|submitted/i.test(s)) type = 'submitted';
    if (!type) continue;
    out.push({
      ...base, drug: drug.name, partners: drug === primary ? partners : [], indication: drug === primary ? indication : null,
      type, date: eventDate(s, published) || monthYear[0] || (oldYear ? 'history' : null), pdufaDate: null, pdufaTimeframe: null, pdufaTimeframeEnd: null,
      priority: /priority review/i.test(s), resubClass: /class 1\b/i.test(s) ? 1 : /class 2\b/i.test(s) ? 2 : null,
      supplemental: /\bs(NDA|BLA)\b|supplemental/i.test(s), evidence: s.slice(0, 400), where: 'body',
    });
  }
  return { primary: primary?.name || null, events: out };
}

// Name pairs written as "drug (other name)" — the article's own statement that two names are one agent.
// Short alias forms: "T-DXd", "sac-TMT", "lonvo-z", "MK-1026", "UX143". A plain capitalised word
// ("Inc", "Moderna") is not one: company names would chain unrelated drugs together.
const ABBR_LIKE = /^(?=.*[A-Z])[A-Za-z]{1,6}-[A-Za-z0-9]{1,6}(?:-[A-Za-z0-9]{1,6})?$|^[A-Z]{1,6}[- ]?\d{2,6}[A-Za-z]?(?:-[A-Za-z0-9]+)?$/;
const COMPANY = /\b(inc|ltd|llc|plc|corp|co|ag|sa|nv|gmbh|pharma|pharmaceuticals?|therapeutics|biotherapeutics|bio|biosciences|biotech|oncology|medical|health|holdings|group|labs?|moderna|pfizer|merck|novartis|roche|genentech|amgen|abbvie|gilead|lilly|sanofi|astrazeneca|bayer|takeda|regeneron|janssen|bms|gsk)\b/i;
const DISEASE_WORD = /cancer|carcinoma|lymphoma|leukemia|myeloma|tumor|disease|syndrome|response|survival|rate|trial|study|patients|events|therapy|inhibitor|antibody|conjugate|receptor|kinase/i;
export function synonymPairs(a) {
  const mentions = new Set((a.drugMentions || []).map(lc));
  const text = `${a.title}. ${a.summary || ''} ${bodyOf(a.text)}`;
  const innWord = new RegExp(`^${INN.source}$`, 'i');
  const strong = s => mentions.has(lc(s)) || innWord.test(s.split(/\s+/).at(-1));
  const pairs = [];
  for (const m of text.matchAll(/([A-Za-z0-9][\w-]*(?: [a-z][\w-]*){0,3}) \(([^()]{2,60})\)/g)) {
    const words = m[1].split(' ');
    let left = null;
    for (let i = 0; i < words.length && !left; i++) {
      const cand = words.slice(i).join(' ');
      if (mentions.has(lc(cand)) && !DISEASE_WORD.test(cand)) left = cand;
    }
    if (!left && innWord.test(words.at(-1))) {
      // "enfortumab vedotin", "trastuzumab deruxtecan": keep a preceding stem word too.
      left = words.length > 1 && innWord.test(words.at(-2)) ? words.slice(-2).join(' ') : words.at(-1);
    }
    if (!left) continue;
    for (const raw of m[2].split(/;|,| or | and |\bformerly\b|\balso known as\b/)) {
      const right = raw.replace(/^(also known as|formerly|previously|brand name)\s+/i, '').replace(/[®™]/g, '').trim();
      if (!right || right.length < 2 || DISEASE_WORD.test(right) || COMPANY.test(right) || /^(NCT|n ?=|\d)/i.test(right)) continue;
      // "nogapendekin alfa inbakicept (NAI)": an all-caps abbreviation of the name's own initials.
      const initials = left.replace(/-[a-z]{4}\b/g, '').split(/[\s-]+/).map(w => w[0]).join('').toUpperCase();
      const isInitials = /^[A-Z]{2,6}$/.test(right) && right === initials;
      if ((strong(right) || ABBR_LIKE.test(right) || isInitials) && normName(left) !== normName(right)) pairs.push([left, right]);
    }
  }
  // A mention written as "name (alias)" names the same agent twice.
  for (const m of a.drugMentions || []) {
    const x = m.match(/^(.+?)\s*\(([^()]+)\)$/);
    if (x) pairs.push([x[1], x[2]]);
  }
  return pairs;
}

export function extractAll() {
  const articles = Object.keys(BRANDS).flatMap(b => Object.values(loadArticles(b)));
  const events = [], pairs = [];
  for (const a of articles) {
    events.push(...extractArticle(a).events);
    pairs.push(...synonymPairs(a));
  }
  return { articles, events, pairs };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { articles, events, pairs } = extractAll();
  const byType = {};
  for (const e of events) byType[e.type] = (byType[e.type] || 0) + 1;
  console.log({ articles: articles.length, events: events.length, byType, synonymPairs: pairs.length });
}
