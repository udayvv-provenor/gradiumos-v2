/**
 * workforceV1Routes — /api/v1/workforce
 *
 * Phase B endpoints for employer workforce operations:
 *   BC 50 — JD upload with KYC gate
 *   BC 55 — PATCH cluster target overrides
 *   BC 56 — JD revert stub (Phase C)
 *
 * Phase C additions:
 *   BC 94-95 — GET /roles/:id/institutes — institute opportunity map
 *   BC 96    — POST /institutes/:id/partnership — request partnership
 *   BC 98    — POST /roles/:id/sponsored-pathway — create sponsored pathway
 *   BC 99-101 — GET /roles/:id/calibrate — calibration with peer benchmark
 *   BC 102-103 — GET /roles/:id/discovery — candidate discovery panel
 */
import { Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { requireRole, requireKycVerified } from '../middleware/auth.js';
import { acceptUpload, normaliseUpload } from '../services/upload/uploadMiddleware.js';
import * as upload from '../controllers/v3UploadController.js';
import { ok, fail } from '../utils/response.js';
import { prisma } from '../config/db.js';
import { withAudit } from '../middleware/audit.js';
import { ALL_CLUSTERS, parseTargets, parseWeights, bandForMatch } from '../services/workforce/helpers.js';
import { matchScore } from '../services/competency/formulas.js';
import type { ClusterCode } from '@prisma/client';
import { Prisma } from '@prisma/client';
import crypto from 'crypto';
import { send as sendNotification } from '../services/notification/notificationService.js';

const router = Router();

// ─────────────────────────────────────────────────────────────────────────────
// Phase D — BC 153 prerequisite: Create EmployerRole
// POST /api/v1/workforce/roles
// Body: { title, archetype?, seniority?, careerTrackCode, seatsPlanned? }
// Returns: { id, title, status }
// ─────────────────────────────────────────────────────────────────────────────

router.post(
  '/roles',
  requireRole('TA_LEAD'),
  asyncHandler(async (req, res) => {
    const employerId = req.auth!.emp;
    if (!employerId) { fail(res, 403, 'AUTH_FORBIDDEN', 'Employer scope required'); return; }

    const body = req.body as {
      title?: string;
      careerTrackCode?: string;
      archetype?: string;
      seniority?: string;
      seatsPlanned?: number;
    };

    if (!body.title) { fail(res, 400, 'VALIDATION', '`title` is required'); return; }
    if (!body.careerTrackCode) { fail(res, 400, 'VALIDATION', '`careerTrackCode` is required'); return; }

    // Look up CareerTrack by code
    const careerTrack = await prisma.careerTrack.findUnique({
      where: { code: body.careerTrackCode },
    });
    if (!careerTrack) {
      fail(res, 404, 'NOT_FOUND', `CareerTrack with code '${body.careerTrackCode}' not found`);
      return;
    }

    // Default cluster weights and targets (zeros; updated via JD upload)
    const emptyClusterWeights = { C1: 0, C2: 0, C3: 0, C4: 0, C5: 0, C6: 0, C7: 0, C8: 0 };
    const emptyClusterTargets = { C1: 0, C2: 0, C3: 0, C4: 0, C5: 0, C6: 0, C7: 0, C8: 0 };

    const role = await prisma.employerRole.create({
      data: {
        employerId,
        careerTrackId: careerTrack.id,
        title: body.title,
        seatsPlanned: body.seatsPlanned ?? 1,
        status: 'draft',
        clusterWeights: emptyClusterWeights,
        clusterTargets: emptyClusterTargets,
        jdExtraction: (body.archetype || body.seniority)
          ? { archetype: body.archetype ?? null, seniority: body.seniority ?? null } as Prisma.InputJsonValue
          : Prisma.JsonNull,
      },
    });

    ok(res, { id: role.id, title: role.title, status: role.status }, 201);
  }),
);

// BC 50 — JD upload with KYC gate
router.post(
  '/roles/:id/jd',
  requireRole('TA_LEAD'),
  requireKycVerified,
  acceptUpload,
  normaliseUpload('employer'),
  asyncHandler(upload.postJD),
);

// BC 55 — PATCH cluster targets override
router.patch(
  '/roles/:id/targets',
  requireRole('TA_LEAD'),
  requireKycVerified,
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const body = req.body as Record<string, unknown>;

    // Validate each cluster value is 0-100
    const clusterKeys = ['C1','C2','C3','C4','C5','C6','C7','C8'];
    const overrides: Record<string, number> = {};
    for (const k of clusterKeys) {
      if (k in body) {
        const v = Number(body[k]);
        if (isNaN(v) || v < 0 || v > 100) {
          fail(res, 400, 'VALIDATION', `${k} must be 0–100`); return;
        }
        overrides[k] = v;
      }
    }
    if (Object.keys(overrides).length === 0) {
      fail(res, 400, 'VALIDATION', 'At least one cluster target required'); return;
    }

    const role = await prisma.employerRole.findUnique({ where: { id } });
    if (!role) { fail(res, 404, 'NOT_FOUND', 'Role not found'); return; }
    if (role.employerId !== req.auth!.emp) { fail(res, 403, 'AUTH_FORBIDDEN', 'Not your role'); return; }

    const existingTargets = role.clusterTargets as Record<string, number>;
    const newTargets = { ...existingTargets, ...overrides };

    const updated = await prisma.employerRole.update({
      where: { id },
      data: { clusterTargets: newTargets, jdVersion: { increment: 1 }, version: { increment: 1 } },
    });

    // Write AuditLog
    await prisma.auditLog.create({ data: {
      userId: req.auth?.sub, action: 'targets_overridden', entityType: 'EmployerRole', entityId: id,
      before: existingTargets, after: newTargets,
    }});

    ok(res, { id: updated.id, clusterTargets: updated.clusterTargets, jdVersion: updated.jdVersion });
  }),
);

// CF-4 / BC 56 — JD revert (full implementation)
router.post(
  '/roles/:id/jd/revert/:version',
  requireRole('TA_LEAD'),
  asyncHandler(async (req, res) => {
    const { id: roleId, version } = req.params as { id: string; version: string };
    const targetVersion = parseInt(version, 10);
    if (isNaN(targetVersion) || targetVersion < 1) {
      fail(res, 400, 'VALIDATION', 'version must be a positive integer'); return;
    }

    const role = await prisma.employerRole.findUnique({ where: { id: roleId } });
    if (!role) { fail(res, 404, 'NOT_FOUND', 'Role not found'); return; }
    if (role.employerId !== req.auth!.emp) { fail(res, 403, 'AUTH_FORBIDDEN', 'Not your role'); return; }

    // Find AuditLog entry for jd_uploaded where the after.jdVersion matches targetVersion
    const auditEntries = await prisma.auditLog.findMany({
      where: {
        entityType: 'EmployerRole',
        entityId: roleId,
        action: { in: ['jd_uploaded', 'jd_reverted'] },
      },
      orderBy: { createdAt: 'asc' },
    });

    // Find the entry whose `after` snapshot has jdVersion === targetVersion
    const matchEntry = auditEntries.find((entry) => {
      const afterData = entry.after as Record<string, unknown> | null;
      return afterData && afterData.jdVersion === targetVersion;
    });

    if (!matchEntry) {
      fail(res, 404, 'NOT_FOUND', `No audit entry found for jdVersion ${targetVersion}`); return;
    }

    const restoredSnapshot = matchEntry.after as Record<string, unknown>;

    const currentState = {
      jdText: role.jdText,
      jdVersion: role.jdVersion,
      clusterTargets: role.clusterTargets,
    };

    const restored = await withAudit({
      userId: req.auth?.sub,
      action: 'jd_reverted',
      entityType: 'EmployerRole',
      entityId: roleId,
      before: currentState,
      fn: async () => prisma.employerRole.update({
        where: { id: roleId },
        data: {
          jdText: (restoredSnapshot.jdText as string | null) ?? null,
          jdVersion: targetVersion,
          clusterTargets: (restoredSnapshot.clusterTargets ?? role.clusterTargets) as Prisma.InputJsonValue,
          version: { increment: 1 },
        },
      }),
    });

    ok(res, { id: restored.id, jdVersion: restored.jdVersion, restoredFrom: targetVersion });
  }),
);

// ─────────────────────────────────────────────────────────────────────────────
// Phase C — BC 94-95: Institute Opportunity Map
// ─────────────────────────────────────────────────────────────────────────────

router.get(
  '/roles/:id/institutes',
  requireRole('TA_LEAD'),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const employerId = req.auth!.emp;

    const role = await prisma.employerRole.findUnique({ where: { id } });
    if (!role) { fail(res, 404, 'NOT_FOUND', 'Role not found'); return; }
    if (role.employerId !== employerId) { fail(res, 403, 'AUTH_FORBIDDEN', 'Not your role'); return; }

    const targets = parseTargets(role.clusterTargets);
    const weights = parseWeights(role.clusterWeights);

    // Fetch all institutions with their learners and competency scores
    const institutions = await prisma.institution.findMany({
      select: {
        id: true,
        name: true,
        nirfRank: true,
        learners: {
          select: {
            id: true,
            scores: { select: { clusterCode: true, scoreWeighted: true, confidence: true } },
          },
        },
      },
    });

    // Fetch all partnership requests for this employer
    const partnerships = await prisma.partnershipRequest.findMany({
      where: { employerId: employerId! },
      select: { institutionId: true, status: true },
    });
    const partnerMap = new Map<string, string>();
    for (const p of partnerships) partnerMap.set(p.institutionId, p.status);

    const rows = institutions
      .map((inst) => {
        // Count learners with at least 1 competency score
        const learnersWithScores = inst.learners.filter((l) => l.scores.length > 0);
        const cohortSize = learnersWithScores.length;

        // k-anonymity: exclude if fewer than 5 learners
        if (cohortSize < 5) return null;

        // fitScore: % of learners whose median per-cluster scores meet all role targets
        // Simplified: learner fits if their weighted matchScore > 0.5
        let fitCount = 0;
        for (const learner of learnersWithScores) {
          const byCode = new Map<ClusterCode, number>();
          for (const s of learner.scores) byCode.set(s.clusterCode, s.scoreWeighted);

          const entries = ALL_CLUSTERS
            .map((c) => {
              const t = targets[c];
              const w = weights[c] ?? 0;
              if (!t || t.target <= 0 || w <= 0) return null;
              return { scoreWeighted: byCode.get(c) ?? 0, target: t.target, weight: w };
            })
            .filter((e): e is { scoreWeighted: number; target: number; weight: number } => e !== null);

          if (entries.length === 0) continue;
          const ms = matchScore(entries);
          if (ms >= 0.5) fitCount++;
        }

        const fitScore = Math.round((fitCount / cohortSize) * 100);
        const partnershipStatus = (partnerMap.get(inst.id) ?? 'None') as 'None' | 'Pending' | 'Active' | 'Declined';

        return {
          institutionId: inst.id,
          name: inst.name,
          cohortSize,
          fitScore,
          nirfRank: inst.nirfRank ?? null,
          partnershipStatus,
        };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);

    rows.sort((a, b) => b.fitScore - a.fitScore);

    ok(res, { institutes: rows });
  }),
);

// ─────────────────────────────────────────────────────────────────────────────
// Phase C — BC 96: Request Partnership
// ─────────────────────────────────────────────────────────────────────────────

router.post(
  '/institutes/:id/partnership',
  requireRole('TA_LEAD'),
  asyncHandler(async (req, res) => {
    const institutionId = req.params.id;
    const employerId = req.auth!.emp!;

    // Check institution exists
    const institution = await prisma.institution.findUnique({
      where: { id: institutionId },
      include: { users: { where: { role: 'DEAN' }, select: { id: true } } },
    });
    if (!institution) { fail(res, 404, 'NOT_FOUND', 'Institution not found'); return; }

    // Check no existing Active/Pending request
    const existing = await prisma.partnershipRequest.findFirst({
      where: { employerId, institutionId, status: { in: ['Active', 'Pending'] } },
    });
    if (existing) {
      fail(res, 409, 'CONFLICT', `Partnership already ${existing.status.toLowerCase()} for this institution`);
      return;
    }

    const partnershipRequest = await prisma.partnershipRequest.create({
      data: { employerId, institutionId, status: 'Pending', requestedAt: new Date() },
    });

    // Fire notifications to all DEAN users at this institution via notification service
    // Look up employer name for the payload
    const employer = await prisma.employer.findUnique({ where: { id: employerId }, select: { name: true } });
    if (institution.users.length > 0) {
      await Promise.all(
        institution.users.map((u) =>
          sendNotification('partnership_request', u.id, {
            employerName: employer?.name ?? 'An employer',
          }),
        ),
      );
    }

    ok(res, { id: partnershipRequest.id, status: partnershipRequest.status, requestedAt: partnershipRequest.requestedAt }, 201);
  }),
);

// ─────────────────────────────────────────────────────────────────────────────
// Phase C — BC 98: Sponsored Pathway
// ─────────────────────────────────────────────────────────────────────────────

router.post(
  '/roles/:id/sponsored-pathway',
  requireRole('TA_LEAD'),
  requireKycVerified,
  asyncHandler(async (req, res) => {
    const { id: roleId } = req.params;
    const employerId = req.auth!.emp!;
    const body = req.body as { institutionId?: string; clusterTarget?: string; fundingConfirmedAt?: string };

    if (!body.institutionId || !body.clusterTarget || !body.fundingConfirmedAt) {
      fail(res, 400, 'VALIDATION', 'institutionId, clusterTarget, and fundingConfirmedAt are required');
      return;
    }

    const role = await prisma.employerRole.findUnique({ where: { id: roleId } });
    if (!role) { fail(res, 404, 'NOT_FOUND', 'Role not found'); return; }
    if (role.employerId !== employerId) { fail(res, 403, 'AUTH_FORBIDDEN', 'Not your role'); return; }

    const institution = await prisma.institution.findUnique({
      where: { id: body.institutionId },
      include: { users: { where: { role: 'DEAN' }, select: { id: true } } },
    });
    if (!institution) { fail(res, 404, 'NOT_FOUND', 'Institution not found'); return; }

    // Find AugmentationProgramme for careerTrack/clusterTarget (most recent by createdAt)
    const clusterCode = body.clusterTarget as ClusterCode;
    const programme = await prisma.augmentationProgramme.findFirst({
      where: { clusterCode },
      orderBy: { createdAt: 'desc' },
    });

    const pathway = await prisma.sponsoredPathway.create({
      data: {
        employerId,
        institutionId: body.institutionId,
        pathwayId: programme?.id ?? 'unassigned',
        careerTrackId: role.careerTrackId,
        clusterTarget: body.clusterTarget,
        fundingConfirmedAt: new Date(body.fundingConfirmedAt),
        status: 'Active',
      },
    });

    // Fire notifications to Dean users via notification service
    const sponsorEmployer = await prisma.employer.findUnique({ where: { id: employerId }, select: { name: true } });
    if (institution.users.length > 0) {
      await Promise.all(
        institution.users.map((u) =>
          sendNotification('sponsored_pathway', u.id, {
            employerName: sponsorEmployer?.name ?? 'An employer',
            clusterName: body.clusterTarget ?? '',
          }),
        ),
      );
    }

    ok(res, { id: pathway.id, status: pathway.status }, 201);
  }),
);

// ─────────────────────────────────────────────────────────────────────────────
// Phase C — BC 99-101: Calibrate with Peer Benchmark
// ─────────────────────────────────────────────────────────────────────────────

router.get(
  '/roles/:id/calibrate',
  requireRole('TA_LEAD'),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const employerId = req.auth!.emp;

    const role = await prisma.employerRole.findUnique({
      where: { id },
      include: { careerTrack: true },
    });
    if (!role) { fail(res, 404, 'NOT_FOUND', 'Role not found'); return; }
    if (role.employerId !== employerId) { fail(res, 403, 'AUTH_FORBIDDEN', 'Not your role'); return; }

    const targets = parseTargets(role.clusterTargets);
    const weights = parseWeights(role.clusterWeights);

    // Fetch MarketDemandSignal rows for this careerTrack (peer P50)
    const demandSignals = await prisma.marketDemandSignal.findMany({
      where: { careerTrackId: role.careerTrackId },
      orderBy: { capturedAt: 'desc' },
      take: 100,
    });

    // Build per-cluster: p50 and stddev from demand signals
    const clusterP50: Record<string, number> = {};
    const clusterStddev: Record<string, number> = {};
    let peerP50Source = 'cold-start-public';

    if (demandSignals.length > 0) {
      peerP50Source = demandSignals[0].source;
      for (const c of ALL_CLUSTERS) {
        const vals = demandSignals
          .map((s) => {
            const p50 = s.p50ClusterTargets as Record<string, number>;
            return typeof p50[c] === 'number' ? p50[c] : null;
          })
          .filter((v): v is number => v !== null);

        if (vals.length === 0) { clusterP50[c] = 60; clusterStddev[c] = 10; continue; }
        const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
        const variance = vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length;
        clusterP50[c] = Math.round(mean);
        clusterStddev[c] = Math.sqrt(variance) || 1;
      }
    } else {
      // Fallback defaults
      for (const c of ALL_CLUSTERS) { clusterP50[c] = 60; clusterStddev[c] = 10; }
    }

    // Build deviations per cluster
    const deviations = ALL_CLUSTERS.map((c) => {
      const yourTarget = targets[c]?.target ?? 0;
      const p50 = clusterP50[c];
      const stddev = clusterStddev[c];
      const deviationSigma = stddev === 0 ? 0 : (yourTarget - p50) / stddev;
      let badge: 'above' | 'below' | 'aligned';
      if (deviationSigma > 1.5) badge = 'above';
      else if (deviationSigma < -1.5) badge = 'below';
      else badge = 'aligned';
      return { clusterCode: c, yourTarget, p50, deviationSigma: Math.round(deviationSigma * 100) / 100, badge };
    });

    // matchedInstitutesCount: institutions with at least 5 learners where fitScore > 50
    // Quick estimate: count institutions with enough learners matching > 50% of targets
    const institutionsWithFit = await prisma.institution.findMany({
      select: {
        id: true,
        learners: { select: { id: true, scores: { select: { clusterCode: true, scoreWeighted: true } } } },
      },
    });

    let matchedInstitutesCount = 0;
    for (const inst of institutionsWithFit) {
      const learnersWithScores = inst.learners.filter((l) => l.scores.length > 0);
      if (learnersWithScores.length < 5) continue;

      let fitCount = 0;
      for (const learner of learnersWithScores) {
        const byCode = new Map<ClusterCode, number>();
        for (const s of learner.scores) byCode.set(s.clusterCode, s.scoreWeighted);
        const entries = ALL_CLUSTERS
          .map((c) => {
            const t = targets[c];
            const w = weights[c] ?? 0;
            if (!t || t.target <= 0 || w <= 0) return null;
            return { scoreWeighted: byCode.get(c) ?? 0, target: t.target, weight: w };
          })
          .filter((e): e is { scoreWeighted: number; target: number; weight: number } => e !== null);
        if (entries.length === 0) continue;
        if (matchScore(entries) >= 0.5) fitCount++;
      }

      const fitScore = learnersWithScores.length > 0 ? (fitCount / learnersWithScores.length) * 100 : 0;
      if (fitScore > 50) matchedInstitutesCount++;
    }

    const peerP50 = ALL_CLUSTERS.reduce<Record<string, number>>((acc, c) => { acc[c] = clusterP50[c]; return acc; }, {});

    ok(res, {
      role: { id: role.id, title: role.title, careerTrackId: role.careerTrackId, careerTrackName: role.careerTrack.name },
      clusterTargets: role.clusterTargets,
      peerP50,
      deviations,
      matchedInstitutesCount,
      peerP50Source,
    });
  }),
);

// ─────────────────────────────────────────────────────────────────────────────
// Phase C — BC 102-103: Discovery Panel
// ─────────────────────────────────────────────────────────────────────────────

router.get(
  '/roles/:id/discovery',
  requireRole('TA_LEAD'),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const employerId = req.auth!.emp;
    const userId = req.auth!.sub;

    const page = Math.max(1, parseInt(String(req.query.page ?? '1'), 10) || 1);
    const rawPageSize = Math.min(100, Math.max(1, parseInt(String(req.query.pageSize ?? '25'), 10) || 25));
    const minMatch = parseFloat(String(req.query.minMatch ?? '0')) / 100; // convert % to 0-1
    const cityFilter = String(req.query.city ?? '').trim();
    const careerTrackFilter = String(req.query.careerTrackId ?? '').trim();

    const role = await prisma.employerRole.findUnique({
      where: { id },
      include: { careerTrack: true },
    });
    if (!role) { fail(res, 404, 'NOT_FOUND', 'Role not found'); return; }
    if (role.employerId !== employerId) { fail(res, 403, 'AUTH_FORBIDDEN', 'Not your role'); return; }

    const targets = parseTargets(role.clusterTargets);
    const weights = parseWeights(role.clusterWeights);

    // Build learner query
    const learnerWhere: Record<string, unknown> = {};
    if (careerTrackFilter) {
      learnerWhere.careerTrackEnrollments = { some: { careerTrackId: careerTrackFilter } };
    }

    const allLearners = await prisma.learner.findMany({
      where: learnerWhere,
      select: {
        id: true,
        scores: { select: { clusterCode: true, scoreWeighted: true, confidence: true } },
        cohort: { select: { name: true } },
        track: { select: { institutionId: true } },
        user: { select: { id: true } },
      },
    });

    // Fetch consent records for opportunity-matching
    const learnerIds = allLearners.map((l) => l.id);
    const consentRecords = await prisma.consentRecord.findMany({
      where: {
        purpose: 'opportunity-matching',
        granted: true,
        userId: { in: allLearners.filter((l) => l.user).map((l) => l.user!.id) },
      },
      select: { userId: true },
    });
    const consentUserSet = new Set(consentRecords.map((c) => c.userId));
    // Map learnerId -> hasConsent
    const learnerConsentMap = new Map<string, boolean>();
    for (const l of allLearners) {
      learnerConsentMap.set(l.id, l.user ? consentUserSet.has(l.user.id) : false);
    }

    // Compute match scores and build candidate rows
    const candidates = allLearners
      .map((learner) => {
        if (learner.scores.length === 0) return null;
        const byCode = new Map<ClusterCode, number>();
        for (const s of learner.scores) byCode.set(s.clusterCode, s.scoreWeighted);

        const entries = ALL_CLUSTERS
          .map((c) => {
            const t = targets[c];
            const w = weights[c] ?? 0;
            if (!t || t.target <= 0 || w <= 0) return null;
            return { scoreWeighted: byCode.get(c) ?? 0, target: t.target, weight: w };
          })
          .filter((e): e is { scoreWeighted: number; target: number; weight: number } => e !== null);

        if (entries.length === 0) return null;
        const ms = matchScore(entries);
        if (ms < minMatch) return null;

        const hasConsent = learnerConsentMap.get(learner.id) ?? false;

        // Hash learner ID (one-way, deterministic per learner)
        const hashedId = crypto.createHash('sha256').update(learner.id + (userId ?? '')).digest('hex').slice(0, 16);

        // Anonymised cluster profile if no consent
        const clusterProfile = hasConsent
          ? ALL_CLUSTERS.reduce<Record<string, number>>((acc, c) => { acc[c] = byCode.get(c) ?? 0; return acc; }, {})
          : ALL_CLUSTERS.reduce<Record<string, string>>((acc, c) => {
              const v = byCode.get(c) ?? 0;
              // Anonymise: show only band label
              acc[c] = v >= 70 ? 'High' : v >= 40 ? 'Mid' : 'Low';
              return acc;
            }, {});

        return {
          learnerId: hashedId,
          band: bandForMatch(ms),
          clusterProfile,
          matchScore: Math.round(ms * 100),
          hasConsent,
        };
      })
      .filter((c): c is NonNullable<typeof c> => c !== null);

    // Sort by matchScore desc
    candidates.sort((a, b) => b.matchScore - a.matchScore);

    const total = candidates.length;
    const offset = (page - 1) * rawPageSize;
    const paged = candidates.slice(offset, offset + rawPageSize);

    ok(res, { candidates: paged, total, page, pageSize: rawPageSize });
  }),
);

// ─────────────────────────────────────────────────────────────────────────────
// Phase D — BC 116-127: Application lifecycle + Role lifecycle state machines
// ─────────────────────────────────────────────────────────────────────────────

// Notification helper (stub — replaced by real notificationService later)
async function dispatchNotification(
  userId: string,
  type: string,
  title: string,
  body: string,
  deepLink: string,
) {
  await prisma.notification.create({ data: { userId, type, title, body, deepLink } });
}

// ─── BC 118 — Application state machine ──────────────────────────────────────

const APP_TRANSITIONS: Record<string, string[]> = {
  Applied:    ['Shortlisted', 'Withdrawn'],
  Shortlisted:['Interview',   'Declined', 'Withdrawn'],
  Interview:  ['Offer',       'Declined', 'Withdrawn'],
  Offer:      ['Accepted',    'Declined', 'Withdrawn'],
  // Terminal states — no further transitions
  Accepted:  [],
  Declined:  [],
  Withdrawn: [],
};

// ─── BC 117 — PATCH application status (TA_LEAD) ─────────────────────────────

/**
 * PATCH /api/v1/workforce/applications/:id/status
 * Body: { status, notes? }
 * TA_LEAD only. Validates transition, checks ownership, notifies learner.
 */
router.patch(
  '/applications/:id/status',
  requireRole('TA_LEAD'),
  asyncHandler(async (req, res) => {
    const userId = req.auth!.sub;
    const employerId = req.auth!.emp!;
    const { id } = req.params as { id: string };
    const body = req.body as { status?: string; notes?: string };

    if (!body.status) return fail(res, 400, 'VALIDATION', '`status` is required');

    const application = await prisma.application.findUnique({
      where: { id },
    });
    if (!application) return fail(res, 404, 'NOT_FOUND', 'Application not found');

    // Verify the application's role belongs to this employer
    const role = await prisma.employerRole.findUnique({ where: { id: application.roleId } });
    if (!role || role.employerId !== employerId) {
      return fail(res, 403, 'AUTH_FORBIDDEN', 'Not your role');
    }

    // Validate state machine transition
    const allowed = APP_TRANSITIONS[application.status] ?? [];
    if (!allowed.includes(body.status)) {
      return fail(res, 409, 'INVALID_TRANSITION',
        `Cannot transition from '${application.status}' to '${body.status}'`);
    }

    const before = { status: application.status };
    const after = { status: body.status, notes: body.notes ?? null };

    const updated = await withAudit({
      userId,
      action: 'application_status_changed',
      entityType: 'Application',
      entityId: id,
      before,
      after,
      fn: async () => prisma.application.update({
        where: { id },
        data: { status: body.status!, statusUpdatedAt: new Date(), statusUpdatedBy: userId },
      }),
    });

    // BC 163 — On Accepted: increment MarketDemandSignal.jobPostingVolume (synchronous)
    if (body.status === 'Accepted') {
      const acceptedRole = await prisma.employerRole.findUnique({
        where: { id: application.roleId },
        select: { careerTrackId: true, jdExtraction: true, clusterTargets: true },
      });
      if (acceptedRole) {
        const jdEx = acceptedRole.jdExtraction as Record<string, unknown> | null;
        const archetype = (jdEx?.archetype as string | null) ?? null;
        const city = (jdEx?.city as string | null) ?? null;

        const existingSignal = await prisma.marketDemandSignal.findFirst({
          where: {
            careerTrackId: acceptedRole.careerTrackId,
            archetype,
            city,
            source: 'live-aggregate',
          },
        });

        if (existingSignal) {
          await prisma.marketDemandSignal.update({
            where: { id: existingSignal.id },
            data: { jobPostingVolume: { increment: 1 }, capturedAt: new Date() },
          });
        } else {
          await prisma.marketDemandSignal.create({
            data: {
              careerTrackId: acceptedRole.careerTrackId,
              archetype,
              city,
              jobPostingVolume: 1,
              p50ClusterTargets: acceptedRole.clusterTargets as import('@prisma/client').Prisma.InputJsonValue,
              source: 'live-aggregate',
            },
          });
        }
      }
    }

    // Notify learner — look up their userId via learnerId
    const learnerUser = await prisma.user.findFirst({ where: { learnerId: application.learnerId } });
    if (learnerUser) {
      let notifType: string;
      let notifTitle: string;

      if (body.status === 'Shortlisted') {
        notifType = 'shortlisted';
        notifTitle = 'You have been shortlisted';
      } else if (body.status === 'Offer') {
        notifType = 'offer_received';
        notifTitle = 'Offer extended';
      } else if (body.status === 'Declined') {
        notifType = 'application_declined';
        notifTitle = 'Application decision';
      } else {
        notifType = 'application_status_changed';
        notifTitle = 'Application update';
      }

      await dispatchNotification(
        learnerUser.id,
        notifType,
        notifTitle,
        `Your application status has been updated to: ${body.status}`,
        `/talent/applications`,
      );
    }

    ok(res, {
      id: updated.id,
      status: updated.status,
      statusUpdatedAt: updated.statusUpdatedAt.toISOString(),
    });
  }),
);

// ─── BC 121 — Pipeline view for a role ───────────────────────────────────────

/**
 * GET /api/v1/workforce/roles/:id/pipeline
 * Returns stage counts + candidate list (learnerId hashed, band, matchScore).
 */
router.get(
  '/roles/:id/pipeline',
  requireRole('TA_LEAD'),
  asyncHandler(async (req, res) => {
    const { id } = req.params as { id: string };
    const employerId = req.auth!.emp;
    const userId = req.auth!.sub;

    const role = await prisma.employerRole.findUnique({ where: { id } });
    if (!role) return fail(res, 404, 'NOT_FOUND', 'Role not found');
    if (role.employerId !== employerId) return fail(res, 403, 'AUTH_FORBIDDEN', 'Not your role');

    const applications = await prisma.application.findMany({
      where: { roleId: id },
      orderBy: { appliedAt: 'desc' },
    });

    // Compute stage counts
    const STAGES = ['Applied', 'Shortlisted', 'Interview', 'Offer', 'Accepted', 'Declined', 'Withdrawn'];
    const counts = STAGES.reduce<Record<string, number>>((acc, s) => { acc[s] = 0; return acc; }, {});
    for (const app of applications) {
      if (counts[app.status] !== undefined) counts[app.status]++;
    }

    // Fetch learner competency scores for matchScore
    const learnerIds = applications.map((a) => a.learnerId);
    const learners = await prisma.learner.findMany({
      where: { id: { in: learnerIds } },
      select: { id: true, scores: { select: { clusterCode: true, scoreWeighted: true } } },
    });
    const learnerMap = new Map(learners.map((l) => [l.id, l]));

    const targets = (role.clusterTargets ?? {}) as Record<string, number>;
    const targetEntries = Object.entries(targets).filter(([, v]) => v > 0);

    const { matchScore: matchScoreFn } = await import('../services/competency/formulas.js');
    const { bandForMatch } = await import('../services/workforce/helpers.js');

    const candidates = applications.map((app) => {
      const learner = learnerMap.get(app.learnerId);
      const scoreByCluster = new Map((learner?.scores ?? []).map((s) => [s.clusterCode, s.scoreWeighted]));

      let matchScore = 0;
      if (targetEntries.length > 0 && learner) {
        const entries = targetEntries.map(([code, target]) => ({
          scoreWeighted: scoreByCluster.get(code as 'C1') ?? 0,
          target,
          weight: 1,
        }));
        matchScore = Math.round(matchScoreFn(entries) * 100);
      }

      const hashedId = crypto
        .createHash('sha256')
        .update(app.learnerId + (userId ?? ''))
        .digest('hex')
        .slice(0, 16);

      return {
        id: app.id,
        learnerId: hashedId,
        band: bandForMatch(matchScore / 100),
        matchScore,
        status: app.status,
        appliedAt: app.appliedAt.toISOString(),
      };
    });

    ok(res, { counts, applications: candidates });
  }),
);

// ─── BC 122 — Role status lifecycle ──────────────────────────────────────────

const ROLE_TRANSITIONS: Record<string, string[]> = {
  draft:   ['active'],
  active:  ['paused', 'closed'],
  paused:  ['active', 'closed'],
  closed:  [], // terminal
};

/**
 * PATCH /api/v1/workforce/roles/:id/status
 * Body: { status, reason? }
 * TA_LEAD only. Validates state machine, notifies learners on close.
 */
router.patch(
  '/roles/:id/status',
  requireRole('TA_LEAD'),
  asyncHandler(async (req, res) => {
    const userId = req.auth!.sub;
    const employerId = req.auth!.emp!;
    const { id } = req.params as { id: string };
    const body = req.body as { status?: string; reason?: string };

    if (!body.status) return fail(res, 400, 'VALIDATION', '`status` is required');

    const role = await prisma.employerRole.findUnique({
      where: { id },
      include: { employer: { select: { name: true } } },
    });
    if (!role) return fail(res, 404, 'NOT_FOUND', 'Role not found');
    if (role.employerId !== employerId) return fail(res, 403, 'AUTH_FORBIDDEN', 'Not your role');

    const currentStatus = role.status as string;
    const allowed = ROLE_TRANSITIONS[currentStatus] ?? [];
    if (!allowed.includes(body.status)) {
      return fail(res, 409, 'INVALID_TRANSITION',
        `Cannot transition role from '${currentStatus}' to '${body.status}'`);
    }

    const before = { status: currentStatus };
    const after = { status: body.status, reason: body.reason ?? null };

    const updated = await withAudit({
      userId,
      action: 'role_status_changed',
      entityType: 'EmployerRole',
      entityId: id,
      before,
      after,
      fn: async () => prisma.employerRole.update({
        where: { id },
        data: { status: body.status as 'draft' | 'active' | 'paused' | 'closed', version: { increment: 1 } },
      }),
    });

    // BC 126 — On close: notify all learners with open applications (N11)
    if (body.status === 'closed') {
      const openApps = await prisma.application.findMany({
        where: {
          roleId: id,
          status: { in: ['Applied', 'Shortlisted', 'Interview', 'Offer'] },
        },
      });

      for (const app of openApps) {
        const learnerUser = await prisma.user.findFirst({ where: { learnerId: app.learnerId } });
        if (learnerUser) {
          await dispatchNotification(
            learnerUser.id,
            'role_closed',
            'A role you applied to has closed',
            `The role ${role.title} at ${role.employer.name} is no longer accepting applications.`,
            `/talent/applications`,
          );
        }
      }
    }

    ok(res, {
      id: updated.id,
      status: updated.status,
      updatedAt: updated.updatedAt.toISOString(),
    });
  }),
);

// ─── BC 162 — Bulk application status update ─────────────────────────────────

/**
 * POST /api/v1/workforce/applications/bulk-status
 * Body: { applicationIds: string[], status: string, notes? }
 * Max 500 IDs. Validates state machine, checks ownership, bulk updates in a transaction.
 * Returns { updated, failed, errors }.
 */
router.post(
  '/applications/bulk-status',
  requireRole('TA_LEAD'),
  asyncHandler(async (req, res) => {
    const userId = req.auth!.sub;
    const employerId = req.auth!.emp!;
    const body = req.body as { applicationIds?: unknown; status?: string; notes?: string };

    if (!Array.isArray(body.applicationIds)) {
      fail(res, 400, 'VALIDATION', '`applicationIds` must be an array'); return;
    }
    if (!body.status) {
      fail(res, 400, 'VALIDATION', '`status` is required'); return;
    }

    const rawIds = (body.applicationIds as unknown[])
      .filter((id): id is string => typeof id === 'string')
      .slice(0, 500);

    if (rawIds.length === 0) {
      fail(res, 400, 'VALIDATION', '`applicationIds` must not be empty'); return;
    }

    // Fetch all applications and their roles
    const applications = await prisma.application.findMany({
      where: { id: { in: rawIds } },
    });

    const roleIds = Array.from(new Set(applications.map((a) => a.roleId)));
    const roles = await prisma.employerRole.findMany({
      where: { id: { in: roleIds } },
      select: { id: true, employerId: true },
    });
    const roleOwnerMap = new Map(roles.map((r) => [r.id, r.employerId]));

    const errors: { id: string; reason: string }[] = [];
    const validIds: string[] = [];

    for (const app of applications) {
      const allowed = APP_TRANSITIONS[app.status] ?? [];
      if (!allowed.includes(body.status!)) {
        errors.push({ id: app.id, reason: `Cannot transition from '${app.status}' to '${body.status}'` });
        continue;
      }
      const ownerEmployerId = roleOwnerMap.get(app.roleId);
      if (ownerEmployerId !== employerId) {
        errors.push({ id: app.id, reason: 'Application does not belong to your roles' });
        continue;
      }
      validIds.push(app.id);
    }

    // Also mark IDs not found as errors
    const foundIds = new Set(applications.map((a) => a.id));
    for (const id of rawIds) {
      if (!foundIds.has(id)) {
        errors.push({ id, reason: 'Application not found' });
      }
    }

    // Bulk update in a single transaction
    if (validIds.length > 0) {
      await prisma.$transaction(
        validIds.map((id) =>
          prisma.application.update({
            where: { id },
            data: { status: body.status!, statusUpdatedAt: new Date(), statusUpdatedBy: userId },
          }),
        ),
      );

      // Single batch AuditLog entry
      await prisma.auditLog.create({
        data: {
          userId,
          action: 'application_status_changed',
          entityType: 'Application',
          entityId: `bulk:${validIds.length}`,
          before: Prisma.DbNull,
          after: { applicationIds: validIds, status: body.status, notes: body.notes ?? null } as Prisma.InputJsonValue,
        },
      });
    }

    ok(res, { updated: validIds.length, failed: errors.length, errors });
  }),
);

export default router;
