# Emerging Biotech Tracker

Tracks US biotech companies **entering the clinic** (first Phase 1) and
**advancing to Phase 2**, for MJH business development and editorial.

Lives in the fda-pipeline repo. Nightly action `.github/workflows/update-biotech-tracker.yml`
(7 AM UTC) → `reports/index.html`, published at
https://silvaneus.github.io/fda-pipeline/biotech-tracker/

## How it works

1. **Pull** (`ctgov.js`): every industry-sponsored interventional study on
   ClinicalTrials.gov (~114k, ~75 s via API v2). The full history is pulled each
   night instead of following the RSS feed: "first trial ever" needs a sponsor's
   whole history, and a full pull also picks up edits to older records.
2. **Group** (`sponsors.js`, `analyze.js`): studies → companies by normalized
   sponsor name ("Acme Bio, Inc." = "Acme Bio"); a "subsidiary of X" sponsor is
   folded into X. Only studies with a phase and a drug/biologic/genetic
   intervention count (device studies are excluded).
3. **Headquarters** (`edgar.js`): SEC EDGAR exact-name match → city/state,
   public ticker, latest Form D (private fundraising). Cached in
   `state/edgar.json`; misses are rechecked every 30 days.
4. **Render** (`render.js`) → `reports/index.html`.

## Definitions (`CONFIG` in analyze.js)

| View | Rule |
|---|---|
| New to the Clinic | First-ever phased drug trial posted ≤ 183 days ago, with a Phase 1 study (incl. 1/2) at US sites or sites not yet listed |
| New to Phase 2 | First Phase 2 or 2/3 (not 1/2) posted ≤ 183 days ago. "Graduated" = had earlier Phase 1; "Direct" = none on record |
| Phase 2 Starts | All industry Phase 2/2-3 posted ≤ 90 days, US or pending sites; default filter ≤ 25 trials |
| Emerging Companies | ≤ 25 trials, trial posted within 5 years, US Phase 1 or 2 |

Newly posted studies often list no sites for weeks, so "sites pending" studies
are included; the headquarters filter does the US screening.

## Manual corrections

`state/overrides.json`:
- `exclude`: display names to drop
- `hq`: `{"Company Name": {"us": true, "place": "Boston, MA"}}`

## Run locally

```
node run.js            # full run
node run.js --cached   # reuse data/all-industry.json
```

## Known limits

- No sponsor-address field on ClinicalTrials.gov; "Not verified" HQ = no SEC
  filing under that exact name (common for foreign and very early companies).
- A company whose first trial is registered only elsewhere (e.g., Australia's
  ANZCTR) can look newer than it is.
- Renamed companies without a "subsidiary of" note appear as separate companies.
