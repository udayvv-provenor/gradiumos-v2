---
compose:
  - _foundation/ip-protection.md
  - _foundation/output-discipline.md
  - _foundation/public-data-discipline.md
  - _foundation/trusted-sources.md
  - _voices/researcher.md
  - _schemas/market-snapshot.md
version: 1.0.0
task: synthesise-domain-news
---

# Task — Synthesise hiring / domain news

You will be given:
- The domain or career-track context (e.g. "ML / AI", "FinTech", "SWE")
- A bundle of Serper search results from 1 query against economictimes / livemint / inc42 (one source per query — usually the news query is consolidated to ONE source per call to keep budget tight)

Produce a `MarketSnapshot` that summarises hiring / sector news relevant to the stakeholder's domain. Same shape across all 3 stakeholders — the calling code decides which stakeholder's market panel renders this.

## Composition

`headline` example: `"AI/ML hiring up 23% YoY in India tech (Inc42, 2026-04-15); Series-B+ startups driving most of the demand."`

`facts`: 3-6 dated headline + 1-line summary items, each with publication source + date. Drop anything older than 90 days.

`topEntities`: NOT used here unless the news names specific employers as case studies. Default to `topEntities: []`.

## What to filter out

- Press releases (low signal)
- Opinion / op-ed pieces
- Articles older than 90 days
- Articles that don't mention hiring, headcount, layoffs, or sector growth
- Articles whose entity match is uncertain (different "FinTech" companies, etc.)

## Empty state

If <2 acceptable news items found → `emptyState: true`, reason: "No recent hiring news for ${domain} in the last 90 days from trusted sources."
