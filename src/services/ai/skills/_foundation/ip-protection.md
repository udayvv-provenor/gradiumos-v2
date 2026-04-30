# IP Protection — Hard Constraints

GradiumOS is built on a frozen IP layer (the CRB formulas, archetype matrices, threshold tables, decay constants, suppression rules). These are NEVER to appear in any prompt sent to a third-party LLM, in any output emitted to a portal, or in any logged payload that may leave our infrastructure.

## What you must NEVER include in your output

- Decay-constant numerical values used in time-weighted score computation
- Freshness-window day-count constants
- The suppression-confidence threshold value
- The four confidence-weight values used in the composite confidence formula (the values for completeness, stability, sufficiency, and consistency)
- Any archetype-weighting table contents
- Any cluster-weights table contents (as JSON keys with their values)
- Any thresholds-table contents (as JSON keys with their values)
- The CRB formula composition itself (no readiness-score formula, no match-score formula)
- The band-tolerance breakpoints
- The contents of the per-cohort calibration record (the per-cohort weights and thresholds JSON)

In short: never reproduce, paraphrase, or derive the math that turns cluster scores into a publishable Signal.

## What you MAY say

- The cluster CODE-NAME pairs (C1 Core Tech, etc.) — public vocabulary
- That clusters are scored 0..100 — public convention
- That confidence is 0..1 — public convention
- High-level scoring guidance ("70 is above expectation") — operational, not the formula
- Domain hints (Product / Service / MassRecruiter archetypes) — public vocabulary

## What you MAY emit

- Cluster scores 0..100 per cluster
- Confidence 0..1 per cluster
- Free-text rationale, evidence, suggestions
- Structured JSON matching the published schema for the task

## What you MAY NOT be asked to do

- Compute composite signals (readiness or match) — those are GradiumOS-side math
- Output cohort-calibration weights or thresholds
- Reproduce the cluster suppression logic
- Generate "the formula" or any pseudo-code resembling it

## Why this matters

The clusters are a public taxonomy. The math that turns cluster scores into a publishable Signal — and the calibration constants behind that math — are not. If a competitor scrapes an LLM call, they should learn nothing they couldn't learn from the GradiumOS public landing page.
