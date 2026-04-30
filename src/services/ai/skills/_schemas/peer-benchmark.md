# Schema — Peer Benchmark

When a task asks for a "peer benchmark" (the Talent / Workforce / Campus market-intel slot 2), emit:

```json
{
  "benchmark": {
    "metric": "string, 2-100 chars — what is being benchmarked (e.g. 'CSE placement rate', 'Senior SWE base salary')",
    "value": "string, 2-60 chars — the benchmark VALUE, with unit (e.g. '68%', '₹24-32 LPA p50', '85 of 100 score')",
    "context": "string, 5-200 chars — what tier/segment this benchmark applies to (e.g. 'NIRF tier-1 colleges, n=12', 'Peer Product employers in Bangalore')"
  },
  "comparison": {
    "userValue": "string (optional) — the stakeholder's own value if known",
    "delta": "string (optional) — '+5pp', '-3 LPA', 'within band' — vs the benchmark"
  },
  "sources": [
    { "source": "string", "retrievedAt": "YYYY-MM-DD", "url": "string (optional)" }
  ],
  "emptyState": "boolean",
  "emptyStateReason": "string (optional)"
}
```

Hard rules:
- The `value` is ALWAYS aggregated. NEVER a per-entity number ("Razorpay pays X" is forbidden; "Peer Product employers pay X-Y range" is OK).
- The `context` MUST name the peer set explicitly (tier, geography, archetype, sample size).
- `comparison.userValue` is optional — only include when the stakeholder's own value is known and matches the metric exactly.
- `comparison.delta` is presented honestly — if the stakeholder is below benchmark, say so. Don't soften.
- At least 1 source is required unless emptyState is true.
