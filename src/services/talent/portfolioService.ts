/**
 * Portfolio — all attempts + completed pathways + signals, grouped by cluster.
 * "visible to employer" rule: score ≥ threshold AND confidence ≥ 0.4.
 * Employer-view endpoint returns only visible items + readiness pills.
 */
import type { ClusterCode } from '@prisma/client';
import { prisma } from '../../config/db.js';
import { bandFor, readinessScore, SUPPRESSION_CONFIDENCE } from '../competency/formulas.js';
import { ALL_CLUSTERS, parseWeights, round1, round3 } from './helpers.js';
import { getLearnerWithScope } from './learnerContext.js';

interface EvidenceItem {
  id: string;
  kind: 'attempt' | 'pathway' | 'signal';
  evidenceKind: 'normative' | 'simulation' | 'augmentation' | 'signal';
  clusterCode: ClusterCode;
  title: string;
  score: number | null;
  confidence: number;
  ts: string;
  visibleToEmployer: boolean;
}

async function collectEvidence(learnerId: string): Promise<EvidenceItem[]> {
  const [attempts, completed, signals, scores] = await Promise.all([
    prisma.assessmentAttemptV2.findMany({ where: { learnerId }, orderBy: { submittedAt: 'desc' } }),
    prisma.augmentationAssignment.findMany({
      where: { learnerId, status: 'complete' },
      include: { programme: true },
      orderBy: { completedAt: 'desc' },
    }),
    prisma.gradiumSignal.findMany({ where: { learnerId, state: 'issued' }, orderBy: { issuedAt: 'desc' } }),
    prisma.competencyScore.findMany({ where: { learnerId } }),
  ]);

  const scoreByCluster = new Map<ClusterCode, { score: number; confidence: number }>();
  for (const s of scores) scoreByCluster.set(s.clusterCode, { score: s.scoreWeighted, confidence: s.confidence });

  const institutionThresholds: Record<string, number> = {};
  const learner = await prisma.learner.findUnique({
    where: { id: learnerId },
    include: { institution: { include: { indexVersions: { orderBy: { effectiveFrom: 'desc' }, take: 1 } } } },
  });
  if (learner) {
    const iv = learner.institution.indexVersions[0];
    if (iv) {
      const thr = iv.thresholds as Record<string, number>;
      for (const k of Object.keys(thr)) institutionThresholds[k] = thr[k];
    }
  }

  const isVisible = (code: ClusterCode, score: number | null, confidence: number): boolean => {
    if (score === null) return false;
    const thr = institutionThresholds[code] ?? 60;
    return score >= thr && confidence >= 0.4;
  };

  const out: EvidenceItem[] = [];
  for (const a of attempts) {
    const clusterInfo = scoreByCluster.get(a.clusterCode);
    const conf = clusterInfo?.confidence ?? 0;
    out.push({
      id: 'attempt:' + a.id,
      kind: 'attempt',
      evidenceKind: a.kind === 'simulation' ? 'simulation' : 'normative',
      clusterCode: a.clusterCode,
      title: `${a.kind.charAt(0).toUpperCase() + a.kind.slice(1)} Assessment — ${a.clusterCode}`,
      score: a.score,
      confidence: round3(conf),
      ts: a.submittedAt.toISOString(),
      visibleToEmployer: isVisible(a.clusterCode, a.score, conf),
    });
  }
  for (const p of completed) {
    const clusterInfo = scoreByCluster.get(p.programme.clusterCode);
    const conf = clusterInfo?.confidence ?? 0;
    const score = clusterInfo?.score ?? null;
    out.push({
      id: 'pathway:' + p.id,
      kind: 'pathway',
      evidenceKind: 'augmentation',
      clusterCode: p.programme.clusterCode,
      title: `Augmentation Pathway — ${p.programme.title}`,
      score: score === null ? null : Math.round(score),
      confidence: round3(conf),
      ts: (p.completedAt ?? p.assignedAt).toISOString(),
      visibleToEmployer: isVisible(p.programme.clusterCode, score, conf),
    });
  }
  for (const s of signals) {
    const clusterInfo = scoreByCluster.get(s.clusterCode);
    const conf = clusterInfo?.confidence ?? 0;
    const score = clusterInfo?.score ?? null;
    out.push({
      id: 'signal:' + s.id,
      kind: 'signal',
      evidenceKind: 'signal',
      clusterCode: s.clusterCode,
      title: `GradiumOS Signal — ${s.clusterCode}`,
      score: score === null ? null : Math.round(score),
      confidence: round3(conf),
      ts: (s.issuedAt ?? new Date()).toISOString(),
      visibleToEmployer: conf >= SUPPRESSION_CONFIDENCE,
    });
  }
  return out;
}

export async function getPortfolio(userId: string) {
  const { learner } = await getLearnerWithScope(userId);
  const evidence = await collectEvidence(learner.id);

  // Enrich with cluster names.
  const clusterDefs = await prisma.competencyCluster.findMany({ orderBy: { code: 'asc' } });
  const nameMap = new Map(clusterDefs.map((c) => [c.code as ClusterCode, c.name]));

  // Shape to PortfolioItemDTO.
  const items = evidence.map((e) => ({
    id: e.id,
    type: e.kind as 'attempt' | 'pathway' | 'signal',
    evidenceKind: e.evidenceKind,
    clusterCode: e.clusterCode,
    clusterName: nameMap.get(e.clusterCode) ?? e.clusterCode,
    title: e.title,
    score: e.score,
    confidence: e.confidence,
    createdAt: e.ts,
    visibleToEmployer: e.visibleToEmployer,
  }));

  // Per-cluster summaries from competency scores.
  const scores = await prisma.competencyScore.findMany({ where: { learnerId: learner.id } });
  const scoreByCluster = new Map<ClusterCode, { score: number; confidence: number }>();
  for (const s of scores) scoreByCluster.set(s.clusterCode, { score: s.scoreWeighted, confidence: s.confidence });

  const clusterSummaries = clusterDefs.map((c) => {
    const info = scoreByCluster.get(c.code);
    const score = info?.score ?? 0;
    const conf = info?.confidence ?? 0;
    return {
      clusterCode: c.code as ClusterCode,
      clusterName: c.name,
      score: round1(score),
      threshold: 60,
      confidence: round3(conf),
      band: bandFor(score, 60),
    };
  });

  return { items, clusterSummaries };
}

export async function getEmployerView(userId: string) {
  const { learner } = await getLearnerWithScope(userId);
  const evidence = await collectEvidence(learner.id);
  const visible = evidence.filter((e) => e.visibleToEmployer);
  const hiddenCount = evidence.length - visible.length;

  // Per-track readiness pills.
  const enrollments = await prisma.careerTrackEnrollment.findMany({
    where: { learnerId: learner.id },
    include: { careerTrack: true },
  });
  const scores = await prisma.competencyScore.findMany({ where: { learnerId: learner.id } });
  const scoreByCluster = new Map<ClusterCode, { score: number; confidence: number }>();
  for (const s of scores) scoreByCluster.set(s.clusterCode, { score: s.scoreWeighted, confidence: s.confidence });

  // Enrich visible evidence with PortfolioItemDTO shape.
  const clusterDefs2 = await prisma.competencyCluster.findMany({ orderBy: { code: 'asc' } });
  const nameMap2 = new Map(clusterDefs2.map((c) => [c.code as ClusterCode, c.name]));
  const visibleItems = visible.map((e) => ({
    id: e.id,
    type: e.kind as 'attempt' | 'pathway' | 'signal',
    evidenceKind: e.evidenceKind,
    clusterCode: e.clusterCode,
    clusterName: nameMap2.get(e.clusterCode) ?? e.clusterCode,
    title: e.title,
    score: e.score,
    confidence: e.confidence,
    createdAt: e.ts,
    visibleToEmployer: true,
  }));

  // Track pills shaped for EmployerViewDTO — include signalState from latest GradiumSignal.
  const trackPills = await Promise.all(enrollments.map(async (e) => {
    const weights = parseWeights(e.careerTrack.clusterWeights);
    const r = readinessScore(ALL_CLUSTERS.map((c) => ({
      scoreWeighted: scoreByCluster.get(c)?.score ?? 0,
      weight: weights[c] ?? 0,
    })));
    const hasSignal = await prisma.gradiumSignal.count({ where: { learnerId: learner.id, state: 'issued' } });
    return {
      careerTrackCode: e.careerTrack.code,
      careerTrackName: e.careerTrack.name,
      readiness: round1(r),
      signalState: hasSignal > 0 ? 'ready' : 'building',
    };
  }));

  // Cluster grid filtered to conf ≥ 0.4, shaped for EmployerViewDTO.
  const clusterDefs3 = await prisma.competencyCluster.findMany({ orderBy: { code: 'asc' } });
  const visibleClusters = clusterDefs3
    .map((c) => {
      const info = scoreByCluster.get(c.code);
      const score = info?.score ?? 0;
      const conf = info?.confidence ?? 0;
      return { clusterCode: c.code as ClusterCode, clusterName: c.name, score: round1(score), confidence: round3(conf), band: bandFor(score, 60) };
    })
    .filter((c) => c.confidence >= 0.4);

  return {
    learnerName: learner.name,
    institutionName: learner.institution.name,
    trackPills,
    clusters: visibleClusters,
    evidence: visibleItems,
    hiddenCount,
  };
}
