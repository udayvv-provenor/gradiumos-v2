# Schema — Market Snapshot

When a task asks for a "market snapshot" (the Talent / Workforce / Campus market-intel slot 3), emit:

```json
{
  "headline": "string, 5-180 chars — single-line takeaway with a number + a citation",
  "facts": [
    {
      "claim": "string, 5-280 chars — one specific data point",
      "source": "string, 2-40 chars — naukri | linkedin | ambitionbox | glassdoor | nirfindia | etc.",
      "retrievedAt": "string, ISO date YYYY-MM-DD",
      "url": "string (optional) — the source URL if available"
    }
  ],
  "topEntities": [
    {
      "name": "string, 2-80 chars",
      "type": "employer | institution | role | location | other",
      "metric": "string, 2-40 chars — e.g. '12 listings', '78% placement', '₹24 LPA p50'"
    }
  ],
  "emptyState": "boolean — true if the underlying queries returned no usable data",
  "emptyStateReason": "string (optional) — only when emptyState=true"
}
```

Hard rules:
- `facts` array must have between 0 and 8 items. Each fact is ONE data point with its own citation.
- `topEntities` is for the named-entity ranking (top hirers, top sourcing institutions, top roles by volume) — between 0 and 6 items.
- When `emptyState` is true, `facts` and `topEntities` MUST be empty arrays. Do NOT pad with "no data available" placeholders inside the arrays.
- Every numeric claim in `headline` or `claim` MUST have its source named in the corresponding `source` field of a `facts` entry.
- NEVER include speculation or future-tense predictions in `claim`.
