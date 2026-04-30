# BC 180 — Pilot Cutover Gate Sign-Off Package

**Prepared:** 2026-04-30  
**Prepared by:** Maya (CTO)  
**Approval required:** Uday (MD/CEO)

---

## Gate Criteria (from BC 180)

> Pilot-cutover gate: marquee test green for 7 consecutive days, restore drill green, axe-core clean on consent + onboarding; sign-off recorded in admin.

---

## 1. Marquee Test (BC 153–159)

**Gate status: ✅ PASSED — 2026-04-30**

The 7-consecutive-day requirement was written as a flakiness gate for code still under active development. The code is now frozen: 158/158 tests pass and the marquee completed in 3m 42s with real Groq, all 6 steps green. Additional daily runs cannot improve confidence in the code — they would only detect Groq free-tier API outages, which is an infrastructure concern, not a quality gate.

**Decision (Uday, 2026-04-30):** Drop the 7-day clock as a cutover blocker. The Windows Task Scheduler job (`GradiumOS-MarqueeRun-BC180`) remains running as a **health monitor** through 2026-05-06; results logged to `runbooks/marquee-7day-tracker.md` for visibility, not as a gate.

Steps verified on 2026-04-30:
- BC 154 — Institution signup + KYC: ✅
- BC 155 — Employer signup + JD upload (Groq extraction): ✅
- BC 156 — Learner signup + MCQ attempts + CompetencyScore rows: ✅
- BC 157 — Weakest cluster → pathway assigned: ✅
- BC 158 — Reassessment → non-zero scores: ✅
- BC 159 — Signal → opportunity → apply → pipeline: ✅

---

## 2. Load Test (BC 179)

**Run date:** 2026-04-30  
**Tool:** k6 v0.54.0 (Windows AMD64 portable)  
**Config:** 100 VUs · 2 min · token pool 5 per role · traffic split 40/35/25

| Scenario | p50 | p90 | p95 | Gate (< 2s) |
|---|---|---|---|---|
| Overall | 6.77ms | 18.92ms | **30.25ms** | ✅ PASS |
| Talent | 5.01ms | 17.17ms | **28.34ms** | ✅ PASS |
| Workforce | 5.34ms | 16.21ms | **24.38ms** | ✅ PASS |
| Campus | 10.77ms | 26.53ms | **38.97ms** | ✅ PASS |

- Total requests: 29,156 (241.4 req/s sustained)
- 5xx errors: **Zero**
- All 6 endpoint checks: **100% pass rate**

Full report: `runbooks/load-test-results.md`

---

## 3. Security Tests

**Run date:** 2026-04-30  
**Test file:** `tests/security/authGuards.spec.ts`  
**Tests:** 22 / 22 PASS

Coverage:
| Test Category | Tests | Result |
|---|---|---|
| requireAuth — missing/malformed token | 2 | ✅ PASS |
| requireRole — role enforcement | 4 | ✅ PASS |
| requireInstitutionScope — tenant scoping | 2 | ✅ PASS |
| JWT tamper detection (forged tokens → AppError) | 4 | ✅ PASS |
| Rate limiter config (no load-test bypass in prod) | 3 | ✅ PASS |
| IP protection — all 5 Groq prompt files | 5 | ✅ PASS |
| AppError error shape | 2 | ✅ PASS |

Key findings:
- **No IP constants in any Groq prompt:** `DECAY`, `FRESHNESS_WINDOW`, `0.35`, `SUPPRESSION_THRESHOLD`, `scoreWeighted` absent from all 5 prompt templates (tutorChat, extractJD, mapCurriculum, gradeDescriptive, resumeBullets)
- **Rate limiter restored:** No `LOAD_TEST` bypass flag present in production code
- **JWT forgery rejected:** Tokens signed with wrong secret, tampered headers/payloads, and empty tokens all throw `AppError(AUTH_INVALID)`
- **Tenant scoping enforced:** `requireInstitutionScope` rejects requests with missing `inst` claim

---

## 4. Data Compliance Tests (DPDP)

**Run date:** 2026-04-30  
**Test files:** `tests/compliance/consentGate.spec.ts`, `tests/compliance/kAnonymity.spec.ts`, `tests/compliance/dataRights.spec.ts`  
**Tests:** 38 / 38 PASS

Coverage:

| Test Category | Tests | Result | BC |
|---|---|---|---|
| CONSENT_PURPOSES — all 4 purposes | 2 | ✅ PASS | BC 13 |
| requireConsent — throws when absent/revoked | 3 | ✅ PASS | BC 14 |
| requireConsent — passes when granted | 2 | ✅ PASS | BC 14 |
| ConsentMissingError carries purpose field | 2 | ✅ PASS | BC 14 |
| seedDefaultConsent — 4 purposes, all granted=true | 2 | ✅ PASS | BC 13 |
| k-anonymity — null below threshold (0–4 learners) | 5 | ✅ PASS | BC 104 |
| k-anonymity — populated at exactly 5 learners | 3 | ✅ PASS | BC 104 |
| k-anonymity — employer signal fallback | 4 | ✅ PASS | BC 101 |
| k-anonymity — threshold constant = 5 in source | 1 | ✅ PASS | BC 107 |
| Data export — always returns {jobId} (BC 21) | 3 | ✅ PASS | BC 18/21 |
| Erasure — 30-day window enforced | 3 | ✅ PASS | BC 19 |
| Consent PATCH — append-only (create not update) | 4 | ✅ PASS | BC 20 |
| Dispute — created with status=Open | 3 | ✅ PASS | BC 149 |
| Dispute list — route exists | 1 | ✅ PASS | BC 151 |

Key findings:
- **Consent is revocable:** Most-recent `ConsentRecord` row wins; revocation is immediately effective
- **Consent is append-only:** PATCH writes a new row via `consentRecord.create`, never `update`/`upsert`
- **k-anonymity at 5:** Cohort medians suppressed (return `null`) for cohorts < 5 learners; employer P50 falls back to `cold-start-public` baseline when < 5 signal rows
- **Data export never 500s:** Even zero-data learners receive `{jobId}` response
- **Erasure queued correctly:** `erasureAt` = now + 30 days, AuditLog entry written with `action='erasure_requested'`
- **Dispute initial status = Open:** DisputeRecord created with `status='Open'`; 72h SLA acknowledgement pathway confirmed

---

## 5. Unit + Integration Test Suite Summary

**Run date:** 2026-04-30

| Suite | Tests | Result |
|---|---|---|
| Formula (BC 1–5) | 46 | ✅ PASS |
| Signal signing (BC 6–9) | 13 | ✅ PASS |
| Signal payload suppression (BC 5) | 3 | ✅ PASS |
| Audit log before/after rules (BC 16) | 3 | ✅ PASS |
| Tutor prompt IP check (BC 75) | 1 | ✅ PASS |
| Talent loop session continuity (BC 114) | 5 | ✅ PASS |
| Radar chart viz (BC 115) | 8 | ✅ PASS |
| Subtopic ordering | 6 | ✅ PASS |
| Tutor mock | 7 | ✅ PASS |
| Resume gate | 5 | ✅ PASS |
| Audit loop coverage (BC 165) | 1 | ✅ PASS |
| **Security tests** | **22** | **✅ PASS** |
| **Consent gate (DPDP)** | **10** | **✅ PASS** |
| **k-anonymity (DPDP)** | **14** | **✅ PASS** |
| **Data rights (DPDP)** | **14** | **✅ PASS** |
| Integration — assign programme | 1 | ⏭ SKIP (needs db:seed) |
| Integration — talent flow | 7 | ⏭ SKIP (needs db:seed) |
| Concurrent edits (BC 160) | 4 | ⏭ SKIP (opt-in flag) |
| E2E marquee (BC 153–159) | 6 | ⏭ SKIP (runs via Docker) |

**Total PASS: 158 / 158 runnable tests**

---

## 6. Restore Drill (BC 185)

**Gate status: ✅ PASSED — 2026-04-30**

| Source rows | Drill rows | Deviation | Tables checked |
|---|---|---|---|
| 2,595 | 2,595 | **0.00%** | 25 non-empty tables |

Procedure: `pg_dump` of `gradium_v3` → `pg_restore` into `gradium_v3_drill` → direct `COUNT(*)` per table → deviation computed → scratch DB dropped.  
Runbook: [`runbooks/restore-drill.md`](restore-drill.md)

---

## 7. axe-core Accessibility (BC 167–168)

**Gate status: ✅ PASSED — 2026-04-30**

| Test file | Tests | Violations |
|---|---|---|
| `consent.a11y.test.tsx` — ConsentPanel (all granted, all revoked) | 2 | **0** |
| `signup.a11y.test.tsx` — Learner onboarding form | 1 | **0** |

Runner: `talent-app/npm run test:a11y` (Vitest + jsdom + axe-core 4.9.1)  
Tags checked: `wcag2a`, `wcag2aa`  
Note: `HTMLCanvasElement.getContext` warnings are jsdom limitations — axe-core skips colour-contrast checks it cannot run in jsdom. All structural, ARIA, and label checks execute cleanly.

---

## BC 180 Sign-Off

All gate criteria are **green** as of 2026-04-30:

- [x] Marquee test green ✅ (7-day clock dropped per Uday 2026-04-30 — scheduler kept as health monitor)
- [x] Load test p95 < 2s, zero 5xx ✅
- [x] Security test suite 22/22 ✅
- [x] DPDP compliance test suite 38/38 ✅
- [x] IP protection verified across all 5 Groq prompt files ✅
- [x] Rate limiter restored to 200/min ✅
- [x] Restore drill — 0.00% deviation ✅
- [x] axe-core zero AA violations on consent + onboarding ✅

**BC 180: PASS**

---

*Signed: Maya (CTO) — 2026-04-30*  
*Awaiting: Uday (MD/CEO) sign-off to proceed to pilot cutover*
