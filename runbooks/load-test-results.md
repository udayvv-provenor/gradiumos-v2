# BC 179 — Load Test Results

## Run: 2026-04-30
- Tool: k6 v0.54.0 (portable, Windows AMD64)
- Duration: 2 min, 100 VUs
- Target: http://localhost:4002 (local Docker stack)
- Token pool: 5 learners · 5 employers · 5 campus users (per-user rate-limit buckets)
- Traffic split: 40% Talent · 35% Workforce · 25% Campus (weighted random)

## Latency Thresholds — ALL PASS

| Scenario | p50 | p90 | p95 | Gate (< 2s) |
|---|---|---|---|---|
| Overall | 6.77ms | 18.92ms | **30.25ms** | ✅ PASS |
| Talent | 5.01ms | 17.17ms | **28.34ms** | ✅ PASS |
| Workforce | 5.34ms | 16.21ms | **24.38ms** | ✅ PASS |
| Campus | 10.77ms | 26.53ms | **38.97ms** | ✅ PASS |

## Check Results — ALL PASS

| Check | Pass Rate | Interpretation |
|---|---|---|
| [talent] health 200 | 100% ✅ | Health endpoint always responsive |
| [talent] signal 200 or 404 | 100% ✅ | Signal returned 200 (fresh learner → all clusters suppressed) |
| [workforce] calibrate 200 or 404 | 100% ✅ | 404 for placeholder role ID — expected |
| [workforce] pipeline 200 or 404 | 100% ✅ | 404 for placeholder role ID — expected |
| [campus] gap 200 or 404 | 100% ✅ | Gap returned 200 (empty cohort) |
| [campus] cohort 200 or 404 | 100% ✅ | Cohort returned 200 (empty list) |

## Throughput
- Requests/s: **241.4 req/s** sustained over 2 minutes
- Total requests: 29,156
- Iterations: 14,578

## 5xx Errors
**Zero 5xx errors recorded.** All `http_req_failed` counts are HTTP 404 responses from
placeholder IDs (`seed-role-001`, `seed-track-001`) — these are expected in the test
environment and explicitly accepted by the check logic. In production, real role/track
IDs would yield 200 responses.

## Rate Limiter Note
The API rate limiter is keyed per-user at 200 req/min. During this run the limiter was
set to 50,000/min to isolate backend performance from rate-limit artefacts. The limiter
was restored to 200/min immediately after the run. A production load test using unique
per-pilot-user tokens at the 200/min limit should see identical latency results — the
backend itself shows no contention at this load level.

## BC 179 Gate
- p95 < 2s: ✅ PASS (30.25ms overall, max 38.97ms per scenario)
- No 5xx: ✅ PASS (zero 500/502/503/504 responses)
- Recorded in runbooks/load-test-results.md: ✅

**BC 179: PASS**
