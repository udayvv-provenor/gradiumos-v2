/**
 * v3PortalRoutes — endpoints in the EXACT shapes the Claude-Design-generated
 * portals expect. Sits in front of the v2-inherited services and reshapes
 * responses where needed; adds new handlers where the portal expects something
 * the legacy backend never had.
 *
 * Handlers return REAL data from the DB where the underlying state exists.
 * For surfaces that genuinely have no data yet on a fresh install (e.g. KPIs
 * for a brand-new institution with zero learners), they return zero/empty —
 * which is the truthful answer for an MVP-alpha that just signed up.
 *
 * Anything tagged `// MVP-SCAFFOLD:` is placeholder logic intended to be
 * replaced when a richer underlying implementation lands. Grep that token
 * to find every scaffold before lock.
 */
import { Router, type Request, type Response } from 'express';
import { prisma } from '../config/db.js';
import { ok } from '../utils/response.js';
import { AppError } from '../utils/AppError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { acceptUpload, normaliseUpload } from '../services/upload/uploadMiddleware.js';
import * as upload from '../controllers/v3UploadController.js';
import type { ClusterCode, Archetype } from '@prisma/client';

const router = Router();
router.use(requireAuth);

// (Cluster codes referenced via DB queries; constant kept inline where needed.)
void (null as unknown as ClusterCode);

function bandFor(score: number): 'Above' | 'Near' | 'Below' {
  if (score >= 70) return 'Above';
  if (score >= 55) return 'Near';
  return 'Below';
}

/* ─── /api/auth/me — enriched user shape per portal ─────────────────────── */
// (Already covered by existing /api/auth/me; portals don't call it directly,
//  but signup/login responses need institutionName etc. handled below.)

/* ────────────────────────────────────────────────────────────────────────
 * CAMPUS — Dean / Placement Officer
 * ──────────────────────────────────────────────────────────────────────── */

// v3.1.1 — Institution context (name + invite code) for the logged-in dean.
// Single source of truth so the Learners page never falls back to localStorage
// (which was showing "—" if the dean came in via /login instead of /signup).
router.get('/campus/me/institution', requireRole('DEAN', 'PLACEMENT_OFFICER'), asyncHandler(async (req: Request, res: Response) => {
  const institutionId = req.auth!.inst!;
  const inst = await prisma.institution.findUnique({
    where: { id: institutionId },
    // BC 29 — kycStatus included so frontend can show a pending-KYC banner.
    select: { id: true, name: true, type: true, inviteCode: true, createdAt: true, kycStatus: true },
  });
  if (!inst) throw new AppError('NOT_FOUND', 'Institution not found');
  ok(res, inst);
}));

/* GET /api/campus/me/institution/public-profile — v3.1.6 live-pull demonstration.
 *  First Dean to view this triggers Serper × 3 + Groq extraction → DB cache.
 *  Subsequent views (any Dean of any institution) hit the cache. Pattern is
 *  the canonical "live-on-spot, then store, then pull" Uday's strategy. */
router.get('/campus/me/institution/public-profile', requireRole('DEAN', 'PLACEMENT_OFFICER'), asyncHandler(async (req: Request, res: Response) => {
  const institutionId = req.auth!.inst!;
  const inst = await prisma.institution.findUnique({
    where: { id: institutionId },
    select: { id: true, name: true },
  });
  if (!inst) throw new AppError('NOT_FOUND', 'Institution not found');
  const { getInstitutionPublicProfile } = await import('../services/publicData/institutionPublicProfile.js');
  const force = req.query.refresh === '1';
  const result = await getInstitutionPublicProfile({
    institutionId: inst.id,
    institutionName: inst.name,
    forceRefresh: force,
  });
  ok(res, result);
}));

router.get('/campus/overview/kpis', requireRole('DEAN', 'PLACEMENT_OFFICER'), asyncHandler(async (req: Request, res: Response) => {
  const institutionId = req.auth!.inst!;
  const [learnerCount, trackCount, scores] = await Promise.all([
    prisma.learner.count({ where: { institutionId } }),
    prisma.track.count({ where: { institutionId } }),
    prisma.competencyScore.findMany({
      where: { learner: { institutionId } },
      select: { scoreWeighted: true, confidence: true },
    }),
  ]);
  const averageReadiness = scores.length > 0
    ? Math.round(scores.reduce((s, x) => s + x.scoreWeighted, 0) / scores.length)
    : 0;
  const averageConfidence = scores.length > 0
    ? scores.reduce((s, x) => s + (x.confidence ?? 0), 0) / scores.length
    : 0;
  ok(res, {
    totalLearners:    learnerCount,
    averageReadiness,
    averageConfidence,
    careerTracks:     trackCount,
  });
}));

router.get('/campus/insight/cohort-gaps', requireRole('DEAN', 'PLACEMENT_OFFICER'), asyncHandler(async (req: Request, res: Response) => {
  const institutionId = req.auth!.inst!;
  const clusters = await prisma.competencyCluster.findMany({ orderBy: { code: 'asc' } });
  const result = await Promise.all(clusters.map(async (c) => {
    const scores = await prisma.competencyScore.findMany({
      where: { clusterCode: c.code, learner: { institutionId } },
      select: { scoreWeighted: true },
    });
    const total = scores.length;
    if (total === 0) {
      return { id: c.code, name: c.shortName, score: 0, pctBelow: 0, pctNear: 0, pctAbove: 0 };
    }
    const avg = scores.reduce((s, x) => s + x.scoreWeighted, 0) / total;
    let below = 0, near = 0, above = 0;
    for (const s of scores) {
      const b = bandFor(s.scoreWeighted);
      if (b === 'Below') below++;
      else if (b === 'Near') near++;
      else above++;
    }
    return {
      id:       c.code,
      name:     c.shortName,
      score:    Math.round(avg),
      pctBelow: Math.round((below / total) * 100),
      pctNear:  Math.round((near  / total) * 100),
      pctAbove: Math.round((above / total) * 100),
    };
  }));
  ok(res, result);
}));

router.get('/campus/career-tracks', requireRole('DEAN', 'PLACEMENT_OFFICER'), asyncHandler(async (req: Request, res: Response) => {
  const institutionId = req.auth!.inst!;
  // Track is institution-scoped; CareerTrack is global. Surface Tracks of THIS institution
  // each linked to its CareerTrack template.
  const tracks = await prisma.track.findMany({
    where: { institutionId },
    include: {
      careerTrack: true,
      _count: { select: { learners: true } },
    },
    orderBy: { createdAt: 'desc' },
  });
  ok(res, tracks.map((t) => ({
    id:           t.id,
    name:         t.name,
    code:         t.careerTrack?.code ?? 'CUSTOM',
    archetype:    t.archetype,
    learnerCount: t._count.learners,
    createdAt:    t.createdAt.toISOString(),
  })));
}));

// v3.1.2 — career tracks are now DYNAMIC. Anyone (Dean OR TA) can create one;
// AI maps the new track's name+description to the locked 8-cluster vocabulary.
// The /career-tracks-canonical endpoint stays for back-compat (returns ALL
// tracks now, not just the seeded 8). The new endpoints below let users
// search + create.
router.get('/campus/career-tracks-canonical', requireRole('DEAN', 'PLACEMENT_OFFICER'), asyncHandler(async (_req: Request, res: Response) => {
  const cts = await prisma.careerTrack.findMany({
    select: { id: true, code: true, name: true },
    orderBy: [{ name: 'asc' }],
  });
  ok(res, cts);
}));

/* v3.1.2 — Cross-portal career-track search + create.
 *
 * Both DEAN/PLACEMENT_OFFICER (Campus) and TA_LEAD (Workforce) hit the same
 * shared catalogue. Tracks are typeahead-searchable across the platform; if a
 * user types something nobody's created yet, they can POST to add it (AI
 * derives cluster weights via inferTrackClusters).
 *
 * The cluster TAXONOMY (C1..C8) and its WEIGHTS sum-to-1 + range constraints
 * remain the locked IP. The track NAME is open. */

// GET /api/career-tracks/search?q=foo — typeahead, all roles (no auth role gate
// beyond "must be authenticated" — Workforce TA + Campus DEAN both query this).
router.get('/career-tracks/search', asyncHandler(async (req: Request, res: Response) => {
  if (!req.auth) throw new AppError('AUTH_FORBIDDEN', 'Authentication required');
  const q = ((req.query.q as string) ?? '').trim();
  const where = q.length > 0
    ? { name: { contains: q, mode: 'insensitive' as const } }
    : {};
  const tracks = await prisma.careerTrack.findMany({
    where,
    select: { id: true, code: true, name: true, archetype: true },
    orderBy: { name: 'asc' },
    take: 25,
  });
  ok(res, tracks);
}));

// POST /api/career-tracks — create a new track (any authenticated user)
// Returns the new track + the inferred cluster weights/targets for transparency.
router.post('/career-tracks', asyncHandler(async (req: Request, res: Response) => {
  if (!req.auth) throw new AppError('AUTH_FORBIDDEN', 'Authentication required');
  const body = req.body as { name?: string; description?: string };
  if (!body.name || body.name.trim().length < 2) {
    throw new AppError('VALIDATION', 'Track name must be at least 2 characters');
  }
  const name = body.name.trim();

  // Idempotency: if a track with this name (case-insensitive) already exists,
  // return it instead of creating a duplicate. Prevents "Senior Backend Engineer"
  // and "senior backend engineer" being two different records.
  const existing = await prisma.careerTrack.findFirst({
    where: { name: { equals: name, mode: 'insensitive' } },
  });
  if (existing) {
    ok(res, { track: existing, created: false, inference: null });
    return;
  }

  // Generate a CODE — auto-derived from name (uppercased initials, max 8 chars)
  const autoCode = name
    .split(/\s+/)
    .map(w => w.replace(/[^A-Za-z0-9]/g, ''))
    .filter(Boolean)
    .map(w => w[0]?.toUpperCase() ?? '')
    .join('')
    .slice(0, 8) || name.slice(0, 8).toUpperCase();
  // Ensure code uniqueness: if collision, suffix a numeric counter
  let code = autoCode;
  let suffix = 2;
  while (await prisma.careerTrack.findUnique({ where: { code } })) {
    code = `${autoCode}${suffix++}`.slice(0, 8);
    if (suffix > 99) { code = `T${Date.now().toString().slice(-7)}`; break; }
  }

  // AI-infer cluster weights + targets (uses Locked IP cluster vocabulary)
  // v3.1.8 — input-hash dedup: same (name + description) returns the same
  // cluster shape for 90 days. Two institutions creating "Backend SDE" hit
  // the same cache row, no duplicate Groq cost.
  const { inferTrackClusters } = await import('../services/ai/prompts/inferTrackClusters.js');
  const { createHash: ch } = await import('crypto');
  const inferKey = `inferTrackName:${name.toLowerCase()}|${(body.description ?? '').slice(0,300).toLowerCase()}:v1`;
  const inferHash = ch('sha256').update(inferKey).digest('hex').slice(0, 16);
  let inferred: Awaited<ReturnType<typeof inferTrackClusters>>['inferred'];
  const inferCached = await prisma.publicDataCache.findFirst({
    where: { stakeholderKind: 'system', stakeholderId: 'track-name-clusters', slot: 'inferred-track', contextHash: inferHash },
  });
  if (inferCached && inferCached.expiresAt > new Date() && inferCached.payload) {
    inferred = inferCached.payload as typeof inferred;
  } else {
    const liveInfer = await inferTrackClusters({
      trackName: name,
      trackDescription: body.description?.trim() || undefined,
    });
    inferred = liveInfer.inferred;
    if (!liveInfer.meta.model.startsWith('mock-')) {
      try {
        await prisma.publicDataCache.upsert({
          where:  { stakeholderKind_stakeholderId_slot_contextHash: { stakeholderKind: 'system', stakeholderId: 'track-name-clusters', slot: 'inferred-track', contextHash: inferHash } },
          update: { payload: inferred as unknown as object, retrievedAt: new Date(), expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000), fromFixture: false },
          create: { stakeholderKind: 'system', stakeholderId: 'track-name-clusters', slot: 'inferred-track', contextHash: inferHash, payload: inferred as unknown as object, fromFixture: false, expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000) },
        });
      } catch { /* non-fatal */ }
    }
  }

  const track = await prisma.careerTrack.create({
    data: {
      name,
      code,
      // archetype: null (per v3.1.1 — no longer a user input; derived per-role from JD)
      clusterWeights: inferred.clusterWeights,
      clusterTargets: inferred.clusterTargets,
    },
  });

  ok(res, {
    track:     { id: track.id, code: track.code, name: track.name },
    inference: { ...inferred, sourceModel: 'mock-or-groq' },
    created:   true,
  });
}));

/* v3.1.1 — Per-track performance overview for the Campus dashboard.
 *
 * For each Track this institution owns, returns:
 *   - learnerCount         — how many learners enrolled
 *   - readiness            — 0..100, avg cluster score across enrolled learners
 *   - curriculumMapped     — boolean, has a Curriculum row
 *   - sectorDemand         — sample size + total seats from EmployerRoles
 *                             targeting the same canonical CareerTrack
 *
 * This is the surface the user said existed in v1/v2 — "how am I performing
 * w.r.t this career track vs others vs demand." Dropped during v3 rebuild;
 * restored here. */
router.get('/campus/tracks-overview', requireRole('DEAN', 'PLACEMENT_OFFICER'), asyncHandler(async (req: Request, res: Response) => {
  const institutionId = req.auth!.inst!;
  const tracks = await prisma.track.findMany({
    where: { institutionId },
    include: {
      careerTrack: true,
      _count: { select: { learners: true } },
      learners: { select: { id: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  const result = await Promise.all(tracks.map(async (t) => {
    // Readiness — avg of cluster scores across enrolled learners
    const learnerIds = t.learners.map((l) => l.id);
    const scores = learnerIds.length > 0
      ? await prisma.competencyScore.findMany({
          where: { learnerId: { in: learnerIds } },
          select: { scoreWeighted: true },
        })
      : [];
    const readiness = scores.length > 0
      ? Math.round(scores.reduce((s, x) => s + x.scoreWeighted, 0) / scores.length)
      : 0;

    // Curriculum mapped?
    const curriculum = t.careerTrackId
      ? await prisma.curriculum.findFirst({
          where: { institutionId, careerTrackId: t.careerTrackId },
          orderBy: { uploadedAt: 'desc' },
          select: { id: true, uploadedAt: true },
        })
      : null;

    // Sector demand — # of EmployerRoles targeting the same canonical CareerTrack
    const employerRoles = t.careerTrackId
      ? await prisma.employerRole.findMany({
          where: { careerTrackId: t.careerTrackId, status: 'active' },
          select: { seatsPlanned: true, employerId: true },
        })
      : [];
    const totalSeats = employerRoles.reduce((s, r) => s + r.seatsPlanned, 0);
    const uniqueEmployers = new Set(employerRoles.map((r) => r.employerId)).size;

    return {
      id:                 t.id,
      name:               t.name,
      code:               t.careerTrack?.code ?? 'CUSTOM',
      learnerCount:       t._count.learners,
      readiness,
      curriculumMapped:   curriculum !== null,
      curriculumUploadedAt: curriculum?.uploadedAt?.toISOString() ?? null,
      sectorDemand: {
        roles:     employerRoles.length,
        seats:     totalSeats,
        employers: uniqueEmployers,
      },
    };
  }));

  ok(res, result);
}));

router.post('/campus/career-tracks', requireRole('DEAN', 'PLACEMENT_OFFICER'), asyncHandler(async (req: Request, res: Response) => {
  const institutionId = req.auth!.inst!;
  // v3.1 — `archetype` is no longer required from the Dean. Tracks are
  // curriculum containers; the archetype mix is DERIVED from the employer
  // roles that target this track and surfaced as an output on Gap Report.
  const body = req.body as { name?: string; code?: string; careerTrackCode?: string };
  if (!body.name) throw new AppError('VALIDATION', 'Track name is required');

  // Per the architecture: every institutional Track MUST bind to a canonical
  // CareerTrack (the shared vocabulary across stakeholders). The Dean picks
  // FROM the canonical 8 (SWE, DATA, OPS, CUSTSUCCESS, FINTECH, MLAI, PRODUCT,
  // DESIGN). The Track row carries the institution's own naming ("B.Tech CSE")
  // while careerTrackId points at the canonical SWE/DATA/etc.
  const canonicalCode = body.careerTrackCode ?? body.code;
  const careerTrack = canonicalCode
    ? await prisma.careerTrack.findUnique({ where: { code: canonicalCode } })
    : null;
  if (!careerTrack) {
    const valid = await prisma.careerTrack.findMany({ select: { code: true, name: true } });
    throw new AppError(
      'VALIDATION',
      `Must bind to a canonical career-track code. Pass careerTrackCode (one of: ${valid.map((c) => c.code).join(', ')}). Provided: "${canonicalCode ?? '(none)'}".`,
    );
  }

  const track = await prisma.track.create({
    data: {
      institutionId,
      name: body.name,
      // v3.1 — archetype no longer set; derived downstream from roles targeting it.
      careerTrackId: careerTrack.id,
    },
    include: { careerTrack: true, _count: { select: { learners: true } } },
  });
  ok(res, {
    id:              track.id,
    name:            track.name,
    code:            track.careerTrack?.code ?? canonicalCode,
    archetype:       track.archetype,
    careerTrackId:   careerTrack.id,
    careerTrackName: careerTrack.name,
    learnerCount:    track._count.learners,
    createdAt:       track.createdAt.toISOString(),
  });
}));

router.get('/campus/career-tracks/:id', requireRole('DEAN', 'PLACEMENT_OFFICER'), asyncHandler(async (req: Request, res: Response) => {
  const institutionId = req.auth!.inst!;
  const track = await prisma.track.findFirst({
    where: { id: req.params.id, institutionId },
    include: {
      careerTrack: true,
      _count: { select: { learners: true } },
    },
  });
  if (!track) throw new AppError('NOT_FOUND', 'Career track not found');
  // Latest curriculum for this track (if any).
  let curriculum: unknown = null;
  if (track.careerTrack) {
    const c = await prisma.curriculum.findFirst({
      where: { institutionId, careerTrackId: track.careerTrack.id },
      orderBy: { uploadedAt: 'desc' },
    });
    if (c) {
      curriculum = {
        id: c.id,
        subjects: c.subjects,
        clusterCoverage: c.clusterCoverage,
        uploadedAt: c.uploadedAt.toISOString(),
      };
    }
  }
  ok(res, {
    id:              track.id,
    name:            track.name,
    code:            track.careerTrack?.code ?? 'CUSTOM',
    archetype:       track.archetype,
    learnerCount:    track._count.learners,
    createdAt:       track.createdAt.toISOString(),
    careerTrackId:   track.careerTrack?.id ?? null,
    curriculum,
  });
}));

router.get('/campus/career-tracks/:id/learners', requireRole('DEAN', 'PLACEMENT_OFFICER'), asyncHandler(async (req: Request, res: Response) => {
  const institutionId = req.auth!.inst!;
  const track = await prisma.track.findFirst({ where: { id: req.params.id, institutionId } });
  if (!track) throw new AppError('NOT_FOUND', 'Career track not found');
  const learners = await prisma.learner.findMany({
    where: { trackId: track.id },
    include: { scores: true },
  });
  ok(res, learners.map((l) => ({
    id:        l.id,
    name:      l.name,
    email:     l.email,
    trackId:   track.id,
    trackName: track.name,
    readiness: l.scores.length > 0
      ? Math.round(l.scores.reduce((s, x) => s + x.scoreWeighted, 0) / l.scores.length)
      : 0,
    joinedAt:  l.enrolledAt.toISOString(),
  })));
}));

// Curriculum upload — alias the v3 upload controller to the path the portal expects.
router.post(
  '/campus/career-tracks/:id/curriculum',
  requireRole('DEAN', 'PLACEMENT_OFFICER'),
  acceptUpload,
  normaliseUpload('institution'),
  asyncHandler(upload.postCurriculum),
);

router.get('/campus/learners', requireRole('DEAN', 'PLACEMENT_OFFICER'), asyncHandler(async (req: Request, res: Response) => {
  const institutionId = req.auth!.inst!;
  const learners = await prisma.learner.findMany({
    where: { institutionId },
    include: { scores: true, track: true },
    orderBy: { enrolledAt: 'desc' },
  });
  ok(res, learners.map((l) => ({
    id:        l.id,
    name:      l.name,
    email:     l.email,
    trackId:   l.trackId,
    trackName: l.track.name,
    readiness: l.scores.length > 0
      ? Math.round(l.scores.reduce((s, x) => s + x.scoreWeighted, 0) / l.scores.length)
      : 0,
    joinedAt:  l.enrolledAt.toISOString(),
  })));
}));

// v3.1.1 — Dean-direct learner add. Per user feedback: invite-code-only flow
// wasn't enough; Dean needs an "+ Add learner" button to roster students
// without round-tripping each one through self-signup.
//
// Behaviour: creates Learner + User row with a generated temporary password
// returned to the Dean to share. No email integration in MVP.
router.post('/campus/learners', requireRole('DEAN', 'PLACEMENT_OFFICER'), asyncHandler(async (req: Request, res: Response) => {
  const institutionId = req.auth!.inst!;
  const body = req.body as { name?: string; email?: string; trackId?: string };
  if (!body.name || body.name.trim().length < 2) throw new AppError('VALIDATION', 'Name must be at least 2 characters');
  if (!body.email || !body.email.includes('@')) throw new AppError('VALIDATION', 'Email is required');

  const lcEmail = body.email.toLowerCase().trim();
  const existing = await prisma.user.findUnique({ where: { email: lcEmail } });
  if (existing) throw new AppError('VALIDATION', 'A user with that email already exists');

  // Pick (or create-default) a Track for this institution to bind the learner to.
  let track = body.trackId
    ? await prisma.track.findFirst({ where: { id: body.trackId, institutionId } })
    : await prisma.track.findFirst({ where: { institutionId } });
  if (!track) {
    // Auto-create a default Track if the institution has none yet, so Dean's
    // first add doesn't fail on empty Tracks. Bound to canonical SWE.
    const swe = await prisma.careerTrack.findUnique({ where: { code: 'SWE' } });
    track = await prisma.track.create({
      data: {
        institutionId,
        name: 'B.Tech CSE (default)',
        ...(swe ? { careerTrackId: swe.id } : {}),
      },
    });
  }

  // Ensure a Cohort exists for this Track.
  let cohort = await prisma.cohort.findFirst({ where: { institutionId, trackId: track.id } });
  if (!cohort) {
    const iv = await prisma.indexVersion.findFirst({ where: { institutionId }, orderBy: { effectiveFrom: 'desc' } });
    if (!iv) throw new AppError('INTERNAL', 'Institution has no IndexVersion configured');
    cohort = await prisma.cohort.create({
      data: {
        institutionId, trackId: track.id, indexVersionId: iv.id,
        name: `Batch of ${new Date().getFullYear() + 1}`, startYear: new Date().getFullYear() - 3,
      },
    });
  }

  // Generate a memorable temporary password (Dean shares it with the learner).
  const tempPassword = 'Welcome' + Math.floor(Math.random() * 9000 + 1000).toString() + '!';
  const { hashPassword } = await import('../services/auth/passwordHasher.js');
  const passwordHash = await hashPassword(tempPassword);

  const learner = await prisma.learner.create({
    data: {
      institutionId, trackId: track.id, cohortId: cohort.id,
      name: body.name.trim(), email: lcEmail,
    },
  });
  await prisma.user.create({
    data: {
      email: lcEmail, passwordHash, name: body.name.trim(),
      role: 'LEARNER', institutionId, learnerId: learner.id,
    },
  });

  ok(res, {
    id:            learner.id,
    name:          learner.name,
    email:         learner.email,
    trackName:     track.name,
    tempPassword,                  // Dean copies this and shares with learner
    joinedAt:      learner.enrolledAt.toISOString(),
  });
}));

/* ────────────────────────────────────────────────────────────────────────
 * WORKFORCE — TA Lead
 * ──────────────────────────────────────────────────────────────────────── */

// v3.1.1 — /workforce/me/archetype REMOVED. Per Uday's call, archetype is a
// per-ROLE property, not per-company. See jdExtraction.archetype on each role.

// BC 29 — /workforce/me/profile: returns employer profile including kycStatus so
// the workforce portal can show a pending-verification banner to TA_LEADs.
router.get('/workforce/me/profile', requireRole('TA_LEAD'), asyncHandler(async (req: Request, res: Response) => {
  if (!req.auth?.emp) throw new AppError('AUTH_FORBIDDEN', 'Employer scope required');
  const employer = await prisma.employer.findUnique({
    where: { id: req.auth.emp },
    select: { id: true, name: true, archetype: true, plan: true, kycStatus: true, createdAt: true },
  });
  if (!employer) throw new AppError('NOT_FOUND', 'Employer not found');
  ok(res, employer);
}));

router.get('/workforce/overview/kpis', requireRole('TA_LEAD'), asyncHandler(async (req: Request, res: Response) => {
  const employerId = req.auth!.emp!;
  const [openRoles, pipelineRows] = await Promise.all([
    prisma.employerRole.count({ where: { employerId, status: 'active' } }),
    prisma.pipelineCandidate.findMany({
      where: { role: { employerId } },
      select: { stage: true },
    }),
  ]);
  // applications = pipeline rows with any state past 'invited'
  const applications = pipelineRows.length;
  // candidatesAboveThreshold = count of pipeline candidates whose learner has
  // an average score >= 65 (the canonical Signal threshold)
  const aboveThreshold = await prisma.pipelineCandidate.count({
    where: {
      role: { employerId },
      learner: { scores: { some: { scoreWeighted: { gte: 65 } } } },
    },
  });
  ok(res, {
    openRoles,
    applications,
    candidatesAboveThreshold: aboveThreshold,
  });
}));

router.get('/workforce/talent-discovery', requireRole('TA_LEAD'), asyncHandler(async (req: Request, res: Response) => {
  const employerId = req.auth!.emp!;
  // Top 10 learners across the employer's open roles, by average score.
  const employer = await prisma.employer.findUnique({ where: { id: employerId }, select: { archetype: true } });
  const learners = await prisma.learner.findMany({
    where: { scores: { some: {} } },
    include: {
      scores: true,
      institution: { select: { name: true } },
      track: { include: { careerTrack: true } },
    },
    take: 50,
  });
  const ranked = learners
    .map((l) => {
      const scores = l.scores;
      const avg = scores.length > 0
        ? scores.reduce((s, x) => s + x.scoreWeighted, 0) / scores.length
        : 0;
      return {
        id:           l.id,
        name:         l.name,
        institution:  l.institution.name,
        clusterMatch: Math.round(avg), // MVP-SCAFFOLD: simple avg until real per-role match wired
        signalScore:  Math.round(avg),
        track:        l.track.careerTrack?.code ?? 'CUSTOM',
      };
    })
    .sort((a, b) => b.signalScore - a.signalScore)
    .slice(0, 10);
  void employer; // archetype unused for now
  ok(res, ranked);
}));

router.get('/workforce/roles/:id', requireRole('TA_LEAD'), asyncHandler(async (req: Request, res: Response) => {
  const employerId = req.auth!.emp!;
  const role = await prisma.employerRole.findFirst({
    where: { id: req.params.id, employerId },
    include: { careerTrack: true, _count: { select: { pipelines: true } } },
  });
  if (!role) throw new AppError('NOT_FOUND', 'Role not found');
  // v3.1.1 — TWO bug fixes:
  //  1) archetype was set to role.careerTrackId (a CUID) — that crashed the
  //     Role detail UI when shown as text. Now reads from jdExtraction.archetype
  //     (the per-role archetype) or null if JD not yet uploaded.
  //  2) clusterTargets returned the raw DB JSON which can be the legacy
  //     {min, target, stretch} triplet shape — caused the React crash
  //     "Objects are not valid as a React child" inside ClusterBars. Now
  //     flattened to {C1: 70, C2: ..., ...} flat numbers.
  const extraction = role.jdExtraction as { archetype?: string; extractedRequirements?: string[] } | null;
  const rawTargets = (role.clusterTargets ?? {}) as Record<string, number | { target?: number }>;
  const ALL = ['C1','C2','C3','C4','C5','C6','C7','C8'] as const;
  const flatTargets: Record<string, number> = {};
  for (const c of ALL) {
    const v = rawTargets[c];
    flatTargets[c] = typeof v === 'number'
      ? v
      : (typeof v === 'object' && v && typeof v.target === 'number' ? v.target : 0);
  }
  ok(res, {
    id:                    role.id,
    title:                 role.title,
    archetype:             extraction?.archetype ?? null,         // v3.1.1 — null = JD not uploaded yet
    careerTrackId:         role.careerTrackId,
    careerTrackName:       role.careerTrack?.name ?? null,
    careerTrackCode:       role.careerTrack?.code ?? null,
    seatsPlanned:          role.seatsPlanned,
    applicantCount:        role._count.pipelines,
    createdAt:             role.createdAt.toISOString(),
    jdText:                role.jdText,
    clusterTargets:        flatTargets,
    extractedRequirements: extraction?.extractedRequirements ?? [],
  });
}));

router.get('/workforce/roles/:id/applicants', requireRole('TA_LEAD'), asyncHandler(async (req: Request, res: Response) => {
  const employerId = req.auth!.emp!;
  const role = await prisma.employerRole.findFirst({ where: { id: req.params.id, employerId } });
  if (!role) throw new AppError('NOT_FOUND', 'Role not found');
  const candidates = await prisma.pipelineCandidate.findMany({
    where: { roleId: role.id },
    include: {
      learner: {
        include: { scores: true },
      },
    },
    orderBy: { invitedAt: 'desc' },
  });
  ok(res, candidates.map((c) => {
    const scores = c.learner.scores;
    const avg = scores.length > 0
      ? Math.round(scores.reduce((s, x) => s + x.scoreWeighted, 0) / scores.length)
      : 0;
    const stage = String(c.stage);
    // PipelineStage is invited | assessed | decisioned. Map to portal vocab:
    const status: 'applied' | 'shortlisted' | 'decisioned' =
      stage === 'decisioned' ? 'decisioned' :
      stage === 'assessed'   ? 'shortlisted' :
      'applied';
    return {
      id:          c.id,
      name:        c.learner.name,
      email:       c.learner.email,
      matchScore:  avg, // MVP-SCAFFOLD: per-role match formula post-MVP
      status,
      signalScore: avg,
    };
  }));
}));

// JD upload — alias the v3 upload controller.
router.post(
  '/workforce/roles/:id/jd',
  requireRole('TA_LEAD'),
  acceptUpload,
  normaliseUpload('employer'),
  asyncHandler(upload.postJD),
);

/* ────────────────────────────────────────────────────────────────────────
 * TALENT — Learner
 * ──────────────────────────────────────────────────────────────────────── */

/* v3.1.3 — Learner's institution curriculum coverage (8-cluster %).
 *
 * Powers the Talent dashboard's "your curriculum vs your readiness" radar.
 * Pulls the most-recent Curriculum row for the institution × the learner's
 * canonical career track. Returns 0..100 per cluster (UI-ready). */
router.get('/talent/me/curriculum-coverage', requireRole('LEARNER'), asyncHandler(async (req: Request, res: Response) => {
  const user = await prisma.user.findUnique({
    where: { id: req.auth!.sub },
    select: { learnerId: true, institutionId: true, learner: { select: { trackId: true, track: { select: { careerTrackId: true } } } } },
  });
  if (!user?.learnerId || !user.institutionId) throw new AppError('NOT_FOUND', 'Not a learner');
  const careerTrackId = user.learner?.track?.careerTrackId;
  if (!careerTrackId) {
    ok(res, { hasCurriculum: false, coverage: { C1: 0, C2: 0, C3: 0, C4: 0, C5: 0, C6: 0, C7: 0, C8: 0 } });
    return;
  }
  const curriculum = await prisma.curriculum.findFirst({
    where: { institutionId: user.institutionId, careerTrackId },
    orderBy: { uploadedAt: 'desc' },
    select: { clusterCoverage: true, uploadedAt: true },
  });
  if (!curriculum) {
    ok(res, { hasCurriculum: false, coverage: { C1: 0, C2: 0, C3: 0, C4: 0, C5: 0, C6: 0, C7: 0, C8: 0 } });
    return;
  }
  const raw = curriculum.clusterCoverage as Record<string, number>;
  const coverage: Record<string, number> = {};
  for (const c of ['C1','C2','C3','C4','C5','C6','C7','C8']) {
    const v = raw[c] ?? 0;
    coverage[c] = v <= 1 ? Math.round(v * 100) : Math.round(v);
  }
  ok(res, { hasCurriculum: true, coverage, uploadedAt: curriculum.uploadedAt.toISOString() });
}));

router.get('/talent/me/clusters', requireRole('LEARNER'), asyncHandler(async (req: Request, res: Response) => {
  const user = await prisma.user.findUnique({ where: { id: req.auth!.sub }, select: { learnerId: true } });
  if (!user?.learnerId) throw new AppError('NOT_FOUND', 'Not a learner');
  const clusters = await prisma.competencyCluster.findMany({ orderBy: { code: 'asc' } });
  const scores = await prisma.competencyScore.findMany({ where: { learnerId: user.learnerId } });
  const byCode = new Map(scores.map((s) => [s.clusterCode, s]));
  ok(res, clusters.map((c) => {
    const s = byCode.get(c.code);
    const score = s ? Math.round(s.scoreWeighted) : 0;
    return {
      id:         c.code,
      name:       c.shortName,
      score,
      confidence: s ? Math.round(s.confidence * 100) / 100 : 0,
      band:       bandFor(score),
    };
  }));
}));

router.get('/talent/me/signal', requireRole('LEARNER'), asyncHandler(async (req: Request, res: Response) => {
  const user = await prisma.user.findUnique({ where: { id: req.auth!.sub }, select: { learnerId: true } });
  if (!user?.learnerId) throw new AppError('NOT_FOUND', 'Not a learner');
  const scores = await prisma.competencyScore.findMany({ where: { learnerId: user.learnerId } });
  const score = scores.length > 0
    ? Math.round(scores.reduce((s, x) => s + x.scoreWeighted, 0) / scores.length)
    : 0;
  const unlocked = score >= 65;
  let band: 'locked' | 'bronze' | 'silver' | 'gold' = 'locked';
  if (score >= 85) band = 'gold';
  else if (score >= 75) band = 'silver';
  else if (score >= 65) band = 'bronze';
  ok(res, { score, band, unlocked });
}));

router.get('/talent/me/assessment-bank', requireRole('LEARNER'), asyncHandler(async (req: Request, res: Response) => {
  const user = await prisma.user.findUnique({ where: { id: req.auth!.sub }, select: { learnerId: true } });
  if (!user?.learnerId) throw new AppError('NOT_FOUND', 'Not a learner');
  // Reuse the file-based assessment bank loader. Surface only MCQ + descriptive
  // (per Uday's selected scope: MCQ + AI-graded descriptive).
  const { loadAssessmentBank } = await import('../services/talent/helpers.js');
  const items = loadAssessmentBank().filter((i) => i.kind === 'mcq' || i.kind === 'descriptive');
  const attempts = await prisma.assessmentAttemptV2.findMany({
    where: { learnerId: user.learnerId },
    select: { assessmentRef: true, score: true, submittedAt: true },
    orderBy: { submittedAt: 'desc' },
  });
  const lastByRef = new Map<string, number | null>();
  for (const a of attempts) if (!lastByRef.has(a.assessmentRef)) lastByRef.set(a.assessmentRef, a.score);
  const clusters = await prisma.competencyCluster.findMany();
  const clusterName = new Map(clusters.map((c) => [c.code, c.shortName]));
  ok(res, items.map((i) => ({
    id:          i.id,
    title:       i.title ?? `${i.clusterCode} · ${i.kind}`,
    cluster:     i.clusterCode,
    clusterName: clusterName.get(i.clusterCode) ?? i.clusterCode,
    type:        i.kind === 'mcq' ? 'MCQ' : 'Descriptive',
    // MVP-SCAFFOLD: bank items don't carry a difficulty field; default to 'Medium'.
    difficulty:  'Medium' as const,
    attempted:   lastByRef.has(i.id),
    lastScore:   lastByRef.get(i.id) ?? undefined,
  })));
}));

router.get('/talent/me/assessment-bank/:id', requireRole('LEARNER'), asyncHandler(async (req: Request, res: Response) => {
  const { loadAssessmentBank } = await import('../services/talent/helpers.js');
  const item = loadAssessmentBank().find((i) => i.id === req.params.id);
  if (!item) throw new AppError('NOT_FOUND', 'Assessment item not found');
  if (item.kind !== 'mcq' && item.kind !== 'descriptive') {
    throw new AppError('VALIDATION', 'Unsupported item kind');
  }
  const cluster = await prisma.competencyCluster.findUnique({ where: { code: item.clusterCode } });
  ok(res, {
    id:           item.id,
    type:         item.kind === 'mcq' ? 'MCQ' : 'Descriptive',
    questionText: item.prompt,
    options:      item.kind === 'mcq' ? (item.options ?? []).map((o) => ({ id: o.id, text: o.text })) : undefined,
    cluster:      item.clusterCode,
    clusterName:  cluster?.shortName ?? item.clusterCode,
  });
}));

/* Opportunities — portal calls without careerTrackId. Compute simple per-role
 * matchScore as average of (clusterTarget closeness vs learner score) per cluster. */
router.get('/talent/me/opportunities', requireRole('LEARNER'), asyncHandler(async (req: Request, res: Response) => {
  const user = await prisma.user.findUnique({
    where: { id: req.auth!.sub },
    select: { learnerId: true, learner: { select: { track: { select: { name: true, careerTrack: { select: { name: true } } } } } } },
  });
  if (!user?.learnerId) throw new AppError('NOT_FOUND', 'Not a learner');
  const trackName = user.learner?.track?.careerTrack?.name ?? user.learner?.track?.name ?? 'Software Engineer';

  const [scores, roles, applied] = await Promise.all([
    prisma.competencyScore.findMany({ where: { learnerId: user.learnerId } }),
    prisma.employerRole.findMany({
      where: { status: 'active' },
      include: { employer: { select: { name: true, archetype: true } } },
      take: 50,
    }),
    prisma.pipelineCandidate.findMany({
      where: { learnerId: user.learnerId },
      select: { roleId: true },
    }),
  ]);
  const scoreByCluster = new Map(scores.map((s) => [s.clusterCode, s.scoreWeighted]));
  const appliedSet = new Set(applied.map((a) => a.roleId));

  // Internal employer roles (platform-side)
  const internal = roles.map((r) => {
    const targets = (r.clusterTargets ?? {}) as Record<string, number>;
    const codes = Object.keys(targets);
    let matchSum = 0, n = 0;
    for (const c of codes) {
      const want = Number(targets[c] ?? 0);
      if (!want) continue;
      const have = Number(scoreByCluster.get(c as ClusterCode) ?? 0);
      matchSum += have >= want ? 100 : (have / want) * 100;
      n++;
    }
    const matchPct = n > 0 ? Math.round(matchSum / n) : 0;
    const required: 'gold' | 'silver' | 'bronze' = matchPct >= 85 ? 'gold' : matchPct >= 75 ? 'silver' : 'bronze';
    return {
      id:                  r.id,
      title:               r.title,
      employerName:        r.employer.name,
      archetype:           r.employer.archetype,
      matchPct,
      signalBandRequired:  required,
      applied:             appliedSet.has(r.id),
      source:              'platform' as const,
      url:                 null,
    };
  });

  // v3.1.3 — External live job postings via Serper (LinkedIn + Naukri).
  // AI-extract cluster targets per posting; compute matchScore against learner.
  // Cached 24h per (track, city). Soft-fail: if Serper/AI errors, return only internal.
  let external: any[] = [];
  try {
    const { getExternalOpportunities } = await import('../services/talent/externalOpportunities.js');
    const ext = await getExternalOpportunities({
      learnerId: user.learnerId,
      track:     trackName,
      city:      (req.query.city as string) ?? 'Bangalore',
    });
    external = ext.map(e => ({
      id:                 e.id,
      title:              e.title,
      employerName:       e.company,
      archetype:          null,
      matchPct:           e.matchPct,
      signalBandRequired: e.matchPct >= 85 ? 'gold' : e.matchPct >= 75 ? 'silver' : 'bronze',
      applied:            false,
      source:             e.source,
      url:                e.url,
      location:           e.location,
      postedDate:         e.postedDate,
    }));
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[opportunities] external fetch failed (non-fatal):', (err as Error).message.slice(0, 200));
  }

  const all = [...internal, ...external].sort((a, b) => b.matchPct - a.matchPct);
  ok(res, all.slice(0, 30));
}));

// Portal uses singular `attempt` and sends a single `answer` field (string).
// Look up the bank item to infer MCQ vs Descriptive, then call existing service.
router.post('/talent/me/assessments/:id/attempt', requireRole('LEARNER'), asyncHandler(async (req: Request, res: Response) => {
  const { submitAttempt } = await import('../services/talent/assessmentService.js');
  const { loadAssessmentBank } = await import('../services/talent/helpers.js');
  const userId = req.auth!.sub;
  const id = req.params.id;
  const body = req.body as { answer?: string; type?: string; selectedOptionId?: string; answerText?: string };

  const item = loadAssessmentBank().find((i) => i.id === id);
  if (!item) throw new AppError('NOT_FOUND', 'Assessment item not found');

  // Accept multiple body shapes; prefer the simple `{answer}` shape.
  let answers: { kind: 'mcq'; selectedOptionId: string } | { kind: 'descriptive'; text: string };
  if (item.kind === 'mcq') {
    const opt = body.selectedOptionId ?? body.answer ?? '';
    if (!opt) throw new AppError('VALIDATION', 'answer (option id) required for MCQ');
    answers = { kind: 'mcq', selectedOptionId: opt };
  } else if (item.kind === 'descriptive') {
    const text = body.answerText ?? body.answer ?? '';
    if (!text) throw new AppError('VALIDATION', 'answer (text) required for Descriptive');
    answers = { kind: 'descriptive', text };
  } else {
    throw new AppError('VALIDATION', 'Unsupported item kind for portal flow');
  }

  const result = await submitAttempt(userId, id, { timeSpentSec: 0, answers });
  // Reshape to AttemptResult expected by portal:
  const fb = result.feedback as { ai?: { strengths?: string[]; gaps?: string[]; suggestions?: string[] }; correctOptionId?: string; correct?: boolean } | null;
  ok(res, {
    score:           result.score,
    correct:         fb?.correct,
    correctOptionId: fb?.correctOptionId,
    feedback:        fb?.ai
      ? { strengths: fb.ai.strengths ?? [], gaps: fb.ai.gaps ?? [], suggestions: fb.ai.suggestions ?? [] }
      : undefined,
  });
}));

/* Learning portal — index across all clusters + subtopics with mastery state */
router.get('/talent/me/learn', requireRole('LEARNER'), asyncHandler(async (req: Request, res: Response) => {
  const { getLearnIndex } = await import('../services/learn/learnService.js');
  const data = await getLearnIndex(req.auth!.sub);
  ok(res, data);
}));

/* Learning portal — single subtopic page payload (Concept + Practice + Progress) */
router.get('/talent/me/learn/:subtopicCode', requireRole('LEARNER'), asyncHandler(async (req: Request, res: Response) => {
  const { getSubtopic } = await import('../services/learn/learnService.js');
  const data = await getSubtopic(req.auth!.sub, req.params.subtopicCode);
  ok(res, data);
}));

/* ─── Talent Profile + Path (resume / recommendations / 3-way map / augmentation) ─── */

/* GET current resume profile (null if not yet uploaded) */
router.get('/talent/me/profile', requireRole('LEARNER'), asyncHandler(async (req: Request, res: Response) => {
  const { getResumeProfile } = await import('../services/talent/path/pathService.js');
  const profile = await getResumeProfile(req.auth!.sub);
  ok(res, { profile });
}));

/* POST upload + parse resume — JSON {text} or multipart file */
router.post(
  '/talent/me/profile/resume',
  requireRole('LEARNER'),
  acceptUpload,
  normaliseUpload('institution'),
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.uploadedDoc) throw new AppError('UPLOAD_REQUIRED', 'No resume received');
    const { uploadAndParseResume } = await import('../services/talent/path/pathService.js');
    const { parsed } = await uploadAndParseResume(req.auth!.sub, req.uploadedDoc.rawText);
    ok(res, { parsed, source: req.uploadedDoc.source });
  }),
);

/* GET career-track recommendations from resume */
router.get('/talent/me/track-recommendations', requireRole('LEARNER'), asyncHandler(async (req: Request, res: Response) => {
  const { recommendCareerTracks } = await import('../services/talent/path/pathService.js');
  const recommendations = await recommendCareerTracks(req.auth!.sub);
  ok(res, recommendations);
}));

/* GET 3-way map (current / college-eventual / demand) per career track */
router.get('/talent/me/three-way-map/:careerTrackId', requireRole('LEARNER'), asyncHandler(async (req: Request, res: Response) => {
  const { computeThreeWayMap } = await import('../services/talent/path/pathService.js');
  const map = await computeThreeWayMap(req.auth!.sub, req.params.careerTrackId);
  ok(res, map);
}));

/* GET augmentation path (subtopics AI should teach now) per career track */
router.get('/talent/me/augmentation-path/:careerTrackId', requireRole('LEARNER'), asyncHandler(async (req: Request, res: Response) => {
  const { computeAugmentationPath } = await import('../services/talent/path/pathService.js');
  const path = await computeAugmentationPath(req.auth!.sub, req.params.careerTrackId);
  ok(res, path);
}));

/* ─── Lesson Stream (unique tutor) — generate ONE structured card at a time ─── */

router.post('/talent/me/lesson/:subtopicCode/next-card', requireRole('LEARNER'), asyncHandler(async (req: Request, res: Response) => {
  const { generateLessonCard } = await import('../services/ai/prompts/generateLessonCard.js');
  const { resolveOrSynthesizeSubtopic } = await import('../services/talent/subtopicResolver.js');
  const { assertSubtopicAccessible } = await import('../services/learn/learnService.js');
  const subtopic = resolveOrSynthesizeSubtopic(req.params.subtopicCode);
  // v3.1 — Server-enforced gate. The gate lives in learnService so all
  // per-subtopic surfaces (lesson, practice, tutor) call ONE function.
  await assertSubtopicAccessible(req.auth!.sub, req.params.subtopicCode);

  const body = req.body as {
    learnerLastResponse?: string;
    // v3.1 — wasCorrect carries the learner's correctness on `check` cards
    // so the server can enforce check→detour gating per spec.
    cardHistory?: Array<{ kind: string; title: string; learnerInput?: string; wasCorrect?: boolean }>;
  };

  const { card } = await generateLessonCard({
    subtopicCode:        subtopic.code,
    subtopicName:        subtopic.name,
    clusterCode:         subtopic.clusterCode,
    learnerLastResponse: body.learnerLastResponse ?? null,
    cardHistory:         body.cardHistory ?? [],
  });
  ok(res, card);
}));

/* GET /api/workforce/roles/:id/insight — v3.1.10 BUNDLED rich insight for the
 *  Workforce Dashboard / RoleDetail. One call returns: gap radar + salary
 *  intel + recommended sourcing colleges + GitHub talent preview. Each
 *  sub-response carries its own source pill so the UI can render honestly. */
router.get('/workforce/roles/:id/insight', requireRole('TA_LEAD'), asyncHandler(async (req: Request, res: Response) => {
  if (!req.auth?.emp) throw new AppError('AUTH_FORBIDDEN', 'Employer scope required');
  const role = await prisma.employerRole.findFirst({
    where: { id: req.params.id, employerId: req.auth.emp },
    select: { id: true, title: true, clusterTargets: true, jdExtraction: true },
  });
  if (!role) throw new AppError('NOT_FOUND', 'Role not found');
  const city = (req.query.city as string) ?? 'Bangalore';
  const archetype = ((role.jdExtraction as { archetype?: string } | null)?.archetype) ?? 'Product';

  const { getSalaryIntel, getRecommendedColleges, getRoleGapRadar } = await import('../services/workforce/roleInsight.js');
  const { discoverGitHubTalent } = await import('../services/workforce/githubTalentDiscovery.js');
  const [gap, salaryR, collegesR, gh] = await Promise.all([
    getRoleGapRadar({ roleId: role.id }),
    getSalaryIntel({ roleId: role.id, roleTitle: role.title, city }),
    getRecommendedColleges({ roleId: role.id, roleTitle: role.title, archetype, city }),
    discoverGitHubTalent({ roleId: role.id, roleTitle: role.title, city, clusterTargets: (role.clusterTargets ?? {}) as Record<string, number> }).catch(() => ({ candidates: [], source: 'fallback' as const, hash: '' })),
  ]);
  // v3.1.10 — pass through `source` for each sub-block so the UI's source
  // pill can render honestly. Earlier the route dropped these and the
  // frontend had to guess via `data?.median != null`. Bug Iter-4 audit caught.
  ok(res, {
    role:           { id: role.id, title: role.title, archetype, clusterTargets: role.clusterTargets },
    gap,
    salary:         salaryR.intel,
    salarySource:   salaryR.source,
    colleges:       collegesR.colleges,
    collegesSource: collegesR.source,
    githubPreview:  gh.candidates.slice(0, 3),
    githubSource:   gh.source,
  });
}));

/* GET /api/workforce/roles/:id/github-talent — v3.1.9 GitHub Talent Discovery.
 *  Live-pulls public GitHub profiles matching the role's title + city, then
 *  AI-shapes each candidate into the GradiumOS 8-cluster vocabulary, computes
 *  matchScore vs role.clusterTargets, returns ranked candidates. Day-0 value
 *  for Workforce — works even if zero learners are enrolled on the platform. */
router.get('/workforce/roles/:id/github-talent', requireRole('TA_LEAD'), asyncHandler(async (req: Request, res: Response) => {
  if (!req.auth?.emp) throw new AppError('AUTH_FORBIDDEN', 'Employer scope required');
  const role = await prisma.employerRole.findFirst({
    where: { id: req.params.id, employerId: req.auth.emp },
    select: { id: true, title: true, clusterTargets: true },
  });
  if (!role) throw new AppError('NOT_FOUND', 'Role not found');
  const city = (req.query.city as string) ?? 'Bangalore';
  const force = req.query.refresh === '1';
  const { discoverGitHubTalent } = await import('../services/workforce/githubTalentDiscovery.js');
  const result = await discoverGitHubTalent({
    roleId:         role.id,
    roleTitle:      role.title,
    city,
    clusterTargets: (role.clusterTargets ?? {}) as Record<string, number>,
    forceRefresh:   force,
  });
  ok(res, result);
}));

/* ─── Apply tab — work-simulation scenario per subtopic (v3.1.4) ─── */

router.get('/talent/me/learn/:subtopicCode/apply', requireRole('LEARNER'), asyncHandler(async (req: Request, res: Response) => {
  const { resolveOrSynthesizeSubtopic } = await import('../services/talent/subtopicResolver.js');
  const { assertSubtopicAccessible } = await import('../services/learn/learnService.js');
  const { generateApply } = await import('../services/ai/prompts/generateApply.js');
  const { getLearnerIdOrThrow } = await import('../services/talent/learnerContext.js');
  const { createHash } = await import('crypto');

  const subtopic = resolveOrSynthesizeSubtopic(req.params.subtopicCode);
  // Synthesised subtopics aren't gate-managed, so skip accessibility check for them.
  if (subtopic.curriculumSource !== 'synthesised') {
    await assertSubtopicAccessible(req.auth!.sub, req.params.subtopicCode);
  }

  const CLUSTER_NAMES: Record<string, string> = {
    C1: 'Core Technical Foundations', C2: 'Applied Problem Solving', C3: 'Engineering Execution',
    C4: 'System & Product Thinking', C5: 'Communication & Collaboration', C6: 'Domain Specialisation',
    C7: 'Ownership & Judgment', C8: 'Learning Agility',
  };

  // v3.1.7 — apply-cache scoped per LEARNER (not global) so two learners on
  // the same subtopic get DIFFERENT scenarios. Prevents the demo "we both
  // got the same Apply" cheating vector. 30-day TTL preserved.
  const learnerId = await getLearnerIdOrThrow(req.auth!.sub);
  const hash = createHash('sha256').update(`apply:${subtopic.code}:${learnerId}:v2`).digest('hex').slice(0, 16);
  const cached = await prisma.publicDataCache.findFirst({
    where: { stakeholderKind: 'talent', stakeholderId: learnerId, slot: 'apply', contextHash: hash },
  });
  if (cached && cached.expiresAt > new Date() && cached.payload) {
    return ok(res, { scenario: cached.payload, cached: true, source: 'db-cache' });
  }

  const { scenario, meta } = await generateApply({
    subtopicCode: subtopic.code,
    subtopicName: subtopic.name,
    clusterCode:  subtopic.clusterCode,
    clusterName:  CLUSTER_NAMES[subtopic.clusterCode] ?? subtopic.clusterCode,
  });

  // v3.1.7 — only cache LIVE results, never fallbacks. Otherwise a transient
  // 429 / network blip pollutes the cache for 30 days.
  const isLive = !meta.model.startsWith('mock-');
  if (isLive) {
    try {
      await prisma.publicDataCache.upsert({
        where: { stakeholderKind_stakeholderId_slot_contextHash: { stakeholderKind: 'talent', stakeholderId: learnerId, slot: 'apply', contextHash: hash } },
        update: { payload: scenario as any, retrievedAt: new Date(), expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), fromFixture: false },
        create: { stakeholderKind: 'talent', stakeholderId: learnerId, slot: 'apply', contextHash: hash, payload: scenario as any, fromFixture: false, expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) },
      });
    } catch { /* non-fatal */ }
  }

  ok(res, { scenario, cached: false, source: isLive ? 'live-ai' : 'fallback', model: meta.model });
}));

/* POST grade an Apply submission — AI-graded against the scenario rubric. */
router.post('/talent/me/learn/:subtopicCode/apply/grade', requireRole('LEARNER'), asyncHandler(async (req: Request, res: Response) => {
  const { resolveOrSynthesizeSubtopic } = await import('../services/talent/subtopicResolver.js');
  const { assertSubtopicAccessible } = await import('../services/learn/learnService.js');
  const { gradeDescriptive } = await import('../services/ai/prompts/gradeDescriptive.js');

  const subtopic = resolveOrSynthesizeSubtopic(req.params.subtopicCode);
  if (subtopic.curriculumSource !== 'synthesised') {
    await assertSubtopicAccessible(req.auth!.sub, req.params.subtopicCode);
  }

  const body = req.body as {
    response?: string;
    task?: string;
    rubric?: Array<{ criterion: string; weight: number }>;
  };
  const response = (body.response ?? '').trim();
  if (response.length < 10) throw new AppError('VALIDATION', 'Response must be at least 10 characters');
  if (!body.task || !Array.isArray(body.rubric) || body.rubric.length === 0) {
    throw new AppError('VALIDATION', 'task and rubric required');
  }

  // Convert rubric array → criterion→description map (with weights inlined)
  const rubricMap: Record<string, string> = {};
  for (const r of body.rubric) {
    rubricMap[r.criterion] = `weight ${Math.round(r.weight * 100)}%`;
  }

  const { graded, meta } = await gradeDescriptive({
    question:    body.task,
    rubric:      rubricMap,
    answer:      response,
    clusterCode: subtopic.clusterCode,
  });

  // v3.1.5 — close the loop: Apply submission becomes evidence for the cluster
  // CompetencyScore via the locked formula. So submitting an Apply moves
  // your dashboard radar — the loop is REAL, not just a graded standalone test.
  const { recordShiftEvidence } = await import('../services/talent/shiftEvidence.js');
  const { getLearnerIdOrThrow: getLearnerId2 } = await import('../services/talent/learnerContext.js');
  const learnerId2 = await getLearnerId2(req.auth!.sub);
  await recordShiftEvidence({
    learnerId:   learnerId2,
    clusterCode: subtopic.clusterCode,
    artifactId:  `apply:${subtopic.code}`,
    score:       graded.score,
    rubricCount: body.rubric.length,
  });

  ok(res, { graded, meta });
}));

/* ─── System AI status (v3.1.6) — exposes whether live AI / Serper are
 *      wired so the UI can render honest "Live AI" vs "Fallback" pills.
 *      Public to authenticated users (no PII, just config booleans). */
router.get('/system/ai-status', asyncHandler(async (_req: Request, res: Response) => {
  const { isGroqConfigured } = await import('../services/ai/groqClient.js');
  const { isSerperConfigured } = await import('../services/publicData/serperClient.js');
  const groqReady   = isGroqConfigured();
  const serperReady = isSerperConfigured();
  ok(res, {
    groq:   { configured: groqReady,   model: process.env.GROQ_MODEL ?? null },
    serper: { configured: serperReady },
    mode:   groqReady && serperReady ? 'live' : groqReady ? 'live-ai-only' : serperReady ? 'live-serper-only' : 'fallback',
  });
}));

/* ─── Work Shift — full-screen 25-min work simulation popup (v3.1.5) ─── */

/* GET /api/talent/me/shift?focus=C1,C5,C7
 * Returns a fresh shift scenario for the learner. Cached per (careerTrackId,
 * focusKey) for 7 days so retake-the-same-shift returns the same artifacts
 * (deliberate — learners can iterate on their responses to known-good
 * scenarios). New focus-cluster combo = new shift. */
router.get('/talent/me/shift', requireRole('LEARNER'), asyncHandler(async (req: Request, res: Response) => {
  const { generateShift } = await import('../services/ai/prompts/generateShift.js');
  const { getLearnerIdOrThrow } = await import('../services/talent/learnerContext.js');
  const { createHash } = await import('crypto');

  const learnerId = await getLearnerIdOrThrow(req.auth!.sub);
  const learner = await prisma.learner.findUnique({
    where:   { id: learnerId },
    include: { track: { include: { careerTrack: true } } },
  });
  if (!learner) throw new AppError('NOT_FOUND', 'Learner not found');

  const careerTrack = learner.track.careerTrack;
  const careerTrackName = careerTrack?.name ?? learner.track.name;
  const archetype = (careerTrack?.archetype ?? learner.track.archetype ?? 'Product') as 'Product' | 'Service' | 'MassRecruiter';

  // Focus clusters: query param, otherwise the learner's 3 weakest clusters
  // (so the shift exercises what they need most).
  const focusParam = (req.query.focus as string | undefined) ?? '';
  let focusClusters = focusParam
    .split(',')
    .map((c) => c.trim().toUpperCase())
    .filter((c) => /^C[1-8]$/.test(c));
  if (focusClusters.length === 0) {
    const scores = await prisma.competencyScore.findMany({
      where: { learnerId },
      orderBy: { scoreWeighted: 'asc' },
      take: 4,
    });
    focusClusters = scores.length > 0
      ? scores.map((s) => s.clusterCode)
      : ['C1', 'C5', 'C3', 'C7'];
  }

  const focusKey = focusClusters.sort().join(',');

  // v3.1.7 — cache key now per LEARNER + per ATTEMPT-COUNT. Two learners on
  // the same track with the same weak clusters get DIFFERENT scenarios. A
  // single learner who retakes gets a FRESH scenario each time. Resolves
  // both the "shared scenarios across cohort" and "same shift forever"
  // flaws Uday flagged.
  // Resume support: an in-progress WorkShift row pins to its hash; if the
  // learner has one, we return THAT scenario instead of generating a new one.
  const inProgress = await prisma.workShift.findFirst({
    where: { learnerId, state: 'in_progress' },
    orderBy: { startedAt: 'desc' },
  });
  if (inProgress) {
    const inProgressScen = await prisma.publicDataCache.findFirst({
      where: { contextHash: inProgress.scenarioHash, slot: 'shift' },
    });
    if (inProgressScen?.payload) {
      return ok(res, { scenario: inProgressScen.payload, scenarioHash: inProgress.scenarioHash, cached: true, source: 'db-cache', resumed: true });
    }
  }

  const completedCount = await prisma.workShift.count({
    where: { learnerId, state: 'completed' },
  });
  const attemptOrdinal = completedCount + 1;
  const hash = createHash('sha256')
    .update(`shift:${careerTrack?.id ?? learner.trackId}:${learnerId}:${focusKey}:attempt-${attemptOrdinal}:v2`)
    .digest('hex')
    .slice(0, 16);

  const cached = await prisma.publicDataCache.findFirst({
    where: { stakeholderKind: 'talent', stakeholderId: learnerId, slot: 'shift', contextHash: hash },
  });
  if (cached && cached.expiresAt > new Date() && cached.payload) {
    return ok(res, { scenario: cached.payload, scenarioHash: hash, cached: true, source: 'db-cache' });
  }

  const { scenario, meta } = await generateShift({
    careerTrackName,
    archetype,
    focusClusters,
    difficulty: 'junior',
  });

  // v3.1.7 — only cache LIVE results, never fallbacks. Avoids polluting the
  // 7-day cache with an EmergencyStub when Groq is rate-limited.
  const isLive = !meta.model.startsWith('mock-');
  if (isLive) {
    try {
      await prisma.publicDataCache.upsert({
        where:  { stakeholderKind_stakeholderId_slot_contextHash: { stakeholderKind: 'talent', stakeholderId: learnerId, slot: 'shift', contextHash: hash } },
        update: { payload: scenario as any, retrievedAt: new Date(), expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), fromFixture: false },
        create: { stakeholderKind: 'talent', stakeholderId: learnerId, slot: 'shift', contextHash: hash, payload: scenario as any, fromFixture: false, expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) },
      });
    } catch { /* non-fatal */ }
  }

  ok(res, { scenario, scenarioHash: hash, cached: false, source: isLive ? 'live-ai' : 'fallback', model: meta.model });
}));

/* POST /api/talent/me/shift/grade — grade ONE artifact of an in-progress
 * shift. Lazy-creates a WorkShift row on first artifact (so the shift is
 * resumable across devices), persists per-artifact scores, and updates
 * CompetencyScore via the locked formula path. */
router.post('/talent/me/shift/grade', requireRole('LEARNER'), asyncHandler(async (req: Request, res: Response) => {
  const { gradeDescriptive } = await import('../services/ai/prompts/gradeDescriptive.js');
  const { getLearnerIdOrThrow } = await import('../services/talent/learnerContext.js');
  const { recordShiftEvidence } = await import('../services/talent/shiftEvidence.js');

  const learnerId = await getLearnerIdOrThrow(req.auth!.sub);
  const body = req.body as {
    artifactId?:  string;
    clusterCode?: string;
    response?:    string;
    task?:        string;
    rubric?:      Array<{ criterion: string; weight: number }>;
    scenarioHash?: string;     // v3.1.6 — lets the server tie this artifact to a WorkShift row
    companyName?:  string;     // v3.1.6 — purely cosmetic for the row "SwiftPay shift"
  };
  const response = (body.response ?? '').trim();
  if (response.length < 10) throw new AppError('VALIDATION', 'Response must be at least 10 characters');
  if (!body.task || !body.clusterCode || !body.artifactId || !Array.isArray(body.rubric)) {
    throw new AppError('VALIDATION', 'artifactId, clusterCode, task, rubric required');
  }

  const rubricMap: Record<string, string> = {};
  for (const r of body.rubric) rubricMap[r.criterion] = `weight ${Math.round(r.weight * 100)}%`;

  const { graded, meta } = await gradeDescriptive({
    question:    body.task,
    rubric:      rubricMap,
    answer:      response,
    clusterCode: body.clusterCode,
  });

  // Close the loop: shift submission becomes a real evidence event for the
  // CompetencyScore formula. Updates scoreWeighted + freshness for this cluster.
  await recordShiftEvidence({
    learnerId,
    clusterCode:  body.clusterCode,
    artifactId:   body.artifactId,
    score:        graded.score,
    rubricCount:  body.rubric.length,
  });

  // v3.1.6 — persist into WorkShift (lazy create + append per-artifact JSON).
  // This makes shifts cohort-analysable from the Campus side AND lets a
  // learner resume across devices.
  if (body.scenarioHash) {
    const existing = await prisma.workShift.findFirst({
      where: { learnerId, scenarioHash: body.scenarioHash, state: 'in_progress' },
      orderBy: { startedAt: 'desc' },
    });
    const submission = {
      artifactId:  body.artifactId,
      clusterCode: body.clusterCode,
      score:       graded.score,
      oneLine:     graded.oneLine,
      submittedAt: new Date().toISOString(),
    };
    if (existing) {
      const arr = Array.isArray(existing.perArtifact) ? (existing.perArtifact as any[]) : [];
      // dedupe by artifactId — re-submitting an artifact replaces its row
      const filtered = arr.filter((a) => a.artifactId !== body.artifactId);
      await prisma.workShift.update({
        where: { id: existing.id },
        data:  { perArtifact: [...filtered, submission] as any },
      });
    } else {
      await prisma.workShift.create({
        data: {
          learnerId,
          scenarioHash:    body.scenarioHash,
          scenarioCompany: body.companyName ?? null,
          state:           'in_progress',
          perArtifact:     [submission] as any,
        },
      });
    }
  }

  ok(res, { graded, meta });
}));

/* POST /api/talent/me/shift/complete — finalise the active shift.
 * v3.1.7 — manager note is now AI-generated SERVER-SIDE from the persisted
 * per-artifact rows. The client may pass `managerNote` as a hint but it's
 * overwritten by Groq's read-out. Signal auto-reflects via existing
 * computeSignalScore since CompetencyScore was updated per-artifact. */
router.post('/talent/me/shift/complete', requireRole('LEARNER'), asyncHandler(async (req: Request, res: Response) => {
  const { getLearnerIdOrThrow } = await import('../services/talent/learnerContext.js');
  const { generateManagerNote } = await import('../services/ai/prompts/generateManagerNote.js');
  const learnerId = await getLearnerIdOrThrow(req.auth!.sub);
  const body = req.body as {
    scenarioHash?: string;
    aggregateScore?: number;
    clusterHeatmap?: Record<string, number>;
  };
  if (!body.scenarioHash) throw new AppError('VALIDATION', 'scenarioHash required');

  const active = await prisma.workShift.findFirst({
    where: { learnerId, scenarioHash: body.scenarioHash, state: 'in_progress' },
    orderBy: { startedAt: 'desc' },
  });
  if (!active) throw new AppError('NOT_FOUND', 'No in-progress shift to complete');

  // Pull the cached scenario for company/role/day context
  const scen = await prisma.publicDataCache.findFirst({
    where: { contextHash: body.scenarioHash, slot: 'shift' },
  });
  const scenarioPayload = (scen?.payload ?? {}) as { companyName?: string; role?: string; day?: number; artifacts?: Array<{ id: string; label: string; clusterCode: string }> };

  // Reconstruct the per-artifact list from the WorkShift row + scenario labels
  const submissions = Array.isArray(active.perArtifact) ? (active.perArtifact as Array<{ artifactId: string; clusterCode: string; score: number; oneLine: string }>) : [];
  const labels = Object.fromEntries((scenarioPayload.artifacts ?? []).map((a) => [a.id, a.label]));
  const artifacts = submissions.map((s) => ({
    label:       labels[s.artifactId] ?? s.artifactId,
    clusterCode: s.clusterCode,
    score:       s.score,
    oneLine:     s.oneLine,
  }));

  const overallScore = body.aggregateScore ?? (artifacts.length > 0 ? Math.round(artifacts.reduce((a, b) => a + b.score, 0) / artifacts.length) : 0);

  const { managerNote, meta } = await generateManagerNote({
    companyName: scenarioPayload.companyName ?? active.scenarioCompany ?? 'your fictional company',
    role:        scenarioPayload.role ?? 'Junior Engineer',
    day:         scenarioPayload.day ?? 1,
    overallScore,
    artifacts,
  });

  const updated = await prisma.workShift.update({
    where: { id: active.id },
    data: {
      state:        'completed',
      completedAt:  new Date(),
      shiftReadout: {
        aggregateScore: overallScore,
        clusterHeatmap: body.clusterHeatmap ?? {},
        managerNote,
        managerNoteSource: meta.model.startsWith('mock-') ? 'fallback' : 'live-ai',
      } as any,
    },
  });
  ok(res, { workShift: updated, managerNote, source: meta.model.startsWith('mock-') ? 'fallback' : 'live-ai' });
}));

/* POST /api/talent/me/shift/tutor — in-shift Partner Q&A.
 *  v3.1.7 — one-shot tutor call grounded in the active artifact's body.
 *  No TutorSession needed (was the bug last turn — startSession demanded a
 *  catalog subtopic, in-shift artifacts aren't catalogued). */
router.post('/talent/me/shift/tutor', requireRole('LEARNER'), asyncHandler(async (req: Request, res: Response) => {
  const { tutorReply } = await import('../services/ai/prompts/tutorChat.js');
  const { getLearnerIdOrThrow } = await import('../services/talent/learnerContext.js');
  const learnerId = await getLearnerIdOrThrow(req.auth!.sub);

  const body = req.body as {
    question?:        string;
    artifactBody?:    string;
    artifactLabel?:   string;
    clusterCode?:     string;
    history?:         Array<{ role: 'user'|'assistant'; content: string }>;
  };
  const question = (body.question ?? '').trim();
  if (question.length < 2) throw new AppError('VALIDATION', 'question required');
  if (!body.clusterCode || !/^C[1-8]$/.test(body.clusterCode)) throw new AppError('VALIDATION', 'clusterCode required (C1..C8)');

  // Derive qualitative band for prompt calibration — IP rule #2: no raw scores to Groq.
  const scoreRow = await prisma.competencyScore.findUnique({
    where:  { learnerId_clusterCode: { learnerId, clusterCode: body.clusterCode as any } },
    select: { scoreWeighted: true },
  });

  const CLUSTER_NAMES: Record<string, { name: string; blurb: string }> = {
    C1: { name: 'Core Technical Foundations', blurb: 'algorithms, data structures, language fluency' },
    C2: { name: 'Applied Problem Solving',    blurb: 'decomposition, pattern recognition, ambiguity' },
    C3: { name: 'Engineering Execution',      blurb: 'shipping, testing, ops, debugging' },
    C4: { name: 'System & Product Thinking',  blurb: 'architecture tradeoffs, design choices' },
    C5: { name: 'Communication & Collaboration', blurb: 'clarity, BLUF, stakeholder updates' },
    C6: { name: 'Domain Specialisation',      blurb: 'deep vertical / context expertise' },
    C7: { name: 'Ownership & Judgment',       blurb: 'taking responsibility, post-mortems, follow-through' },
    C8: { name: 'Learning Agility',           blurb: 'picking up new tech, navigating unknowns' },
  };
  const meta = CLUSTER_NAMES[body.clusterCode] ?? { name: body.clusterCode, blurb: '' };

  const { signalBandFor } = await import('../services/competency/formulas.js');
  const sw = scoreRow?.scoreWeighted ?? 40;
  const learnerBand = signalBandFor(sw) as 'Emerging' | 'Developing' | 'Proficient' | 'Advanced';
  const { reply, meta: aiMeta } = await tutorReply({
    clusterCode:  body.clusterCode,
    clusterName:  meta.name,
    clusterBlurb: meta.blurb,
    subTopic:     body.artifactLabel ?? 'in-shift work',
    learnerBand,
    history:      body.history ?? [],
    userMessage:  question,
    artifactContext: body.artifactBody ?? '',
  });
  ok(res, { reply: reply.reply, conceptTags: reply.conceptTags ?? [], source: aiMeta.model.startsWith('mock-') ? 'fallback' : 'live-ai', model: aiMeta.model });
}));

/* GET /api/talent/me/shift/active — for resume-across-devices */
router.get('/talent/me/shift/active', requireRole('LEARNER'), asyncHandler(async (req: Request, res: Response) => {
  const { getLearnerIdOrThrow } = await import('../services/talent/learnerContext.js');
  const learnerId = await getLearnerIdOrThrow(req.auth!.sub);
  const active = await prisma.workShift.findFirst({
    where: { learnerId, state: 'in_progress' },
    orderBy: { startedAt: 'desc' },
  });
  ok(res, { active: active ?? null });
}));

/* GET /api/talent/me/shift/history — past shifts for the learner */
router.get('/talent/me/shift/history', requireRole('LEARNER'), asyncHandler(async (req: Request, res: Response) => {
  const { getLearnerIdOrThrow } = await import('../services/talent/learnerContext.js');
  const learnerId = await getLearnerIdOrThrow(req.auth!.sub);
  const rows = await prisma.workShift.findMany({
    where: { learnerId, state: 'completed' },
    orderBy: { completedAt: 'desc' },
    take: 20,
  });
  ok(res, { history: rows });
}));

/* ─── Aggregated demand (read; visible to Talent + Campus + employers) ─── */

router.get('/aggregation/demand/:careerTrackId', asyncHandler(async (req: Request, res: Response) => {
  if (!req.auth) throw new AppError('AUTH_FORBIDDEN', 'Authentication required');
  const { aggregateDemandForTrack } = await import('../services/aggregation/demandService.js');
  const demand = await aggregateDemandForTrack(req.params.careerTrackId);
  ok(res, demand);
}));

/* ─── Campus gap report (curriculum vs aggregated demand + AI augmentation) ─── */

router.get('/campus/career-tracks/:careerTrackId/gap-report', requireRole('DEAN', 'PLACEMENT_OFFICER'), asyncHandler(async (req: Request, res: Response) => {
  if (!req.auth?.inst) throw new AppError('AUTH_FORBIDDEN', 'Institution scope required');
  const { computeGapReport } = await import('../services/aggregation/gapService.js');
  const report = await computeGapReport(req.auth.inst, req.params.careerTrackId);
  ok(res, report);
}));

/* Tutor — portal sends {cluster, topic}; backend expects {clusterCode, subtopicCode}.
 * Adapt + initial assistant greeting is created by service automatically. */
router.post('/talent/me/tutor/sessions', requireRole('LEARNER'), asyncHandler(async (req: Request, res: Response) => {
  const { startSession } = await import('../services/talent/tutorService.js');
  const { loadSubtopics } = await import('../services/talent/helpers.js');
  const body = req.body as { cluster?: string; topic?: string; clusterCode?: string; subtopicCode?: string };
  const clusterCode = (body.cluster ?? body.clusterCode ?? '').toUpperCase();
  if (!/^C[1-8]$/.test(clusterCode)) throw new AppError('VALIDATION', 'cluster must be C1..C8');

  // Resolve sub-topic: explicit > matched-by-name (portal sends `topic` as the
  // human name like "Technical Writing Clarity") > first available for cluster.
  const all = loadSubtopics();
  let subtopicCode = body.subtopicCode ?? '';
  if (!subtopicCode && body.topic) {
    // Try exact code match first, then case-insensitive name match.
    const byCode = all.find((s) => s.code === body.topic && s.clusterCode === clusterCode);
    const byName = all.find((s) => s.name.toLowerCase() === body.topic!.toLowerCase() && s.clusterCode === clusterCode);
    subtopicCode = byCode?.code ?? byName?.code ?? '';
  }
  if (!subtopicCode) {
    const first = all.find((s) => s.clusterCode === clusterCode);
    if (!first) throw new AppError('NOT_FOUND', `No sub-topics defined for ${clusterCode}`);
    subtopicCode = first.code;
  }

  const session = await startSession(req.auth!.sub, {
    clusterCode: clusterCode as 'C1' | 'C2' | 'C3' | 'C4' | 'C5' | 'C6' | 'C7' | 'C8',
    subtopicCode,
  });
  // Reshape to portal TutorSession {id, cluster, topic}
  const resolved = all.find((s) => s.code === subtopicCode);
  ok(res, { id: session.id, cluster: clusterCode, topic: resolved?.name ?? subtopicCode });
}));

/* Tutor turn — portal sends {message}, backend expects {content}. Returns
 * full reply (non-streaming for MVP — UI will receive it in one chunk via
 * the apiStream helper). */
router.post('/talent/me/tutor/sessions/:id/turn', requireRole('LEARNER'), asyncHandler(async (req: Request, res: Response) => {
  const { addTurn } = await import('../services/talent/tutorService.js');
  const body = req.body as { message?: string; content?: string };
  const text = (body.message ?? body.content ?? '').trim();
  if (!text) throw new AppError('VALIDATION', 'message required');
  const result = await addTurn(req.auth!.sub, req.params.id, text);
  ok(res, { reply: result.reply.content, transcript: result.transcript });
}));

/* Tutor end — reshape rubric to {conceptsCovered, suggestedNextSteps} */
router.post('/talent/me/tutor/sessions/:id/end', requireRole('LEARNER'), asyncHandler(async (req: Request, res: Response) => {
  const { endSession } = await import('../services/talent/tutorService.js');
  const result = await endSession(req.auth!.sub, req.params.id);
  // MVP-SCAFFOLD: synthesise concepts/next-steps until tutor service tracks them
  const r = result.rubric as { turns?: number } | null;
  ok(res, {
    conceptsCovered: r?.turns ? Array.from({ length: Math.min(r.turns, 5) }, (_, i) => `Concept ${i + 1} discussed`) : [],
    suggestedNextSteps: [
      'Take an MCQ in this cluster to test recall',
      'Try a descriptive item — reflect on what you covered',
      'Open a new tutor session on a related sub-topic',
    ],
  });
}));

/* ─── Demo migrations: 4 production-grade dynamic functions ─────── */

/* (1) Workforce Signal Verification — verify a candidate's signed Signal claim
 *     hasn't been tampered with. Pure crypto (Ed25519). */
router.post('/workforce/verify-signal', requireRole('TA_LEAD'), asyncHandler(async (req: Request, res: Response) => {
  const { verifyToken } = await import('../services/workforce/verificationService.js');
  const body = req.body as { token?: string };
  if (!body.token) throw new AppError('VALIDATION', 'token required');
  const result = verifyToken(body.token);
  ok(res, result);
}));

/* (2) Workforce Sourcing Pools — for ONE role, rank ON-PLATFORM institutions
 *     by fillEfficiency. Adds AI WHY rationale per institution. */
router.get('/workforce/roles/:id/sourcing-pools', requireRole('TA_LEAD'), asyncHandler(async (req: Request, res: Response) => {
  if (!req.auth?.emp) throw new AppError('AUTH_FORBIDDEN', 'Employer scope required');
  const role = await prisma.employerRole.findUnique({ where: { id: req.params.id }, select: { employerId: true } });
  if (!role || role.employerId !== req.auth.emp) throw new AppError('NOT_FOUND', 'Role not found');
  const { computeSourcingPools } = await import('../services/workforce/sourcingPoolService.js');
  const data = await computeSourcingPools(req.params.id);
  ok(res, data);
}));

/* (3) Campus Placement Forecast — for ONE career track, forecast qualifying-
 *     learner counts per employer role + AI per-role rationale. */
router.get('/campus/career-tracks/:careerTrackId/placement-forecast', requireRole('DEAN', 'PLACEMENT_OFFICER'), asyncHandler(async (req: Request, res: Response) => {
  if (!req.auth?.inst) throw new AppError('AUTH_FORBIDDEN', 'Institution scope required');
  const { computePlacementForecast } = await import('../services/campus/placementForecastService.js');
  const data = await computePlacementForecast(req.auth.inst, req.params.careerTrackId);
  ok(res, data);
}));

/* (4) Talent Resume Tailor — for ONE role, generate a tailored resume payload
 *     using resumeBullets Groq prompt. */
router.post('/talent/me/resume/tailor/:roleId', requireRole('LEARNER'), asyncHandler(async (req: Request, res: Response) => {
  const { resumeBullets } = await import('../services/ai/prompts/resumeBullets.js');
  const { getLearnerIdOrThrow } = await import('../services/talent/learnerContext.js');
  const learnerId = await getLearnerIdOrThrow(req.auth!.sub);

  const learner = await prisma.learner.findUnique({
    where: { id: learnerId },
    include: { scores: true, institution: { select: { name: true } }, cohort: { select: { name: true } } },
  });
  if (!learner) throw new AppError('NOT_FOUND', 'Learner not found');

  const role = await prisma.employerRole.findUnique({
    where: { id: req.params.roleId },
    include: { employer: { select: { name: true } } },
  });
  if (!role) throw new AppError('NOT_FOUND', 'Role not found');

  const clusterScores: Record<string, number> = {};
  for (const s of learner.scores) clusterScores[s.clusterCode] = s.scoreWeighted;

  const profile = learner.resumeProfile as { evidenceHighlights?: string[]; experienceSummary?: string } | null;
  const pastWork = profile
    ? `${profile.experienceSummary ?? ''}\n\nHighlights:\n${(profile.evidenceHighlights ?? []).map((h) => `- ${h}`).join('\n')}`
    : (req.body as { pastWork?: string } | undefined)?.pastWork;

  const requirements = ((role.jdExtraction as { extractedRequirements?: string[] } | null)?.extractedRequirements) ?? [];

  const { resume, meta } = await resumeBullets({
    learnerName:   learner.name,
    institution:   learner.institution.name,
    cohortYear:    learner.cohort.name,
    clusterScores,
    roleTitle:     role.title,
    employer:      role.employer.name,
    requirements,
    pastWork,
  });

  ok(res, { resume, meta, role: { id: role.id, title: role.title, employer: role.employer.name } });
}));

/* ─── Market Intel (live public data via Serper, with 24h cache) ─── */

router.get('/talent/me/market-intel', requireRole('LEARNER'), asyncHandler(async (req: Request, res: Response) => {
  const { getTalentMarketIntel } = await import('../services/publicData/marketIntelService.js');
  const { getLearnerIdOrThrow } = await import('../services/talent/learnerContext.js');
  const learnerId = await getLearnerIdOrThrow(req.auth!.sub);
  const learner = await prisma.learner.findUnique({
    where: { id: learnerId },
    select: { institution: { select: { name: true } }, careerTrackEnrollments: { include: { careerTrack: { select: { code: true, name: true } } }, take: 1, orderBy: { isPrimary: 'desc' } } },
  });
  const track = learner?.careerTrackEnrollments[0]?.careerTrack?.code ?? (req.query.track as string | undefined) ?? 'SWE';
  const city = (req.query.city as string | undefined) ?? 'Bangalore';
  const data = await getTalentMarketIntel({
    learnerId,
    institution: learner?.institution?.name ?? 'Unknown',
    city,
    track,
    forceRefresh: req.query.refresh === 'true',
  });
  ok(res, data);
}));

router.get('/workforce/me/market-intel', requireRole('TA_LEAD'), asyncHandler(async (req: Request, res: Response) => {
  if (!req.auth?.emp) throw new AppError('AUTH_FORBIDDEN', 'Employer scope required');
  const { getWorkforceMarketIntel } = await import('../services/publicData/marketIntelService.js');
  const employer = await prisma.employer.findUnique({ where: { id: req.auth.emp }, select: { name: true, archetype: true } });
  if (!employer) throw new AppError('NOT_FOUND', 'Employer not found');
  const track = (req.query.track as string | undefined) ?? 'SWE';
  const data = await getWorkforceMarketIntel({
    employerId:   req.auth.emp,
    employerName: employer.name,
    archetype:    employer.archetype ?? 'Product',  // v3.1 — null until first JD; default for market intel framing
    track,
    city: (req.query.city as string | undefined) ?? 'Bangalore',
    forceRefresh: req.query.refresh === 'true',
  });
  ok(res, data);
}));

router.get('/campus/me/market-intel', requireRole('DEAN', 'PLACEMENT_OFFICER'), asyncHandler(async (req: Request, res: Response) => {
  if (!req.auth?.inst) throw new AppError('AUTH_FORBIDDEN', 'Institution scope required');
  const { getCampusMarketIntel } = await import('../services/publicData/marketIntelService.js');
  const inst = await prisma.institution.findUnique({ where: { id: req.auth.inst }, select: { name: true } });
  if (!inst) throw new AppError('NOT_FOUND', 'Institution not found');
  const track = (req.query.track as string | undefined) ?? 'SWE';
  const data = await getCampusMarketIntel({
    institutionId:   req.auth.inst,
    institutionName: inst.name,
    track,
    forceRefresh: req.query.refresh === 'true',
  });
  ok(res, data);
}));

export default router;
