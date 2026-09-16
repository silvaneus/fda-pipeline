# FDA Pipeline

Nightly tracker for upcoming FDA decisions (PDUFA dates) and the clinical trials
behind them. A GitHub Action runs `run-pipeline.js` every morning and commits a
refreshed `reports/fda-pipeline-report.html`.

## Running it

```
node run-pipeline.js           # use cached data where available
node run-pipeline.js --force   # refresh everything
```

## How a catalyst moves through the pipeline

```
  RTTNews FDA calendar ──┐
  curated list           ├──> catalysts ──> enrich ──> resolve ──> report
  SEC 8-K filings      ──┘                    │           │
                                              │           └─ approved / CRL / still pending
                                              └─ source URL, indication, success rate
```

### Discovery — what is coming up

`scrape-rttnews.js` is the primary calendar. It is a single scraped source, so
it records its own entry count in `state/rttnews-health.json` and **refuses to
overwrite good data with a run that returns under 60% of the previous count** —
a layout change or a throttled page would otherwise shrink the calendar silently.
A drop prints a warning and keeps the last known-good file.

`checkAwaitingPDUFA` fills in dates for entries marked "Awaiting PDUFA" by
searching EDGAR for the company's own 8-K.

### Resolution — what actually happened

`resolve-outcomes.js` answers "was this approved, rejected, or is it still
pending?" by sweeping what FDA *did* and matching backwards, rather than
searching FDA for a drug's name.

That direction matters. A drug tracked under a generic name or development code
(`DTX401`, `177Lu-edotreotide`) is announced under a brand name that does not
exist until the day it is approved, so a name search cannot find it. The join
key is **sponsor + date + molecule**, none of which require knowing the brand.

Four independent sources:

| Source | Covers | Lag |
|---|---|---|
| openFDA `drugsfda` | NDA/BLA approvals, CDER | 1–3 weeks |
| openFDA `transparency/crl` | Complete Response Letters | batched, ~monthly |
| FDA CBER licensed products | cell and gene therapies, absent from drugsfda | same day |
| MJH brand RSS (16 feeds) | everything, plus a readable URL | same day |

A brand name recovered from openFDA is fed back into the news search — that is
how `Bictegravir Plus Lenacapavir` finds a headline that only ever says
"Bixlenvo".

### Confidence governs what the pipeline may do

| Certainty | Meaning | Action |
|---|---|---|
| `resolved` | two sources agree, or one names the exact product | removed from the list, logged |
| `likely` | one good source | status set, kept visible, flagged |
| `review` | suggestive but unproven | nothing changes, flagged for a human |

Nothing is ever removed on a single weak signal. Every removal is written to
`state/outcomes.json` with its evidence and shown in the report's **Recently
decided** panel, so an entry disappearing is auditable rather than silent.

Future-dated entries are checked too — not to resolve them, but to flag the case
where FDA has evidently already acted before the listed PDUFA date, which means
the date is wrong or the entry is stale.

## Source URLs

Priority order: MJH article → the company's 8-K exhibit → search link.

EDGAR full-text search accepts a single quoted phrase or two quoted phrases, but
**not** a parenthesised boolean. The original query used
`"drug" ("PDUFA" OR "FDA accepts")`, which returns zero hits with a 200 status —
so every catalyst silently fell through to a Google link. Filings are also
preferred from the company that owns the application, since a bare drug name
matches partners and competitors discussing it.

A search fallback renders dimmed with a magnifier icon, so it never reads as a
cited source.

## `state/` is tracked on purpose

It is committed by the nightly workflow, because these only work if they survive
between runs:

- `mjh-news.json` — each feed holds ~30 items (2–3 days); the 45-day window
  exists only by accumulating
- `cber-products.json` — the CBER list is cumulative, so a *new* row is the
  approval signal; that needs yesterday's snapshot
- `outcomes.json` — the audit trail
- `rttnews-health.json` — the scrape-size baseline

`data/` stays gitignored; it is recomputable cache.

## Known limits

- openFDA lags one to three weeks, so a very recent approval may be caught only
  by news. If neither has it yet, the entry stays Pending — correctly.
- CRL records carry no drug name, only an application number and company, so the
  match is company + date window.
- The CRL dataset refreshes in batches, not daily.
- Gene therapies have no approval date on the CBER page; a first-ever run has no
  snapshot to diff against and will under-report new listings until the next run.
