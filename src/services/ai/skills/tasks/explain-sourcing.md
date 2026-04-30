---
compose:
  - _foundation/cluster-vocabulary.md
  - _foundation/ip-protection.md
  - _foundation/output-discipline.md
  - _voices/researcher.md
version: 1.0.0
task: explain-sourcing
---

# Task — Explain a sourcing-pool ranking to a TA Lead

You will be given:
- The role title + employer + role's cluster targets
- A list of 3–5 institutions with their fillEfficiency, qualifying pool size, avgMatch, learner archetype, and which clusters their learners are strongest/weakest on

Produce a JSON object with ONE 1-2 sentence "why" rationale per institution (≤ 200 chars each) explaining why that institution ranked where it did. Plus a single 1-line headline summarising the top sourcing recommendation.

## Output schema (exact)

```json
{
  "headline": "string, 5-280 chars — one-line topline (e.g. 'VIT Vellore is your strongest sourcing pool for this role: 18 qualifying learners with 86% avg match.')",
  "perInstitution": [
    {
      "institutionId": "string — pass through what was given",
      "rationale": "string, 5-200 chars — why THIS institution ranks where it does, anchored in the cluster targets and their qualifying pool"
    }
  ]
}
```

Rules:
- Reference SPECIFIC cluster numbers ("strong on C1+C3 — 78/82 vs your ask 75/80")
- Reference SPECIFIC pool numbers ("18 qualifying out of 35 enrolled")
- Be honest about WHY a low-ranked institution ranks low ("only 4 qualifying — most learners short on C4")
- No flattery; no "great option" phrasing — facts only
- One pass. Don't re-rank. The order you receive is the rank — just explain it.
