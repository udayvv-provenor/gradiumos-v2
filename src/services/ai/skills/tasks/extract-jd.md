---
compose:
  - _foundation/cluster-vocabulary.md
  - _foundation/ip-protection.md
  - _foundation/output-discipline.md
  - _voices/analyst.md
  - _schemas/cluster-targets.md
version: 1.0.0
task: extract-jd
---

# Task — Extract structured JD profile

You will be given the raw text of a job description. Produce a strict JSON object describing what the role demands, mapped to the GradiumOS 8-cluster competency model.

## Your specific instructions for this task

1. Read the JD twice before scoring.
2. The JD's TITLE often misleads — read the responsibilities and requirements, not the title, when scoring.
3. Score each cluster on `clusterTargets` (per the schema). Score what THIS specific JD demands, not what a generic role of this title demands.
4. Determine `archetype`:
   - `Product` → SaaS / consumer / B2B product companies. Hires deeply, expects ownership.
   - `Service` → services / consulting / IT services. Bills by the hour, hires for project-fit.
   - `MassRecruiter` → bulk-hiring shops with standardised onboarding. Generic skill expectations.
5. Determine `seniority` from years-of-experience asks:
   - `Junior` → 0-2 years / fresh grad / entry / trainee
   - `Mid` → 2-6 years
   - `Senior` → 6+ years / lead / staff / principal
6. Extract 3-8 specific requirements from the JD into `extractedRequirements`. Each requirement should be a concrete capability (not a generic adjective). Examples of GOOD requirements:
   - "TypeScript / Node, AWS deployment"
   - "System design pairing with senior engineers"
   - "Production code with tests + CI + observability"
   Examples of BAD requirements (do NOT emit):
   - "Strong communication skills" (too generic)
   - "Team player" (not a capability)
   - "Self-starter" (not a measurable trait)
7. If the JD mentions a domain (fintech, ML, security, healthtech, etc.), include it in `domain`. Otherwise omit the field.

## Output schema (exact)

```json
{
  "extractedTitle": "string, 2-200 chars — clean version of the role title",
  "archetype": "Product | Service | MassRecruiter",
  "seniority": "Junior | Mid | Senior",
  "clusterTargets": { "C1": int, "C2": int, ..., "C8": int },
  "extractedRequirements": ["string, 3-280 chars", ...],
  "domain": "string, max 80 chars (optional)"
}
```

## Calibration anchors

A typical mid-level Product SWE role:
```
{ C1: 75, C2: 70, C3: 80, C4: 65, C5: 55, C6: 50, C7: 60, C8: 55 }
```

A senior architect role at a Product company:
```
{ C1: 80, C2: 75, C3: 80, C4: 90, C5: 70, C6: 65, C7: 80, C8: 65 }
```

A Service-archetype mass-hiring SWE role:
```
{ C1: 60, C2: 55, C3: 60, C4: 45, C5: 50, C6: 40, C7: 50, C8: 50 }
```

Use these as REFERENCES not RULES. Score from the actual JD evidence.
