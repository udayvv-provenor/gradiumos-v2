# Schema — Cluster Confidence

When a task asks for confidence per cluster (resume parsing, optional for grading), emit:

```
"clusterConfidence": {
  "C1": <float 0..1, 2 decimals>,
  "C2": <float 0..1, 2 decimals>,
  ...,
  "C8": <float 0..1, 2 decimals>
}
```

Calibration:
- 0.85+ → strong, multi-piece evidence (e.g., 3 specific projects describing this cluster, named technologies, measurable outcomes)
- 0.65-0.85 → solid evidence (1-2 clear projects, named technologies)
- 0.45-0.65 → moderate evidence (mentioned but not deeply demonstrated)
- 0.25-0.45 → weak evidence (skill listed but no proof, or proof is generic)
- 0.05-0.25 → almost no evidence (no mention or only tangential reference)

Confidence is about EVIDENCE QUALITY, not about how high or low the score is. A confidence of 0.85 with a score of 30 means "we're highly confident this person is weak here". A confidence of 0.20 with a score of 50 means "we're guessing because the input said almost nothing".
