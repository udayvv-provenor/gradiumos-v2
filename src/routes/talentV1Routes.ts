/**
 * DPDP Talent self-service endpoints (BC 18–21) + BC 65-74 assessment/tutor v1 aliases.
 * Phase C intelligence surfaces: BC 76-85 (Talent Signal dashboard + opportunities + near-miss).
 *
 * Mounted under /api/v1/talent (after requireAuth in app.ts).
 *
 * BC 18 — POST  /me/data/export      → queue data export job, return { jobId }
 * BC 19 — DELETE /me/account         → queue erasure, write AuditLog, return confirmation
 * BC 20 — PATCH  /me/consent/:purpose → create new ConsentRecord (history row)
 * BC 21 — export endpoint always returns { jobId }, never 500 for empty data
 * BC 65 — POST  /me/assessments/:bankItemId/attempt → MCQ/descriptive attempt submission
 * BC 72 — POST  /me/tutor/sessions               → create tutor session
 * BC 73 — POST  /me/tutor/sessions/:id/turn      → tutor turn
 * BC 74 — POST  /me/tutor/sessions/:id/end       → end session with summary
 * BC 76-78 — GET /me/signal            → cluster bars + signal score/band
 * BC 79    — GET /me/gaps              → top 3 weakest clusters + pathway hint
 * BC 80    — GET /me/clusters/:code/trajectory → last 10 attempt scores
 * BC 81-85 — GET /me/opportunities     → match list with near-miss + newMatch badge
 */
import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { ok, fail } from '../utils/response.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { requireRole } from '../middleware/auth.js';
import { withAudit } from '../middleware/audit.js';
import { prisma } from '../config/db.js';
import { CONSENT_PURPOSES, type ConsentPurpose, requireConsent } from '../services/consent/consentService.js';
import { logger } from '../config/logger.js';
import {
  confidenceBand,
  signalBandFor,
  matchScore as matchScoreFn,
} from '../services/competency/formulas.js';
import { SUPPRESSION_THRESHOLD } from '../services/competency/formulas.config.js';
import { getLearnerIdOrThrow, getLearnerWithScope } from '../services/talent/learnerContext.js';
import { signCustomPayload } from '../services/signal/tokenSigner.js';
import { formulasVersion } from '../services/competency/formulas.config.js';
import { parseTargets } from '../services/talent/helpers.js';
import type { Prisma } from '@prisma/client';

const router = Router();

// All talent DPDP endpoints require LEARNER role
router.use(requireRole('LEARNER'));

// ─── BC 18 + BC 21 — Data export ─────────────────────────────────────────────

/**
 * POST /api/v1/talent/me/data/export
 * Consent NOT required — data export is a DPDP right, not consent-gated.
 * Phase A stub: logs "export job queued" and returns a UUID jobId.
 * Never returns 500 for learners with zero data (BC 21).
 */
router.post(
  '/me/data/export',
  asyncHandler(async (req, res) => {
    const userId = req.auth!.sub;
    const jobId = randomUUID();

    // Phase A stub — no real assembly, just queue acknowledgement
    logger.info({ userId, jobId }, 'export job queued for userId');

    // BC 21: always { jobId } regardless of data state — no DB reads that could
    // throw for empty learners, so this can never 500 from missing data.
    ok(res, { jobId });
  }),
);

// ─── BC 19 — Account erasure ─────────────────────────────────────────────────

/**
 * DELETE /api/v1/talent/me/account
 * Phase A stub: writes an AuditLog entry, returns confirmation with erasureAt.
 */
router.delete(
  '/me/account',
  asyncHandler(async (req, res) => {
    const userId = req.auth!.sub;
    const erasureAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // +30 days

    await withAudit({
      userId,
      action: 'erasure_requested',
      entityType: 'User',
      entityId: userId,
      before: null,
      fn: async () => ({ erasureAt: erasureAt.toISOString(), status: 'queued' }),
    });

    ok(res, {
      message: 'Erasure queued. Your data will be deleted within 30 days.',
      erasureAt: erasureAt.toISOString(),
    });
  }),
);

// ─── BC 20 — Consent PATCH ────────────────────────────────────────────────────

/**
 * PATCH /api/v1/talent/me/consent/:purpose
 * Body: { granted: boolean }
 * Creates a NEW ConsentRecord row (history not in-place update, per BC 20).
 */
router.patch(
  '/me/consent/:purpose',
  asyncHandler(async (req, res) => {
    const userId = req.auth!.sub;
    const { purpose } = req.params as { purpose: string };

    // Validate purpose
    if (!CONSENT_PURPOSES.includes(purpose as ConsentPurpose)) {
      return fail(res, 400, 'VALIDATION', `Invalid purpose. Must be one of: ${CONSENT_PURPOSES.join(', ')}`);
    }

    const body = req.body as { granted?: unknown };
    if (typeof body.granted !== 'boolean') {
      return fail(res, 400, 'VALIDATION', '`granted` must be a boolean');
    }

    const grantedAt = new Date();
    await prisma.consentRecord.create({
      data: {
        userId,
        purpose,
        granted: body.granted,
        grantedAt,
        ipAddress: (req.headers['x-forwarded-for'] as string | undefined) ?? req.ip ?? 'unknown',
      },
    });

    ok(res, { purpose, granted: body.granted, grantedAt: grantedAt.toISOString() });
  }),
);

// ─── BC 65-66 — Assessment bank list + attempt at /api/v1/ ─────────────────

/**
 * GET /api/v1/talent/me/assessments
 * Returns the assessment bank items with answers stripped (no correctOptionId).
 * Used by the E2E closed-loop spec and Talent portal assessment browser.
 */
router.get(
  '/me/assessments',
  asyncHandler(async (_req, res) => {
    const { loadAssessmentBank } = await import('../services/talent/helpers.js');
    const items = loadAssessmentBank().map((item) => {
      if (item.kind === 'mcq') {
        const { correctOptionId: _, ...rest } = item;
        void _;
        return rest;
      }
      if (item.kind === 'descriptive') {
        const { rubricBullets, ...rest } = item;
        return { ...rest, rubric: rubricBullets, minWords: 50 };
      }
      return item;
    });
    ok(res, items);
  }),
);

/**
 * POST /api/v1/talent/me/assessments/:bankItemId/attempt
 * MCQ or descriptive attempt submission (BC 65/66).
 * Accepts proctorFlags (BC 68), calls recomputeCompetencyScore (BC 69),
 * maybeRegenerateSignal (BC 70-71).
 */
router.post(
  '/me/assessments/:bankItemId/attempt',
  asyncHandler(async (req, res) => {
    const { submitAttempt } = await import('../services/talent/assessmentService.js');
    const { bankItemId } = req.params as { bankItemId: string };
    const body = req.body as {
      careerTrackId?: string;
      timeSpentSec: number;
      answers: unknown;
      proctorFlags?: { tabSwitches?: number; copyAttempts?: number; fullscreenExits?: number };
    };
    const result = await submitAttempt(req.auth!.sub, bankItemId, body as Parameters<typeof submitAttempt>[2]);
    ok(res, result, 201);
  }),
);

// ─── BC 72-74 — Tutor session endpoints at /api/v1/ ─────────────────────────

/**
 * POST /api/v1/talent/me/tutor/sessions
 * Create a tutor session (BC 72 — feature flag gated).
 */
router.post(
  '/me/tutor/sessions',
  asyncHandler(async (req, res) => {
    const { startSession } = await import('../services/talent/tutorService.js');
    const body = req.body as { clusterCode: string; subtopicCode: string };
    const result = await startSession(req.auth!.sub, body as Parameters<typeof startSession>[1]);
    ok(res, result, 201);
  }),
);

/**
 * POST /api/v1/talent/me/tutor/sessions/:id/turn
 * Add a tutor turn (BC 73 — consent gated).
 */
router.post(
  '/me/tutor/sessions/:id/turn',
  asyncHandler(async (req, res) => {
    const { addTurn } = await import('../services/talent/tutorService.js');
    const { id } = req.params as { id: string };
    const { content } = req.body as { content: string };
    ok(res, await addTurn(req.auth!.sub, id, content));
  }),
);

/**
 * POST /api/v1/talent/me/tutor/sessions/:id/end
 * End session with summary (BC 74).
 */
router.post(
  '/me/tutor/sessions/:id/end',
  asyncHandler(async (req, res) => {
    const { endSession } = await import('../services/talent/tutorService.js');
    const { id } = req.params as { id: string };
    ok(res, await endSession(req.auth!.sub, id));
  }),
);

// ─── BC 76-78 — Signal dashboard: cluster bars + overall signal ──────────────

/**
 * GET /api/v1/talent/me/signal
 * Returns per-cluster bars with confidenceBand + suppressed flag, plus the
 * aggregated signalScore, signalBand, overallConfidence, and a top-level
 * suppressed flag (true when ALL clusters are suppressed or there are no scores).
 */
router.get(
  '/me/signal',
  asyncHandler(async (req, res) => {
    const learnerId = await getLearnerIdOrThrow(req.auth!.sub);

    const [scores, clusters] = await Promise.all([
      prisma.competencyScore.findMany({ where: { learnerId } }),
      prisma.competencyCluster.findMany({ orderBy: { code: 'asc' } }),
    ]);

    const nameByCode = new Map(clusters.map((c) => [c.code, c.name]));
    const scoreByCode = new Map(scores.map((s) => [s.clusterCode, s]));

    const clusterBars = clusters.map((c) => {
      const s = scoreByCode.get(c.code);
      const confidence = s?.confidence ?? 0;
      const band = confidenceBand(s ? confidence : null);
      const suppressed = confidence < SUPPRESSION_THRESHOLD;
      return {
        clusterCode: c.code,
        clusterName: nameByCode.get(c.code) ?? c.code,
        scoreWeighted: s ? Math.round(s.scoreWeighted) : 0,
        confidence: s ? Math.round(confidence * 100) / 100 : 0,
        confidenceBand: band,
        suppressed,
      };
    });

    const activeScores = scores.filter((s) => s.confidence >= SUPPRESSION_THRESHOLD);
    const allSuppressed = scores.length === 0 || activeScores.length === 0;

    const signalScore = allSuppressed
      ? 0
      : Math.round(activeScores.reduce((sum, s) => sum + s.scoreWeighted, 0) / activeScores.length);

    const overallConfidence =
      activeScores.length === 0
        ? 0
        : Math.round(
            (activeScores.reduce((sum, s) => sum + s.confidence, 0) / activeScores.length) * 100,
          ) / 100;

    ok(res, {
      clusterBars,
      signalScore,
      signalBand: signalBandFor(signalScore),
      overallConfidence,
      suppressed: allSuppressed,
    });
  }),
);

// ─── BC 79 — Top 3 gaps ──────────────────────────────────────────────────────

/**
 * GET /api/v1/talent/me/gaps
 * Returns top 3 weakest non-suppressed clusters (ascending scoreWeighted).
 * pathwayExists: true if any AugmentationProgramme exists for the cluster.
 */
router.get(
  '/me/gaps',
  asyncHandler(async (req, res) => {
    const learnerId = await getLearnerIdOrThrow(req.auth!.sub);

    const [scores, clusters, programmes] = await Promise.all([
      prisma.competencyScore.findMany({ where: { learnerId } }),
      prisma.competencyCluster.findMany(),
      prisma.augmentationProgramme.findMany({ select: { clusterCode: true } }),
    ]);

    const nameByCode = new Map(clusters.map((c) => [c.code, c.name]));
    const programmeClusterCodes = new Set(programmes.map((p) => p.clusterCode));

    const nonSuppressed = scores
      .filter((s) => s.confidence >= SUPPRESSION_THRESHOLD)
      .sort((a, b) => a.scoreWeighted - b.scoreWeighted)
      .slice(0, 3);

    ok(res, {
      gaps: nonSuppressed.map((s) => ({
        clusterCode: s.clusterCode,
        clusterName: nameByCode.get(s.clusterCode) ?? s.clusterCode,
        scoreWeighted: Math.round(s.scoreWeighted),
        confidence: Math.round(s.confidence * 100) / 100,
        pathwayExists: programmeClusterCodes.has(s.clusterCode),
      })),
    });
  }),
);

// ─── BC 80 — Cluster trajectory ──────────────────────────────────────────────

/**
 * GET /api/v1/talent/me/clusters/:code/trajectory
 * Returns last 10 attempt-derived scores for the cluster, in chronological order.
 * Only non-suspicious attempts are included.
 */
router.get(
  '/me/clusters/:code/trajectory',
  asyncHandler(async (req, res) => {
    const learnerId = await getLearnerIdOrThrow(req.auth!.sub);
    const { code } = req.params as { code: string };

    // Validate cluster code
    const clusterExists = await prisma.competencyCluster.findUnique({ where: { code: code as 'C1' } });
    if (!clusterExists) return fail(res, 404, 'NOT_FOUND', `Cluster ${code} not found`);

    const attempts = await prisma.assessmentAttemptV2.findMany({
      where: {
        learnerId,
        clusterCode: code as 'C1',
        suspicious: false,
      },
      orderBy: { submittedAt: 'desc' },
      take: 10,
      select: { score: true, submittedAt: true },
    });

    // Reverse to chronological order
    const trajectory = attempts
      .reverse()
      .map((a) => ({
        score: a.score ?? 0,
        submittedAt: a.submittedAt.toISOString(),
      }));

    ok(res, { trajectory });
  }),
);

// ─── BC 81-85 — Opportunities with near-miss + newMatch badge ────────────────

/**
 * GET /api/v1/talent/me/opportunities
 * Query params: minMatch (0-100), careerTrackId, city
 * Returns platform EmployerRoles with matchScore, near-miss analysis (BC 83),
 * near-miss pathway CTA (BC 84), and newMatch badge (BC 85).
 */
router.get(
  '/me/opportunities',
  asyncHandler(async (req, res) => {
    const learnerId = await getLearnerIdOrThrow(req.auth!.sub);

    const minMatch = req.query.minMatch ? Number(req.query.minMatch) : 0;
    const careerTrackIdFilter = req.query.careerTrackId as string | undefined;
    const cityFilter = req.query.city as string | undefined;

    const [scores, roles, applications, recentSignal] = await Promise.all([
      prisma.competencyScore.findMany({ where: { learnerId } }),
      prisma.employerRole.findMany({
        where: {
          status: 'active',
          ...(careerTrackIdFilter ? { careerTrackId: careerTrackIdFilter } : {}),
        },
        include: {
          employer: { select: { name: true } },
          careerTrack: { select: { code: true, name: true } },
        },
        take: 100,
      }),
      prisma.application.findMany({
        where: { learnerId },
        select: { roleId: true },
      }),
      // BC 85: newest GradiumSignal for this learner across any cluster
      prisma.gradiumSignal.findFirst({
        where: { learnerId, state: 'issued' },
        orderBy: { issuedAt: 'desc' },
        select: { issuedAt: true },
      }),
    ]);

    const scoreByCluster = new Map(scores.map((s) => [s.clusterCode, s.scoreWeighted]));
    const appliedRoleIds = new Set(applications.map((a) => a.roleId));

    // BC 85: signal is "new" if the most recent issuedAt is within 7 days
    const signalIsNew =
      recentSignal?.issuedAt != null &&
      Date.now() - recentSignal.issuedAt.getTime() < 7 * 24 * 60 * 60 * 1000;

    const opportunities = roles
      .map((role) => {
        const targets = (role.clusterTargets ?? {}) as Record<string, number>;
        const targetEntries = Object.entries(targets).filter(([, v]) => v > 0);

        if (targetEntries.length === 0) return null;

        // Compute matchScore using formula
        const entries = targetEntries.map(([code, target]) => ({
          scoreWeighted: scoreByCluster.get(code as 'C1') ?? 0,
          target,
          weight: 1,
        }));
        const rawMatch = matchScoreFn(entries);
        const matchScore = Math.round(rawMatch * 100);

        // Apply minMatch filter
        if (matchScore < minMatch) return null;

        // BC 83 — Near-miss analysis
        // A role is near-miss if learner is within 10 pts on ALL clusters
        // but short on ≤ 2 clusters.
        const shortClusters = targetEntries
          .map(([code, target]) => {
            const learnerScore = scoreByCluster.get(code as 'C1') ?? 0;
            return { clusterCode: code, delta: target - learnerScore, target, learnerScore };
          })
          .filter((c) => c.learnerScore < c.target); // short

        const withinTen = shortClusters.every((c) => c.learnerScore >= c.target - 10);
        const nearMiss = withinTen && shortClusters.length >= 1 && shortClusters.length <= 2;

        const nearMissDetails = nearMiss
          ? {
              gaps: shortClusters.map((c) => ({
                clusterCode: c.clusterCode,
                delta: Math.round(c.delta),
              })),
            }
          : null;

        // BC 85 — newMatch: signal regenerated within last 7 days AND no existing application
        const newMatch = signalIsNew && !appliedRoleIds.has(role.id);

        // Optionally filter by city if EmployerRole has a city field in jdExtraction
        if (cityFilter) {
          const jdEx = role.jdExtraction as Record<string, unknown> | null;
          const roleCity = (jdEx?.city ?? jdEx?.location ?? '') as string;
          if (roleCity && !roleCity.toLowerCase().includes(cityFilter.toLowerCase())) {
            return null;
          }
        }

        return {
          roleId: role.id,
          title: role.title,
          employerName: role.employer.name,
          matchScore,
          careerTrackCode: role.careerTrack.code,
          city: ((role.jdExtraction as Record<string, unknown> | null)?.city as string) ?? null,
          nearMiss,
          nearMissDetails,
          // BC 84 — near-miss CTA: first short cluster's code, no programme lookup needed
          // (learner navigates to /learn#<code>). We include null when there's no near-miss.
          nearMissPathway: nearMiss && shortClusters.length > 0
            ? { clusterCode: shortClusters[0].clusterCode, pathwayId: null }
            : null,
          newMatch,
        };
      })
      .filter((o): o is NonNullable<typeof o> => o !== null)
      .sort((a, b) => b.matchScore - a.matchScore);

    ok(res, { opportunities });
  }),
);

// ─── BC 86 — AI Resume Generation ────────────────────────────────────────────

/**
 * POST /api/v1/talent/me/resume/generate
 * Consent-gated on `opportunity-matching`.
 * Optional body: { roleId } to tailor to a specific employer role's JD.
 * Calls resumeBullets Groq prompt with learner Signal summary + JD text.
 * Returns { id, headline, summary, sections }.
 *
 * IP rule: numeric scores are passed as plain cluster scores (the learner's OWN
 * derived data, not formula constants). No DECAY/confidence weights in the prompt.
 */
router.post(
  '/me/resume/generate',
  asyncHandler(async (req, res) => {
    const userId = req.auth!.sub;
    await requireConsent(userId, 'opportunity-matching');

    const { roleId } = (req.body ?? {}) as { roleId?: string };

    const { learner } = await getLearnerWithScope(userId);

    // Fetch learner's competency scores
    const scores = await prisma.competencyScore.findMany({ where: { learnerId: learner.id } });
    const clusters = await prisma.competencyCluster.findMany({ orderBy: { code: 'asc' } });
    const clusterNameMap = new Map(clusters.map((c) => [c.code, c.name]));

    // Build cluster scores map (only non-suppressed clusters)
    const clusterScores: Record<string, number> = {};
    for (const s of scores) {
      if (s.confidence >= SUPPRESSION_THRESHOLD) {
        clusterScores[s.clusterCode] = Math.round(s.scoreWeighted);
      }
    }

    // Determine role context from a specific role or learner's primary track
    let roleTitle = 'General Role';
    let employer = 'General Employer';
    let requirements: string[] = [];
    let jdText: string | undefined;
    let matchedRoleId: string | null = null;

    if (roleId) {
      const role = await prisma.employerRole.findUnique({
        where: { id: roleId },
        include: { employer: { select: { name: true } } },
      });
      if (!role) return fail(res, 404, 'NOT_FOUND', 'Role not found');
      matchedRoleId = role.id;
      roleTitle = role.title;
      employer = role.employer.name;
      jdText = role.jdText ?? undefined;
      const jdEx = role.jdExtraction as Record<string, unknown> | null;
      if (jdEx?.extractedRequirements && Array.isArray(jdEx.extractedRequirements)) {
        requirements = (jdEx.extractedRequirements as unknown[])
          .map((r) => String(r))
          .slice(0, 8);
      } else if (jdText) {
        // Derive requirements from first 6 lines of JD text that look like bullet points
        requirements = jdText
          .split('\n')
          .map((l) => l.replace(/^[-•*]\s*/, '').trim())
          .filter((l) => l.length > 20)
          .slice(0, 6);
      }
    } else {
      // Use primary career track info as context
      const primaryEnrollment = learner.careerTrackEnrollments.find((e) => e.isPrimary)
        ?? learner.careerTrackEnrollments[0];
      if (primaryEnrollment) {
        roleTitle = primaryEnrollment.careerTrack.name + ' Candidate';
        const trackTargets = parseTargets(primaryEnrollment.careerTrack.clusterTargets);
        requirements = Object.entries(trackTargets)
          .filter(([, v]) => v > 0)
          .sort(([, a], [, b]) => b - a)
          .slice(0, 4)
          .map(([code]) => `Strong ${clusterNameMap.get(code as 'C1') ?? code} competency`);
      }
    }

    const { resumeBullets } = await import('../services/ai/prompts/resumeBullets.js');
    const cohort = await prisma.cohort.findUnique({ where: { id: learner.cohortId } });

    const { resume, meta } = await resumeBullets({
      learnerName: learner.name,
      institution: learner.institution.name,
      cohortYear: cohort?.name ?? String(new Date().getFullYear()),
      clusterScores,
      roleTitle,
      employer,
      requirements,
      pastWork: learner.uploadedResumeText ?? undefined,
    });

    logger.info({ userId, latencyMs: meta.latencyMs, model: meta.model }, 'resumeBullets generated');

    // Persist the generated resume using Prisma Resume model
    const primaryEnrollment = learner.careerTrackEnrollments.find((e) => e.isPrimary)
      ?? learner.careerTrackEnrollments[0];
    if (!primaryEnrollment) {
      return fail(res, 409, 'VALIDATION', 'Learner has no career track enrollment');
    }

    const avgScore = scores.length > 0
      ? Math.round(scores.reduce((s, r) => s + r.scoreWeighted, 0) / scores.length)
      : 0;
    const avgConf = scores.length > 0
      ? scores.reduce((s, r) => s + r.confidence, 0) / scores.length
      : 0;

    const saved = await prisma.resume.create({
      data: {
        learnerId: learner.id,
        careerTrackId: primaryEnrollment.careerTrackId,
        variant: matchedRoleId ? 'jd_tailored' : 'general',
        matchedRoleId,
        jdText: jdText ?? null,
        headline: resume.headline,
        summary: resume.summary,
        sections: resume.sections as unknown as Prisma.InputJsonValue,
        signalScoreAtGen: avgScore,
        signalConfAtGen: Math.round(avgConf * 1000) / 1000,
      },
    });

    ok(res, {
      id: saved.id,
      headline: saved.headline,
      summary: saved.summary,
      sections: resume.sections,
      createdAt: saved.createdAt.toISOString(),
    }, 201);
  }),
);

// ─── BC 87 — Save Resume ──────────────────────────────────────────────────────

/**
 * POST /api/v1/talent/me/resume
 * Body: { headline, summary, sections, careerTrackId? }
 * Upserts: if the learner has an existing general resume for the career track,
 * creates a new row (keeps history). Returns { id, updatedAt }.
 */
router.post(
  '/me/resume',
  asyncHandler(async (req, res) => {
    const userId = req.auth!.sub;
    const { learner } = await getLearnerWithScope(userId);

    const body = req.body as {
      headline?: string;
      summary?: string;
      sections?: unknown;
      careerTrackId?: string;
    };

    if (!body.headline || !body.summary || !Array.isArray(body.sections)) {
      return fail(res, 400, 'VALIDATION', '`headline`, `summary`, and `sections` are required');
    }

    const primaryEnrollment = learner.careerTrackEnrollments.find((e) => e.isPrimary)
      ?? learner.careerTrackEnrollments[0];

    const careerTrackId = body.careerTrackId ?? primaryEnrollment?.careerTrackId;
    if (!careerTrackId) {
      return fail(res, 409, 'VALIDATION', 'Learner has no career track enrollment');
    }

    const scores = await prisma.competencyScore.findMany({ where: { learnerId: learner.id } });
    const avgScore = scores.length > 0
      ? Math.round(scores.reduce((s, r) => s + r.scoreWeighted, 0) / scores.length)
      : 0;
    const avgConf = scores.length > 0
      ? scores.reduce((s, r) => s + r.confidence, 0) / scores.length
      : 0;

    const saved = await prisma.resume.create({
      data: {
        learnerId: learner.id,
        careerTrackId,
        variant: 'general',
        headline: body.headline,
        summary: body.summary,
        sections: body.sections as Prisma.InputJsonValue,
        signalScoreAtGen: avgScore,
        signalConfAtGen: Math.round(avgConf * 1000) / 1000,
      },
    });

    ok(res, { id: saved.id, updatedAt: saved.createdAt.toISOString() });
  }),
);

// ─── BC 88 — Resume Export ────────────────────────────────────────────────────

/**
 * GET /api/v1/talent/me/resume/export
 * Returns the most recent saved Resume as PDF-ready JSON.
 * If no resume: 404 with { data: null, error: ... }.
 */
router.get(
  '/me/resume/export',
  asyncHandler(async (req, res) => {
    const userId = req.auth!.sub;
    const learnerId = await getLearnerIdOrThrow(userId);

    const resume = await prisma.resume.findFirst({
      where: { learnerId },
      orderBy: { createdAt: 'desc' },
    });

    if (!resume) {
      return fail(res, 404, 'NOT_FOUND', 'No resume found. Generate or save a resume first.');
    }

    ok(res, {
      id: resume.id,
      headline: resume.headline,
      summary: resume.summary,
      sections: resume.sections,
      exportedAt: new Date().toISOString(),
    });
  }),
);

// ─── BC 116 — Apply to opportunity ───────────────────────────────────────────

/**
 * POST /api/v1/talent/me/opportunities/:roleId/apply
 * Idempotent on (learnerId, roleId). Role must have status = 'active'.
 * BC 124 — active-only check handles paused/closed → 409 ROLE_NOT_ACCEPTING.
 */
router.post(
  '/me/opportunities/:roleId/apply',
  asyncHandler(async (req, res) => {
    const userId = req.auth!.sub;
    const { roleId } = req.params as { roleId: string };
    const learnerId = await getLearnerIdOrThrow(userId);

    // Check role exists and is accepting applications
    const role = await prisma.employerRole.findUnique({
      where: { id: roleId },
      include: { employer: { select: { users: { where: { role: 'TA_LEAD' }, select: { id: true } } } } },
    });
    if (!role) return fail(res, 404, 'NOT_FOUND', 'Role not found');
    if (role.status !== 'active') {
      return fail(res, 409, 'ROLE_NOT_ACCEPTING', 'This role is not currently accepting applications');
    }

    // Idempotent: return existing application if already applied
    const existing = await prisma.application.findUnique({
      where: { learnerId_roleId: { learnerId, roleId } },
    });
    if (existing) {
      return ok(res, {
        id: existing.id,
        roleId: existing.roleId,
        status: existing.status,
        appliedAt: existing.appliedAt.toISOString(),
      });
    }

    // Create application + audit
    const application = await withAudit({
      userId,
      action: 'application_created',
      entityType: 'Application',
      entityId: `${learnerId}:${roleId}`,
      before: null,
      fn: async () => prisma.application.create({
        data: { learnerId, roleId, status: 'Applied', statusUpdatedBy: userId },
      }),
    });

    // Notify TA_LEAD(s) for this employer
    for (const taUser of role.employer.users) {
      await dispatchNotification(
        taUser.id,
        'new_application',
        'New application received',
        'A candidate applied to your role.',
        `/workforce/roles/${roleId}/pipeline`,
      );
    }

    ok(res, {
      id: application.id,
      roleId: application.roleId,
      status: application.status,
      appliedAt: application.appliedAt.toISOString(),
    }, 201);
  }),
);

// ─── BC 120 — List my applications ───────────────────────────────────────────

const NEXT_ACTION_MAP: Record<string, string> = {
  Applied: 'Awaiting review',
  Shortlisted: 'Interview scheduled',
  Interview: 'Awaiting decision',
  Offer: 'Awaiting decision',
  Accepted: '—',
  Declined: '—',
  Withdrawn: '—',
};

/**
 * GET /api/v1/talent/me/applications
 * Returns all applications for the logged-in learner with role/employer context.
 */
router.get(
  '/me/applications',
  asyncHandler(async (req, res) => {
    const learnerId = await getLearnerIdOrThrow(req.auth!.sub);

    const applications = await prisma.application.findMany({
      where: { learnerId },
      orderBy: { appliedAt: 'desc' },
    });

    // Batch-fetch roles for all application roleIds
    const roleIds = Array.from(new Set(applications.map((a) => a.roleId)));
    const roles = await prisma.employerRole.findMany({
      where: { id: { in: roleIds } },
      include: { employer: { select: { name: true } } },
    });
    const roleMap = new Map(roles.map((r) => [r.id, r]));

    ok(res, {
      applications: applications.map((a) => {
        const role = roleMap.get(a.roleId);
        return {
          id: a.id,
          roleId: a.roleId,
          roleTitle: role?.title ?? 'Unknown role',
          employerName: role?.employer.name ?? 'Unknown employer',
          status: a.status,
          appliedAt: a.appliedAt.toISOString(),
          statusUpdatedAt: a.statusUpdatedAt.toISOString(),
          nextAction: NEXT_ACTION_MAP[a.status] ?? '—',
        };
      }),
    });
  }),
);

// ─── BC 120 — Withdraw application (talent side) ──────────────────────────────

const VALID_WITHDRAW_FROM = new Set(['Applied', 'Shortlisted', 'Interview', 'Offer']);

/**
 * POST /api/v1/talent/me/applications/:id/withdraw
 * Verifies ownership, then transitions to Withdrawn.
 */
router.post(
  '/me/applications/:id/withdraw',
  asyncHandler(async (req, res) => {
    const userId = req.auth!.sub;
    const { id } = req.params as { id: string };
    const learnerId = await getLearnerIdOrThrow(userId);

    const application = await prisma.application.findUnique({ where: { id } });
    if (!application) return fail(res, 404, 'NOT_FOUND', 'Application not found');
    if (application.learnerId !== learnerId) {
      return fail(res, 403, 'AUTH_FORBIDDEN', 'Not your application');
    }
    if (!VALID_WITHDRAW_FROM.has(application.status)) {
      return fail(res, 409, 'INVALID_TRANSITION', `Cannot withdraw from status: ${application.status}`);
    }

    const before = { status: application.status };
    const updated = await withAudit({
      userId,
      action: 'application_status_changed',
      entityType: 'Application',
      entityId: id,
      before,
      after: { status: 'Withdrawn' },
      fn: async () => prisma.application.update({
        where: { id },
        data: { status: 'Withdrawn', statusUpdatedAt: new Date(), statusUpdatedBy: userId },
      }),
    });

    ok(res, { id: updated.id, status: updated.status, statusUpdatedAt: updated.statusUpdatedAt.toISOString() });
  }),
);

// ─── BC 149 — Submit DPDP data dispute ───────────────────────────────────────

/**
 * POST /api/v1/talent/me/data/dispute
 * Body: { description: string }
 * LEARNER only. Creates a DisputeRecord and an AuditLog entry.
 */
router.post(
  '/me/data/dispute',
  asyncHandler(async (req, res) => {
    const userId = req.auth!.sub;
    const body = req.body as { description?: string };

    if (!body.description || typeof body.description !== 'string' || body.description.trim() === '') {
      return fail(res, 400, 'VALIDATION', '`description` is required');
    }

    const { auditCreate } = await import('../middleware/audit.js');
    const dispute = await auditCreate({
      userId,
      action: 'dispute_submitted',
      entityType: 'DisputeRecord',
      entityId: userId,
      fn: async () => prisma.disputeRecord.create({
        data: {
          userId,
          description: body.description!.trim(),
          status: 'Open',
        },
      }),
    });

    ok(res, {
      id: dispute.id,
      status: dispute.status,
      createdAt: dispute.createdAt.toISOString(),
      message: 'Dispute submitted. You will receive acknowledgement within 72 hours.',
    }, 201);
  }),
);

// ─── BC 151 — List my disputes ────────────────────────────────────────────────

/**
 * GET /api/v1/talent/me/data/disputes
 * Returns all DisputeRecord rows for this learner.
 */
router.get(
  '/me/data/disputes',
  asyncHandler(async (req, res) => {
    const userId = req.auth!.sub;

    const disputes = await prisma.disputeRecord.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });

    ok(res, {
      disputes: disputes.map((d) => ({
        id: d.id,
        description: d.description,
        status: d.status,
        createdAt: d.createdAt.toISOString(),
        acknowledgedAt: d.acknowledgedAt?.toISOString() ?? null,
        resolvedAt: d.resolvedAt?.toISOString() ?? null,
        resolution: d.resolution ?? null,
      })),
    });
  }),
);

// ─── Notification helper (stub — replaced by real notificationService later) ──

async function dispatchNotification(
  userId: string,
  type: string,
  title: string,
  body: string,
  deepLink: string,
) {
  await prisma.notification.create({ data: { userId, type, title, body, deepLink } });
}

// ─── BC 89 — Signal Export ────────────────────────────────────────────────────

/**
 * GET /api/v1/talent/me/signal/export
 * Returns a portable Ed25519-signed Signal token.
 * Payload: { sub, formulasVersion, issuedAt, expiresAt, clusterSummary }
 * Only includes clusters with confidence >= SUPPRESSION_THRESHOLD.
 * Band labels only (no raw numeric scores in payload per IP rule).
 * typ: 'signal' in the header.
 */
router.get(
  '/me/signal/export',
  asyncHandler(async (req, res) => {
    const userId = req.auth!.sub;
    const learnerId = await getLearnerIdOrThrow(userId);

    const [scores, clusters] = await Promise.all([
      prisma.competencyScore.findMany({ where: { learnerId } }),
      prisma.competencyCluster.findMany({ orderBy: { code: 'asc' } }),
    ]);

    // Only non-suppressed clusters (confidence >= 0.30)
    const activeScores = scores.filter((s) => s.confidence >= SUPPRESSION_THRESHOLD);

    if (activeScores.length === 0) {
      return fail(res, 409, 'VALIDATION', 'No clusters meet the confidence threshold for export. Complete more assessments first.');
    }

    const clusterNameMap = new Map(clusters.map((c) => [c.code, c.name]));

    const clusterSummary = activeScores.map((s) => ({
      clusterCode: s.clusterCode,
      clusterName: clusterNameMap.get(s.clusterCode) ?? s.clusterCode,
      band: signalBandFor(s.scoreWeighted),
      confidence: confidenceBand(s.confidence),
    }));

    // Build payload — band labels only, no numeric scores
    const payloadData = {
      sub: learnerId,
      formulasVersion,
      clusterSummary,
    };

    const { token, iat, exp } = signCustomPayload('signal', payloadData);
    const issuedAt = new Date(iat * 1000).toISOString();
    const expiresAt = new Date(exp * 1000).toISOString();

    ok(res, {
      token,
      issuedAt,
      expiresAt,
      payload: { ...payloadData, issuedAt, expiresAt },
    });
  }),
);

// ─── BC 90 — Board Brief ─────────────────────────────────────────────────────

/**
 * GET /api/v1/talent/me/signal/board-brief
 * Same key pair as Signal (D8), typ: 'board-brief'.
 * Payload: cluster summary (band labels only, no raw scores) +
 *          top 3 employer matches by matchScore.
 * matchScore returned as percentage string (e.g. "82%").
 */
router.get(
  '/me/signal/board-brief',
  asyncHandler(async (req, res) => {
    const userId = req.auth!.sub;
    const learnerId = await getLearnerIdOrThrow(userId);

    const [scores, clusters, activeRoles] = await Promise.all([
      prisma.competencyScore.findMany({ where: { learnerId } }),
      prisma.competencyCluster.findMany({ orderBy: { code: 'asc' } }),
      prisma.employerRole.findMany({
        where: { status: 'active' },
        include: { employer: { select: { name: true } } },
        take: 200,
      }),
    ]);

    const clusterNameMap = new Map(clusters.map((c) => [c.code, c.name]));
    const activeScores = scores.filter((s) => s.confidence >= SUPPRESSION_THRESHOLD);

    const clusterSummary = activeScores.map((s) => ({
      clusterCode: s.clusterCode,
      clusterName: clusterNameMap.get(s.clusterCode) ?? s.clusterCode,
      band: signalBandFor(s.scoreWeighted),
      confidence: confidenceBand(s.confidence),
    }));

    const scoreByCluster = new Map(scores.map((s) => [s.clusterCode, s.scoreWeighted]));

    // Compute matchScore for each role and take top 3
    const rankedRoles = activeRoles
      .map((role) => {
        const targets = (role.clusterTargets ?? {}) as Record<string, number>;
        const entries = Object.entries(targets)
          .filter(([, v]) => v > 0)
          .map(([code, target]) => ({
            scoreWeighted: scoreByCluster.get(code as 'C1') ?? 0,
            target,
            weight: 1,
          }));
        if (entries.length === 0) return null;
        const rawMatch = matchScoreFn(entries);
        return {
          roleId: role.id,
          title: role.title,
          employerName: role.employer.name,
          matchScore: `${Math.round(rawMatch * 100)}%`,
          matchScoreNum: rawMatch,
        };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null)
      .sort((a, b) => b.matchScoreNum - a.matchScoreNum)
      .slice(0, 3)
      .map(({ matchScoreNum: _dropped, ...rest }) => rest); // drop internal sort key

    const payloadData = {
      sub: learnerId,
      formulasVersion,
      clusterSummary,
      topMatches: rankedRoles,
    };

    const { token, iat, exp } = signCustomPayload('board-brief', payloadData);
    const issuedAt = new Date(iat * 1000).toISOString();
    const expiresAt = new Date(exp * 1000).toISOString();

    ok(res, {
      token,
      issuedAt,
      expiresAt,
      payload: { ...payloadData, issuedAt, expiresAt },
    });
  }),
);

export default router;
