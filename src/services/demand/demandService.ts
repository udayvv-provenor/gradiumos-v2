/**
 * Demand vs Coverage — archetype × cluster matrix.
 * Demand is the `archetypeWeights` JSON already on CompetencyCluster.
 * Coverage = % of learners in tracks of that archetype whose score is above threshold.
 */
import { prisma } from '../../config/db.js';
import { AppError } from '../../utils/AppError.js';
import { Archetype, type ClusterCode } from '@prisma/client';
import { bandFor } from '../competency/formulas.js';

type DemandBand = 'ok' | 'at_risk' | 'critical';

export interface DemandCell {
  cluster: ClusterCode;
  archetype: Archetype;
  demandPct: number;
  coveragePct: number;
  gapPct: number;
  band: DemandBand;
}

export async function getDemandVsCoverage(institutionId: string) {
  const iv = await prisma.indexVersion.findFirst({
    where: { institutionId },
    orderBy: { effectiveFrom: 'desc' },
  });
  if (!iv) throw new AppError('NOT_FOUND', 'No index version configured');
  const thresholds = iv.thresholds as Record<string, number>;

  const [clusters, tracks, scores] = await Promise.all([
    prisma.competencyCluster.findMany({ orderBy: { code: 'asc' } }),
    prisma.track.findMany({ where: { institutionId }, include: { learners: true } }),
    prisma.competencyScore.findMany({
      where: { learner: { institutionId } },
      include: { learner: true },
    }),
  ]);

  const archetypes: Archetype[] = [Archetype.Product, Archetype.Service, Archetype.MassRecruiter];
  const cells: DemandCell[] = [];

  for (const c of clusters) {
    const aw = c.archetypeWeights as Record<string, number>;
    for (const a of archetypes) {
      const archetypeTrackIds = tracks.filter((t) => t.archetype === a).map((t) => t.id);
      const bucket = scores.filter(
        (s) => s.clusterCode === c.code && archetypeTrackIds.includes(s.learner.trackId),
      );
      const threshold = thresholds[c.code] ?? 60;
      const above = bucket.filter((s) => bandFor(s.scoreWeighted, threshold) === 'Above').length;
      const coveragePct = bucket.length === 0 ? 0 : above / bucket.length;
      const demandPct = aw[a] ?? 0;
      const gapPct = demandPct - coveragePct;
      let band: DemandBand = 'ok';
      if (gapPct > 0.15) band = 'critical';
      else if (gapPct > 0.05) band = 'at_risk';
      cells.push({
        cluster: c.code,
        archetype: a,
        demandPct: round3(demandPct),
        coveragePct: round3(coveragePct),
        gapPct: round3(gapPct),
        band,
      });
    }
  }

  const gapsByArchetype: Record<Archetype, string[]> = {
    [Archetype.Product]: [],
    [Archetype.Service]: [],
    [Archetype.MassRecruiter]: [],
  };
  for (const a of archetypes) {
    const worst = cells
      .filter((c) => c.archetype === a && c.band !== 'ok')
      .sort((x, y) => y.gapPct - x.gapPct)
      .slice(0, 3);
    gapsByArchetype[a] = worst.map((w) => {
      const cluster = clusters.find((c) => c.code === w.cluster)!;
      return `${w.cluster} · ${cluster.shortName}: ${Math.round(w.coveragePct * 100)}% coverage against ${Math.round(w.demandPct * 100)}% demand`;
    });
  }

  return {
    archetypes,
    clusters: clusters.map((c) => ({ code: c.code, name: c.name, shortName: c.shortName })),
    cells,
    gapsByArchetype,
  };
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;
