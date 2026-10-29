// Regression check: the combined list against the 77 hand-verified MJH-only rows (state/verify-*.json).
// Bad rows (duplicates, already decided, not filings, wrong drug) should be gone; confirmed rows should remain.
import fs from 'node:fs';
const rows = JSON.parse(fs.readFileSync('state/verify-mjh-only.json', 'utf8'));
const res = JSON.parse(fs.readFileSync('state/verify-results.json', 'utf8'));
const m = JSON.parse(fs.readFileSync('state/merged.json', 'utf8'));
const live = m.rows.filter(r => r.confidence !== 'low' && (r.status === 'Pending' || r.status === 'Overdue') && r.pdufaDate >= m.today);
const has = name => live.some(r => r.drug.toLowerCase() === name.toLowerCase());
const out = { badStill: [], goodLost: [], uncertainStill: [] };
for (const r of rows) {
  const v = res[r.id]?.verdict;
  if (v === 'confirmed' && !has(r.drug)) out.goodLost.push(r.drug);
  else if (['duplicate', 'already_decided', 'not_a_filing', 'wrong_drug'].includes(v) && has(r.drug)) out.badStill.push(`${r.drug} (${v})`);
  else if (v === 'uncertain' && has(r.drug)) out.uncertainStill.push(r.drug);
}
const bad = rows.filter(r => ['duplicate', 'already_decided', 'not_a_filing', 'wrong_drug'].includes(res[r.id]?.verdict)).length;
const good = rows.filter(r => res[r.id]?.verdict === 'confirmed').length;
console.log(`bad rows removed: ${bad - out.badStill.length}/${bad} | confirmed rows kept: ${good - out.goodLost.length}/${good}`);
console.log(out);

// Cases the user or a web check found by hand. Each must NOT appear as an open filing on the main list.
const KNOWN_NOT_OPEN = {
  'Orca-T': 'approved Jun 30, 2026 (Tregzi)',
  'MIL-62': 'the NDA in that headline was tavapadon',
  'aminolevulinic acid hydrochloride': 'Ameluz PDT for sBCC approved Sep 14, 2026',
  'ruxolitinib': 'Jakafi XR approved May 2026; the Aug 30 date was ropeginterferon',
  'sotagliflozin': '"submits additional data" is not a filing',
  'XPro1595': 'trial results submitted for publication, not a BLA',
  'Evolysse Sculpt': 'dermal filler (device)',
  'remibrutinib': 'approved Oct 7, 2026',
  'olanzapine extended-release injectable suspension': 'TEV-749 approved Oct 9, 2026',
  'ifezuntirgene inilparvovec': 'AMT-130: pathway alignment and a reversal, no filing',
  talazoparib: 'with enzalutamide, approved Oct 26, 2026',
  camrelizumab: 'same filing as rivoceranib plus camrelizumab, resubmitted Oct 2026',
};
const openNow = n => live.some(r => r.drug.toLowerCase() === n.toLowerCase());
const failing = Object.entries(KNOWN_NOT_OPEN).filter(([n]) => openNow(n));
console.log(`known cases: ${Object.keys(KNOWN_NOT_OPEN).length - failing.length}/${Object.keys(KNOWN_NOT_OPEN).length} correct`, failing.map(([n, why]) => `${n} (${why})`));

// Filings that must be on the main list, upcoming.
const KNOWN_OPEN = { deramiocel: '2026-11-22 (extended from Aug 22)', cemdisiran: 'November 2026 (priority voucher)', dibutepinephrine: '2027-03-16 (Anaphylm)', 'sac-TMT': '2027-06-15' };
const missingOpen = Object.entries(KNOWN_OPEN).filter(([n]) => !openNow(n));
console.log(`known open filings: ${Object.keys(KNOWN_OPEN).length - missingOpen.length}/${Object.keys(KNOWN_OPEN).length} present`, missingOpen.map(([n, d]) => `${n} ${d}`));

// Drugs with two filings open at once must keep both, each on its own date.
const KNOWN_DATES = [['giredestrant', '2026-11-30'], ['giredestrant', '2026-12-18'], ['bezuclastinib', '2026-11-30'], ['bezuclastinib', '2026-12-30'],
  ['zanzalintinib', '2027-03-03'], ['roflumilast cream', '2027-02-23'], ['tabelecleucel', '2027-03-31']];
const wrongDate = KNOWN_DATES.filter(([n, d]) => !live.some(r => r.drug.toLowerCase() === n && r.pdufaDate === d));
const dupes = ['deramiocel', 'tabelecleucel', 'rivoceranib'].filter(n => live.filter(r => r.drug.toLowerCase() === n).length > 1);
console.log(`known dates: ${KNOWN_DATES.length - wrongDate.length}/${KNOWN_DATES.length} right`, wrongDate.map(x => x.join(' ')), dupes.length ? 'duplicated: ' + dupes.join(', ') : '');
