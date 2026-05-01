# GradiumOS v2 — Option A Production-Readiness Lock
**Date:** 2026-05-01  
**Status:** COMPLETE — all 4 blockers fixed, all 5 verification types PASS  
**Engineer:** Claude (solo execution)

---

## What Option A was

Four blockers between "deployed prototype" and "safe to show to a customer":

| # | Blocker | What we fixed |
|---|---------|---------------|
| A1 | `railway.json` ran `prisma migrate reset` on every deploy — data-loss bomb | Removed; start command is now `npx prisma db seed && node dist/server.js` |
| A2 | 3 demo logins had unknown/stale passwords | Seed now always resets `passwordHash` on upsert; DPDP consent records seeded for Arjun |
| A3 | No consent checkbox on any Signup page | Added terms + privacy checkbox to all 3 portals; button disabled until ticked |
| A4 | `/metrics` endpoint open to the internet | Gated behind `METRICS_TOKEN` bearer token; 401 when token set and not provided |

---

## Live URLs (as of 2026-05-01)

**Backend**
- Railway: `https://gradiumos-v2-backend-production.up.railway.app`
- Health: `https://gradiumos-v2-backend-production.up.railway.app/api/v1/health`

**Portals (Vercel)**
| Portal | URL |
|--------|-----|
| Campus (Dean) | https://campus-app-gray.vercel.app |
| Workforce (TA Lead) | https://workforce-app-one.vercel.app |
| Talent (Learner) | https://talent-app-henna.vercel.app |

**GitHub**
- Repo: `https://github.com/udayvv-provenor/gradiumos-v2`
- `main` branch — 3 portals (campus-app, talent-app, workforce-app) — commit `804c2e6`
- `backend-main` branch — backend source — commit `b0243e8`

**Demo credentials** (password: `DemoPass123!`)
| Role | Email |
|------|-------|
| Dean / Campus | krishnamurthy@srm.edu |
| TA Lead / Workforce | sarita.rajan@freshworks.com |
| Learner / Talent | arjun.patel@srm.edu |
| Institution invite code | SRMPILOT |

---

## 5-Type Structured Verification — Results

### Type 1 — JD Upload + Groq Extraction (Employer flow)

**Login:** sarita.rajan@freshworks.com  
**Steps:**
1. `POST /api/v1/workforce/roles` with `careerTrackCode: "SWE"` → role created
2. `POST /api/workforce/roles/:id/jd` with raw JD text → Groq extracted clusterTargets + archetype

**Result:** ✅ PASS  
`clusterTargets` returned: `{C1:80,C2:75,C3:70,C4:65,C5:60,C6:55,C7:60,C8:50}`  
`archetype: "Product"`, `seniority: "Senior"`, `extractedRequirements` array populated

---

### Type 2 — Curriculum Upload + Groq Mapping (Institution flow)

**Login:** krishnamurthy@srm.edu  
**Steps:**
1. `POST /api/campus/career-tracks` → track created
2. `POST /api/campus/career-tracks/:id/curriculum` with B.Tech CSE curriculum text → Groq mapped to C1–C8

**Result:** ✅ PASS  
`clusterCoverage` returned with 8 numeric values (0–1 range)  
`subjects` array had 8+ entries with per-subject cluster mapping  
`overallClusterCoverage.C1 = 0.85`, demonstrating real AI extraction

---

### Type 3 — MCQ Assessments + CompetencyScore materialisation (Learner flow)

**Login:** arjun.patel@srm.edu  
**Steps:**
1. Submitted 3 MCQ attempts from assessment bank:
   - C1-MCQ-01 → score 0 (wrong answer)
   - C1-MCQ-02 → score 100 (correct answer)
   - C1-MCQ-03 → score 0 (wrong answer)
2. Fetched `GET /api/talent/me/clusters` → verified 8 CompetencyScore rows materialised

**Result:** ✅ PASS  
8 CompetencyScore rows present  
`scoreWeighted` ∈ [0, 100] ✓  
`confidence` ∈ [0, 1] ✓  
Formula pipeline (DECAY, FRESHNESS, confidence weights) operating on real attempt data

---

### Type 4 — AI Tutor (Real Groq turns)

**Login:** arjun.patel@srm.edu  
**Steps:**
1. `POST /api/talent/me/tutor/sessions` `{clusterCode:"C1", topic:"Dynamic Programming"}`
2. Sent 3 message turns via `POST /api/talent/me/tutor/sessions/:id/turn`
3. Verified 3 replies received, all distinct (not mock fixtures)

**Result:** ✅ PASS  
- 3 Groq replies received
- All 3 replies unique (different content each turn) ✓
- Consent records required: all 4 DPDP purposes (`assessment-grading`, `tutor-AI`, `opportunity-matching`, `analytics`) seeded correctly in `prisma/seed.ts`

**Fix applied during verification:** seed.ts previously bypassed `signupLearner`'s `seedDefaultConsent()` call. Added consent record seeding block to seed directly. Also added `update: { passwordHash }` to user upserts so passwords reset on every seed run.

---

### Type 5 — Opportunities + Apply (End-to-end match flow)

**Login:** arjun.patel@srm.edu  
**Steps:**
1. `GET /api/talent/me/opportunities` → 4 roles returned with real `matchPct` values
2. `POST /api/talent/me/opportunities/:roleId/apply` → `state: "piped"`, `alreadyApplied: false`
3. Re-apply same role → `alreadyApplied: true` (idempotent) ✓

**Result:** ✅ PASS  
`matchPct` is formula-computed (value: 5 — Arjun has few attempts, so score is genuinely low vs targets)  
Apply creates `Placement` record with `state: "piped"` ✓

**Known bug logged (non-blocking):** Workforce pipeline applicant count shows 0 for Freshworks roles even after Arjun applied. Root cause: `applicantCount` aggregation in roles list endpoint appears to filter by a different Placement state than `piped`. Apply endpoint works correctly; display bug in pipeline count only. To be fixed in Option B.

---

## Code changes in this session

### backend/prisma/seed.ts
- Added full demo accounts block (SRM institution, IndexVersion, Dean user, Freshworks employer, TA_LEAD user, Arjun learner + user)
- Changed `update: {}` → `update: { passwordHash }` for Dean and TA_LEAD upserts (resets passwords on every seed run)
- Added DPDP consent records seeding for Arjun (4 purposes, `skipDuplicates: true`)

### backend/railway.json
- Removed `prisma migrate reset` from start command (data-loss bomb)
- Start command: `npx prisma db seed && node dist/server.js`

### backend/src/app.ts
- `/metrics` endpoint now checks `METRICS_TOKEN` env var; returns 401 if token set and not matched

### backend/src/config/env.ts
- Added `METRICS_TOKEN: z.string().optional()`

### campus-app/src/pages/Signup.tsx
- Added `agreedToTerms` state
- Added consent checkbox (links to `/privacy` + `/terms` on gradiumos-demo-landing.vercel.app)
- Submit button disabled until checkbox ticked
- Guard in `handleSubmit`: returns error if not agreed

### workforce-app/src/pages/Signup.tsx
- Same consent checkbox pattern (employer copy)

### talent-app/src/pages/Signup.tsx
- Same consent checkbox pattern (learner copy)

---

## Option A Sign-off

All 4 blockers fixed. All 5 verification types pass. GitHub backed up. Local committed.

| Check | Status |
|-------|--------|
| A1 — No data-loss on redeploy | ✅ |
| A2 — All 3 demo logins work | ✅ |
| A3 — Consent checkbox on all Signup pages | ✅ |
| A4 — /metrics gated | ✅ |
| Type 1 — JD + Groq | ✅ |
| Type 2 — Curriculum + Groq | ✅ |
| Type 3 — Assessments + CompetencyScore | ✅ |
| Type 4 — AI Tutor (real Groq turns) | ✅ |
| Type 5 — Opportunities + Apply | ✅ |
| GitHub backup | ✅ github.com/udayvv-provenor/gradiumos-v2 |

**Ready for Option B.**

---

## Option B — What's next

The following hardening items are queued for Option B (full production readiness):

**Security & Auth**
- Email verification on signup (Resend integration — `RESEND_API_KEY` already in env schema)
- Password reset flow (forgot password → email link → reset)
- Rate limiting on signup endpoints (currently only on login)

**Data & Compliance**
- Full DPDP consent flow in-app (not just checkbox — granular per-purpose settings panel)
- Data deletion mechanism (`DELETE /api/v1/talent/me/account`)
- Audit log (write every destructive action to audit table)

**Infrastructure**
- Prisma connection pool tuning (pgBouncer or `connection_limit` env var)
- Sentry error monitoring (DSN already in env schema)
- Database backup schedule (Railway volume snapshots)
- Custom domains (campus.gradiumos.com / workforce.gradiumos.com / talent.gradiumos.com)

**Admin**
- Admin dashboard (institution management, user listing, feature flags UI)
- Employer onboarding flow (currently manual / seed-only for non-demo employers)

**Known bug to fix in Option B**
- Workforce pipeline applicant count = 0 display bug (apply works; count aggregation wrong)
