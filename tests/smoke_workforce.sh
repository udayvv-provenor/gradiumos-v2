#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# GradiumOS v2 — Workforce Portal E2E Smoke Test (via API)
#
# Usage:
#   bash tests/smoke_workforce.sh
#   BACKEND=http://localhost:4002 bash tests/smoke_workforce.sh
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
auth_patch(){ curl -s -X PATCH "$BACKEND$3" -H "Authorization: Bearer $1" -H "Content-Type: application/json" -d "$2"; }

echo ""
echo "════════════════════════════════════════════"
echo " Workforce Portal Smoke Test"
echo " Target: $BACKEND"
echo "════════════════════════════════════════════"
echo ""

# Auth
echo "AUTH"
T=$(get_token "sarita.rajan@freshworks.com" "DemoPass123!")
[ -n "$T" ] && pass "login TA_LEAD" || fail "login TA_LEAD — no token"

# Dashboard KPIs
echo ""
echo "DASHBOARD"
check_no_error "GET /api/workforce/overview/kpis" "$(auth_get "$T" "/api/workforce/overview/kpis")"

# Roles list
echo ""
echo "ROLES"
ROLES=$(auth_get "$T" "/api/workforce/roles")
check_no_error "GET /api/workforce/roles" "$ROLES"
check_field "roles is array" "$ROLES" "['data'].__class__.__name__" "^list$"

# Get first role ID for subsequent tests
ROLE_ID=$(echo "$ROLES" | python -c "import sys,json; d=json.load(sys.stdin); print(d['data'][0]['id'] if d.get('data') else '')" 2>/dev/null || echo "")

# Create a role via v1 endpoint (requires careerTrackCode, not careerTrackId)
echo ""
echo "ROLE CREATION FLOW"
TS=$(date +%s)
# Get career track code first
CT_CODE=$(curl -s "$BACKEND/api/workforce/career-tracks" -H "Authorization: Bearer $T" | python -c "import sys,json; d=json.load(sys.stdin); print(d['data'][0]['code'] if d.get('data') else '')" 2>/dev/null || echo "")
if [ -n "$CT_CODE" ]; then
  CR=$(auth_post "$T" "{\"title\":\"Senior SWE $TS\",\"careerTrackCode\":\"$CT_CODE\",\"seatsPlanned\":3}" "/api/v1/workforce/roles")
  check_field "create role — title present" "$CR" "['data']['title']" "Senior SWE"
  NEW_ROLE_ID=$(echo "$CR" | python -c "import sys,json; d=json.load(sys.stdin); print(d['data']['id'] if d.get('data') else '')" 2>/dev/null || echo "")
  if [ -n "$NEW_ROLE_ID" ] && [ "$NEW_ROLE_ID" != "None" ]; then
    # Use newly created role for subsequent tests
    ROLE_ID="$NEW_ROLE_ID"
    pass "create role — ID obtained ($ROLE_ID)"

    # Note: JD upload (POST /api/v1/workforce/roles/:id/jd) requires KYC verification.
    # The demo user is not KYC verified so we skip that step and test with the existing role's data.
  else
    fail "create role — could not get ID"
  fi
else
  fail "no career track found to create role"
fi

# Role detail
echo ""
echo "ROLE DETAIL"
if [ -n "$ROLE_ID" ] && [ "$ROLE_ID" != "None" ]; then
  RD=$(auth_get "$T" "/api/workforce/roles/$ROLE_ID")
  check_no_error "GET /api/workforce/roles/:id" "$RD"

  # Pipeline for this role
  PP=$(auth_get "$T" "/api/v1/workforce/roles/$ROLE_ID/pipeline")
  check_no_error "GET /api/v1/workforce/roles/:id/pipeline" "$PP"

  # Calibrate for this role
  CAL=$(auth_get "$T" "/api/v1/workforce/roles/$ROLE_ID/calibrate")
  check_no_error "GET /api/v1/workforce/roles/:id/calibrate" "$CAL"
else
  fail "role detail: no role ID"
fi

# Talent discovery
echo ""
echo "TALENT DISCOVERY"
check_no_error "GET /api/workforce/talent-discovery" "$(auth_get "$T" "/api/workforce/talent-discovery")"

# Market Intel
echo ""
echo "MARKET INTEL"
check_no_error "GET /api/workforce/me/market-intel" "$(auth_get "$T" "/api/workforce/me/market-intel")"

# Signup — employer (unique run)
echo ""
echo "EMPLOYER SIGNUP"
SUP=$(curl -s -X POST "$BACKEND/api/auth/signup/employer" \
  -H "Content-Type: application/json" \
  -d "{\"employerName\":\"Test Corp $TS\",\"email\":\"ta$TS@testcorp.com\",\"password\":\"TestPass123!\",\"name\":\"Test TA\"}")
check_field "signup employer — role=TA_LEAD" "$SUP" "['data']['user']['role']" "^TA_LEAD$"

echo ""
echo "════════════════════════════════════════════"
echo " Results: $PASS passed, $FAIL failed"
echo "════════════════════════════════════════════"
[ $FAIL -gt 0 ] && { for e in "${ERRORS[@]}"; do echo "  ✗ $e"; done; exit 1; }
echo " All Workforce tests passed."
