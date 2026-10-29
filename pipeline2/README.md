# FDA Pipeline 2.0

Lives inside the FDA-Pipeline repo and feeds its FDA Catalysts tab through `src/catalysts.js`.

A new-drug pipeline tracker built entirely from MJH's own coverage. It reads articles straight from Sanity, finds every US regulatory event (submission, acceptance, priority review, PDUFA date, extension, approval, CRL), groups them into FDA applications, and gives each application a decision date.

```
node run.js            # sync new articles, rebuild, measure coverage, write the report
node run.js --no-sync  # rebuild from cached articles only
```

Output: `reports/pipeline-2.0.html`. It needs Node 18+, has no npm dependencies, and requires no API keys.

## Combined list (MJH + RTTNews)

The upcoming list merges this pipeline with the RTTNews FDA calendar (`src/rttnews.js` reuses the repo's `scrape-rttnews.js` parser; `src/merge.js` does the merge). The curated list is not used: it was the source of every invented entry in the audit.

- RTTNews generics (ANDA) are dropped.
- An RTTNews entry is removed when MJH reported its decision, provided the decision matches the listing's indication.
- Dates, in order of priority:
  1. An MJH-reported date, which picks up extensions RTTNews misses.
  2. An RTTNews exact date, which beats an MJH estimate. It also replaces an MJH date that has already passed with no decision on record.
- Entries MJH never covered are kept and labelled "RTTNews only".

## Sources

The Sanity datasets are publicly readable through Sanity's API CDN (project `0vv8moc6`), so no connector or token is needed. The brands are configured in `BRANDS` in `src/sanity.js`:

| Dataset | Why it's included |
|---|---|
| onclive, targetedonc, cancernetwork | Oncology. Targeted Oncology and CancerNetwork catch filings OncLive skipped (e.g. anito-cel) |
| hcplive | Everything outside oncology |
| neurolive, ophtalmology, dermatologytimes, contagion | Specialty filings HCPLive doesn't cover |
| ajmc, pharmacytimes | Their "PDUFA dates to watch" previews list many decisions at once |

The first run backfills from 2024-01-01. Later runs re-read the last 7 days, which picks up edits.

## Decision dates

1. **Announced:** any reported PDUFA/target action date, including extensions. Used every time one exists.
2. **Resubmission after a CRL:** resubmission + 2 months (Class 1) or + 6 months (Class 2 or not stated).
3. **Acceptance:** for a new application, acceptance + 10 months (standard) or + 6 months (priority). For a supplement (sNDA/sBLA), 2 months less.
4. **Submission:** for a new application, submission + 60 days + 10 or 6 months. For a supplement, submission + 10 or 6 months.
5. **Company guidance** (e.g. "first quarter of 2027"): the end of that window. This overrides 3 and 4. The report shows the window itself ("Q4 2026", "Nov 2026"), not its last day.

FDA starts a supplement's review clock at submission rather than after the 60-day filing period. Checked against dates MJH later reported, this change cut the median error on supplements from 63 to 5 days (priority) and from 75 to 16 days (standard).

The constants are in `RULES` in `src/build.js`.

Outcomes come from MJH approval and CRL stories. FDA approval records (openFDA) act as a backstop for decisions MJH didn't report. FDA data is never used to *add* an application.

## One drug, several filings

A drug can be under review for more than one indication at once (giredestrant adjuvant Nov 30 and with everolimus Dec 18; bezuclastinib in GIST, nonadvanced SM and advanced SM). Stories are kept apart as separate filings when:
- they give different PDUFA dates (unless one is an extension), or
- one is early-stage disease (adjuvant, perioperative) and the other advanced or metastatic.

After a CRL, the resubmission's new date stays on the same application. A story recalling an old CRL in passing is not read as a new one.

## Confidence

An application is **high confidence** if it has an announced date, a headline about the filing, or more than one article. Everything else goes under "Signals to verify" in the report: filings mentioned once, in passing, inside an unrelated story. Coverage measured on high-confidence rows alone is the same as on all rows (see `state/coverage.json`).

## Files

- `src/sanity.js`: fetch and cache candidate articles (`state/articles/<brand>.json`)
- `src/extract.js`: rule-based event extraction. Every event keeps its source sentence.
- `src/build.js`: drug name merging, grouping into applications, dates, statuses → `state/pipeline.json`
- `src/coverage.js`: benchmarks (see below) → `state/coverage.json`
- `src/report.js`: the HTML page
- `src/rttnews.js`, `src/merge.js`: the RTTNews calendar and the combined list → `state/merged.json`
- `src/audit-v1.js`: audit of the current tracker → `reports/tracker-audit.html`

## Coverage benchmarks

`node src/coverage.js [from] [to]` measures two things:

- **Against the current tracker:** every catalyst this repo's report has ever listed, rebuilt from weekly snapshots of its nightly report commits.
- **Against FDA:** NDA/BLA approvals in the window (novel, plus efficacy supplements), checking whether an MJH story about the filing ran *before* the decision.

## Auditing the current tracker

`node src/audit-v1.js` replays every daily snapshot of this repo's report against MJH coverage and writes `reports/tracker-audit.html`. It reports:
- how long entries stayed listed after MJH reported a CRL or approval;
- entries that were added after the decision had already been reported;
- today's list, entry by entry, against MJH;
- past entries with no outcome on record anywhere.

Only decisions reported in a headline that names the drug are counted.

## Known limits

- Extraction is rule-based, so edge phrasings get missed. Each miss in the coverage report has been checked, and the remaining misses are mostly drugs MJH never wrote a filing story about.
- Name matching relies on the articles' own "generic (brand)" pairs and the AI `drugMentions` field. A drug that is only ever mentioned under two unconnected names will appear twice.
- openFDA has no CBER products (gene/cell therapies, vaccines), so those depend on MJH approval stories to close.
