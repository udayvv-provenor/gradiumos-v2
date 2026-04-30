# Public Data Discipline

Public-data results from Serper feed our market-intel surfaces. The discipline here protects users + protects GradiumOS from surfacing wrong / stale / hallucinated data.

## Recency rules (per query type)

| Query type | Max acceptable age | What to do if older |
|---|---|---|
| Open job listings | 30 days | Drop the result; show "no recent listings" |
| Salary data | 365 days | Use it but flag year |
| Hiring news | 90 days | Drop |
| NIRF / NAAC rankings | 365 days | Use it (rankings update annually) |
| Institution placement records | 365 days | Use it (reports are annual) |

## Trust-no-snippet rule

Search snippets can be:
- Truncated mid-sentence
- AI-summarised (lossy)
- Outdated cache
- Wrong entity (search ambiguity)

The AI MUST verify entity match before extracting numbers. If snippet says "AB Engineering College — placement 92%" but the user's institution is "AB Engineering Institute", DO NOT use the number — flag uncertainty instead.

## Empty-result honesty

When Serper returns 0 results OR all results fail recency check:
- DO NOT fabricate plausible-sounding data
- DO NOT scale up older data and present as current
- Surface the empty state as a fact: "No recent listings found for this query"
- Offer the user a way to refresh / change query parameters

## Cross-stakeholder data leak prevention

A learner's market-intel call must NEVER include any other learner's data, even anonymised. Stakeholder isolation is enforced at the cache key — `(stakeholderId, queryType)` — but the AI must also refuse if asked to compare individuals.

## Source attribution discipline

Every emitted fact must cite its source. Format:
- `(naukri, 2026-04-25)` — source name + date the data was retrieved (or published if dated)
- Multiple-source facts: `(naukri + linkedin, 2026-04-25)`

The UI uses citations to let users click through to the original source. NEVER omit citations even for "obvious" facts.

## What you may NEVER emit

- Per-employer salary specifics (employer X pays Y to person Z) — even if the search returns it
- PII from any search result (named individuals, contact info)
- Speculation framed as fact ("the market WILL grow 30% next year")
- Comparisons that imply ranking between specific competitors ("Razorpay > Freshworks")

## What you MAY emit

- Aggregate / range / band statistics ("salary 18-26 LPA, n=12 listings sampled")
- Top-N lists where the entity is publicly the actor (e.g., "top hirers" by published placement reports)
- Trend direction claims when ≥2 sources agree ("hiring volume up vs. last quarter per ET + Inc42")
- Citations + dates for every numeric claim
