#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# GradiumOS v2 — Master Test Runner
# Runs all three portal smoke tests sequentially and reports overall pass/fail.
#
# Usage:
#   bash tests/run_all.sh
#   BACKEND=http://localhost:4002 bash tests/run_all.sh
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND="${BACKEND:-https://gradiumos-v2-backend-production.up.railway.app}"

export BACKEND

echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║  GradiumOS v2 — Full Ecosystem Test Suite    ║"
echo "╠══════════════════════════════════════════════╣"
echo "║  Backend: $BACKEND"
echo "╚══════════════════════════════════════════════╝"

TOTAL_FAIL=0

run_suite() {
  local name="$1" script="$2"
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo " Running: $name"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  if bash "$SCRIPT_DIR/$script"; then
    echo "  → $name: PASSED ✓"
  else
    echo "  → $name: FAILED ✗"
    TOTAL_FAIL=$((TOTAL_FAIL+1))
  fi
}

run_suite "Backend Core"         "smoke_backend.sh"
run_suite "Campus Portal"        "smoke_campus.sh"
run_suite "Workforce Portal"     "smoke_workforce.sh"
run_suite "Talent Portal"        "smoke_talent.sh"

echo ""
echo "╔══════════════════════════════════════════════╗"
if [ $TOTAL_FAIL -eq 0 ]; then
  echo "║  ALL SUITES PASSED ✓                         ║"
else
  echo "║  $TOTAL_FAIL SUITE(S) FAILED ✗                        ║"
fi
echo "╚══════════════════════════════════════════════╝"
echo ""

exit $TOTAL_FAIL
