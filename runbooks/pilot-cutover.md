# Pilot Cutover Runbook (BC 178)

Complete each section in order. Do not proceed past a section if any item is incomplete.

---

## Pre-flight checklist

- [ ] `.env` parity with `.env.example` confirmed — every non-optional var is set
- [ ] `GROQ_API_KEY` set and tested — run `npm run test:e2e` and confirm green
- [ ] `SIGNAL_PRIVATE_KEY_HEX` + `SIGNAL_PUBLIC_KEY_HEX` set; confirm `backend/.well-known/published-keys.json` (or equivalent) matches the public key
- [ ] `RESEND_API_KEY` set; send a test email via `node scripts/send-test-email.js` and confirm delivery
- [ ] `DATABASE_URL` points to production DB; `gradium_v3` schema exists and is accessible
- [ ] SSL certificate installed and serving on port 443
- [ ] Backup completed (see DB Backup section below) and stored off-server before proceeding

---

## DB backup (before any migration)

Run immediately before touching the schema. Store the file off-server (S3 or equivalent) before proceeding.

```bash
mkdir -p backup
pg_dump $DATABASE_URL > backup/gradium_v3_$(date +%Y%m%d_%H%M%S).sql
```

Verify the file is non-empty:

```bash
ls -lh backup/gradium_v3_*.sql | tail -1
```

Upload to off-server storage (example — S3):

```bash
aws s3 cp backup/gradium_v3_<timestamp>.sql s3://<your-bucket>/gradium/backups/
```

---

## Schema migration

```bash
cd backend
npx prisma migrate deploy   # applies all pending migrations in order
```

Only run the seed if this is a fresh installation with no existing data:

```bash
npx prisma db seed           # skip if data already exists in production
```

---

## Seed public data

These scripts are idempotent (upsert-safe) and can be run on existing databases.

```bash
npx tsx scripts/seed-public-data.ts
npx tsx scripts/seed-career-tracks.ts
```

---

## Smoke test

### Health check

```bash
curl https://<your-domain>/api/v1/health
# Expected: {"status":"ok","version":"1.0.0","commit":"<sha>"}
```

### Manual marquee flow (target: complete within 5 minutes)

1. Institution login — confirm JWT is returned and dashboard loads
2. JD upload — upload a sample JD PDF; confirm AI extraction completes (or mock response if `GROQ_API_KEY` absent)
3. Learner signup — create a new learner with invite code; confirm welcome email is received
4. Assessment — complete a single-cluster assessment; confirm score is recorded
5. Apply — submit an application for an active role; confirm `Application` row created

---

## Rollback procedure

Execute in order if the cutover must be reversed.

```bash
# 1. Stop the backend
pm2 stop gradiumos-backend   # or equivalent process manager

# 2. Restore DB from backup taken in the DB Backup section above
psql $DATABASE_URL < backup/gradium_v3_<timestamp>.sql

# 3. Checkout the previous release tag
git checkout <previous-tag>

# 4. Rebuild
npm install && npm run build

# 5. Restart
pm2 start gradiumos-backend
```

Verify health after restart:

```bash
curl https://<your-domain>/api/v1/health
```

---

## DNS

| Record | Value | TTL |
|---|---|---|
| `api.gradiumos.ai` | backend server IP | 300s during cutover; raise to 3600s after stabilisation |
| `gradiumos.ai` | frontend static assets or reverse proxy | 300s during cutover; raise to 3600s after stabilisation |

Set TTL to 300s (5 min) before cutover. After 30 minutes of stable operation, raise to 3600s.

---

## Sign-off

Pilot is officially live once the following flag is set with SUPER_ADMIN credentials:

```bash
curl -X POST https://<your-domain>/api/v1/admin/feature-flags/PILOT_LIVE \
  -H "Authorization: Bearer <super-admin-token>" \
  -H "Content-Type: application/json" \
  -d '{"enabled": true}'
```

This is the canonical "pilot is live" signal. Record the timestamp from the response.

**Reviewed by:** Maya (CTO), Uday (MD/CEO)
**Date:** _____________
**Sign-off timestamp:** _____________
