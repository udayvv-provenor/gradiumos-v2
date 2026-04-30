/**
 * Admin endpoints — BC 17, BC 23, BC 28, BC 149-152, BC 164, BC 174-176, BC 181-184.
 *
 * Mounted under /api/v1/admin (after requireAuth in app.ts).
 *
 * BC 17  — GET  /audit-log
 *   Requires SUPER_ADMIN role (not in the Role enum; checked via string comparison).
 *   Query: entityType?, entityId?, userId?, page? (default 1), limit? (default 50, max 200)
 *   Returns paginated AuditLog entries with isRestorable flag on each entry.
 *
 * BC 23  — POST /public-data/refresh
 *   Programmatically invokes the cold-start seeder (runPublicDataSeed).
 *   Returns { seeded: { demandSignals, institutions } }.
 *
 * BC 28  — PATCH /kyc/:type/:id
 *   Updates kycStatus on Institution or Employer and writes an AuditLog entry.
 *   Body: { status: 'Verified' | 'Rejected', notes?: string }
 *   Returns the updated entity.
 *
 * BC 150 — GET  /disputes                 — DPDP dispute SLA dashboard
 * BC 150 — PATCH /disputes/:id/acknowledge — set acknowledgedAt (72h SLA clock)
 * BC 152 — PATCH /disputes/:id/resolve     — resolve dispute + email learner
 *
 * BC 164 — POST /demand-signals/recompute  — recompute MarketDemandSignal from accepted apps
 *
 * BC 174 — POST /restore/:entityType/:id/:version — restore entity to a prior AuditLog snapshot
 * BC 175 — AuditLog for restore (satisfied by BC 174 step 9)
 * BC 176 — isRestorable field on /audit-log entries (satisfied in BC 17 handler below)
 *
 * BC 181 — PATCH /attempts/:id/flag       — flag/unflag AssessmentAttemptV2 as suspicious
 * BC 182 — POST  /users/:id/revoke-sessions — revoke all refresh tokens for a user
 * BC 183 — GET   /institutions/:id/export  — DPDP-compliant Ed25519-signed institution export
 * BC 184 — PATCH /feature-flags/:name      — enable/disable a feature flag without redeploy
 */
import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { Prisma } from '@prisma/client';
import type { RoleStatus } from '@prisma/client';
import { ok, fail } from '../utils/response.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { prisma } from '../config/db.js';
import { withAudit, auditCreate } from '../middleware/audit.js';
import { runPublicDataSeed } from '../services/publicData/publicDataSeedService.js';
import { logger } from '../config/logger.js';
import { signCustomPayload, publicKeyKid } from '../services/signal/tokenSigner.js';
import { recomputeCompetencyScore } from '../services/talent/assessmentService.js';

/** Converts a plain object or null to a Prisma-acceptable JsonValue for Json? columns. */
function toJsonValue(value: object | null | undefined): Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput {
  if (value == null) return Prisma.DbNull;
  return value as Prisma.InputJsonValue;
}

const router = Router();

// ─── SUPER_ADMIN guard ────────────────────────────────────────────────────────

/**
 * requireSuperAdmin: checks req.auth.role === 'SUPER_ADMIN'.
 * SUPER_ADMIN is not in the Role Prisma enum (campus/workforce roles are different),
 * so we do a string comparison here rather than using requireRole().
 */
function requireSuperAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!req.auth) {
    fail(res, 401, 'AUTH_INVALID', 'Not authenticated');
    return;
  }
  if ((req.auth.role as string) !== 'SUPER_ADMIN') {
    fail(res, 403, 'AUTH_FORBIDDEN', 'SUPER_ADMIN role required');
    return;
  }
  next();
}

// ─── BC 17 — AuditLog viewer ─────────────────────────────────────────────────

router.get(
  '/audit-log',
  requireSuperAdmin,
  asyncHandler(async (req, res) => {
    const {
      entityType,
      entityId,
      userId,
      page: pageStr = '1',
      limit: limitStr = '50',
    } = req.query as Record<string, string | undefined>;

    const page  = Math.max(1, parseInt(pageStr  ?? '1',  10) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(limitStr ?? '50', 10) || 50));
    const skip  = (page - 1) * limit;

    const where = {
      ...(entityType ? { entityType } : {}),
      ...(entityId   ? { entityId }   : {}),
      ...(userId     ? { userId }     : {}),
    };

    const RESTORABLE_ENTITY_TYPES = new Set(['EmployerRole', 'Curriculum', 'CompetencyScore']);

    const [total, entries] = await Promise.all([
      prisma.auditLog.count({ where }),
      prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
    ]);

    // BC 176 — isRestorable: true when this entry can be passed to the BC 174 restore endpoint.
    const enriched = entries.map((entry) => {
      let isRestorable = false;
      if (
        RESTORABLE_ENTITY_TYPES.has(entry.entityType) &&
        entry.after != null
      ) {
        const after = entry.after as Record<string, unknown>;
        isRestorable = typeof after['version'] === 'number';
      }
      return { ...entry, isRestorable };
    });

    ok(res, {
      entries: enriched,
      pagination: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit),
      },
    });
  }),
);

// ─── BC 23 — Public-data refresh ─────────────────────────────────────────────

/**
 * POST /api/v1/admin/public-data/refresh
 *
 * Programmatically runs the cold-start public data seeder:
 *   - Upserts MarketDemandSignal rows from demand-signal.json
 *   - Updates NIRF/NAAC/AISHE fields on matching institutions
 *
 * Returns { seeded: { demandSignals: number, institutions: number } }.
 */
router.post(
  '/public-data/refresh',
  requireSuperAdmin,
  asyncHandler(async (_req, res) => {
    const result = await runPublicDataSeed();
    ok(res, { seeded: result });
  }),
);

// ─── BC 28 — KYC status management ───────────────────────────────────────────

/**
 * PATCH /api/v1/admin/kyc/:type/:id
 *
 * Updates the kycStatus of an Institution or Employer and writes an AuditLog entry.
 *
 * :type — 'institution' | 'employer'
 * Body  — { status: 'Verified' | 'Rejected', notes?: string }
 *
 * Returns the updated entity.
 */
router.patch(
  '/kyc/:type/:id',
  requireSuperAdmin,
  asyncHandler(async (req: Request, res: Response) => {
    const { type, id } = req.params as { type: string; id: string };
    const { status, notes } = req.body as { status?: string; notes?: string };

    if (type !== 'institution' && type !== 'employer') {
      fail(res, 400, 'VALIDATION', 'type must be "institution" or "employer"');
      return;
    }
    if (status !== 'Verified' && status !== 'Rejected') {
      fail(res, 400, 'VALIDATION', 'status must be "Verified" or "Rejected"');
      return;
    }

    const adminUserId: string | undefined = req.auth?.sub;

    if (type === 'institution') {
      const existing = await prisma.institution.findUnique({ where: { id } });
      if (!existing) { fail(res, 404, 'NOT_FOUND', 'Institution not found'); return; }

      const updated = await withAudit({
        userId:     adminUserId,
        action:     'kyc_status_updated',
        entityType: 'institution',
        entityId:   id,
        before:     { kycStatus: existing.kycStatus },
        fn: () => prisma.institution.update({
          where: { id },
          data:  { kycStatus: status },
        }),
      });
      // notes are captured in the AuditLog before/after if needed in future;
      // for now surface them in the response so callers can confirm receipt.
      ok(res, { ...updated, _notes: notes ?? null });
      return;
    }

    // type === 'employer'
    const existing = await prisma.employer.findUnique({ where: { id } });
    if (!existing) { fail(res, 404, 'NOT_FOUND', 'Employer not found'); return; }

    const updated = await withAudit({
      userId:     adminUserId,
      action:     'kyc_status_updated',
      entityType: 'employer',
      entityId:   id,
      before:     { kycStatus: existing.kycStatus },
      fn: () => prisma.employer.update({
        where: { id },
        data:  { kycStatus: status },
      }),
    });
    ok(res, { ...updated, _notes: notes ?? null });
  }),
);

// ─── BC 150 — DPDP dispute SLA dashboard ─────────────────────────────────────

/**
 * GET /api/v1/admin/disputes
 *
 * Returns all DisputeRecord rows with slaBreached flag.
 * slaBreached = acknowledgedAt is null AND createdAt was > 72h ago.
 */
router.get(
  '/disputes',
  requireSuperAdmin,
  asyncHandler(async (_req, res) => {
    const disputes = await prisma.disputeRecord.findMany({
      orderBy: { createdAt: 'desc' },
    });

    const now = Date.now();
    const SLA_MS = 72 * 60 * 60 * 1000; // 72 hours

    ok(res, {
      disputes: disputes.map((d) => ({
        id: d.id,
        userId: d.userId,
        status: d.status,
        createdAt: d.createdAt.toISOString(),
        acknowledgedAt: d.acknowledgedAt?.toISOString() ?? null,
        resolvedAt: d.resolvedAt?.toISOString() ?? null,
        slaBreached: d.acknowledgedAt === null && now - d.createdAt.getTime() > SLA_MS,
      })),
    });
  }),
);

// ─── BC 150 — Acknowledge dispute ────────────────────────────────────────────

/**
 * PATCH /api/v1/admin/disputes/:id/acknowledge
 *
 * Sets acknowledgedAt = now() — starts the 72h resolution SLA clock.
 */
router.patch(
  '/disputes/:id/acknowledge',
  requireSuperAdmin,
  asyncHandler(async (req, res) => {
    const { id } = req.params as { id: string };

    const dispute = await prisma.disputeRecord.findUnique({ where: { id } });
    if (!dispute) { fail(res, 404, 'NOT_FOUND', 'Dispute not found'); return; }

    const acknowledgedAt = new Date();
    const updated = await prisma.disputeRecord.update({
      where: { id },
      data: { acknowledgedAt, status: 'UnderReview' },
    });

    ok(res, { id: updated.id, acknowledgedAt: updated.acknowledgedAt!.toISOString() });
  }),
);

// ─── BC 152 — Resolve dispute ─────────────────────────────────────────────────

/**
 * PATCH /api/v1/admin/disputes/:id/resolve
 *
 * Sets resolvedAt, resolution, status = 'Resolved'.
 * Sends Resend email to the learner with the resolution text.
 */
router.patch(
  '/disputes/:id/resolve',
  requireSuperAdmin,
  asyncHandler(async (req, res) => {
    const { id } = req.params as { id: string };
    const body = req.body as { resolution?: string };

    if (!body.resolution || typeof body.resolution !== 'string' || body.resolution.trim() === '') {
      fail(res, 400, 'VALIDATION', '`resolution` is required'); return;
    }

    const dispute = await prisma.disputeRecord.findUnique({ where: { id } });
    if (!dispute) { fail(res, 404, 'NOT_FOUND', 'Dispute not found'); return; }
    if (dispute.status === 'Resolved') {
      fail(res, 409, 'CONFLICT', 'Dispute is already resolved'); return;
    }

    const resolvedAt = new Date();
    const updated = await prisma.disputeRecord.update({
      where: { id },
      data: { resolvedAt, resolution: body.resolution.trim(), status: 'Resolved' },
    });

    // Fetch user email for notification
    const user = await prisma.user.findUnique({ where: { id: dispute.userId } });
    if (user?.email) {
      try {
        const { env } = await import('../config/env.js');
        if (env.RESEND_API_KEY) {
          const { Resend } = await import('resend');
          const resend = new Resend(env.RESEND_API_KEY);
          await resend.emails.send({
            from: 'GradiumOS <noreply@gradiumos.ai>',
            to: user.email,
            subject: 'Your dispute has been resolved',
            text: `Hi ${user.name},\n\nYour data dispute has been resolved.\n\nResolution:\n${body.resolution.trim()}\n\nIf you have further concerns, you may submit a new dispute via your account settings.\n\nGradiumOS Data Team`,
          });
        }
      } catch (err) {
        logger.warn({ err, disputeId: id }, 'dispute resolve email failed — non-fatal');
      }
    }

    ok(res, {
      id: updated.id,
      resolvedAt: updated.resolvedAt!.toISOString(),
      resolution: updated.resolution,
    });
  }),
);

// ─── BC 164 — Recompute MarketDemandSignal ────────────────────────────────────

/**
 * POST /api/v1/admin/demand-signals/recompute
 *
 * Re-aggregates MarketDemandSignal from all accepted Application history.
 * Groups by role's (careerTrackId, archetype, city).
 * k-anonymity: slices with < 5 accepted applications → source stays 'cold-start-public'.
 * Returns { recomputed: N, skipped: N }.
 */
router.post(
  '/demand-signals/recompute',
  requireSuperAdmin,
  asyncHandler(async (_req, res) => {
    // Fetch all accepted applications with their role details
    const acceptedApps = await prisma.application.findMany({
      where: { status: 'Accepted' },
    });

    if (acceptedApps.length === 0) {
      ok(res, { recomputed: 0, skipped: 0 });
      return;
    }

    // Batch-fetch roles for all application roleIds
    const roleIds = Array.from(new Set(acceptedApps.map((a) => a.roleId)));
    const roles = await prisma.employerRole.findMany({
      where: { id: { in: roleIds } },
      select: {
        id: true,
        careerTrackId: true,
        jdExtraction: true,
        clusterTargets: true,
      },
    });
    const roleMap = new Map(roles.map((r) => [r.id, r]));

    // Group accepted applications by (careerTrackId, archetype, city)
    type GroupKey = string;
    const groups = new Map<GroupKey, { careerTrackId: string; archetype: string | null; city: string | null; count: number; targetsSum: Record<string, number> }>();

    for (const app of acceptedApps) {
      const role = roleMap.get(app.roleId);
      if (!role) continue;

      const jdEx = role.jdExtraction as Record<string, unknown> | null;
      const archetype = (jdEx?.archetype as string | null) ?? null;
      const city = (jdEx?.city as string | null) ?? null;
      const key: GroupKey = `${role.careerTrackId}::${archetype ?? ''}::${city ?? ''}`;

      if (!groups.has(key)) {
        groups.set(key, { careerTrackId: role.careerTrackId, archetype, city, count: 0, targetsSum: {} });
      }

      const grp = groups.get(key)!;
      grp.count++;

      // Accumulate cluster targets
      const targets = (role.clusterTargets ?? {}) as Record<string, number>;
      for (const [code, val] of Object.entries(targets)) {
        grp.targetsSum[code] = (grp.targetsSum[code] ?? 0) + (typeof val === 'number' ? val : 0);
      }
    }

    // For p50ClusterTargets, average from HiringBarProfile for this archetype/careerTrack
    const CLUSTER_CODES = ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8'];

    let recomputed = 0;
    let skipped = 0;

    for (const [, grp] of groups) {
      if (grp.count < 5) {
        skipped++;
        continue;
      }

      // Average p50ClusterTargets from HiringBarProfile
      const hiringProfiles = await prisma.hiringBarProfile.findMany({
        where: {
          careerTrackId: grp.careerTrackId,
          ...(grp.archetype ? { archetype: grp.archetype } : {}),
        },
        select: { clusterTargets: true },
      });

      let p50ClusterTargets: Record<string, number>;
      if (hiringProfiles.length > 0) {
        const sums: Record<string, number> = {};
        for (const c of CLUSTER_CODES) sums[c] = 0;
        for (const hp of hiringProfiles) {
          const t = hp.clusterTargets as Record<string, number>;
          for (const c of CLUSTER_CODES) {
            sums[c] += typeof t[c] === 'number' ? t[c] : 0;
          }
        }
        p50ClusterTargets = {} as Record<string, number>;
        for (const c of CLUSTER_CODES) {
          p50ClusterTargets[c] = Math.round(sums[c] / hiringProfiles.length);
        }
      } else {
        // Fall back to averaging from accumulated targets
        p50ClusterTargets = {} as Record<string, number>;
        for (const c of CLUSTER_CODES) {
          p50ClusterTargets[c] = grp.count > 0 ? Math.round((grp.targetsSum[c] ?? 0) / grp.count) : 60;
        }
      }

      // Upsert MarketDemandSignal
      // We do a find-first + create/update because MarketDemandSignal has no unique constraint
      // on (careerTrackId, archetype, city). Use updateMany for matching rows, else create.
      const existing = await prisma.marketDemandSignal.findFirst({
        where: {
          careerTrackId: grp.careerTrackId,
          archetype: grp.archetype,
          city: grp.city,
          source: 'live-aggregate',
        },
      });

      if (existing) {
        await prisma.marketDemandSignal.update({
          where: { id: existing.id },
          data: {
            jobPostingVolume: grp.count,
            p50ClusterTargets,
            capturedAt: new Date(),
          },
        });
      } else {
        await prisma.marketDemandSignal.create({
          data: {
            careerTrackId: grp.careerTrackId,
            archetype: grp.archetype,
            city: grp.city,
            jobPostingVolume: grp.count,
            p50ClusterTargets,
            source: 'live-aggregate',
          },
        });
      }

      recomputed++;
    }

    ok(res, { recomputed, skipped });
  }),
);

// ─── BC 174 — Restore entity to a prior AuditLog snapshot ────────────────────

/**
 * POST /api/v1/admin/restore/:entityType/:id/:version
 *
 * Restores an entity to the state captured in a prior AuditLog 'after' snapshot.
 * Supported entityTypes: EmployerRole, Curriculum, CompetencyScore.
 *
 * BC 175 — The AuditLog write in step 9 satisfies the "restore audit" requirement.
 */
router.post(
  '/restore/:entityType/:id/:version',
  requireSuperAdmin,
  asyncHandler(async (req: Request, res: Response) => {
    const { entityType, id, version: versionStr } = req.params as {
      entityType: string;
      id: string;
      version: string;
    };
    const targetVersion = parseInt(versionStr, 10);

    if (isNaN(targetVersion)) {
      fail(res, 400, 'VALIDATION', 'version must be a number');
      return;
    }

    const SUPPORTED = new Set(['EmployerRole', 'Curriculum', 'CompetencyScore']);
    if (!SUPPORTED.has(entityType)) {
      fail(res, 400, 'VALIDATION', 'Restore not supported for this entity type');
      return;
    }

    // 1–2. Fetch all audit log entries for this entity, then filter in-memory for non-null after
    const logs = await prisma.auditLog.findMany({
      where: { entityType, entityId: id },
      orderBy: { createdAt: 'desc' },
    });

    const matchingLog = logs.find((log) => {
      if (log.after == null) return false;
      const after = log.after as Record<string, unknown>;
      return after['version'] === targetVersion;
    });

    if (!matchingLog) {
      fail(res, 404, 'NOT_FOUND', `No AuditLog snapshot found for ${entityType} ${id} at version ${targetVersion}`);
      return;
    }

    const restoredSnapshot = matchingLog.after as Record<string, unknown>;

    // 3–8. Fetch current row, restore, capture before/after
    const adminUserId: string | undefined = req.auth?.sub;

    if (entityType === 'EmployerRole') {
      const current = await prisma.employerRole.findUnique({ where: { id } });
      if (!current) { fail(res, 404, 'NOT_FOUND', 'EmployerRole not found'); return; }

      const beforeSnapshot = {
        jdText: current.jdText,
        clusterTargets: current.clusterTargets,
        archetype: (current.jdExtraction as Record<string, unknown> | null)?.['archetype'] ?? null,
        seniority: (current.jdExtraction as Record<string, unknown> | null)?.['seniority'] ?? null,
        status: current.status,
        version: current.version,
      };

      await prisma.employerRole.update({
        where: { id },
        data: {
          jdText: (restoredSnapshot['jdText'] as string | null | undefined) ?? current.jdText,
          clusterTargets: toJsonValue(restoredSnapshot['clusterTargets'] as object | null) as Prisma.InputJsonValue,
          status: ((restoredSnapshot['status'] as string | undefined) ?? current.status) as RoleStatus,
          version: { increment: 1 },
        },
      });

      // 9. Write AuditLog for the restore itself
      await prisma.auditLog.create({
        data: {
          userId: adminUserId ?? null,
          action: 'admin_restore',
          entityType,
          entityId: id,
          before: toJsonValue(beforeSnapshot),
          after: toJsonValue(restoredSnapshot),
          createdAt: new Date(),
        },
      });

      ok(res, {
        restored: true,
        entityType,
        entityId: id,
        version: targetVersion,
        diff: { before: beforeSnapshot, after: restoredSnapshot },
      });
      return;
    }

    if (entityType === 'Curriculum') {
      const current = await prisma.curriculum.findUnique({ where: { id } });
      if (!current) { fail(res, 404, 'NOT_FOUND', 'Curriculum not found'); return; }

      const beforeSnapshot = {
        clusterCoverage: current.clusterCoverage,
        subjects: current.subjects,
        rawText: current.rawText,
        version: current.version,
      };

      await prisma.curriculum.update({
        where: { id },
        data: {
          clusterCoverage: toJsonValue(restoredSnapshot['clusterCoverage'] as object | null) as Prisma.InputJsonValue,
          subjects: toJsonValue(restoredSnapshot['subjects'] as object | null) as Prisma.InputJsonValue,
          rawText: (restoredSnapshot['rawText'] as string | undefined) ?? current.rawText,
          version: { increment: 1 },
        },
      });

      await prisma.auditLog.create({
        data: {
          userId: adminUserId ?? null,
          action: 'admin_restore',
          entityType,
          entityId: id,
          before: toJsonValue(beforeSnapshot),
          after: toJsonValue(restoredSnapshot),
          createdAt: new Date(),
        },
      });

      ok(res, {
        restored: true,
        entityType,
        entityId: id,
        version: targetVersion,
        diff: { before: beforeSnapshot, after: restoredSnapshot },
      });
      return;
    }

    // entityType === 'CompetencyScore'
    const current = await prisma.competencyScore.findUnique({ where: { id } });
    if (!current) { fail(res, 404, 'NOT_FOUND', 'CompetencyScore not found'); return; }

    const beforeSnapshot = {
      scoreWeighted: current.scoreWeighted,
      confidence: current.confidence,
      version: current.version,
    };

    await prisma.competencyScore.update({
      where: { id },
      data: {
        scoreWeighted: restoredSnapshot['scoreWeighted'] as number ?? current.scoreWeighted,
        confidence: restoredSnapshot['confidence'] as number ?? current.confidence,
        version: { increment: 1 },
      },
    });

    await prisma.auditLog.create({
      data: {
        userId: adminUserId ?? null,
        action: 'admin_restore',
        entityType,
        entityId: id,
        before: toJsonValue(beforeSnapshot),
        after: toJsonValue(restoredSnapshot),
        createdAt: new Date(),
      },
    });

    ok(res, {
      restored: true,
      entityType,
      entityId: id,
      version: targetVersion,
      diff: { before: beforeSnapshot, after: restoredSnapshot },
    });
  }),
);

// ─── BC 181 — Flag / unflag an AssessmentAttemptV2 as suspicious ──────────────

/**
 * PATCH /api/v1/admin/attempts/:id/flag
 *
 * Body: { flag: boolean, reason?: string }
 *
 * When unflagging (flag=false), calls recomputeCompetencyScore automatically.
 * When flagging (flag=true), sets suspicious=true; admin must call recompute separately
 * (recompute already skips suspicious attempts, so the next natural recompute will
 * exclude this attempt — no immediate action needed).
 */
router.patch(
  '/attempts/:id/flag',
  requireSuperAdmin,
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params as { id: string };
    const { flag, reason } = req.body as { flag?: boolean; reason?: string };

    if (typeof flag !== 'boolean') {
      fail(res, 400, 'VALIDATION', 'flag must be a boolean');
      return;
    }

    const attempt = await prisma.assessmentAttemptV2.findUnique({ where: { id } });
    if (!attempt) { fail(res, 404, 'NOT_FOUND', 'AssessmentAttemptV2 not found'); return; }

    const before = {
      suspicious: attempt.suspicious,
      learnerId: attempt.learnerId,
      clusterCode: attempt.clusterCode,
    };

    await prisma.assessmentAttemptV2.update({
      where: { id },
      data: { suspicious: flag },
    });

    const adminUserId: string | undefined = req.auth?.sub;
    await prisma.auditLog.create({
      data: {
        userId: adminUserId ?? null,
        action: flag ? 'attempt_flagged' : 'attempt_unflagged',
        entityType: 'AssessmentAttemptV2',
        entityId: id,
        before: toJsonValue(before),
        after: toJsonValue({ suspicious: flag, reason: reason ?? null }),
        createdAt: new Date(),
      },
    });

    // When unflagging, immediately recompute competency score so the attempt
    // is re-included in the learner's score.
    if (!flag) {
      try {
        await recomputeCompetencyScore(attempt.learnerId, attempt.clusterCode);
      } catch (err) {
        logger.warn({ err, attemptId: id }, 'recomputeCompetencyScore after unflag failed — non-fatal');
      }
    }

    ok(res, {
      id,
      suspicious: flag,
      reason: reason ?? null,
      ...(flag ? { note: 'Call recomputeCompetencyScore for this learner/cluster to exclude this attempt.' } : {}),
    });
  }),
);

// ─── BC 182 — Revoke all refresh tokens for a user ───────────────────────────

/**
 * POST /api/v1/admin/users/:id/revoke-sessions
 *
 * Deletes all RefreshToken rows for the given userId, forcing logout on all devices.
 */
router.post(
  '/users/:id/revoke-sessions',
  requireSuperAdmin,
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params as { id: string };

    const user = await prisma.user.findUnique({ where: { id }, select: { id: true } });
    if (!user) { fail(res, 404, 'NOT_FOUND', 'User not found'); return; }

    await prisma.refreshToken.deleteMany({ where: { userId: id } });

    const adminUserId: string | undefined = req.auth?.sub;
    await prisma.auditLog.create({
      data: {
        userId: adminUserId ?? null,
        action: 'sessions_revoked',
        entityType: 'User',
        entityId: id,
        before: Prisma.DbNull,
        after: toJsonValue({ revokedAt: new Date().toISOString() }),
        createdAt: new Date(),
      },
    });

    ok(res, { userId: id, revokedAt: new Date().toISOString() });
  }),
);

// ─── BC 183 — Institution data export (DPDP-compliant, Ed25519 signed) ────────

/**
 * GET /api/v1/admin/institutions/:id/export
 *
 * Exports all institution learner data in DPDP-compliant format, signed with the
 * server's Ed25519 key. Enforces k-anonymity (min 5 learners).
 */
router.get(
  '/institutions/:id/export',
  requireSuperAdmin,
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params as { id: string };

    const institution = await prisma.institution.findUnique({ where: { id } });
    if (!institution) { fail(res, 404, 'NOT_FOUND', 'Institution not found'); return; }

    const learners = await prisma.learner.findMany({
      where: { institutionId: id },
      include: {
        user: { select: { name: true, email: true } },
        scores: true,
        signals: { where: { state: 'issued' } },
      },
    });

    // k-anonymity threshold
    if (learners.length < 5) {
      fail(res, 400, 'K_ANON_BELOW_THRESHOLD', 'Institution has fewer than 5 learners — export not available');
      return;
    }

    const exportedAt = new Date().toISOString();

    const learnerPayloads = learners.map((l) => {
      // Build per-cluster score map
      const clusterScores: Record<string, number> = {};
      for (const s of l.scores) {
        clusterScores[s.clusterCode] = s.scoreWeighted;
      }
      // Find the active (issued) signal, if any
      const activeSignal = l.signals[0] ?? null;

      return {
        id: l.id,
        name: l.user?.name ?? l.name,
        email: l.user?.email ?? l.email,
        clusterScores,
        activeSignalId: activeSignal?.id ?? null,
      };
    });

    const payload: Record<string, unknown> = {
      institution: {
        id: institution.id,
        name: institution.name,
        nirfRank: institution.nirfRank ?? null,
        naacGrade: institution.naacGrade ?? null,
      },
      exportedAt,
      learnerCount: learners.length,
      learners: learnerPayloads,
    };

    const { token, iat, exp } = signCustomPayload('dpdp-export', payload);
    const kid = publicKeyKid();

    ok(res, { payload, signature: token, kid, exportedAt, iat, exp });
  }),
);

// ─── BC 184 — Enable / disable a feature flag without redeploy ───────────────

/**
 * PATCH /api/v1/admin/feature-flags/:name
 *
 * Body: { enabled: boolean, scope?: string }
 *
 * Upserts the FeatureFlag row. Because featureFlagService.isEnabled() reads
 * from DB on every call, the change is effective within the next DB-read cycle
 * (naturally ≤ 60s with no cache to invalidate).
 */
router.patch(
  '/feature-flags/:name',
  requireSuperAdmin,
  asyncHandler(async (req: Request, res: Response) => {
    const { name } = req.params as { name: string };
    const { enabled, scope } = req.body as { enabled?: boolean; scope?: string };

    if (typeof enabled !== 'boolean') {
      fail(res, 400, 'VALIDATION', 'enabled must be a boolean');
      return;
    }

    const flag = await prisma.featureFlag.upsert({
      where: { name },
      update: { enabled, scope: scope ?? null },
      create: { name, enabled, scope: scope ?? null },
    });

    ok(res, {
      name: flag.name,
      enabled: flag.enabled,
      scope: flag.scope ?? null,
      updatedAt: flag.updatedAt.toISOString(),
    });
  }),
);

export default router;
