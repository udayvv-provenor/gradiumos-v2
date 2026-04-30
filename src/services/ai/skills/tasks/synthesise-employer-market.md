---
compose:
  - _foundation/ip-protection.md
  - _foundation/output-discipline.md
  - _foundation/public-data-discipline.md
  - _foundation/trusted-sources.md
  - _voices/researcher.md
  - _schemas/market-snapshot.md
  - _schemas/peer-benchmark.md
version: 1.0.0
task: synthesise-employer-market
---

# Task — Synthesise market intel for a Workforce TA / employer

You will be given:
- The employer's archetype (Product / Service / MassRecruiter)
- The career track they are hiring for (e.g. "SWE")
- A role title + seniority (when defining a specific role)
- A bundle of Serper search results from 4-6 separate queries:
  1. Competitor roles at this seniority — naukri (1 query) + linkedin (1 query)
  2. Salary benchmark — ambitionbox (1 query) + glassdoor (1 query)
  3. Top sourcing institutions for this track (NIRF top-tier colleges placing into this archetype)
  4. Recent hiring news for this archetype / track

Produce TWO outputs depending on what the caller asks for (one call per slot):
- A `MarketSnapshot` for slot 3 (actionable counterparty data — top sourcing institutions)
- A `PeerBenchmark` for slot 2 (anonymised peer benchmark — what peer employers ask for)

## MarketSnapshot composition (slot 3 — sourcing pools)

`headline` example: `"Top sourcing institutions for SWE in your archetype: VIT (412 placed), SRM (289), BITS (231) — NIRF tier-1 average 78% software-track placement."`

`topEntities`: institutions, type=`institution`, metric=`N placed` (or `N% software placement` when count not available).

## PeerBenchmark composition (slot 2 — peer ask vs your ask)

`metric`: e.g. "Peer Senior Backend cluster targets"
`value`: e.g. "C1 73 p50, C3 78 p50, salary 22-30 LPA"
`context`: e.g. "Peer Product employers in Bangalore + Hyderabad, n=18 listings sampled"

If the employer has uploaded their own role with cluster targets, include `comparison`:
- `userValue`: their own asks
- `delta`: e.g. "your C1 ask 78 vs peer 73 — +5pp above peer median"

## Forbidden

NEVER name a competitor in slot 2 ("Razorpay pays X"). Always aggregate ("Peer Product employers"). Slot 3 named-institution lists ARE allowed because the TA is making sourcing decisions and needs the names.

## Empty state

If competitor / salary / institution searches all fail → `emptyState: true` with reason naming which queries returned nothing.
