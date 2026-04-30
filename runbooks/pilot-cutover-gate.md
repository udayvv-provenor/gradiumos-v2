# Pilot Cutover Gate Checklist (BC 180)

All items must be green before cutover.

## Hard requirements
- [ ] `closed-loop-end-to-end.spec.ts` passed with real GROQ_API_KEY for 7 consecutive days
- [ ] Restore drill completed (see restore-drill.md) — row counts within 0.1%
- [ ] axe-core scan on consent + onboarding: zero AA violations
- [ ] TypeScript: 0 errors across all packages
- [ ] Unit tests: ≥ 92 passing (current: 98)
- [ ] Load test: p95 < 2s, < 1% error rate at 100 VUs

## Carry-forward confirmation
- [x] BC 16 — AuditLog null rules (Phase A) ✅ closed Phase D
- [x] BC 17 — Admin audit-log viewer (Phase A) ✅ closed Phase D
- [x] BC 24 — Public data refresh (Phase A) ✅ closed Phase D
- [x] BC 56 — JD revert endpoint (Phase B) ✅ closed Phase D
- [x] BC 61 — Curriculum revert endpoint (Phase B) ✅ closed Phase D
- [x] BC 114 — talent-loop E2E spec (Phase C) ✅ closed Phase D

## Sign-off
| Role | Name | Date | Signature |
|---|---|---|---|
| CTO | Maya | | |
| MD/CEO | Uday | | |
