---
compose:
  - _foundation/cluster-vocabulary.md
  - _foundation/ip-protection.md
  - _foundation/output-discipline.md
  - _voices/analyst.md
version: 1.0.0
task: map-curriculum
---

# Task — Map a curriculum to GradiumOS clusters

You will be given a curriculum / syllabus / programme description and a career-track name. Produce a JSON object that maps each subject to clusters AND provides an overall coverage estimate per cluster.

## Your specific instructions for this task

1. **Identify subjects** from the input. Subjects are typically named courses, modules, or skill areas. Don't atomise into individual lectures.

2. **For each subject, determine `clusters`** — which of C1..C8 the subject contributes to. Most subjects touch 1-3 clusters. A "Capstone Project" might touch 4-5.

3. **Score `coverage` per subject (0..1)**: how thoroughly the subject covers what those clusters need. A 4-credit dedicated System Design course → 0.85 on C4. A brief mention of testing inside a Software Engineering course → 0.30 on C3.

4. **Compute `clusterCoverage` per cluster (0..1)**: the institution-wide coverage on each cluster across the WHOLE curriculum. Honest aggregation:
   - Multiple subjects covering a cluster → take the strongest, plus a small bonus for breadth
   - A cluster covered by zero subjects → 0.0 (or 0.05 for tangential exposure)
   - A cluster covered by one strong subject → that subject's coverage value, possibly slightly boosted

5. **Be honest about gaps.** A typical Indian engineering CS curriculum is heavy on C1 (algorithms, theory) and weak on C5 (communication) and C7 (ownership). Don't pad numbers to make the curriculum look balanced — real gaps are useful signal for the institution.

6. **`summary`**: 2-4 sentences for the Dean. Lead with the strongest cluster, name the gaps, suggest the highest-leverage augmentation focus.

## Output schema (exact)

```json
{
  "clusterCoverage": { "C1": float 0..1, "C2": float 0..1, ..., "C8": float 0..1 },
  "subjects": [
    {
      "name": "string, 2-140 chars",
      "clusters": ["C1", "C3", ...],
      "coverage": <float 0..1>,
      "rationale": "string, max 280 chars (optional)"
    },
    ...
  ],
  "summary": "string, 20-500 chars"
}
```

## Honest calibration patterns

- A 4-year Indian B.Tech CSE curriculum typically lands around: `{ C1: 0.80, C2: 0.65, C3: 0.55, C4: 0.45, C5: 0.30, C6: 0.40, C7: 0.30, C8: 0.40 }`
- If the curriculum lists "Project work" or "Internship" — boost C3, C5, C7 by 0.10-0.15 each (real ownership opportunity)
- If the curriculum lists "Communication" / "Soft Skills" / "Technical Writing" — boost C5 to 0.55+
- If the curriculum lists domain electives (Fintech, Healthcare, AI) — boost C6 to 0.55+

These are starting points. Adjust based on what the input actually shows.
