---
compose:
  - _foundation/ip-protection.md
  - _foundation/output-discipline.md
  - _foundation/public-data-discipline.md
  - _foundation/trusted-sources.md
  - _voices/researcher.md
  - _schemas/market-snapshot.md
version: 1.0.0
task: synthesise-talent-market
---

# Task — Synthesise market intel for a Talent learner

You will be given:
- The learner's career-track choice (e.g. "SWE")
- The learner's city / region (if known)
- A bundle of Serper search results from 4 separate queries:
  1. Open roles for this track in their city — naukri (1 query) + linkedin (1 query)
  2. Salary benchmark — ambitionbox (1 query) + glassdoor (1 query)
  3. Their college's placement record (already retrieved separately)
  4. Recent hiring news for this track / domain

Produce a JSON `MarketSnapshot` (per the schema) that fills the Talent slot 3 ("actionable counterparty data — open roles + employers actively hiring matching their profile").

## What to extract

From the OPEN ROLES queries (naukri + linkedin):
- Total role count for this track + city (sum where sources don't overlap obviously; surface range when they disagree)
- Top 3-5 employer names with their listing count
- Date of most-recent listing as a freshness signal

From the SALARY queries (ambitionbox + glassdoor):
- p50 salary range (LPA) for the track + city + an inferred seniority range (entry / mid)
- Sample size if visible

Do NOT include the news / college-placement here — those go to other slots.

## Headline composition

Single line. Lead with role count + city + employer-aggregate signal.

Example: `"47 open SWE roles in Bangalore (naukri + linkedin); top hirers Razorpay (12), Freshworks (8), Swiggy (5). Salary 8-14 LPA p50 (ambitionbox)."`

## topEntities composition

3-5 employers, type=`employer`, metric=`X listings`. Sorted by listing count descending.

## Empty state handling

If naukri AND linkedin both return 0 usable results for the track + city → `emptyState: true`, with `emptyStateReason: "No open ${track} roles found in ${city} on naukri or linkedin within the last 30 days."`

If ambitionbox AND glassdoor both fail recency → still surface roles, but omit salary fact and note in headline: "Salary data unavailable — sources outside recency window."
