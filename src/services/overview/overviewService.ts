import { prisma } from '../../config/db.js';
import { AppError } from '../../utils/AppError.js';
import { AssignmentStatus, type ClusterCode } from '@prisma/client';
import { bandFor, confidenceBand, SUPPRESSION_CONFIDENCE } from '../competency/formulas.js';

export interface KpiResult {
  enrolledLearners: number;
  assessmentRate: number;
  systemConfidence: number;
  aboveThresholdPct: number;
  activeAugmentation: number;
  placementMatchedPct: number;
  signalsGenerated: number;
}

export async function getKpis(institutionId: string): Promise<KpiResult> {
  const [learnerCount, scores, clustersCount, activeAssignments, signalsIssued, placedLearners] = await Promise.all([
    prisma.learner.count({ where: { institutionId } }),
    prisma.competencyScore.findMany({
      where: { learner: { institutionId } },
      select: { scoreWeighted: true, confidence: true, clusterCode: true, learnerId: true },
    }),
    prisma.competencyCluster.count(),
    prisma.augmentationAssignment.count({
      where: {
        programme: { institutionId },
        status: { in: [AssignmentStatus.assigned, AssignmentStatus.in_progress, AssignmentStatus.awaiting_assessment] },
      },
    }),
    prisma.gradiumSignal.count({ where: { learner: { institutionId }, state: 'issued' } }),
    prisma.placement.findMany({
      where: { learner: { institutionId } },
      select: { learnerId: true },
      distinct: ['learnerId'],
    }),
  ]);

  const iv = await prisma.indexVersion.findFirst({ where: { institutionId }, orderBy: { effectiveFrom: 'desc' } });
  if (!iv) throw new AppError('NOT_FOUND', 'No index version configured');
  const thresholds = iv.thresholds as Record<string, number>;

  const expectedPairs = learnerCount * clustersCount;
  const assessmentRate = expectedPairs === 0 ? 0 : scores.length / expectedPairs;
  const systemConfidence = scores.length === 0 ? 0 : scores.reduce((a, s) => a + s.confidence, 0) / scores.length;
  const aboveCount = scores.reduce((acc, s) => acc + (s.scoreWeighted >= (thresholds[s.clusterCode] ?? 60) ? 1 : 0), 0);
  const aboveThresholdPct = scores.length === 0 ? 0 : aboveCount / scores.length;

  // Placement-matched: distinct learners with at least one realised Placement row,
  // divided by total learners. Pure formula over seed data — no hardcoded targets.
  const placementMatchedPct = learnerCount === 0 ? 0 : placedLearners.length / learnerCount;

  const result: KpiResult = {
    enrolledLearners: learnerCount,
    assessmentRate,
    systemConfidence,
    aboveThresholdPct,
    activeAugmentation: activeAssignments,
    placementMatchedPct,
    signalsGenerated: signalsIssued,
  };

  return result;
}

export interface WeakClusterResult {
  cluster: ClusterCode;
  name: string;
  pctBelow: number;
  severityIndex: number;
  confidence: number | null;
  suppressed: boolean;
}

export async function getWeakClusters(institutionId: string, limit = 3): Promise<WeakClusterResult[]> {
  const iv = await prisma.indexVersion.findFirst({ where: { institutionId }, orderBy: { effectiveFrom: 'desc' } });
  if (!iv) throw new AppError('NOT_FOUND', 'No index version configured');
  const thresholds = iv.thresholds as Record<string, number>;
  const weights    = iv.weights    as Record<string, number>;

  const effectiveLimit = limit;

  const clusters = await prisma.competencyCluster.findMany();
  const scores = await prisma.competencyScore.findMany({
    where: { learner: { institutionId } },
    select: { clusterCode: true, scoreWeighted: true, confidence: true },
  });

  const results: WeakClusterResult[] = [];
  for (const c of clusters) {
    const bucket = scores.filter((s) => s.clusterCode === c.code);
    if (bucket.length === 0) {
      results.push({ cluster: c.code, name: c.name, pctBelow: 0, severityIndex: 0, confidence: null, suppressed: true });
      continue;
    }
    const threshold = thresholds[c.code] ?? 60;
    const below = bucket.filter((s) => bandFor(s.scoreWeighted, threshold) === 'Below').length;
    const pctBelow = below / bucket.length;
    const avgGap = bucket.reduce((a, s) => a + Math.max(0, threshold - s.scoreWeighted), 0) / bucket.length;
    const severityIndex = avgGap * (weights[c.code] ?? 0);
    const confAvg = bucket.reduce((a, s) => a + s.confidence, 0) / bucket.length;
    results.push({
      cluster: c.code,
      name: c.name,
      pctBelow,
      severityIndex: Math.round(severityIndex * 100) / 100,
      confidence: Math.round(confAvg * 1000) / 1000,
      suppressed: confAvg < SUPPRESSION_CONFIDENCE,
    });
  }
  const sorted = results.sort((a, b) => b.severityIndex - a.severityIndex).slice(0, effectiveLimit);

  return sorted;
}

export async function getReadinessByTrack(institutionId: string) {
  const tracks = await prisma.track.findMany({ where: { institutionId }, include: { learners: true } });
  const iv = await prisma.indexVersion.findFirst({ where: { institutionId }, orderBy: { effectiveFrom: 'desc' } });
  if (!iv) throw new AppError('NOT_FOUND', 'No index version configured');
  const thresholds = iv.thresholds as Record<string, number>;

  const rows: Array<{ trackId: string; trackName: string; learners: number; abovePct: number; nearPct: number; belowPct: number }> = [];
  for (const t of tracks) {
    const learnerIds = t.learners.map((l) => l.id);
    if (learnerIds.length === 0) {
      rows.push({ trackId: t.id, trackName: t.name, learners: 0, abovePct: 0, nearPct: 0, belowPct: 0 });
      continue;
    }
    const scores = await prisma.competencyScore.findMany({ where: { learnerId: { in: learnerIds } } });
    let above = 0, near = 0, below = 0;
    for (const s of scores) {
      const b = bandFor(s.scoreWeighted, thresholds[s.clusterCode] ?? 60);
      if (b === 'Above') above++; else if (b === 'Near') near++; else below++;
    }
    const n = scores.length || 1;
    rows.push({
      trackId: t.id,
      trackName: t.name,
      learners: t.learners.length,
      abovePct: above / n,
      nearPct: near / n,
      belowPct: below / n,
    });
  }

  return rows;
}

export async function getSignalConfidenceMatrix(institutionId: string) {
  const tracks = await prisma.track.findMany({ where: { institutionId } });
  const clusters = await prisma.competencyCluster.findMany({ orderBy: { code: 'asc' } });
  const scores = await prisma.competencyScore.findMany({
    where: { learner: { institutionId } },
    include: { learner: true },
  });

  const cells: { track: string; cluster: ClusterCode; value: number | null; band: 'green' | 'amber' | 'grey' | 'suppressed' }[] = [];
  for (const t of tracks) {
    for (const c of clusters) {
      const bucket = scores.filter((s) => s.clusterCode === c.code && s.learner.trackId === t.id);
      if (bucket.length === 0) {
        cells.push({ track: t.name, cluster: c.code, value: null, band: 'grey' });
        continue;
      }
      const confAvg = bucket.reduce((a, s) => a + s.confidence, 0) / bucket.length;
      cells.push({ track: t.name, cluster: c.code, value: Math.round(confAvg * 1000) / 1000, band: confidenceBand(confAvg) });
    }
  }

  return {
    tracks: tracks.map((t) => t.name),
    clusters: clusters.map((c) => c.code),
    cells,
  };
}
