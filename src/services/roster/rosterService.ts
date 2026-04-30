import { prisma } from '../../config/db.js';
import { AppError } from '../../utils/AppError.js';
import { AssignmentStatus, Prisma, type ClusterCode } from '@prisma/client';
import { bandFor, readinessScore, confidenceBand, SUPPRESSION_CONFIDENCE } from '../competency/formulas.js';

export type BandLabel = 'Above' | 'Near' | 'Below';

export interface LearnerRowDTO {
  id: string;
  name: string;
  email: string;
  trackName: string;
  cohortName: string;
  band: BandLabel;
  readinessScore: number;
  signalGenerated: boolean;
  activeAugmentations: number;
  lastAssessedAt: string | null;
}

export interface ListLearnersArgs {
  institutionId: string;
  q?: string;
  band?: BandLabel;
  trackId?: string;
  caeStatus?: 'active' | 'none';
  page: number;
  pageSize: number;
}

export async function listLearners(args: ListLearnersArgs): Promise<{ items: LearnerRowDTO[]; page: number; pageSize: number; total: number }> {
  const { institutionId, q, trackId } = args;

  const iv = await prisma.indexVersion.findFirst({ where: { institutionId }, orderBy: { effectiveFrom: 'desc' } });
  if (!iv) throw new AppError('NOT_FOUND', 'No index version configured');
  const weights    = iv.weights    as Record<string, number>;
  const thresholds = iv.thresholds as Record<string, number>;

  const where: Prisma.LearnerWhereInput = {
    institutionId,
    ...(trackId ? { trackId } : {}),
    ...(q
      ? {
          OR: [
            { name:  { contains: q, mode: Prisma.QueryMode.insensitive } },
            { email: { contains: q, mode: Prisma.QueryMode.insensitive } },
          ],
        }
      : {}),
  };

  // We need to post-filter by band + CAE status (derived fields), so fetch all matching then slice.
  const all = await prisma.learner.findMany({
    where,
    include: {
      track: true,
      cohort: true,
      scores: true,
      assignments: {
        where: {
          status: { in: [AssignmentStatus.assigned, AssignmentStatus.in_progress, AssignmentStatus.awaiting_assessment] },
        },
      },
      signals: { where: { state: 'issued' } },
    },
    orderBy: { name: 'asc' },
  });

  const enriched: LearnerRowDTO[] = all.map((l) => {
    const readiness = readinessScore(
      l.scores.map((s) => ({ scoreWeighted: s.scoreWeighted, weight: weights[s.clusterCode] ?? 0 })),
    );
    // Band at learner-level: derive from readiness vs. mean threshold, or report 'Near' when mixed.
    const avgThreshold = Object.values(thresholds).reduce((a, b) => a + b, 0) / Object.keys(thresholds).length;
    const band = bandFor(readiness, avgThreshold);
    const lastAttempt = l.scores.reduce<Date | null>((acc, s) => {
      if (!s.lastAttemptAt) return acc;
      return !acc || s.lastAttemptAt > acc ? s.lastAttemptAt : acc;
    }, null);
    return {
      id: l.id,
      name: l.name,
      email: l.email,
      trackName: l.track.name,
      cohortName: l.cohort.name,
      band,
      readinessScore: Math.round(readiness * 10) / 10,
      signalGenerated: l.signals.length > 0,
      activeAugmentations: l.assignments.length,
      lastAssessedAt: lastAttempt ? lastAttempt.toISOString() : null,
    };
  });

  const filtered = enriched.filter((r) => {
    if (args.band && r.band !== args.band) return false;
    if (args.caeStatus === 'active' && r.activeAugmentations === 0) return false;
    if (args.caeStatus === 'none'   && r.activeAugmentations !== 0) return false;
    return true;
  });

  const start = (args.page - 1) * args.pageSize;
  const items = filtered.slice(start, start + args.pageSize);
  return { items, page: args.page, pageSize: args.pageSize, total: filtered.length };
}

export interface ClusterDetailDTO {
  cluster: ClusterCode;
  name: string;
  score: number | null;
  threshold: number;
  confidence: number | null;
  freshness: number | null;
  band: BandLabel | null;
  suppressed: boolean;
  attempts: number;
}

export async function getLearner(institutionId: string, learnerId: string) {
  const learner = await prisma.learner.findFirst({
    where: { id: learnerId, institutionId },
    include: {
      track: true,
      cohort: true,
      scores: { include: { cluster: true } },
    },
  });
  if (!learner) throw new AppError('NOT_FOUND', 'Learner not found');

  const iv = await prisma.indexVersion.findFirst({ where: { institutionId }, orderBy: { effectiveFrom: 'desc' } });
  if (!iv) throw new AppError('NOT_FOUND', 'No index version configured');
  const thresholds = iv.thresholds as Record<string, number>;
  const weights    = iv.weights    as Record<string, number>;

  const clusters = await prisma.competencyCluster.findMany({ orderBy: { code: 'asc' } });
  const clustersOut: ClusterDetailDTO[] = clusters.map((c) => {
    const s = learner.scores.find((x) => x.clusterCode === c.code);
    const threshold = thresholds[c.code] ?? 60;
    if (!s) {
      return { cluster: c.code, name: c.name, score: null, threshold, confidence: null, freshness: null, band: null, suppressed: true, attempts: 0 };
    }
    const suppressed = s.confidence < SUPPRESSION_CONFIDENCE;
    return {
      cluster: c.code,
      name: c.name,
      score: Math.round(s.scoreWeighted * 10) / 10,
      threshold,
      confidence: Math.round(s.confidence * 1000) / 1000,
      freshness: Math.round(s.freshness * 1000) / 1000,
      band: bandFor(s.scoreWeighted, threshold),
      suppressed,
      attempts: s.attemptsCount,
    };
  });

  const readiness = readinessScore(
    learner.scores.map((s) => ({ scoreWeighted: s.scoreWeighted, weight: weights[s.clusterCode] ?? 0 })),
  );
  const signals = await prisma.gradiumSignal.count({ where: { learnerId: learner.id, state: 'issued' } });

  return {
    id: learner.id,
    name: learner.name,
    email: learner.email,
    trackName: learner.track.name,
    cohortName: learner.cohort.name,
    clusters: clustersOut,
    readinessScore: Math.round(readiness * 10) / 10,
    signalGenerated: signals > 0,
  };
}

export { confidenceBand };
