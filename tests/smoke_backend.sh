#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# GradiumOS v2 — Backend Smoke Test Suite
# Run from any directory. Requires: curl, python (for JSON parsing).
#
# Usage:
#   bash tests/smoke_backend.sh
#   BACKEND=http://localhost:4002 bash tests/smoke_backend.sh
#
# Exit code 0 = all tests pass.
# Exit code 1 = one or more failures (details logged above).
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

BACKEND="${BACKEND:-https://gradiumos-v2-backend-production.up.railway.app}"

PASS=0
FAIL=0
ERRORS=()

# ── Helpers ──────────────────────────────────────────────────────────────────

pass() { echo "  ✓ $1"; PASS=$((PASS+1)); }
fail() { echo "  ✗ $1"; FAIL=$((FAIL+1)); ERRORS+=("$1"); }

check_field() {
  local label="$1" json="$2" path="$3" expected="$4"
  local actual
  actual=$(echo "$json" | python -c "import sys,json; d=json.load(sys.stdin); exec('print(d'+\"$path\"+')')" 2>/dev/null || echo "PARSE_ERROR")
  if echo "$actual" | grep -qE "$expected"; then
    pass "$label (got: $actual)"
  else
    fail "$label — expected /$expected/ got: $actual"
  fi
}

check_no_error() {
  local label="$1" json="$2"
  local err
  err=$(echo "$json" | python -c "import sys,json; d=json.load(sys.stdin); print(d.get('error'))" 2>/dev/null || echo "PARSE_ERROR")
  if [ "$err" = "None" ]; then pass "$label"; else fail "$label — error: $err"; fi
}

# ── Login helper ─────────────────────────────────────────────────────────────

login() {
  local email="$1" password="$2"
  curl -s -X POST "$BACKEND/api/auth/login" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$email\",\"password\":\"$password\"}"
}

get_token() {
  local email="$1" password="$2"
  login "$email" "$password" | python -c "import sys,json; d=json.load(sys.stdin); print(d['data']['accessToken'])"
}

auth_get() {
  local token="$1" path="$2"
  curl -s "$BACKEND$path" -H "Authorization: Bearer $token"
}

auth_post() {
  local token="$1" path="$2" body="$3"
  curl -s -X POST "$BACKEND$path" \
    -H "Authorization: Bearer $token" \
    -H "Content-Type: application/json" \
    -d "$body"
}

auth_patch() {
  local token="$1" path="$2" body="$3"
  curl -s -X PATCH "$BACKEND$path" \
    -H "Authorization: Bearer $token" \
    -H "Content-Type: application/json" \
    -d "$body"
}

# ─────────────────────────────────────────────────────────────────────────────
echo ""
echo "════════════════════════════════════════════"
echo " GradiumOS v2 Backend Smoke Test"
echo " Target: $BACKEND"
echo "════════════════════════════════════════════"
echo ""

# ── T1: Health ────────────────────────────────────────────────────────────────
echo "T1: Health check"
H=$(curl -s "$BACKEND/health")
check_field "health.status=ok" "$H" "['status']" "^ok$"

# ── T2: Login — Dean ─────────────────────────────────────────────────────────
echo ""
echo "T2: Login as Dean (krishnamurthy@srm.edu)"
DEAN_RESP=$(login "krishnamurthy@srm.edu" "DemoPass123!")
check_field "login.data.user.role=DEAN" "$DEAN_RESP" "['data']['user']['role']" "^DEAN$"
DEAN_TOKEN=$(echo "$DEAN_RESP" | python -c "import sys,json; d=json.load(sys.stdin); print(d['data']['accessToken'])")

# ── T3: Login — TA_LEAD ──────────────────────────────────────────────────────
echo ""
echo "T3: Login as TA_LEAD (sarita.rajan@freshworks.com)"
TA_RESP=$(login "sarita.rajan@freshworks.com" "DemoPass123!")
check_field "login.data.user.role=TA_LEAD" "$TA_RESP" "['data']['user']['role']" "^TA_LEAD$"
TA_TOKEN=$(echo "$TA_RESP" | python -c "import sys,json; d=json.load(sys.stdin); print(d['data']['accessToken'])")

# ── T4: Login — Learner ──────────────────────────────────────────────────────
echo ""
echo "T4: Login as Learner (arjun.patel@srm.edu)"
LRN_RESP=$(login "arjun.patel@srm.edu" "DemoPass123!")
check_field "login.data.user.role=LEARNER" "$LRN_RESP" "['data']['user']['role']" "^LEARNER$"
LRN_TOKEN=$(echo "$LRN_RESP" | python -c "import sys,json; d=json.load(sys.stdin); print(d['data']['accessToken'])")

# ── T5: /auth/me ─────────────────────────────────────────────────────────────
echo ""
echo "T5: GET /api/auth/me (all 3 users)"
ME_DEAN=$(auth_get "$DEAN_TOKEN" "/api/auth/me")
check_field "me.dean.role" "$ME_DEAN" "['data']['user']['role']" "^DEAN$"

ME_LRN=$(auth_get "$LRN_TOKEN" "/api/auth/me")
check_field "me.learner.role" "$ME_LRN" "['data']['user']['role']" "^LEARNER$"

# ── T6: Campus — KPIs ────────────────────────────────────────────────────────
echo ""
echo "T6: GET /api/campus/overview/kpis"
KPIS=$(auth_get "$DEAN_TOKEN" "/api/campus/overview/kpis")
check_field "kpis.totalLearners>=0" "$KPIS" "['data']['totalLearners']" "^[0-9]+$"

# ── T7: Campus — Career tracks ───────────────────────────────────────────────
echo ""
echo "T7: GET /api/campus/career-tracks"
TRACKS=$(auth_get "$DEAN_TOKEN" "/api/campus/career-tracks")
check_field "tracks is list" "$TRACKS" "['data'].__class__.__name__" "^list$"

# ── T8: Campus — Learners ────────────────────────────────────────────────────
echo ""
echo "T8: GET /api/campus/learners"
LRNS=$(auth_get "$DEAN_TOKEN" "/api/campus/learners")
check_field "learners is list" "$LRNS" "['data'].__class__.__name__" "^list$"
LRN_COUNT=$(echo "$LRNS" | python -c "import sys,json; d=json.load(sys.stdin); print(len(d['data']))" 2>/dev/null || echo "0")
[ "${LRN_COUNT:-0}" -ge 1 ] && pass "learner count >= 1 (=$LRN_COUNT)" || fail "learner count should be >= 1 got $LRN_COUNT"

# ── T9: Workforce — Roles ────────────────────────────────────────────────────
echo ""
echo "T9: GET /api/workforce/roles"
ROLES=$(auth_get "$TA_TOKEN" "/api/workforce/roles")
check_field "roles is list" "$ROLES" "['data'].__class__.__name__" "^list$"

# ── T10: Workforce — Talent discovery ────────────────────────────────────────
echo ""
echo "T10: GET /api/workforce/talent-discovery"
DISC=$(auth_get "$TA_TOKEN" "/api/workforce/talent-discovery")
check_field "discovery is list" "$DISC" "['data'].__class__.__name__" "^list$"

# ── T11: Talent — Signal (v1) ────────────────────────────────────────────────
echo ""
echo "T11: GET /api/v1/talent/me/signal"
SIG=$(auth_get "$LRN_TOKEN" "/api/v1/talent/me/signal")
check_field "signal.signalScore>=0" "$SIG" "['data']['signalScore']" "^[0-9]"
check_field "signal.signalBand present" "$SIG" "['data']['signalBand']" "."

# ── T12: Talent — Consents ───────────────────────────────────────────────────
echo ""
echo "T12: GET /api/v1/talent/me/consents"
CONS=$(auth_get "$LRN_TOKEN" "/api/v1/talent/me/consents")
check_field "consents is list" "$CONS" "['data']['consents'].__class__.__name__" "^list$"
CONS_LEN=$(echo "$CONS" | python -c "import sys,json; d=json.load(sys.stdin); print(len(d['data']['consents']))" 2>/dev/null || echo "0")
[ "${CONS_LEN:-0}" -eq 4 ] && pass "consents count=4 (=$CONS_LEN)" || fail "consents count should be 4 got $CONS_LEN"

# ── T13: Consent PATCH cycle ─────────────────────────────────────────────────
echo ""
echo "T13: PATCH consent analytics → false → true"
P1=$(auth_patch "$LRN_TOKEN" "/api/v1/talent/me/consent/analytics" '{"granted":false}')
check_field "patch analytics false" "$P1" "['data']['granted']" "^False$"
P2=$(auth_patch "$LRN_TOKEN" "/api/v1/talent/me/consent/analytics" '{"granted":true}')
check_field "patch analytics true" "$P2" "['data']['granted']" "^True$"

# ── T14: Talent — Opportunities (v1) ─────────────────────────────────────────
echo ""
echo "T14: GET /api/v1/talent/me/opportunities"
OPPS=$(auth_get "$LRN_TOKEN" "/api/v1/talent/me/opportunities")
check_field "opportunities is list" "$OPPS" "['data']['opportunities'].__class__.__name__" "^list$"

# ── T15: Talent — Assessment bank ────────────────────────────────────────────
echo ""
echo "T15: GET /api/v1/talent/me/assessments"
BANK=$(auth_get "$LRN_TOKEN" "/api/v1/talent/me/assessments")
check_field "bank is list" "$BANK" "['data'].__class__.__name__" "^list$"
BANK_LEN=$(echo "$BANK" | python -c "import sys,json; d=json.load(sys.stdin); print(len(d['data']))" 2>/dev/null || echo "0")
[ "${BANK_LEN:-0}" -ge 1 ] && pass "bank length > 0 (=$BANK_LEN)" || fail "bank should have items got $BANK_LEN"

# ── T16: Password reset flow ─────────────────────────────────────────────────
echo ""
echo "T16: POST /api/auth/forgot-password (no user enumeration)"
FP=$(curl -s -X POST "$BACKEND/api/auth/forgot-password" \
  -H "Content-Type: application/json" \
  -d '{"email":"arjun.patel@srm.edu"}')
check_field "forgot-password 200 message" "$FP" "['data']['message']" "registered"

# ── T17: Resend verification ─────────────────────────────────────────────────
echo ""
echo "T17: POST /api/auth/resend-verification"
RV=$(curl -s -X POST "$BACKEND/api/auth/resend-verification" \
  -H "Content-Type: application/json" \
  -d '{"email":"arjun.patel@srm.edu"}')
check_field "resend-verification 200" "$RV" "['data']['message']" "registered"

# ── T18: Data export ─────────────────────────────────────────────────────────
echo ""
echo "T18: POST /api/v1/talent/me/data/export"
EXP=$(auth_post "$LRN_TOKEN" "/api/v1/talent/me/data/export" '{}')
check_field "export.jobId present" "$EXP" "['data']['jobId']" "."

# ── T19: Campus — Cohort gaps ────────────────────────────────────────────────
echo ""
echo "T19: GET /api/campus/insight/cohort-gaps"
GAPS=$(auth_get "$DEAN_TOKEN" "/api/campus/insight/cohort-gaps")
check_no_error "cohort-gaps no error" "$GAPS"

# ── T20: Workforce — Market intel ────────────────────────────────────────────
echo ""
echo "T20: GET /api/workforce/me/market-intel"
MKT=$(auth_get "$TA_TOKEN" "/api/workforce/me/market-intel")
check_no_error "market-intel no error" "$MKT"

# ── Summary ──────────────────────────────────────────────────────────────────
echo ""
echo "════════════════════════════════════════════"
echo " Results: $PASS passed, $FAIL failed"
echo "════════════════════════════════════════════"

if [ $FAIL -gt 0 ]; then
  echo ""
  echo "FAILED TESTS:"
  for e in "${ERRORS[@]}"; do echo "  ✗ $e"; done
  echo ""
  exit 1
fi

echo " All tests passed."
echo ""
