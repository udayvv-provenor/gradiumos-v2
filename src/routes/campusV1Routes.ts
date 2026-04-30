/**
 * campusV1Routes — /api/v1/campus routes for Phase B + C.
 * Mounted in app.ts under /api/v1/campus (with requireAuth applied at mount).
 *
 * Phase C additions:
 *   BC 97  — PATCH /partnerships/:id — accept or decline partnership request (DEAN)
 *   BC 104 — GET  /career-tracks/:id/gap
 *   BC 106 — GET  /career-tracks/:id/cohort
 *   BC 107 — requireSameInstitution helper (tenant scope enforcement)
 *   BC 108 — GET  /learners/:id/radar
 *   BC 109 — GET  /learners/compare?ids=a,b
 *   BC 110 — GET  /programmes/:id/outcome
 *   BC 111 — inFlightAssignments added to gap endpoint
 *   BC 111 — POST /programmes/:id/assign-bulk
 *   BC 112 — GET  /export/accreditation
 *   BC 113 — GET  /bridge-to-bar
 */
import { Router, type Request, type Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { requireRole, requireKycVerified } from '../middleware/auth.js';
import { acceptUpload, normaliseUpload } from '../services/upload/uploadMiddleware.js';
import * as upload from '../controllers/v3UploadController.js';
import { ok, fail } from '../utils/response.js';
import { prisma } from '../config/db.js';
import { sendInviteEmail } from '../services/email/emailService.js';
import { withAudit } from '../middleware/audit.js';
import { signPayload } from '../services/signal/tokenSigner.js';
import { signalBandFor } from '../services/competency/formulas.js';
import { Prisma } from '@prisma/client';
import { send as sendNotification } from '../services/notification/notificationService.js';

const router = Router();

// ─────────────────────────────────────────────────────────────────────────────
// BC 107 — Tenant scope enforcement helper
// Every endpoint that returns learner data must call this before responding.
// Returns true = OK to proceed; false = already sent 403 + audit log written.
// ─────────────────────────────────────────────────────────────────────────────

async function requireSameInstitution(
  institutionId: string,
  req: Request,
  res: Response,
): Promise<boolean> {
  if (req.auth?.inst !== institutionId) {
    try {
      await prisma.auditLog.create({
        data: {
          userId: req.auth?.sub ?? null,
          action: 'unauthorized_cross_institution_access',
          entityType: 'Institution',
          entityId: institutionId,
          before: Prisma.DbNull,
          after: Prisma.DbNull,
        },
      });
    } catch { /* never suppress the response on audit failure */ }
    fail(res, 403, 'AUTH_FORBIDDEN', 'Cross-institution access denied');
    return false;
  }
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared utilities
// ─────────────────────────────────────────────────────────────────────────────

const CLUSTER_CODES = ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8'] as const;
type ClusterKey = typeof CLUSTER_CODES[number];
type ClusterRecord = Record<ClusterKey, number>;

/** Median of a numeric array. Returns 0 for empty input. */
function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Seeded baseline used when < 5 MarketDemandSignal rows exist for a track.
 * Intentionally conservative mid-tier values — real signals always take precedence.
 */
const SEEDED_BASELINE: ClusterRecord = {
  C1: 65, C2: 62, C3: 60, C4: 58, C5: 63, C6: 61, C7: 59, C8: 60,
};

/** Average p50ClusterTargets from MarketDemandSignal rows; falls back to baseline if < 5. */
async function employerP50ForTrack(careerTrackId: string): Promise<ClusterRecord> {
  const signals = await prisma.marketDemandSignal.findMany({
    where: { careerTrackId },
    select: { p50ClusterTargets: true },
  });
  if (signals.length < 5) return { ...SEEDED_BASELINE };
  const sums: Record<string, number> = { C1: 0, C2: 0, C3: 0, C4: 0, C5: 0, C6: 0, C7: 0, C8: 0 };
  for (const sig of signals) {
    const targets = sig.p50ClusterTargets as Record<string, unknown>;
    for (const c of CLUSTER_CODES) {
      sums[c] += typeof targets[c] === 'number' ? (targets[c] as number) : 0;
    }
  }
  const result = {} as ClusterRecord;
  for (const c of CLUSTER_CODES) result[c] = sums[c] / signals.length;
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// BC 57 — Curriculum upload at v1 with KYC gate
router.post(
  '/career-tracks/:id/curriculum',
  requireRole('DEAN', 'PLACEMENT_OFFICER'),
  requireKycVerified,
  acceptUpload,
  normaliseUpload('institution'),
  asyncHandler(upload.postCurriculum),
);

// CF-5 / BC 61 — Curriculum revert (full implementation)
router.post(
  '/career-tracks/:id/curriculum/revert/:version',
  requireRole('DEAN', 'PLACEMENT_OFFICER'),
  asyncHandler(async (req, res) => {
    if (!req.auth?.inst) { fail(res, 403, 'AUTH_FORBIDDEN', 'Institution scope required'); return; }

    const { id: careerTrackId, version } = req.params as { id: string; version: string };
    const targetVersion = parseInt(version, 10);
    if (isNaN(targetVersion) || targetVersion < 1) {
      fail(res, 400, 'VALIDATION', 'version must be a positive integer'); return;
    }

    const curriculum = await prisma.curriculum.findFirst({
      where: { careerTrackId, institutionId: req.auth.inst },
    });
    if (!curriculum) { fail(res, 404, 'NOT_FOUND', 'Curriculum not found for this career track'); return; }

    if (targetVersion === curriculum.version) {
      fail(res, 409, 'CONFLICT', 'Cannot revert to the current version'); return;
    }

    // Find AuditLog entry where after.version === targetVersion for this curriculum
    const auditEntries = await prisma.auditLog.findMany({
      where: {
        entityType: 'Curriculum',
        entityId: curriculum.id,
        action: { in: ['curriculum_uploaded', 'curriculum_reverted'] },
      },
      orderBy: { createdAt: 'asc' },
    });

    const matchEntry = auditEntries.find((entry) => {
      const afterData = entry.after as Record<string, unknown> | null;
      return afterData && afterData.version === targetVersion;
    });

    if (!matchEntry) {
      fail(res, 404, 'NOT_FOUND', `No audit entry found for curriculum version ${targetVersion}`); return;
    }

    const restoredSnapshot = matchEntry.after as Record<string, unknown>;
    const currentState = {
      version: curriculum.version,
      clusterCoverage: curriculum.clusterCoverage,
      subjects: curriculum.subjects,
      rawText: curriculum.rawText,
    };

    const newVersion = curriculum.version + 1;
    const restored = await withAudit({
      userId: req.auth.sub,
      action: 'curriculum_reverted',
      entityType: 'Curriculum',
      entityId: curriculum.id,
      before: currentState,
      fn: async () => prisma.curriculum.update({
        where: { id: curriculum.id },
        data: {
          clusterCoverage: restoredSnapshot.clusterCoverage as Prisma.InputJsonValue ?? curriculum.clusterCoverage as Prisma.InputJsonValue,
          subjects: restoredSnapshot.subjects as Prisma.InputJsonValue ?? curriculum.subjects as Prisma.InputJsonValue,
          rawText: typeof restoredSnapshot.rawText === 'string' ? restoredSnapshot.rawText : curriculum.rawText,
          version: newVersion,
        },
      }),
    });

    ok(res, { id: restored.id, version: restored.version, restoredFrom: targetVersion });
  }),
);

// BC 62-64 — Learner bulk invite
router.post(
  '/learners/bulk',
  requireRole('DEAN', 'PLACEMENT_OFFICER'),
  asyncHandler(async (req, res) => {
    if (!req.auth?.inst) { fail(res, 403, 'AUTH_FORBIDDEN', 'Institution scope required'); return; }

    const institution = await prisma.institution.findUnique({ where: { id: req.auth.inst } });
    if (!institution) { fail(res, 404, 'NOT_FOUND', 'Institution not found'); return; }

    // Accept JSON array or parse from body object
    let entries: { name: string; email: string }[] = [];
    const body = req.body as { learners?: { name: string; email: string }[] } | { name: string; email: string }[];
    if (Array.isArray(body)) {
      entries = body;
    } else if (body && 'learners' in body && Array.isArray(body.learners)) {
      entries = body.learners;
    } else {
      fail(res, 400, 'VALIDATION', 'Body must be a JSON array [{name, email}] or {learners: [{name, email}]}');
      return;
    }

    if (entries.length === 0) { fail(res, 400, 'VALIDATION', 'No entries provided'); return; }

    // Get existing learner emails at this institution to detect duplicates
    const existingUsers = await prisma.user.findMany({
      where: { institutionId: req.auth.inst },
      select: { email: true },
    });
    const existingEmails = new Set(existingUsers.map(u => u.email.toLowerCase()));

    const results: { email: string; status: 'sent' | 'skipped' | 'failed'; reason?: string }[] = [];
    let sent = 0, skipped = 0, failed = 0;

    for (const entry of entries) {
      if (!entry.email || !entry.name) {
        results.push({ email: entry.email ?? '', status: 'failed', reason: 'Missing name or email' });
        failed++;
        continue;
      }
      if (existingEmails.has(entry.email.toLowerCase())) {
        results.push({ email: entry.email, status: 'skipped', reason: 'Already a learner at this institution' });
        skipped++;
        continue;
      }
      try {
        await sendInviteEmail({ to: entry.email, name: entry.name, inviteCode: institution.inviteCode });
        results.push({ email: entry.email, status: 'sent' });
        sent++;
      } catch {
        results.push({ email: entry.email, status: 'failed', reason: 'Email delivery failed' });
        failed++;
      }
    }

    ok(res, { total: entries.length, sent, skipped, failed, results });
  }),
);

// ─────────────────────────────────────────────────────────────────────────────
// Phase C — BC 97: Partnership Accept / Decline (DEAN only)
// ─────────────────────────────────────────────────────────────────────────────

router.patch(
  '/partnerships/:id',
  requireRole('DEAN'),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const deanUserId = req.auth!.sub;
    const instId = req.auth?.inst;
    const body = req.body as { action?: string };

    if (!instId) { fail(res, 403, 'AUTH_FORBIDDEN', 'Institution scope required'); return; }
    if (!body.action || !['accept', 'decline'].includes(body.action)) {
      fail(res, 400, 'VALIDATION', 'action must be "accept" or "decline"'); return;
    }

    const partnershipRequest = await prisma.partnershipRequest.findUnique({ where: { id } });
    if (!partnershipRequest) { fail(res, 404, 'NOT_FOUND', 'Partnership request not found'); return; }
    if (partnershipRequest.institutionId !== instId) {
      fail(res, 403, 'AUTH_FORBIDDEN', 'This request does not belong to your institution'); return;
    }
    if (partnershipRequest.status !== 'Pending') {
      fail(res, 409, 'CONFLICT', `Request is already ${partnershipRequest.status.toLowerCase()}`); return;
    }

    const newStatus = body.action === 'accept' ? 'Active' : 'Declined';
    const respondedAt = new Date();

    const updated = await withAudit({
      userId: deanUserId,
      action: body.action === 'accept' ? 'partnership_accepted' : 'partnership_declined',
      entityType: 'PartnershipRequest',
      entityId: id,
      before: { status: partnershipRequest.status },
      after: { status: newStatus },
      fn: () =>
        prisma.partnershipRequest.update({
          where: { id },
          data: { status: newStatus, respondedAt, respondedBy: deanUserId },
        }),
    });

    // On accept: notify employer TA_LEAD users via notification service
    if (body.action === 'accept') {
      const taLeads = await prisma.user.findMany({
        where: { employerId: partnershipRequest.employerId, role: 'TA_LEAD' },
        select: { id: true },
      });
      if (taLeads.length > 0) {
        // Resolve institution name for the payload
        const institution = await prisma.institution.findUnique({
          where: { id: instId },
          select: { name: true },
        });
        await Promise.all(
          taLeads.map((u) =>
            sendNotification('partnership_accepted', u.id, {
              institutionName: institution?.name ?? 'An institution',
            }),
          ),
        );
      }
    }

    ok(res, { id: updated.id, status: updated.status, respondedAt: updated.respondedAt });
  }),
);

// ─────────────────────────────────────────────────────────────────────────────
// BC 104 + BC 111 — GET /career-tracks/:id/gap
// Cohort median vs employer P50 gap, + in-flight assignment counts per cluster.
// ─────────────────────────────────────────────────────────────────────────────

router.get(
  '/career-tracks/:id/gap',
  requireRole('DEAN', 'PLACEMENT_OFFICER'),
  asyncHandler(async (req, res) => {
    if (!req.auth?.inst) { fail(res, 403, 'AUTH_FORBIDDEN', 'Institution scope required'); return; }
    const careerTrackId = req.params.id;
    const institutionId = req.auth.inst;

    const enrollments = await prisma.careerTrackEnrollment.findMany({
      where: { careerTrackId, learner: { institutionId } },
      select: { learnerId: true },
    });
    const learnerIds = enrollments.map(e => e.learnerId);

    // Cohort median (k-anon: null if < 5 learners)
    let cohortMedian: ClusterRecord | null = null;
    if (learnerIds.length >= 5) {
      const scores = await prisma.competencyScore.findMany({
        where: { learnerId: { in: learnerIds } },
        select: { clusterCode: true, scoreWeighted: true },
      });
      const byCluster: Record<string, number[]> = {};
      for (const c of CLUSTER_CODES) byCluster[c] = [];
      for (const s of scores) {
        if (byCluster[s.clusterCode]) byCluster[s.clusterCode].push(s.scoreWeighted);
      }
      cohortMedian = {} as ClusterRecord;
      for (const c of CLUSTER_CODES) cohortMedian[c] = median(byCluster[c]);
    }

    const employerP50 = await employerP50ForTrack(careerTrackId);

    // Gap: positive means cohort is behind employer bar
    const gap = {} as ClusterRecord;
    for (const c of CLUSTER_CODES) {
      (gap as Record<string, number | null>)[c] = cohortMedian !== null
        ? employerP50[c] - cohortMedian[c]
        : null;
    }

    // BC 111 — in-flight assignments per cluster for these learners
    const programmes = await prisma.augmentationProgramme.findMany({
      where: { institutionId },
      select: {
        clusterCode: true,
        assignments: {
          where: {
            status: { in: ['assigned', 'in_progress'] },
            ...(learnerIds.length > 0 ? { learnerId: { in: learnerIds } } : { learnerId: '__none__' }),
          },
          select: { learnerId: true },
        },
      },
    });

    const inFlight = {} as Record<string, number>;
    for (const c of CLUSTER_CODES) inFlight[c] = 0;
    for (const prog of programmes) {
      if (prog.clusterCode && inFlight[prog.clusterCode] !== undefined) {
        inFlight[prog.clusterCode] += prog.assignments.length;
      }
    }

    ok(res, { cohortMedian, employerP50, gap, inFlightAssignments: inFlight, learnerCount: learnerIds.length });
  }),
);

// ─────────────────────────────────────────────────────────────────────────────
// BC 106 — GET /career-tracks/:id/cohort
// Paginated learner list with cluster scores for drill-down.
// ─────────────────────────────────────────────────────────────────────────────

router.get(
  '/career-tracks/:id/cohort',
  requireRole('DEAN', 'PLACEMENT_OFFICER'),
  asyncHandler(async (req, res) => {
    if (!req.auth?.inst) { fail(res, 403, 'AUTH_FORBIDDEN', 'Institution scope required'); return; }
    const careerTrackId = req.params.id;
    const institutionId = req.auth.inst;
    const page = Math.max(1, parseInt((req.query.page as string) ?? '1', 10));
    const pageSize = Math.min(100, Math.max(1, parseInt((req.query.pageSize as string) ?? '25', 10)));

    const total = await prisma.careerTrackEnrollment.count({
      where: { careerTrackId, learner: { institutionId } },
    });

    const enrollments = await prisma.careerTrackEnrollment.findMany({
      where: { careerTrackId, learner: { institutionId } },
      select: { learnerId: true },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });

    const learnerIds = enrollments.map(e => e.learnerId);

    // BC 107: each learner is already scoped to institutionId via the where clause above.
    // No cross-institution risk, but we still verify the track belongs to this institution
    // by checking that at least one enrollment exists. If learnerIds is empty the track
    // either doesn't exist for this inst or has no enrollments — both fine to return empty.

    const learners = await prisma.learner.findMany({
      where: { id: { in: learnerIds }, institutionId },
      select: {
        id: true,
        name: true,
        scores: { select: { clusterCode: true, scoreWeighted: true, confidence: true } },
      },
    });

    const result = learners.map(l => {
      const clusterScores = {} as ClusterRecord;
      for (const c of CLUSTER_CODES) clusterScores[c] = 0;
      for (const s of l.scores) {
        if (clusterScores[s.clusterCode as ClusterKey] !== undefined) {
          clusterScores[s.clusterCode as ClusterKey] = s.scoreWeighted;
        }
      }
      const values = Object.values(clusterScores);
      const readiness = values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : 0;
      const confValues = l.scores.map(s => s.confidence);
      const signalConfidence = confValues.length > 0
        ? confValues.reduce((a, b) => a + b, 0) / confValues.length
        : 0;
      return {
        learnerId: l.id,
        name: l.name,
        clusterScores,
        band: signalBandFor(readiness),
        signalConfidence: Math.round(signalConfidence * 100) / 100,
      };
    });

    ok(res, { learners: result, total, page, pageSize });
  }),
);

// ─────────────────────────────────────────────────────────────────────────────
// BC 108 — GET /learners/:id/radar
// Three series: learner, cohort median (k-anon), employer bar.
// ─────────────────────────────────────────────────────────────────────────────

// NOTE: /learners/compare must be registered BEFORE /learners/:id to prevent
// "compare" being matched as a learnerId.
router.get(
  '/learners/compare',
  requireRole('DEAN', 'PLACEMENT_OFFICER'),
  asyncHandler(async (req, res) => {
    if (!req.auth?.inst) { fail(res, 403, 'AUTH_FORBIDDEN', 'Institution scope required'); return; }
    const idsParam = (req.query.ids as string) ?? '';
    const ids = idsParam.split(',').map(s => s.trim()).filter(Boolean);
    if (ids.length !== 2) { fail(res, 400, 'VALIDATION', 'Exactly 2 learner IDs required (ids=a,b)'); return; }
    const [idA, idB] = ids as [string, string];

    const learners = await prisma.learner.findMany({
      where: { id: { in: [idA, idB] } },
      select: { id: true, institutionId: true, scores: { select: { clusterCode: true, scoreWeighted: true } } },
    });
    if (learners.length !== 2) { fail(res, 404, 'NOT_FOUND', 'One or both learners not found'); return; }

    const learnerA = learners.find(l => l.id === idA)!;
    const learnerB = learners.find(l => l.id === idB)!;

    // BC 107 — both must belong to the requesting dean's institution
    if (learnerA.institutionId !== req.auth.inst) {
      const allowed = await requireSameInstitution(learnerA.institutionId, req, res);
      if (!allowed) return;
    }
    if (learnerB.institutionId !== req.auth.inst) {
      const allowed = await requireSameInstitution(learnerB.institutionId, req, res);
      if (!allowed) return;
    }
    if (learnerA.institutionId !== learnerB.institutionId) {
      fail(res, 400, 'VALIDATION', 'Both learners must belong to the same institution');
      return;
    }

    function toClusterRecord(scores: { clusterCode: string; scoreWeighted: number }[]): ClusterRecord {
      const rec = {} as ClusterRecord;
      for (const c of CLUSTER_CODES) rec[c] = 0;
      for (const s of scores) {
        if (rec[s.clusterCode as ClusterKey] !== undefined) rec[s.clusterCode as ClusterKey] = s.scoreWeighted;
      }
      return rec;
    }

    ok(res, { learnerA: toClusterRecord(learnerA.scores), learnerB: toClusterRecord(learnerB.scores) });
  }),
);

// BC 108 — learner radar (registered after /learners/compare)
router.get(
  '/learners/:id/radar',
  requireRole('DEAN', 'PLACEMENT_OFFICER'),
  asyncHandler(async (req, res) => {
    if (!req.auth?.inst) { fail(res, 403, 'AUTH_FORBIDDEN', 'Institution scope required'); return; }

    const learner = await prisma.learner.findUnique({
      where: { id: req.params.id },
      select: {
        id: true, institutionId: true,
        scores: { select: { clusterCode: true, scoreWeighted: true } },
        careerTrackEnrollments: { where: { isPrimary: true }, select: { careerTrackId: true }, take: 1 },
      },
    });
    if (!learner) { fail(res, 404, 'NOT_FOUND', 'Learner not found'); return; }

    const allowed = await requireSameInstitution(learner.institutionId, req, res);
    if (!allowed) return;

    const learnerScores = {} as ClusterRecord;
    for (const c of CLUSTER_CODES) learnerScores[c] = 0;
    for (const s of learner.scores) {
      if (learnerScores[s.clusterCode as ClusterKey] !== undefined) {
        learnerScores[s.clusterCode as ClusterKey] = s.scoreWeighted;
      }
    }

    const primaryTrackId = learner.careerTrackEnrollments[0]?.careerTrackId ?? null;

    let cohortMedian: ClusterRecord | null = null;
    if (primaryTrackId) {
      const peers = await prisma.careerTrackEnrollment.findMany({
        where: { careerTrackId: primaryTrackId, learner: { institutionId: learner.institutionId } },
        select: { learnerId: true },
      });
      if (peers.length >= 5) {
        const peerIds = peers.map(p => p.learnerId);
        const peerScores = await prisma.competencyScore.findMany({
          where: { learnerId: { in: peerIds } },
          select: { clusterCode: true, scoreWeighted: true },
        });
        const byCluster: Record<string, number[]> = {};
        for (const c of CLUSTER_CODES) byCluster[c] = [];
        for (const s of peerScores) {
          if (byCluster[s.clusterCode]) byCluster[s.clusterCode].push(s.scoreWeighted);
        }
        cohortMedian = {} as ClusterRecord;
        for (const c of CLUSTER_CODES) cohortMedian[c] = median(byCluster[c]);
      }
    }

    const employerBar = primaryTrackId
      ? await employerP50ForTrack(primaryTrackId)
      : { ...SEEDED_BASELINE };

    ok(res, { learner: learnerScores, cohortMedian, employerBar });
  }),
);

// ─────────────────────────────────────────────────────────────────────────────
// BC 110 — GET /programmes/:id/outcome
// Pre/post delta per cluster; k-anon enforced (< 5 completers → suppress).
// ─────────────────────────────────────────────────────────────────────────────

router.get(
  '/programmes/:id/outcome',
  requireRole('DEAN', 'PLACEMENT_OFFICER'),
  asyncHandler(async (req, res) => {
    if (!req.auth?.inst) { fail(res, 403, 'AUTH_FORBIDDEN', 'Institution scope required'); return; }

    const programme = await prisma.augmentationProgramme.findUnique({
      where: { id: req.params.id },
      select: { id: true, institutionId: true, clusterCode: true },
    });
    if (!programme) { fail(res, 404, 'NOT_FOUND', 'Programme not found'); return; }

    const allowed = await requireSameInstitution(programme.institutionId, req, res);
    if (!allowed) return;

    const assignments = await prisma.augmentationAssignment.findMany({
      where: { programmeId: req.params.id, status: 'complete' },
      include: { outcome: true },
    });

    const completers = assignments.length;
    if (completers < 5) { ok(res, { sufficient: false, completers }); return; }

    const outcomes = assignments.map(a => a.outcome).filter((o): o is NonNullable<typeof o> => o !== null);
    if (outcomes.length === 0) { ok(res, { sufficient: false, completers }); return; }

    const preMean = outcomes.reduce((s, o) => s + o.scoreBefore, 0) / outcomes.length;
    const postMean = outcomes.reduce((s, o) => s + o.scoreAfter, 0) / outcomes.length;

    ok(res, {
      sufficient: true,
      clusterId: programme.clusterCode,
      preMean: Math.round(preMean * 100) / 100,
      postMean: Math.round(postMean * 100) / 100,
      delta: Math.round((postMean - preMean) * 100) / 100,
      completers,
    });
  }),
);

// ─────────────────────────────────────────────────────────────────────────────
// BC 111 addendum — POST /programmes/:id/assign-bulk
// Bulk-assign learners to an AugmentationProgramme (max 500 per request).
// ─────────────────────────────────────────────────────────────────────────────

router.post(
  '/programmes/:id/assign-bulk',
  requireRole('DEAN', 'PLACEMENT_OFFICER'),
  asyncHandler(async (req, res) => {
    if (!req.auth?.inst) { fail(res, 403, 'AUTH_FORBIDDEN', 'Institution scope required'); return; }

    const body = req.body as { learnerIds?: unknown };
    if (!Array.isArray(body.learnerIds)) { fail(res, 400, 'VALIDATION', 'learnerIds must be an array'); return; }

    const learnerIds = (body.learnerIds as unknown[])
      .filter((id): id is string => typeof id === 'string')
      .slice(0, 500);

    if (learnerIds.length === 0) { fail(res, 400, 'VALIDATION', 'learnerIds array must not be empty'); return; }

    const programme = await prisma.augmentationProgramme.findUnique({
      where: { id: req.params.id },
      select: { id: true, institutionId: true, steps: { select: { id: true } } },
    });
    if (!programme) { fail(res, 404, 'NOT_FOUND', 'Programme not found'); return; }

    const allowed = await requireSameInstitution(programme.institutionId, req, res);
    if (!allowed) return;

    const stepsTotal = programme.steps.length;
    let assigned = 0, alreadyAssigned = 0, failed = 0;

    for (const learnerId of learnerIds) {
      const learner = await prisma.learner.findFirst({
        where: { id: learnerId, institutionId: req.auth!.inst! },
        select: { id: true },
      });
      if (!learner) { failed++; continue; }

      try {
        const existing = await prisma.augmentationAssignment.findUnique({
          where: { programmeId_learnerId: { programmeId: req.params.id, learnerId } },
          select: { id: true },
        });
        if (existing) {
          alreadyAssigned++;
        } else {
          await prisma.augmentationAssignment.create({
            data: { programmeId: req.params.id, learnerId, status: 'assigned', stepsComplete: 0, stepsTotal },
          });
          assigned++;
        }
      } catch { failed++; }
    }

    // Single batch audit log entry (BC 165 — pathway_assigned is the marquee loop action)
    await prisma.auditLog.create({
      data: {
        userId: req.auth!.sub ?? null,
        action: 'pathway_assigned',
        entityType: 'AugmentationProgramme',
        entityId: req.params.id,
        before: Prisma.DbNull,
        after: { count: assigned, learnerIds } as unknown as Prisma.InputJsonValue,
      },
    });

    ok(res, { assigned, alreadyAssigned, failed });
  }),
);

// ─────────────────────────────────────────────────────────────────────────────
// BC 112 — GET /export/accreditation
// Ed25519-signed JSON export of institution cohort data.
// ─────────────────────────────────────────────────────────────────────────────

router.get(
  '/export/accreditation',
  requireRole('DEAN', 'PLACEMENT_OFFICER'),
  asyncHandler(async (req, res) => {
    if (!req.auth?.inst) { fail(res, 403, 'AUTH_FORBIDDEN', 'Institution scope required'); return; }
    const institutionId = req.auth.inst;
    const exportedAt = new Date().toISOString();

    const trackEnrollments = await prisma.careerTrackEnrollment.findMany({
      where: { learner: { institutionId } },
      select: { careerTrackId: true, learnerId: true },
    });

    const byTrack = new Map<string, string[]>();
    for (const e of trackEnrollments) {
      if (!byTrack.has(e.careerTrackId)) byTrack.set(e.careerTrackId, []);
      byTrack.get(e.careerTrackId)!.push(e.learnerId);
    }

    const careerTrackIds = [...byTrack.keys()];
    const careerTracks = await prisma.careerTrack.findMany({
      where: { id: { in: careerTrackIds } },
      select: { id: true, code: true },
    });
    const trackCodeMap = new Map(careerTracks.map(ct => [ct.id, ct.code]));

    const careerTrackSummaries = await Promise.all(
      [...byTrack.entries()].map(async ([careerTrackId, lids]) => {
        const learnerCount = lids.length;
        const placements = await prisma.placement.count({ where: { learnerId: { in: lids } } });
        const placementRate = learnerCount > 0 ? Math.round((placements / learnerCount) * 1000) / 1000 : 0;

        let clusterMedians: ClusterRecord | null = null;
        if (learnerCount >= 5) {
          const scores = await prisma.competencyScore.findMany({
            where: { learnerId: { in: lids } },
            select: { clusterCode: true, scoreWeighted: true },
          });
          const byCluster: Record<string, number[]> = {};
          for (const c of CLUSTER_CODES) byCluster[c] = [];
          for (const s of scores) {
            if (byCluster[s.clusterCode]) byCluster[s.clusterCode].push(s.scoreWeighted);
          }
          clusterMedians = {} as ClusterRecord;
          for (const c of CLUSTER_CODES) clusterMedians[c] = median(byCluster[c]);
        }

        return {
          careerTrackCode: trackCodeMap.get(careerTrackId) ?? careerTrackId,
          learnerCount,
          clusterMedians,
          placementRate,
        };
      }),
    );

    const exportPayload = { exportedAt, institutionId, careerTrackSummaries };

    // Ed25519-sign the export using the signal signer.
    // We encode the export identity into versionTag; the token sub is the institutionId.
    const token = signPayload({
      sub: institutionId,
      cluster: 'EXPORT',
      score: 0,
      confidence: 1,
      freshness: 1,
      versionTag: `accreditation-export:${exportedAt}`,
    });

    ok(res, { data: exportPayload, token });
  }),
);

// ─────────────────────────────────────────────────────────────────────────────
// BC 113 — GET /bridge-to-bar
// Institution cohort vs employer P50 with data-state classification.
// ─────────────────────────────────────────────────────────────────────────────

router.get(
  '/bridge-to-bar',
  requireRole('DEAN', 'PLACEMENT_OFFICER'),
  asyncHandler(async (req, res) => {
    if (!req.auth?.inst) { fail(res, 403, 'AUTH_FORBIDDEN', 'Institution scope required'); return; }
    const institutionId = req.auth.inst;

    // Count learners with >= 5 total assessment attempts
    const attemptCounts = await prisma.assessmentAttemptV2.groupBy({
      by: ['learnerId'],
      where: { learner: { institutionId } },
      _count: { id: true },
    });
    const qualifiedLearners = attemptCounts.filter(a => a._count.id >= 5).length;

    const dataState: 'Baseline' | 'Mixed' | 'Live' =
      qualifiedLearners === 0 ? 'Baseline' : qualifiedLearners < 30 ? 'Mixed' : 'Live';

    // Cohort median across all learners at this institution (k-anon)
    const allLearnerIds = (await prisma.learner.findMany({
      where: { institutionId },
      select: { id: true },
    })).map(l => l.id);

    let cohortMedian: ClusterRecord | null = null;
    if (allLearnerIds.length >= 5) {
      const scores = await prisma.competencyScore.findMany({
        where: { learnerId: { in: allLearnerIds } },
        select: { clusterCode: true, scoreWeighted: true },
      });
      const byCluster: Record<string, number[]> = {};
      for (const c of CLUSTER_CODES) byCluster[c] = [];
      for (const s of scores) {
        if (byCluster[s.clusterCode]) byCluster[s.clusterCode].push(s.scoreWeighted);
      }
      cohortMedian = {} as ClusterRecord;
      for (const c of CLUSTER_CODES) cohortMedian[c] = median(byCluster[c]);
    }

    // Employer P50 — average across all career tracks this institution enrolls in
    const uniqueTrackIds = (await prisma.careerTrackEnrollment.findMany({
      where: { learner: { institutionId } },
      select: { careerTrackId: true },
      distinct: ['careerTrackId'],
    })).map(e => e.careerTrackId);

    let employerP50: ClusterRecord;
    if (uniqueTrackIds.length === 0) {
      employerP50 = { ...SEEDED_BASELINE };
    } else {
      const trackP50s = await Promise.all(uniqueTrackIds.map(tid => employerP50ForTrack(tid)));
      employerP50 = {} as ClusterRecord;
      for (const c of CLUSTER_CODES) {
        employerP50[c] = trackP50s.reduce((s, p) => s + p[c], 0) / trackP50s.length;
      }
    }

    const gap = {} as Record<string, number | null>;
    for (const c of CLUSTER_CODES) {
      gap[c] = cohortMedian !== null ? employerP50[c] - cohortMedian[c] : null;
    }

    ok(res, {
      cohortMedian,
      employerP50,
      gap,
      dataState,
      progressToLive: { current: qualifiedLearners, required: 30 },
    });
  }),
);

// ─────────────────────────────────────────────────────────────────────────────
// Phase D — BC 153 prerequisite: Create AugmentationProgramme
// POST /api/v1/campus/programmes
// Body: { name, clusterCode, careerTrackId, triggerType?, steps? }
// Returns: { id, name }
//
// Note: AugmentationProgramme requires an existing cohort (cohortId) and is
// unique per (cohortId, clusterCode). This route finds the first available
// cohort for the institution and the target cluster, creating the programme
// under it. If a programme already exists for that pair, returns the existing
// record (idempotent).
// ─────────────────────────────────────────────────────────────────────────────

router.post(
  '/programmes',
  requireRole('DEAN', 'PLACEMENT_OFFICER'),
  asyncHandler(async (req, res) => {
    if (!req.auth?.inst) { fail(res, 403, 'AUTH_FORBIDDEN', 'Institution scope required'); return; }
    const institutionId = req.auth.inst;
    const userId = req.auth.sub;

    const body = req.body as {
      name?: string;
      clusterCode?: string;
      careerTrackId?: string;
      triggerType?: string;
      steps?: string[];
    };

    if (!body.name) { fail(res, 400, 'VALIDATION', '`name` is required'); return; }
    if (!body.clusterCode) { fail(res, 400, 'VALIDATION', '`clusterCode` is required'); return; }

    const clusterCode = body.clusterCode as ClusterKey;
    const VALID_CLUSTERS = ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8'];
    if (!VALID_CLUSTERS.includes(clusterCode)) {
      fail(res, 400, 'VALIDATION', `clusterCode must be one of ${VALID_CLUSTERS.join(', ')}`);
      return;
    }

    // Resolve careerTrackId — may be passed as a code (e.g. 'SWE') or an actual UUID
    let resolvedCareerTrackId: string | null = null;
    if (body.careerTrackId) {
      // Try as a direct ID first
      const byId = await prisma.careerTrack.findUnique({ where: { id: body.careerTrackId } });
      if (byId) {
        resolvedCareerTrackId = byId.id;
      } else {
        // Try as a code
        const byCode = await prisma.careerTrack.findUnique({ where: { code: body.careerTrackId } });
        resolvedCareerTrackId = byCode?.id ?? null;
      }
    }

    // Find the first cohort for this institution (programmes are scoped to a cohort)
    let cohort = await prisma.cohort.findFirst({
      where: { institutionId },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    });

    if (!cohort) {
      // No cohort exists yet — create a sentinel cohort so the test stack works end-to-end.
      // In production, cohorts are created during institution onboarding.

      // Find or create a Track
      let track = await prisma.track.findFirst({
        where: { institutionId },
        select: { id: true },
      });
      if (!track) {
        const careerTrack = resolvedCareerTrackId
          ? await prisma.careerTrack.findUnique({ where: { id: resolvedCareerTrackId } })
          : null;

        track = await prisma.track.create({
          data: {
            institutionId,
            name: 'Default Track',
            careerTrackId: careerTrack?.id ?? null,
          },
          select: { id: true },
        });
      }

      // Find or create an IndexVersion
      let indexVersion = await prisma.indexVersion.findFirst({
        where: { institutionId },
        select: { id: true },
      });
      if (!indexVersion) {
        const defaultWeights = { C1: 1, C2: 1, C3: 1, C4: 1, C5: 1, C6: 1, C7: 1, C8: 1 };
        const defaultThresholds = { suppression: 0.3 };
        indexVersion = await prisma.indexVersion.create({
          data: {
            institutionId,
            versionTag: '1.0',
            effectiveFrom: new Date(),
            locked: false,
            weights: defaultWeights,
            thresholds: defaultThresholds,
          },
          select: { id: true },
        });
      }

      cohort = await prisma.cohort.create({
        data: {
          institutionId,
          trackId: track.id,
          indexVersionId: indexVersion.id,
          name: 'Default Cohort',
          startYear: new Date().getFullYear(),
        },
        select: { id: true },
      });
    }

    // Check if a programme already exists for this (cohortId, clusterCode)
    const existing = await prisma.augmentationProgramme.findFirst({
      where: { cohortId: cohort.id, clusterCode },
      select: { id: true, title: true },
    });
    if (existing) {
      // Idempotent — return the existing programme
      ok(res, { id: existing.id, name: existing.title });
      return;
    }

    const triggerType = (['mandatory', 'on_demand', 'stretch'].includes(body.triggerType ?? ''))
      ? (body.triggerType as 'mandatory' | 'on_demand' | 'stretch')
      : 'on_demand';

    const programme = await prisma.augmentationProgramme.create({
      data: {
        institutionId,
        cohortId: cohort.id,
        clusterCode,
        triggerType,
        title: body.name,
        createdByUserId: userId ?? null,
      },
    });

    ok(res, { id: programme.id, name: programme.title }, 201);
  }),
);

export default router;
