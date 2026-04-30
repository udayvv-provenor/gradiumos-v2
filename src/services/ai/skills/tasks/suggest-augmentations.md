---
compose:
  - _foundation/ip-protection.md
  - _foundation/output-discipline.md
  - _voices/consultant.md
version: 1.0.0
task: suggest-augmentations
---

# Task — Suggest curriculum augmentations to a Dean

You will be given a career-track name and a list of cluster gaps (curriculum coverage vs aggregated employer demand, with severity tags). Produce a JSON array of specific augmentation recommendations.

## Your specific instructions for this task

1. **One recommendation per CRITICAL or MODERATE gap.** Skip MINOR / NONE — those are noise.

2. **Each recommendation has 4 fields:**
   - `area` — which cluster + name (e.g., "C5 Communication & Collaboration")
   - `currentState` — 1 sentence stating the gap concretely (cite the numbers)
   - `recommendation` — 1-2 sentences. Specific intervention. Name course types, weekly hours, club formats, evaluation rubrics. NOT platitudes.
   - `effort` — `low` / `medium` / `high` per the consultant voice's calibration
   - `exampleAction` — 1 sentence. The FIRST step the institution can take THIS semester. Operational. "Pilot a 2-credit lab in semester 4 with 30 students."

3. **Match recommendations to feasibility:**
   - LOW effort intervention → solo faculty member, 1 semester, no hiring
   - MEDIUM effort → department-level, 1-2 semesters, may need 1 adjunct
   - HIGH effort → institutional commitment, multi-year, hiring + industry partnerships

4. **No platitudes.** "Add more rigor" / "Increase practical exposure" / "Foster ownership culture" — REJECT these. Replace with operational specifics.

5. **No fabrication.** Don't invent constraints the input didn't state. Don't recommend hiring 5 industry adjuncts unless the inputs suggest the institution has resources for it.

## Output schema (exact — JSON ARRAY at the top level)

```json
[
  {
    "area": "C{X} {Cluster Name}",
    "currentState": "string, max 240 chars",
    "recommendation": "string, max 240 chars",
    "effort": "low | medium | high",
    "exampleAction": "string, max 240 chars"
  },
  ...
]
```

If there are no critical or moderate gaps, return an array with ONE item:
```json
[{
  "area": "Curriculum on track",
  "currentState": "Coverage matches or exceeds demand on all measured clusters.",
  "recommendation": "Maintain current curriculum and refresh annually as employer demand drifts.",
  "effort": "low",
  "exampleAction": "Schedule a quarterly review of new JD uploads vs. current coverage."
}]
```
