#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# GradiumOS v2 — Campus Portal E2E Smoke Test (via API)
# Tests every backend endpoint the Campus portal calls.
#
# Usage:
#   bash tests/smoke_campus.sh
#   BACKEND=http://localhost:4002 bash tests/smoke_campus.sh
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
auth_get()  { curl -s "$BACKEND$2" -H "Authorization: Bearer $1"; }
auth_post() { curl -s -X POST "$BACKEND$3" -H "Authorization: Bearer $1" -H "Content-Type: application/json" -d "$2"; }

echo ""
echo "════════════════════════════════════════════"
echo " Campus Portal Smoke Test"
echo " Target: $BACKEND"
echo "════════════════════════════════════════════"
echo ""

# Login
echo "AUTH"
T=$(get_token "krishnamurthy@srm.edu" "DemoPass123!")
[ -n "$T" ] && pass "login dean" || fail "login dean — no token"

# Dashboard endpoints
echo ""
echo "DASHBOARD"
check_no_error "GET /api/campus/overview/kpis" "$(auth_get "$T" "/api/campus/overview/kpis")"
check_no_error "GET /api/campus/insight/cohort-gaps" "$(auth_get "$T" "/api/campus/insight/cohort-gaps")"

# Career tracks
echo ""
echo "CAREER TRACKS"
TRACKS=$(auth_get "$T" "/api/campus/career-tracks")
check_no_error "GET /api/campus/career-tracks" "$TRACKS"
check_field "tracks is array" "$TRACKS" "['data'].__class__.__name__" "^list$"

# Get first career track ID for subsequent tests
TRACK_ID=$(echo "$TRACKS" | python -c "import sys,json; d=json.load(sys.stdin); print(d['data'][0]['id'] if d.get('data') else '')" 2>/dev/null || echo "")

# Learners
echo ""
echo "LEARNERS"
LRNS=$(auth_get "$T" "/api/campus/learners")
check_no_error "GET /api/campus/learners" "$LRNS"
check_field "learner list" "$LRNS" "['data'].__class__.__name__" "^list$"
LRN_COUNT=$(echo "$LRNS" | python -c "import sys,json; d=json.load(sys.stdin); print(len(d['data']))" 2>/dev/null || echo "0")
[ "${LRN_COUNT:-0}" -ge 1 ] && pass "learner count >= 1 (=$LRN_COUNT)" || fail "learner count should be >= 1 got $LRN_COUNT"

# Invite code — from /campus/me/institution (not /auth/me)
echo ""
echo "INVITE CODE"
INST=$(auth_get "$T" "/api/campus/me/institution")
check_field "institution.inviteCode present" "$INST" "['data']['inviteCode']" "."

# Gap report — requires a careerTrackId
echo ""
echo "GAP REPORT"
if [ -n "$TRACK_ID" ]; then
  GAP=$(auth_get "$T" "/api/campus/career-tracks/$TRACK_ID/gap-report")
  check_no_error "GET /api/campus/career-tracks/:id/gap-report" "$GAP"
else
  fail "gap-report: no career track found"
fi

# Market Intel
echo ""
echo "MARKET INTEL"
MKT=$(auth_get "$T" "/api/campus/me/market-intel")
check_no_error "GET /api/campus/me/market-intel" "$MKT"

# Signup — institution (use a unique email each run)
echo ""
echo "SIGNUP FLOW"
TS=$(date +%s)
SUP=$(curl -s -X POST "$BACKEND/api/auth/signup/institution" \
  -H "Content-Type: application/json" \
  -d "{\"institutionName\":\"Test Uni $TS\",\"email\":\"dean$TS@testuni.edu\",\"password\":\"TestPass123!\",\"name\":\"Test Dean\"}")
check_field "signup institution — role=DEAN" "$SUP" "['data']['user']['role']" "^DEAN$"
check_field "signup institution — inviteCode present" "$SUP" "['data']['inviteCode']" "."
INST_INVITE=$(echo "$SUP" | python -c "import sys,json; d=json.load(sys.stdin); print(d['data']['inviteCode'])")
echo "    → invite code: $INST_INVITE"

# Attempt duplicate signup (should fail)
DUP=$(curl -s -X POST "$BACKEND/api/auth/signup/institution" \
  -H "Content-Type: application/json" \
  -d "{\"institutionName\":\"Dup Uni\",\"email\":\"dean$TS@testuni.edu\",\"password\":\"TestPass123!\",\"name\":\"Dup Dean\"}")
DUP_CODE=$(echo "$DUP" | python -c "import sys,json; d=json.load(sys.stdin); print(d.get('error',{}).get('code','none') if d.get('error') else 'none')" 2>/dev/null)
if [ "$DUP_CODE" != "none" ]; then pass "duplicate email rejected (code=$DUP_CODE)"; else fail "duplicate email should be rejected"; fi

echo ""
echo "════════════════════════════════════════════"
echo " Results: $PASS passed, $FAIL failed"
echo "════════════════════════════════════════════"
[ $FAIL -gt 0 ] && { for e in "${ERRORS[@]}"; do echo "  ✗ $e"; done; exit 1; }
echo " All Campus tests passed."
