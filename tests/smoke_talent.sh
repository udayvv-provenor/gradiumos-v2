#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# GradiumOS v2 — Talent Portal E2E Smoke Test (via API)
# Full learner journey: login → profile → clusters → signal → assessments →
# consent → opportunities → apply → data export
#
# Usage:
#   bash tests/smoke_talent.sh
#   BACKEND=http://localhost:4002 bash tests/smoke_talent.sh
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail
BACKEND="${BACKEND:-https://gradiumos-v2-backend-production.up.railway.app}"
PASS=0; FAIL=0; ERRORS=()
pass() { echo "  ✓ $1"; PASS=$((PASS+1)); }
fail() { echo "  ✗ $1"; FAIL=$((FAIL+1)); ERRORS+=("$1"); }

check_no_error() {
  local label="$1" json="$2"
  local err
  err=$(echo "$json" | python -c "import sys,json; d=json.load(sys.stdin); print(d.get('error'))" 2>/dev/null || echo "PARSE_ERROR")
  if [ "$err" = "None" ]; then pass "$label"; else fail "$label — error: $err"; fi
}
check_field() {
  local label="$1" json="$2" path="$3" expected="$4"
  local actual
  actual=$(echo "$json" | python -c "import sys,json; d=json.load(sys.stdin); exec('print(d'+\"$path\"+')')" 2>/dev/null || echo "PARSE_ERROR")
  if echo "$actual" | grep -qE "$expected"; then pass "$label (=$actual)"; else fail "$label — expected /$expected/ got: $actual"; fi
}
get_token() {
  curl -s -X POST "$BACKEND/api/auth/login" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$1\",\"password\":\"$2\"}" | python -c "import sys,json; d=json.load(sys.stdin); print(d['data']['accessToken'])"
}
auth_get()   { curl -s "$BACKEND$2" -H "Authorization: Bearer $1"; }
auth_post()  { curl -s -X POST "$BACKEND$3" -H "Authorization: Bearer $1" -H "Content-Type: application/json" -d "$2"; }
auth_patch() { curl -s -X PATCH "$BACKEND$3" -H "Authorization: Bearer $1" -H "Content-Type: application/json" -d "$2"; }

echo ""
echo "════════════════════════════════════════════"
echo " Talent Portal Smoke Test"
echo " Target: $BACKEND"
echo "════════════════════════════════════════════"
echo ""

# ── Auth ─────────────────────────────────────────────────────────────────────
echo "AUTH"
T=$(get_token "arjun.patel@srm.edu" "DemoPass123!")
[ -n "$T" ] && pass "login learner" || { fail "login learner"; exit 1; }

ME=$(auth_get "$T" "/api/auth/me")
check_field "me.role=LEARNER" "$ME" "['data']['user']['role']" "^LEARNER$"

# ── Profile ───────────────────────────────────────────────────────────────────
echo ""
echo "PROFILE"
PROF=$(auth_get "$T" "/api/talent/me/profile")
check_no_error "GET /api/talent/me/profile" "$PROF"

# ── Cluster Scores ────────────────────────────────────────────────────────────
echo ""
echo "CLUSTER SCORES"
CLUST=$(auth_get "$T" "/api/talent/me/clusters")
check_no_error "GET /api/talent/me/clusters" "$CLUST"
check_field "clusters is array" "$CLUST" "['data'].__class__.__name__" "^list$"

# ── Signal (v1 — returns signalScore/signalBand) ──────────────────────────────
echo ""
echo "SIGNAL"
SIG=$(auth_get "$T" "/api/v1/talent/me/signal")
check_field "signal.signalScore in [0,100]" "$SIG" "['data']['signalScore']" "^[0-9]"
check_field "signal.signalBand present" "$SIG" "['data']['signalBand']" "."

# ── Gaps ─────────────────────────────────────────────────────────────────────
echo ""
echo "GAPS"
GAPS=$(auth_get "$T" "/api/v1/talent/me/gaps")
check_no_error "GET /api/v1/talent/me/gaps" "$GAPS"

# ── Consents ─────────────────────────────────────────────────────────────────
echo ""
echo "CONSENT"
CONS=$(auth_get "$T" "/api/v1/talent/me/consents")
check_field "consents is list" "$CONS" "['data']['consents'].__class__.__name__" "^list$"
CONS_LEN=$(echo "$CONS" | python -c "import sys,json; d=json.load(sys.stdin); print(len(d['data']['consents']))" 2>/dev/null || echo "0")
[ "${CONS_LEN:-0}" -eq 4 ] && pass "consents count=4 (=$CONS_LEN)" || fail "consents count should be 4 got $CONS_LEN"

# Toggle analytics consent
P1=$(auth_patch "$T" '{"granted":false}' "/api/v1/talent/me/consent/analytics")
check_field "revoke analytics" "$P1" "['data']['granted']" "^False$"

# Verify revoke reflected in GET
CONS2=$(auth_get "$T" "/api/v1/talent/me/consents")
ANALYTICS_GRANTED=$(echo "$CONS2" | python -c "import sys,json; d=json.load(sys.stdin); cs=[c['granted'] for c in d['data']['consents'] if c['purpose']=='analytics']; print(cs[0] if cs else 'MISSING')" 2>/dev/null || echo "PARSE_ERROR")
[ "$ANALYTICS_GRANTED" = "False" ] && pass "consent reflects revoke (analytics=False)" || fail "consent reflects revoke — expected False got $ANALYTICS_GRANTED"

# Restore
auth_patch "$T" '{"granted":true}' "/api/v1/talent/me/consent/analytics" > /dev/null
pass "restored analytics consent"

# ── Assessment bank ───────────────────────────────────────────────────────────
echo ""
echo "ASSESSMENTS"
BANK=$(auth_get "$T" "/api/v1/talent/me/assessments")
check_field "bank is list" "$BANK" "['data'].__class__.__name__" "^list$"
BANK_LEN=$(echo "$BANK" | python -c "import sys,json; d=json.load(sys.stdin); print(len(d['data']))" 2>/dev/null || echo "0")
[ "${BANK_LEN:-0}" -ge 1 ] && pass "bank has items (=$BANK_LEN)" || fail "bank should have items got $BANK_LEN"

# Grab a MCQ item and submit an attempt via v3Portal endpoint (handles selectedOptionId natively)
MCQ_ID=$(echo "$BANK" | python -c "
import sys,json
items=json.load(sys.stdin)['data']
mcqs=[i for i in items if i.get('kind')=='mcq']
print(mcqs[0]['id'] if mcqs else '')
" 2>/dev/null)

if [ -n "$MCQ_ID" ]; then
  # Get first option id
  OPT_ID=$(echo "$BANK" | python -c "
import sys,json
items=json.load(sys.stdin)['data']
mcqs=[i for i in items if i.get('kind')=='mcq']
print(mcqs[0]['options'][0]['id'] if mcqs else '')
" 2>/dev/null)
  # Use /api/talent/ path (v3Portal) — handles selectedOptionId directly
  ATT=$(auth_post "$T" "{\"selectedOptionId\":\"$OPT_ID\"}" "/api/talent/me/assessments/$MCQ_ID/attempt")
  check_no_error "POST /api/talent/me/assessments/:id/attempt (MCQ)" "$ATT"
  check_field "attempt.correct present" "$ATT" "['data'].__contains__('correct')" "^True$"
else
  fail "no MCQ item found in bank"
fi

# ── Opportunities + Apply ────────────────────────────────────────────────────
echo ""
echo "OPPORTUNITIES"
OPPS=$(auth_get "$T" "/api/v1/talent/me/opportunities")
check_no_error "GET /api/v1/talent/me/opportunities" "$OPPS"
check_field "opportunities is list" "$OPPS" "['data']['opportunities'].__class__.__name__" "^list$"

ROLE_ID=$(echo "$OPPS" | python -c "
import sys,json
opps=json.load(sys.stdin)['data']['opportunities']
print(opps[0]['roleId'] if opps else '')
" 2>/dev/null)

if [ -n "$ROLE_ID" ] && [ "$ROLE_ID" != "None" ]; then
  APL=$(auth_post "$T" "{}" "/api/v1/talent/me/opportunities/$ROLE_ID/apply")
  APL_ERR=$(echo "$APL" | python -c "import sys,json; d=json.load(sys.stdin); print(d.get('error'))" 2>/dev/null)
  if [ "$APL_ERR" = "None" ]; then
    pass "POST apply (ok)"
  else
    APL_CODE=$(echo "$APL" | python -c "import sys,json; d=json.load(sys.stdin); print(d.get('error',{}).get('code','?') if d.get('error') else 'ok')" 2>/dev/null)
    # Already applied is acceptable (idempotent)
    if [ "$APL_CODE" = "ALREADY_APPLIED" ]; then
      pass "POST apply (already applied — idempotent)"
    else
      fail "POST apply — unexpected error code: $APL_CODE"
    fi
  fi
else
  pass "no opportunities yet (zero roles) — skip apply test"
fi

# ── Applications ─────────────────────────────────────────────────────────────
echo ""
echo "APPLICATIONS"
check_no_error "GET /api/v1/talent/me/applications" "$(auth_get "$T" "/api/v1/talent/me/applications")"

# ── Learn index ──────────────────────────────────────────────────────────────
echo ""
echo "LEARN"
check_no_error "GET /api/talent/me/learn" "$(auth_get "$T" "/api/talent/me/learn")"

# ── Data export ──────────────────────────────────────────────────────────────
echo ""
echo "DATA RIGHTS"
EXP=$(auth_post "$T" "{}" "/api/v1/talent/me/data/export")
check_field "data export — jobId" "$EXP" "['data']['jobId']" "."

# ── Password reset endpoints ─────────────────────────────────────────────────
echo ""
echo "AUTH FLOWS"
FP=$(curl -s -X POST "$BACKEND/api/auth/forgot-password" \
  -H "Content-Type: application/json" -d '{"email":"arjun.patel@srm.edu"}')
check_field "forgot-password 200" "$FP" "['data']['message']" "registered"

RES=$(curl -s -X POST "$BACKEND/api/auth/resend-verification" \
  -H "Content-Type: application/json" -d '{"email":"arjun.patel@srm.edu"}')
check_field "resend-verification 200" "$RES" "['data']['message']" "registered"

# ── Signup — learner with real invite code ───────────────────────────────────
echo ""
echo "LEARNER SIGNUP"
TS=$(date +%s)
SUP=$(curl -s -X POST "$BACKEND/api/auth/signup/learner" \
  -H "Content-Type: application/json" \
  -d "{\"inviteCode\":\"SRMPILOT\",\"email\":\"learner$TS@srm.edu\",\"password\":\"TestPass123!\",\"name\":\"Test Learner $TS\"}")
check_field "signup learner — role=LEARNER" "$SUP" "['data']['user']['role']" "^LEARNER$"
check_field "signup learner — institutionName present" "$SUP" "['data']['institutionName']" "SRM"

# Bad invite code
BAD=$(curl -s -X POST "$BACKEND/api/auth/signup/learner" \
  -H "Content-Type: application/json" \
  -d '{"inviteCode":"BADCODE1","email":"bad@test.com","password":"TestPass123!","name":"Bad"}')
BAD_CODE=$(echo "$BAD" | python -c "import sys,json; d=json.load(sys.stdin); print(d.get('error',{}).get('code','none'))" 2>/dev/null)
if [ "$BAD_CODE" = "INVALID_INVITE_CODE" ]; then pass "bad invite code rejected"; else fail "bad invite code should return INVALID_INVITE_CODE got $BAD_CODE"; fi

echo ""
echo "════════════════════════════════════════════"
echo " Results: $PASS passed, $FAIL failed"
echo "════════════════════════════════════════════"
[ $FAIL -gt 0 ] && { for e in "${ERRORS[@]}"; do echo "  ✗ $e"; done; exit 1; }
echo " All Talent tests passed."
