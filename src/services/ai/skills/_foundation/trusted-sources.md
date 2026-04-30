# Trusted Sources Registry

Curated registry of named sources GradiumOS queries via Serper. Each query type lists its trusted sources. Queries always include the source NAME in the search string (NOT a `site:` operator) — Google's algorithm has been observed to weight a source-name keyword heavily without restricting the result set, giving us deterministic top-1 organic results.

## Query rules

1. **One source per query.** Never combine sources — `"AI jobs Bangalore naukri linkedin"` returns inconsistent results because Google has to decide which to surface. Run TWO queries: `"AI jobs Bangalore naukri"` and `"AI jobs Bangalore linkedin"`.

2. **Take the first non-sponsored organic result.** Sponsored results are tagged in Serper's response. Skip them — the first organic result is the most-cited / most-trusted page on Google's index for that query.

3. **Never use `site:` operators except for government / official institution domains.** `site:nirfindia.org` is OK because NIRF is the canonical source. `site:linkedin.com` is too restrictive — we want LinkedIn's name in the query but not a hard restriction.

4. **Quote multi-word entity names.** `"SRM Institute"` not `SRM Institute` — Google treats unquoted as keyword soup.

## Trusted sources by query type

### Open roles (current job listings)
- `naukri` — India default, broad coverage, recent listings
- `linkedin` — global brand recognition, employer profiles attached
- (Optional, future) `instahyre`, `hirist.tech` — startup-heavy, India

### Salary benchmarks
- `ambitionbox` — India default, deepest India coverage by company + role
- `glassdoor` — global, more US-skewed but useful for cross-reference
- `levels.fyi` — top-tier tech only (FAANG, unicorns), very specific

### Open college placement records
- Institution's own `.edu` (or `.ac.in`) site — placement reports live here
- `nirfindia.org` — NIRF publishes per-institution placement rates annually

### NIRF / NAAC / AISHE rankings (official India higher-ed data)
- `nirfindia.org` — National Institutional Ranking Framework (use `site:nirfindia.org`)
- `naac.gov.in` — National Assessment & Accreditation Council
- `aishe.gov.in` — All India Survey on Higher Education

### Hiring news & trends
- `economictimes` (economictimes.indiatimes.com) — India business news, hiring coverage
- `livemint` — India business / tech news
- `inc42` — India startup ecosystem news

### Domain-specific trends (when learner / employer specialises)
- `inc42` — startup + funding signals (good proxy for domain heat)
- `economictimes` — hiring trends by sector
- (Future) `gartner` — enterprise B2B trends; `crunchbase` — funding signals

## Negative list — sources to NEVER include in queries

- `quora`, `reddit`, `medium` — opinion-heavy, not authoritative
- `wikipedia` — fine for entity disambiguation only, not for live data
- Press-release wires (`prnewswire`, `businesswire`) — vendor-controlled content, low signal
- `wikipedia.org` for placement/salary data — usually outdated

## Per-source parsing notes

When the AI synthesises the search result, it extracts:

| Source | What to extract from snippet | Caveat |
|---|---|---|
| naukri | role count, location, top company names from the snippet | Snippet sometimes shows "X jobs" — pull that number |
| linkedin | employer name, role title, posted date | LinkedIn snippets often show "Connections / X applicants" — useful trust signal |
| ambitionbox | salary range (min-max) per role+location | Snippet shows "₹X.X Lakhs - ₹X.X Lakhs" pattern — parse |
| glassdoor | salary average, base / total | Snippet shows "$X" and "₹X" — pick the right currency for India context |
| levels.fyi | total comp band, level label | Sparse for India — only useful for top-tier roles |
| nirfindia.org | rank, score, year, category | Always cite the year — NIRF publishes annually |
| naac.gov.in | grade letter (A++, A+, A, B, etc.), validity period | Cite validity end date |
| economictimes / livemint / inc42 | headline + 1-line summary + publication date | Skip if older than 90 days for "trends" queries |
