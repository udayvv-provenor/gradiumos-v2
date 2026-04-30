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
task: synthesise-institution-market
---

# Task — Synthesise market intel for a Campus Dean / Placement Officer

You will be given:
- The institution's name
- The institution's tier (NIRF rank if known) + state
- The career track being viewed (e.g. "SWE")
- A bundle of Serper search results from 4-5 separate queries:
  1. Their own NIRF / NAAC record (1-2 queries against nirfindia.org + naac.gov.in)
  2. Peer-tier placement benchmark (1 query against NIRF reports for the same tier)
  3. Top employers hiring from peer institutions for this track (1 query)
  4. Recent hiring trends news (1 query)

Produce TWO outputs depending on what the caller asks for:
- A `MarketSnapshot` for slot 1 (self-profile — their own NIRF / NAAC / placement)
- A `MarketSnapshot` for slot 3 (top hirers from peer-archetype institutions — counterparty employers)
- A `PeerBenchmark` for slot 2 (peer placement-rate benchmark)

## Slot 1 — Self-profile (MarketSnapshot)

`headline` example: `"SRM Institute — NIRF rank 41, NAAC A++, AISHE-reported CSE enrolment 4,200 across 4 years."`

`facts` array: 3-5 facts about THE INSTITUTION ITSELF, each with source + date.

`topEntities`: NOT used here (this slot is about the user's own profile, not entities they act on). Return `topEntities: []`.

## Slot 2 — Peer benchmark (PeerBenchmark)

`metric`: e.g. "CSE placement rate, NIRF tier-1 colleges"
`value`: e.g. "68% (band 58-78% across 14 institutions)"
`context`: e.g. "NIRF tier-1 colleges, n=14, 2024 placement reports"

`comparison.userValue` if the institution's own placement rate is in the search results.
`comparison.delta` honest — if institution is below benchmark, say so plainly.

## Slot 3 — Top hirers from peers (MarketSnapshot)

`headline` example: `"Top 5 hirers from NIRF tier-1 CSE peers: Razorpay (47 hires), Freshworks (38), Swiggy (31), Zomato (28), Uber (24) — placement reports 2024."`

`topEntities`: employers, type=`employer`, metric=`N hires`. These are NAMED because the Dean uses them as counterparties (potential MoU partners).

## Forbidden

NEVER list competing institutions as entities the Dean can browse ("VIT placed X, BITS placed Y"). The Dean cares about peers as a BENCHMARK band, not as a profile directory. Per Uday's framing: "AS A COMPETITOR but not as a profile to see."

## Empty state

If NIRF/NAAC searches return nothing for the institution name → `emptyState: true` with reason "Institution name not found in NIRF / NAAC public records — verify the official registered name." Don't fabricate a rank.
