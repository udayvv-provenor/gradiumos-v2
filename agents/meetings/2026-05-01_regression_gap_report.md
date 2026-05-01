# GradiumOS v2 — Regression Gap Report
**Date:** 2026-05-01  
**Session:** 15-proxy client regression (5 Campus × 5 Workforce × 5 Talent agents) + browser spot-check  
**Overseer:** Claude (solo)  
**Status at close:** All 3 portals live, login working, BOM fix committed + deployed

---

## Live URLs (confirmed working as of this MoM)

| Surface | URL | Status |
|---|---|---|
| Campus portal | https://campus-app-uday-v-vs-projects.vercel.app | ✅ Live |
| Workforce portal | https://workforce-app-uday-v-vs-projects.vercel.app | ✅ Live |
| Talent portal | https://talent-app-uday-v-vs-projects.vercel.app | ✅ Live |
| Landing page | https://gradiumos-demo-landing-uday-v-v-uday-v-vs-projects.vercel.app | ✅ Live |
| Backend (Railway) | https://gradiumos-v2-backend-production.up.railway.app | ✅ Live |

---

## What was done this session

1. **PR #1 confirmed** — `udayvv-provenor/veranox-master-backup`, branch `backup/session-2026-04-30`, commit `4522d95` (153 files, 31,277 insertions). Already open, no action needed.
2. **Deployment Protection disabled** — Uday manually disabled for all 4 Vercel apps. All URLs now publicly accessible.
3. **15-agent regression run** — 5 Campus + 5 Workforce + 5 Talent proxy clients, each creating accounts and testing every feature. Results documented below.
4. **BOM bug found and fixed** — Root cause of "Invalid response" login error on all 3 portals. Fix deployed (commit `3cb9452`, pushed to `gradiumos-v2` + 3 Vercel redeployments).
5. **Browser spot-check** — All 3 portals manually verified logged in and navigated key pages.

---

## Regression results by stakeholder

### Campus (5 proxy Deans — SRM, VIT, BITS, IIT, Anna)

| Test | Result |
|---|---|
| Signup (new institution) | ✅ Pass |
| Login | ✅ Pass |
| Create career track | ✅ Pass (code must be canonical: SWE/DATA/MLAI/PRODUCT/DESIGN) |
| Career track `archetype` field | ⚠️ Silently discarded — API accepts but does not persist |
| Upload curriculum (text) | ✅ Pass |
| GET learners list | ✅ Pass |
| GET cohort gap intelligence | ✅ Pass |
| Market intel (fresh institution) | ❌ Falls back to generic/random data (see below) |
| GET invite code | ✅ Pass |

**Campus API smoke: 80/80 passing** (backend tests)

---

### Workforce (5 proxy TA Leads — Freshworks, Razorpay, Swiggy, Zomato, Zepto)

| Test | Result |
|---|---|
| Signup (new employer) | ✅ Pass |
| Login | ✅ Pass |
| Create role | ✅ Pass |
| GET role detail — `status` field | ⚠️ Absent from GET response (POST returns it, GET omits it) |
| JD upload (`POST /api/v1/workforce/roles/:id/jd`) | ❌ KYC-gated for all fresh accounts — `KYC_PENDING` |
| PATCH role targets | ❌ KYC-gated for all fresh accounts — `KYC_PENDING` |
| Talent discovery | ⚠️ Returns same 3 global candidates to all employers (not role-scoped) |
| Calibrate dashboard (fresh role, 0 applicants) | ⚠️ Shows all-zeros — no empty-state messaging |

**Workforce API smoke: 80/80 passing** (seeded employer, KYC pre-verified)

---

### Talent (5 proxy Learners — Arjun, Priya, Ravi, Ananya, Kiran)

| Test | Result |
|---|---|
| Signup (new learner via invite code) | ✅ Pass |
| Login | ✅ Pass |
| GET profile | ✅ Pass |
| GET cluster scores | ✅ Pass |
| GET signal | ✅ Pass (score=0 for new learner, LOCKED band) |
| GET gaps | ✅ Pass |
| Consent system (4 consents auto-provisioned) | ✅ Pass |
| MCQ attempt | ✅ Pass (partial credit: wrong answer still updates C1 score) |
| Descriptive attempt | ✅ Pass (AI graded) |
| GET opportunities | ✅ Pass (4 opportunities at signal=0) |
| Apply to live roles | ✅ Pass |
| Apply to draft roles | ❌ `ROLE_NOT_ACCEPTING` (409) — regression roles were created in draft state; not a product bug |
| Data export | ✅ Pass |
| Forgot password / resend verification | ✅ Pass |

**Talent API smoke: 101/111 passing** — 10 failures all tied to regression-created draft roles, not product bugs.

---

## Gaps to bridge (prioritised)

### 🔴 BLOCKER — Fixed this session
| # | Issue | Fix | Status |
|---|---|---|---|
| B1 | BOM character `﻿` embedded in `VITE_API_BASE_URL` on all 3 Vercel deployments → "Invalid response" on login | `api.ts`: `.replace(/^﻿/, '')` on BASE; redeployed all 3 portals | ✅ FIXED — commit `3cb9452` |

---

### 🔴 BLOCKER — Needs fix before advisor demo

| # | Issue | Impact | Recommended fix |
|---|---|---|---|
| B2 | **Market intel falls back to random/unrelated data for new institutions** — "Regression Corp" returned generic job listings; "tops" keyword mapped to Myntra clothing site as a "top hirer" | Dean opens portal for the first time and sees meaningless noise — actively embarrassing in a demo | Cap the market intel to known-good institution/employer name patterns; add "data not yet available for this institution" empty state rather than showing fallback garbage |
| B3 | **KYC gate blocks all Workforce personalisation pre-verification** — both `POST /jd` and `PATCH /targets` return `KYC_PENDING` for all new employers | TA Lead can't upload a JD or set role targets on signup day — the one thing they'd want to do first | Either (a) allow JD/targets before KYC and gate only shortlisting/contact; or (b) surface KYC onboarding flow prominently on signup so the TA knows what to do next |

---

### 🟡 DEGRADED — Fix before real client onboarding

| # | Issue | Impact | Recommended fix |
|---|---|---|---|
| D1 | **`archetype` field silently discarded on career track create** — POST accepts it, does not persist it | Career track archetype is a core concept; Deans expect it to be stored | Backend: persist `archetype` on `CareerTrack` model; return it in GET |
| D2 | **`status` field absent from GET role detail** — POST returns it, GET omits it | TA Lead can't distinguish draft vs live roles in the UI without workaround | Backend: include `status` in the role GET response payload |
| D3 | **Talent discovery not role-scoped** — all employers see the same top 3 global candidates regardless of role | A TA looking at "Senior Data Analyst" sees a "SWE Track" learner at #1 — no relevance | Scope talent discovery by track archetype match, not global top-N |
| D4 | **Career track `clusterWeights` identical across all 5 tracks** — SWE, DATA, MLAI, PRODUCT, DESIGN all have weight distribution `C1=0.18…C8=0.05` | Weights should differ by track (DATA track should weight C4/C6 higher; DESIGN should weight C5/C7) — currently meaningless differentiation | Review seed weights; apply track-appropriate distributions |

---

### 🔵 SECURITY — Address before any real learner data

| # | Issue | Impact | Recommended fix |
|---|---|---|---|
| S1 | **Refresh token returned as plain JSON body field** — not in an HttpOnly cookie | XSS on any of the 3 portals can steal the refresh token and maintain persistent access | Move refresh token to `Set-Cookie: refreshToken=...; HttpOnly; Secure; SameSite=Strict`; remove from JSON body. Update all 3 portals to not read it from JSON. |

---

### ⚪ COSMETIC — Post-advisor-demo polish

| # | Issue |
|---|---|
| C1 | Workforce Calibrate shows all-zeros immediately on role creation — needs "No applicants yet" empty-state message |
| C2 | Regression-era test roles in Workforce (named `Senior SWE 1777616384` etc.) are cluttering the Freshworks account with "JD MISSING" tags — clean up seeded data |
| C3 | Talent `assessments` route redirects to `/profile?welcome=1` for learners with incomplete profiles — works as intended but should explain why (tooltip/callout) |

---

## What the browser spot-check confirmed

| Page | Checked | Result |
|---|---|---|
| Campus login | ✅ | Logged in as Prof. Krishnamurthy / SRM |
| Campus dashboard | ✅ | 3 learners, 11% avg readiness, 1 track — data correct |
| Campus career tracks | ✅ | B.Tech CSE / SWE track, 3 learners, created 01/05/2026 |
| Workforce login | ✅ | Logged in as Sarita Rajan / Freshworks |
| Workforce dashboard | ✅ | 2 open roles, 0 applications, radar chart rendering |
| Workforce roles | ✅ | 5 roles shown (3 DATA/JD-missing from regression, 2 SWE) |
| Talent login | ✅ | Logged in as Arjun Patel / SRM |
| Talent dashboard | ✅ | C1=11/HIGH, C2–C8=LOW, Signal 11/EMERGING |
| Talent opportunities | ✅ | 3 matched roles (Freshworks ×2, Razorpay ×1) at 2% match |
| Talent assessments | ✅ | Gated behind profile completion (intentional UX) |

---

## Actions before advisor demo (in order)

1. **[Uday / product call]** — Decide on KYC gate UX (B3): allow JD upload pre-KYC or show onboarding flow? This is a product decision, not just a bug fix.
2. **[Dev — 1 session]** — Fix market intel empty state (B2): if institution name has no Serper hits, show "We're still calibrating data for your institution — check back in 24h" rather than random fallback.
3. **[Dev — 30 min]** — Fix `archetype` persist on career track (D1) + `status` in GET role (D2) — both are small backend patches.
4. **[Dev — 1 session]** — Scope talent discovery by track archetype (D3).
5. **[Uday — manual]** — Delete the regression-era test roles from Freshworks account in the Workforce portal (C2) before any live demo.

---

## What is ready for an advisor walk-through today

- All 3 portals load, look professional, respond fast
- Seeded demo accounts (krishnamurthy, sarita.rajan, arjun.patel) all log in without issue
- Full learner journey visible in Talent: dashboard → gaps → opportunities → apply
- Campus Dean can see cohort readiness, career tracks, Bridge to Bar chart
- Workforce TA can see role pipeline, demand vs competency radar, talent discovery
- Landing page is live and professionally presented

**Do NOT demo:** market intel refresh (shows random/bad fallback), JD upload for a fresh employer (KYC-blocked), talent discovery (not role-scoped)

---

*Authored by Claude. Commit: `3cb9452`. All 3 portals redeployed 2026-05-01.*
