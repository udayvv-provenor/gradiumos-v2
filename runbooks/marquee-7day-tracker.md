# BC 180 — Marquee 7-Day Consecutive Green Tracker

Gate requirement: `closed-loop-end-to-end.spec.ts` must pass for **7 consecutive days** before pilot cutover.

## How to run

```powershell
powershell -ExecutionPolicy Bypass -File runbooks/daily-marquee-run.ps1
```

Or manually:

```
npm run test:e2e
```

## Results

| Date | Time | Result | Duration | Notes |
|---|---|---|---|---|
| 2026-04-30 | 13:43 IST | ✅ PASS | 3.70s | Day 1 — BC 180 gate opened. All 6 steps green. Groq API live. |

<!-- Script appends rows here -->
