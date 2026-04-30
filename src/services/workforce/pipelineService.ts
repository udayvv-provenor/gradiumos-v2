/**
 * Pipeline service — invited → assessed → decisioned transitions with guard rails.
 * Also exposes a time-series view for the Workforce Assessment Pipelines graph.
 */
import { prisma } from '../../config/db.js';
import { AppError } from '../../utils/AppError.js';
import { matchScore, SUPPRESSION_CONFIDENCE, confidenceScore } from '../competency/formulas.js';
import { ALL_CLUSTERS, parseTargets, parseWeights, round3 } from './helpers.js';
import type { ClusterCode, PipelineStage, Decision } from '@prisma/client';

export async function listPipeline(employerId: string) {
  const rows = await prisma.pipelineCandidate.findMany({
    where: { employerId },
    include: {
      role: true,
      learner: { include: { track: { include: { institution: true } }, cohort: true } },
    },
    orderBy: { invitedAt: 'desc' },
  });
  const out = rows.map((p) => ({
    id: p.id,
    roleId: p.roleId,
    roleTitle: p.role.title,
    learnerId: p.learnerId,
    learnerName: p.learner.name,
    learnerEmail: p.learner.email,
    institutionName: p.learner.track.institution.name,
    cohortName: p.learner.cohort.name,
    stage: p.stage,
    decision: p.decision,
    signalMatch: p.signalMatch,
    augmentedMatch: p.augmentedMatch,
    invitedAt: p.invitedAt.toISOString(),
    assessedAt: p.assessedAt?.toISOString() ?? null,
    decidedAt: p.decidedAt?.toISOString() ?? null,
  }));
  const grouped: Record<PipelineStage, typeof out> = {
    invited: out.filter((r) => r.stage === 'invited'),
    assessed: out.filter((r) => r.stage === 'assessed'),
    decisioned: out.filter((r) => r.stage === 'decisioned'),
  };
  return { grouped, rows: out };
}

export async function invite(employerId: string, payload: { roleId: string; learnerId: string }) {
  const role = await prisma.employerRole.findUnique({ where: { id: payload.roleId } });
  if (!role || role.employerId !== employerId) throw new AppError('NOT_FOUND', 'Role not found');
  const learner = await prisma.learner.findUnique({ where: { id: payload.learnerId }, include: { scores: true } });
  if (!learner) throw new AppError('NOT_FOUND', 'Learner not found');

  const existing = await prisma.pipelineCandidate.findUnique({
    where: { roleId_learnerId: { roleId: role.id, learnerId: learner.id } },
  });
  if (existing) throw new AppError('CONFLICT', 'Learner already in pipeline for this role');

  const weights = parseWeights(role.clusterWeights);
  const targets = parseTargets(role.clusterTargets);
  const byCode = new Map<ClusterCode, { score: number; confidence: number }>();
  for (const s of learner.scores) byCode.set(s.clusterCode, { score: s.scoreWeighted, confidence: s.confidence });
  const entries: { scoreWeighted: number; target: number; weight: number }[] = [];
  for (const c of ALL_CLUSTERS) {
    const w = weights[c] ?? 0;
    const t = targets[c];
    if (w <= 0 || !t) continue;
    const sv = byCode.get(c);
    if (!sv || sv.confidence < SUPPRESSION_CONFIDENCE) continue;
    entries.push({ scoreWeighted: sv.score, target: t.target, weight: w });
  }
  const match = matchScore(entries);

  const created = await prisma.pipelineCandidate.create({
    data: {
      employerId,
      roleId: role.id,
      learnerId: learner.id,
      stage: 'invited',
      signalMatch: round3(match),
    },
  });
  return { id: created.id, stage: created.stage, signalMatch: created.signalMatch };
}

/**
 * Record a stage transition. Legal transitions:
 *   invited   → assessed
 *   assessed  → decisioned (decision required)
 * Decision can only be set when moving to decisioned (or updated while at decisioned).
 */
export async function recordDecision(
  employerId: string,
  pipelineId: string,
  payload: { stage: PipelineStage; decision?: Decision },
) {
  const row = await prisma.pipelineCandidate.findUnique({ where: { id: pipelineId } });
  if (!row || row.employerId !== employerId) throw new AppError('NOT_FOUND', 'Pipeline row not found');

  const { stage, decision } = payload;
  const now = new Date();
  let update: Record<string, unknown> = {};

  if (row.stage === 'invited' && stage === 'assessed') {
    update = { stage: 'assessed', assessedAt: now };
  } else if (row.stage === 'assessed' && stage === 'decisioned') {
    if (!decision) throw new AppError('VALIDATION_ERROR', 'Decision required when moving to decisioned');
    update = { stage: 'decisioned', decidedAt: now, decision };
  } else if (row.stage === 'decisioned' && stage === 'decisioned') {
    if (!decision) throw new AppError('VALIDATION_ERROR', 'Decision required at decisioned stage');
    update = { decision, decidedAt: now };
  } else {
    throw new AppError('CONFLICT', `Illegal transition: ${row.stage} → ${stage}`);
  }

  const next = await prisma.pipelineCandidate.update({ where: { id: pipelineId }, data: update });
  return { id: next.id, stage: next.stage, decision: next.decision };
}

/**
 * Assessment Pipelines time-series — last 90 days, broken down by stage.
 * Bucketed into 12 buckets (~weekly) so the UI can render a stacked bar chart
 * that is never empty for a demo-seeded tenant.
 */
export async function getPipelineTimeseries(employerId: string, windowDays = 90) {
  const now = new Date();
  const from = new Date(now.getTime() - windowDays * 86400000);
  const [pipelineRows, attempts] = await Promise.all([
    prisma.pipelineCandidate.findMany({
      where: { employerId, invitedAt: { gte: from } },
      include: { role: true, learner: { select: { id: true } } },
    }),
    prisma.attempt.findMany({
      where: {
        takenAt: { gte: from },
        learner: { pipelines: { some: { employerId } } },
      },
      select: { takenAt: true, scoreNorm: true, clusterCode: true, kind: true, learnerId: true },
    }),
  ]);

  const bucketCount = 12;
  const bucketMs = (windowDays * 86400000) / bucketCount;
  const buckets: {
    bucketStart: string;
    bucketEnd: string;
    screening: number; // pipeline.invited
    technical: number; // pipeline.assessed + new Attempt rows
    final: number;     // pipeline.decisioned
    attempts: number;
    avgScore: number;
  }[] = [];

  for (let i = 0; i < bucketCount; i++) {
    const startMs = from.getTime() + i * bucketMs;
    const endMs = startMs + bucketMs;
    const scr = pipelineRows.filter((p) => p.invitedAt.getTime() >= startMs && p.invitedAt.getTime() < endMs).length;
    const tech = pipelineRows.filter((p) => p.assessedAt && p.assessedAt.getTime() >= startMs && p.assessedAt.getTime() < endMs).length
      + attempts.filter((a) => a.takenAt.getTime() >= startMs && a.takenAt.getTime() < endMs).length;
    const fin = pipelineRows.filter((p) => p.decidedAt && p.decidedAt.getTime() >= startMs && p.decidedAt.getTime() < endMs).length;
    const attemptsBucket = attempts.filter((a) => a.takenAt.getTime() >= startMs && a.takenAt.getTime() < endMs);
    const avgScore = attemptsBucket.length === 0
      ? 0
      : attemptsBucket.reduce((a, b) => a + b.scoreNorm, 0) / attemptsBucket.length;
    buckets.push({
      bucketStart: new Date(startMs).toISOString(),
      bucketEnd: new Date(endMs).toISOString(),
      screening: scr,
      technical: tech,
      final: fin,
      attempts: attemptsBucket.length,
      avgScore: Math.round(avgScore * 10) / 10,
    });
  }

  // Stage totals
  const totals = {
    screening: pipelineRows.filter((p) => p.stage === 'invited').length,
    technical: pipelineRows.filter((p) => p.stage === 'assessed').length,
    final: pipelineRows.filter((p) => p.stage === 'decisioned').length,
    totalCandidates: pipelineRows.length,
    totalAttempts: attempts.length,
    avgScore: attempts.length === 0 ? 0 : Math.round((attempts.reduce((a, b) => a + b.scoreNorm, 0) / attempts.length) * 10) / 10,
  };

  // Per-cluster attempt counts — for a secondary cluster-breakdown chart
  const perCluster: Record<ClusterCode, { count: number; avgScore: number }> = {} as Record<ClusterCode, { count: number; avgScore: number }>;
  for (const c of ALL_CLUSTERS) perCluster[c] = { count: 0, avgScore: 0 };
  for (const a of attempts) {
    const bucket = perCluster[a.clusterCode];
    bucket.count += 1;
    bucket.avgScore += a.scoreNorm;
  }
  const byCluster = ALL_CLUSTERS.map((c) => ({
    clusterCode: c,
    attempts: perCluster[c].count,
    avgScore: perCluster[c].count === 0 ? 0 : Math.round((perCluster[c].avgScore / perCluster[c].count) * 10) / 10,
  }));

  const confidence = confidenceScore({
    completeness: Math.min(1, attempts.length / 40),
    stability: Math.min(1, pipelineRows.length / 10),
    sufficiency: Math.min(1, bucketCount / 12),
    consistency: 0.75,
  });

  // Derived funnel rates surfaced on totals so the UI / downstream can read them.
  const totalCand = Math.max(1, pipelineRows.length);
  const totalsWithRates = {
    ...totals,
    signalPassRate: round3((totals.technical + totals.final) / totalCand),
    decisionRate: round3(totals.final / totalCand),
    offerRate: round3(
      pipelineRows.filter((p) => p.decision === 'offer').length / Math.max(1, totals.final),
    ),
  };

  return {
    windowDays,
    from: from.toISOString(),
    to: now.toISOString(),
    buckets,
    byCluster,
    totals: totalsWithRates,
    confidence: round3(confidence),
  };
}
