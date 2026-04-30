import { prisma } from '../../config/db.js';
import { AppError } from '../../utils/AppError.js';
import type { ClusterCode } from '@prisma/client';
import { bandFor, confidenceBand, SUPPRESSION_CONFIDENCE } from './formulas.js';

export interface DistributionRadarPoint { cluster: ClusterCode; mean: number; threshold: number; p75: number }
export interface DistributionTableRow {
  cluster: ClusterCode;
  name: string;
  mean: number;
  threshold: number;
  pctAbove: number;
  pctNear: number;
  pctBelow: number;
  confidence: number | null;
  suppressed: boolean;
}

export async function getDistribution(
  institutionId: string,
  filters: { cohortId?: string; trackId?: string },
): Promise<{ radar: DistributionRadarPoint[]; table: DistributionTableRow[] }> {
  const iv = await prisma.indexVersion.findFirst({
    where: { institutionId },
    orderBy: { effectiveFrom: 'desc' },
  });
  if (!iv) throw new AppError('NOT_FOUND', 'No index version found');
  const thresholds = iv.thresholds as Record<string, number>;

  const learnerWhere: Record<string, unknown> = { institutionId };
  if (filters.cohortId) learnerWhere.cohortId = filters.cohortId;
  if (filters.trackId)  learnerWhere.trackId  = filters.trackId;

  const scores = await prisma.competencyScore.findMany({
    where: { learner: learnerWhere },
    include: { cluster: true },
  });

  const clusters = await prisma.competencyCluster.findMany({ orderBy: { code: 'asc' } });
  const radar: DistributionRadarPoint[] = [];
  const table: DistributionTableRow[] = [];

  for (const c of clusters) {
    const t = thresholds[c.code] ?? 60;
    const bucket = scores.filter((s) => s.clusterCode === c.code);
    if (bucket.length === 0) {
      radar.push({ cluster: c.code, mean: 0, threshold: t, p75: 0 });
      table.push({ cluster: c.code, name: c.name, mean: 0, threshold: t, pctAbove: 0, pctNear: 0, pctBelow: 0, confidence: null, suppressed: true });
      continue;
    }
    const mean = bucket.reduce((a, s) => a + s.scoreWeighted, 0) / bucket.length;
    const sorted = bucket.map((s) => s.scoreWeighted).sort((a, b) => a - b);
    const p75 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.75))];
    const confAvg = bucket.reduce((a, s) => a + s.confidence, 0) / bucket.length;

    let above = 0, near = 0, below = 0;
    for (const s of bucket) {
      const b = bandFor(s.scoreWeighted, t);
      if (b === 'Above') above++; else if (b === 'Near') near++; else below++;
    }
    const n = bucket.length;
    const suppressed = confAvg < SUPPRESSION_CONFIDENCE;

    radar.push({ cluster: c.code, mean: round1(mean), threshold: t, p75: round1(p75) });
    table.push({
      cluster: c.code,
      name: c.name,
      mean: round1(mean),
      threshold: t,
      pctAbove: above / n,
      pctNear: near / n,
      pctBelow: below / n,
      confidence: round3(confAvg),
      suppressed,
    });
  }

  return { radar, table };
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const round3 = (n: number) => Math.round(n * 1000) / 1000;

export { confidenceBand };
