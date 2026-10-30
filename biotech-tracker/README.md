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
3. **Headquarters**, strongest source first:
   - SEC EDGAR (`edgar.js`): exact-name match → city/state, public ticker,
     and Form D private-fundraising filings with amounts. Each D/A names the
     filing it amends, so a round is counted once at its latest amount sold.
     Cached in `state/edgar.json`; amounts refetch only when the filing list
     changes. SEC requires a contact email in the User-Agent for documents.
   - Trial contacts (`locate.js`): when a study's contact email is on the
     company's own domain, the phone's US area code → state (or country code
     → country). Also gives the company website. CRO/hospital contacts ignored.
   - GLEIF legal-entity registry, only for companies the first two can't place
     (`state/gleif.json`; ~1 request/s).
   - Legal form in the name (Ltd, GmbH, Co., Ltd.) → outside US.
   Misses are rechecked every 30 days. SEC search sometimes returns an error
   body with HTTP 200; that is retried, never cached as "not found".
4. **Render** (`render.js`); the run fails without publishing if a generated
   script doesn't parse.
   Output: → `reports/index.html` plus `reports/profiles.js`
   (company profiles, loaded on first click; `#c=<key>` links open one).

## Websites and leadership

**Website**, strongest source first: a manual fix (`overrides.json` → `website`),
the leadership check below, a trial contact email on the company's own domain,
then a guess (`website.js`). A guess tries the usual biotech domains built from
the name (`arunabio.com`, `ratiotx.com`, `santaana.bio`) and is kept only when
the domain is the company's own name (a redirect to "Fulcrum Genomics" is
rejected), the page title names the company, and the page reads like a drug
developer. A bare short domain (`prescient.com`) must also carry the full
company name somewhere on the page. Cached in `state/websites.json`; misses
are retried after 60 days. Profiles say which source each website came from.

**Leadership**, strongest source first:
1. The **leadership check**, a Claude routine (claude.ai/code/routines) that runs
   daily. It takes the first 50 companies in `state/leadership-queue.json`, reads
   each company's own website (team/leadership pages), and records the
   executive team with titles and founders in `state/leadership.json`, along
   with the pages it read. It commits only that file.
2. The company's latest **SEC Form D**, which names executive officers and
   directors but no titles (`edgar.js` → `enrichPeople`; refetched only when a
   newer Form D appears).

Every nightly run rewrites the queue: US-headquartered companies never checked,
or checked more than 180 days ago. New to the Clinic / New to Phase 2 come
first, then emerging companies by latest trial, then companies with a marketed
drug. Companies outside the US or with an unknown headquarters are not queued,
to keep the routine's usage down; they keep their Form D names, if any.

The **Founders & Leadership** tab has one row per person: leadership-check people,
plus Form D executive officers for companies not yet checked (Form D directors
are left out, since board seats are often investors).

## Definitions (`CONFIG` in analyze.js)

| View | Rule |
|---|---|
| New to the Clinic | First-ever phased drug trial posted ≤ 183 days ago, with a Phase 1 study (incl. 1/2) at US sites or sites not yet listed |
| New to Phase 2 | First Phase 2 or 2/3 (not 1/2) posted ≤ 183 days ago. "Graduated" = had earlier Phase 1; "Direct" = none on record |
| Phase 2 Starts | All industry Phase 2/2-3 posted ≤ 90 days, US or pending sites; default filter ≤ 25 trials |
| Emerging Companies | ≤ 25 trials, trial posted within 3 years or still running, US Phase 1, 2 or 3 |

Newly posted studies often list no sites for weeks, so "sites pending" studies
are included; the headquarters filter does the US screening.

## Current vs. dormant programs

Indication filters use **current** programs only: a study that is running
(recruiting, not yet recruiting, active) or that completed within
`currentYears` (2). A 2019 Phase 1 with nothing since is dormant: it still
shows in the profile (greyed, "Dormant since 2023") but doesn't tag the
company. On **New to Phase 2**, the indication filter matches the new Phase 2
study itself, not the company's whole history.

## When a company stops being "emerging"

The All Emerging Companies view hides companies with a **marketed drug**:
- an FDA approval in Drugs@FDA (`fda.js`). FDA sponsor names are abbreviated
  ("ARCUTIS", "VERTEX PHARMS"), so names match on their distinctive core. A
  one-word core is shared by unrelated firms (Hope, United, Antares), so it
  only counts when a branded (NDA/BLA) product's ingredient or brand also
  appears in the company's own trials. Or
- any Phase 4 (post-marketing) trial. This covers drugs sold only abroad and
  CBER products (cell/gene therapy, vaccines) that Drugs@FDA lacks.

Phase 4 alone misses most recent approvals (Revolution Medicines, Nuvalent,
Arcutis had none), which is why both are used. Fix misses or false matches
with `marketed` / `notMarketed` in `state/overrides.json`. A checkbox brings
these companies back into the view. The last good result is kept in
`state/marketed.json` in case the FDA download fails.

## Filters

- **Indication** (`indications.js`): second-level tags under each therapeutic
  area (e.g., Oncology › Lung cancer), regex-matched on trial conditions. A
  company appears under an area if any of its trials does. ~71% of recent
  drug trials get a tag; most of the rest are healthy-volunteer/PK studies.
- **Raised at least**: sum of Form D round sizes ("total offering amount").
  Form D is due within 15 days of a round's first sale, so "amount sold" is
  often just the first tranche (35% of rounds: size > 1.25x sold) and is rarely
  amended later. Round size matches press releases; profiles show both. Public companies' stock
  offerings are not in Form D, so their totals understate funding.
- **Search** covers names, every trial condition, lead drug codes and every
  trial's official title (`reports/search.js`, loaded on the first search).

## Manual corrections

`state/overrides.json`:
- `exclude`: display names to drop
- `hq`: `{"Company Name": {"us": true, "place": "Boston, MA"}}`
- `marketed` / `notMarketed`: display names to force in or out of "has a marketed drug"
- `website`: `{"Company Name": "example.com"}`

## Run locally

```
node run.js            # full run
node run.js --cached   # reuse data/all-industry.json
```

## Known limits

- No sponsor-address field on ClinicalTrials.gov; a dash for HQ means none of
  the sources above could place the company.
- A company whose first trial is registered only elsewhere (e.g., Australia's
  ANZCTR) can look newer than it is.
- Renamed companies without a "subsidiary of" note appear as separate companies.
