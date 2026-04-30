# Monthly Restore Drill Procedure (BC 185)

Run this drill monthly. **First run: 2026-04-30 — PASSED (BC 185 gate satisfied).**

## Prerequisites
- Access to yesterday's pg_dump backup
- A scratch PostgreSQL instance (separate from production)
- `psql` and `prisma` CLI available

## Steps

### 1. Identify yesterday's backup
```bash
ls -lt backup/ | head -5
# Note the most recent backup file: gradium_v3_YYYYMMDD_HHMMSS.sql
```

### 2. Create scratch database
```bash
createdb gradium_v3_drill
```

### 3. Restore backup to scratch
```bash
psql gradium_v3_drill < backup/gradium_v3_<timestamp>.sql
```

### 4. Verify row counts (within 0.1% of source)
Run the verification script:
```bash
node scripts/verify-restore.js --source $DATABASE_URL --target postgresql://localhost/gradium_v3_drill
```

The script queries row counts for all major tables and asserts each is within 0.1% (ceiling 1 row) of the source:
- User, Learner, Institution, Employer, EmployerRole
- AssessmentAttemptV2, CompetencyScore, GradiumSignal
- Application, Notification, AuditLog, ConsentRecord

### 5. Smoke-test the restored DB
```bash
DATABASE_URL=postgresql://localhost/gradium_v3_drill npm run test:integration
```
Expected: same pass/skip count as production.

### 6. Record results
Append to this file:

| Date | Source rows | Restored rows | Delta | Pass |
|---|---|---|---|---|
| 2026-04-30 | 2,595 | 2,595 | 0.00% | ✅ PASS |

### 7. Teardown
```bash
dropdb gradium_v3_drill
```

## Automation note
For Phase E pilot, this drill is manual. Post-pilot: automate via a monthly cron + Slack alert.
