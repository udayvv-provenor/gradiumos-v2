# GradiumOS v2 — Option B Session 2 MoM
**Date:** 2026-05-01  
**Type:** Engineering execution  
**Status:** DEPLOYED ✓

---

## What was done

This session completed the DPDP consent management loop — the last remaining Option B item from Session 1.

### 1. Backend — `GET /api/v1/talent/me/consents` (NEW)

**File:** `backend/src/routes/talentV1Routes.ts`  
**Commit:** `e814060`  
**Deployed to Railway:** ✓

The PATCH endpoint for updating consent already existed (`/me/consent/:purpose`). The portal had been calling `/me/consents` (GET) but it was returning 404. Now implemented:

- Reads all `ConsentRecord` rows for the user, newest-first
- Most-recent row per purpose wins (append-only history, per BC 20)
- Any purpose absent from DB defaults to `true` (matches `seedDefaultConsent` behaviour)
- Returns `{ consents: [{ purpose, granted, grantedAt }] }`

**Test results (live, Railway):**

```
GET  /api/v1/talent/me/consents          → { consents: [4 rows, all granted] }
PATCH /api/v1/talent/me/consent/analytics { granted: false }
                                          → { purpose: "analytics", granted: false }
GET  /api/v1/talent/me/consents          → analytics = false ✓ (most-recent row wins)
PATCH /api/v1/talent/me/consent/analytics { granted: true }
                                          → restored ✓
```

---

### 2. Talent portal — `PrivacySettings.tsx` (NEW page)

**File:** `talent-app/src/pages/PrivacySettings.tsx`  
**Route:** `/settings/privacy`  
**Commit:** `865f00e`  
**Deployed to Vercel:** ✓

Three sections on the page:

**Section 1 — Data processing consent**
- Uses the existing `ConsentPanel` component (4 toggles: assessment-grading, tutor-AI, opportunity-matching, analytics)
- Loads current state from `GET /api/v1/talent/me/consents`
- Each toggle calls `PATCH /api/v1/talent/me/consent/:purpose` on change
- Required toggle (`assessment-grading`) is disabled/locked with "Required" badge
- Purpose key mapping: `tutor-ai` (ConsentPanel) ↔ `tutor-AI` (DB) handled in-page
- Save confirmation via toast on each toggle

**Section 2 — Data portability**
- "Request data export" button → `POST /api/v1/talent/me/data/export`
- Returns `{ jobId }` with toast: "Export queued (job XXXXXXXX…)"
- Note to user: "Processing takes up to 24 hours. You'll receive an email when ready."

**Section 3 — Right to erasure**
- Staged confirmation UI (not a single click)
- Step 1: "Request account deletion" button → reveals confirmation panel
- Step 2: Checkbox "I understand this cannot be undone" must be checked
- Step 3: "Confirm deletion" → `DELETE /api/v1/talent/me/account` → toast with scheduled date
- Cancel clears both states back to step 1
- 30-day queued erasure (matches BC 19 implementation)

Footer note references DPDP Act 2023 + `privacy@veranox.com` grievance address.

---

### 3. Sidebar update — "Settings" section

**File:** `talent-app/src/components/Sidebar.tsx`

Added a distinct "Settings" nav group at the bottom of the nav list with two links:
- `⊕ Privacy & Data` → `/settings/privacy`
- `◎ Notifications` → `/settings/notifications`

Previously `NotificationSettings` existed but had no sidebar entry — this surfaces it alongside the new Privacy page.

---

## Live URLs

| Surface | URL |
|---|---|
| Backend | `https://gradiumos-v2-backend-production.up.railway.app` |
| Talent portal | `https://talent-app-henna.vercel.app` |
| Privacy settings | `https://talent-app-henna.vercel.app/settings/privacy` |

Demo credentials: `arjun.patel@srm.edu` / `DemoPass123!`

---

## GitHub

| Repo | Branch | Latest commit |
|---|---|---|
| `udayvv-provenor/gradiumos-v2` | `main` | `865f00e` — DPDP PrivacySettings page |
| `udayvv-provenor/gradiumos-v1-test` | `backend-main` | `e814060` — GET /me/consents endpoint |

---

## All Option B items — status

| Item | Status |
|---|---|
| Pipeline applicant count bug (Shortlist vs PipelineCandidate) | ✅ DONE (commit 667f54c) |
| Signup rate limiter — 10/15min/IP (abuse prevention) | ✅ DONE (commit 667f54c) |
| Connection pool — `connection_limit=10&pool_timeout=20` | ✅ DONE (commit 667f54c) |
| Sentry wiring — already in server.ts, just needs DSN env var | ✅ DONE (commit 667f54c, doc only) |
| Email verification — `GET /verify-email?token=...` | ✅ DONE (commit 29c6f8f) |
| Forgot password — `POST /forgot-password` | ✅ DONE (commit 29c6f8f) |
| Reset password — `POST /reset-password` | ✅ DONE (commit 29c6f8f) |
| Resend verification — `POST /resend-verification` | ✅ DONE (commit 29c6f8f) |
| Schema: 6 new User columns (emailVerified, tokens, expiry) | ✅ DONE (commit 29c6f8f) |
| DPDP consent — GET /me/consents endpoint | ✅ DONE (commit e814060) |
| DPDP PrivacySettings page (Talent portal) | ✅ DONE (commit 865f00e) |
| Sidebar — Settings nav group | ✅ DONE (commit 865f00e) |

---

## Open items (not in this sprint scope)

- **Sentry DSN env var** — add `SENTRY_DSN` to Railway environment variables (5 minutes, Uday can do this directly)
- **Email sending** — requires `RESEND_API_KEY` in Railway environment. Currently fire-and-forget but silently drops if key missing. Uday to create a Resend.com account + add the key.
- **Custom domains** — `campus.gradiumos.com` / `workforce.gradiumos.com` / `talent.gradiumos.com` (DNS + Vercel config, 15 minutes)
- **Admin dashboard** — institution/user management UI for SUPER_ADMIN
- **Real email verification test** — will only fully work once RESEND_API_KEY is in Railway

---

## TypeScript state

Backend: `tsc --noEmit` → **0 errors**  
Talent portal (new files only): `PrivacySettings.tsx`, `Sidebar.tsx`, `App.tsx` → **0 errors**  
Pre-existing TS errors in `Profile.tsx` (TanStack Query generic typing) are unchanged from prior sessions — not regressions from this work.
