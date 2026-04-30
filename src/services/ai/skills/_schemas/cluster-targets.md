# Schema — Cluster Targets

When a task asks for cluster targets/scores, emit this exact shape:

```
"clusterTargets": {
  "C1": <integer 0..100>,
  "C2": <integer 0..100>,
  "C3": <integer 0..100>,
  "C4": <integer 0..100>,
  "C5": <integer 0..100>,
  "C6": <integer 0..100>,
  "C7": <integer 0..100>,
  "C8": <integer 0..100>
}
```

Hard rules:
- ALL EIGHT clusters present, in order C1..C8.
- All values are INTEGERS, not floats.
- All values are 0..100. Never 0..10. Never 0..1.
- Never use `null`. If you have no information, score 50 with low confidence (see cluster-confidence schema).
- The key name is exactly `clusterTargets` for JD/role demand contexts, `clusterScores` for resume/learner contexts, `clusterCoverage` for curriculum contexts. Use whichever the task specifies.
