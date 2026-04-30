---
compose:
  - _foundation/cluster-vocabulary.md
  - _foundation/ip-protection.md
  - _foundation/output-discipline.md
  - _voices/analyst.md
  - _schemas/cluster-targets.md
  - _schemas/cluster-confidence.md
version: 1.0.0
task: parse-resume
---

# Task — Parse a learner's resume

You will be given the raw text of a resume. Produce a strict JSON profile mapping the candidate's competencies onto the GradiumOS 8-cluster model, plus identifying metadata.

## Your specific instructions for this task

1. **Read the resume top to bottom before scoring.** First scan for evidence; then assign scores.

2. **Score `clusterScores`**: each cluster 0..100. Per the analyst voice's calibration heuristics — DON'T inflate. A 2-year intern doesn't have 80 on system design.

3. **Score `clusterConfidence`**: 0..1. This reflects EVIDENCE QUALITY (per `_schemas/cluster-confidence.md`). A confident-low score is more useful than an uncertain-medium score.

4. **Determine `yearsExp`**: the candidate's professional years (internships count as 0.5x). Estimate honestly; round to nearest integer.

5. **Determine `archetype`**: based on companies named in their experience.
   - `Product` → companies like Razorpay, Freshworks, Swiggy, Google, Meta, Stripe
   - `Service` → companies like TCS, Infosys, Accenture, Cognizant, Capgemini
   - `MassRecruiter` → bulk-hiring shops (Cognizant Genc, Wipro WILP)
   - `Unknown` → no recognisable companies, fresh grad with no industry exposure

6. **`declaredSkills`**: list 5-20 specific technologies/skills NAMED in the resume. Not "programming" — name the languages. Not "cloud" — name AWS / GCP / Azure.

7. **`experienceSummary`**: 2-3 sentences. Distill, don't repeat. Lead with archetype + years + strongest cluster + biggest gap.

8. **`evidenceHighlights`**: 3-6 specific bullet-shaped achievements from the resume. Quote the resume's own language where it's strong. Skip generic claims.

## Output schema (exact)

```json
{
  "candidateName": "string, max 120 (optional — omit if not detectable)",
  "yearsExp": <integer 0..50>,
  "archetype": "Product | Service | MassRecruiter | Unknown",
  "clusterScores": { "C1": int, "C2": int, ..., "C8": int },
  "clusterConfidence": { "C1": float, "C2": float, ..., "C8": float },
  "declaredSkills": ["string, 1-60 chars", ...],
  "experienceSummary": "string, 20-800 chars",
  "evidenceHighlights": ["string, 8-280 chars", ...]
}
```

## Common failure modes to avoid

- **Inflating C5 (Communication)** because the resume LISTS "communication" as a skill. C5 needs evidence (talks, blogs, cross-team work), not claims.
- **Inflating C7 (Ownership)** because the title says "Senior". Title isn't ownership; named initiatives + post-mortems are.
- **Missing C8 evidence** when it's there: "picked up Go in 2 weeks" / "transitioned from frontend to ML" — strong C8 signals.
- **Penalising fresh grads on C3 (Engineering Execution)**: a strong CP record + one shipped side project gives them moderate C3, not high. Industry experience compounds C3 fast.
