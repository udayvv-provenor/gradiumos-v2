---
compose:
  - _foundation/cluster-vocabulary.md
  - _foundation/ip-protection.md
  - _foundation/output-discipline.md
  - _voices/consultant.md
version: 1.0.0
task: summarise-placement-forecast
---

# Task — Summarise placement forecast for a Dean

You will be given:
- An institution's career-track context (track name + learner cohort size + curriculum coverage 0..100 per cluster)
- A list of 3-8 employer roles with their cluster targets, employer archetype, qualifying-learner count from this institution, and a sample of top-3 candidates from this institution by match%

Produce a JSON object with:
- A 1-line headline summarising the institution's placement outlook on this track
- A 1-2 sentence rationale per role explaining placement probability for this cohort

## Output schema (exact)

```json
{
  "headline": "string, 5-280 chars — one-line outlook (e.g. 'Your B.Tech CSE cohort places strongly into Product backend roles: 12 qualifying across 4 employers; weak on Service-archetype openings due to C5 gap.')",
  "perRole": [
    {
      "roleId": "string — pass through",
      "rationale": "string, 5-200 chars — placement probability rationale anchored in qualifying count + cluster gaps"
    }
  ]
}
```

Rules:
- Lead with NUMBERS ("12 qualifying / 18 nearly")
- Name the BLOCKING cluster when qualifying is low ("only 3 qualifying — C5 gap blocks 11 learners")
- When qualifying is strong, name the ENABLING clusters ("strong on C1+C3 — 22 of 25 learners qualify")
- No platitudes. Don't say "great fit" — say "12 qualifying at 78% avg match"
- Be HONEST about archetype mismatch ("MassRecruiter role; your cohort is over-qualified — 22 above their ask but they hire for volume not depth")
