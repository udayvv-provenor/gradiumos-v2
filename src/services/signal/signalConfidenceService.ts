/**
 * Signal Confidence — extended track × cluster confidence matrix.
 * Builds on overview.getSignalConfidenceMatrix but adds per-cell component breakdown,
 * suppression counts, and index-wide KPIs.
 */
import { prisma } from '../../config/db.js';
import { AppError } from '../../utils/AppError.js';
import { type ClusterCode } from '@prisma/client';
import {
  SUPPRESSION_CONFIDENCE,
  confidenceBand,
  completeness as fCompleteness,
  stability as fStability,
  sufficiency as fSufficiency,
  consistency as fConsistency,
} from '../competency/formulas.js';

export async function getSignalConfidence(institutionId: string) {
  const [tracks, clusters, scores, attempts] = await Promise.all([
    prisma.track.findMany({ where: { institutionId } }),
    prisma.competencyCluster.findMany({ orderBy: { code: 'asc' } }),
    prisma.competencyScore.findMany({
      where: { learner: { institutionId } },
      include: { learner: true },
    }),
    prisma.attempt.findMany({
      where: { learner: { institutionId } },
      orderBy: { takenAt: 'asc' },
    }),
  ]);

  if (tracks.length === 0) throw new AppError('NOT_FOUND', 'No tracks configured');

  // Index per learner|cluster chronological scores
  const chronoMap = new Map<string, number[]>();
  for (const a of attempts) {
    const key = `${a.learnerId}|${a.clusterCode}`;
    const arr = chronoMap.get(key) ?? [];
    arr.push(a.scoreNorm);
    chronoMap.set(key, arr);
  }

  const totalClusters = clusters.length;
  const cells: Array<{
    track: string;
    cluster: ClusterCode;
    value: number | null;
    band: 'green' | 'amber' | 'grey' | 'suppressed';
    completeness: number;
    stability: number;
    sufficiency: number;
    consistency: number;
    suppressedLearners: number;
    totalLearners: number;
  }> = [];

  let sumConf = 0;
  let cntConf = 0;
  let sumComp = 0;
  let sumStab = 0;
  let sumSuf = 0;
  let sumCons = 0;
  let bandCounts = { green: 0, amber: 0, grey: 0, suppressed: 0 };

  for (const t of tracks) {
    const trackLearners = scores.filter((s) => s.learner.trackId === t.id);
    for (const c of clusters) {
      const bucket = trackLearners.filter((s) => s.clusterCode === c.code);
      if (bucket.length === 0) {
        cells.push({
          track: t.name,
          cluster: c.code,
          value: null,
          band: 'grey',
          completeness: 0,
          stability: 0,
          sufficiency: 0,
          consistency: 0,
          suppressedLearners: 0,
          totalLearners: 0,
        });
        bandCounts.grey += 1;
        continue;
      }
      const confAvg = bucket.reduce((a, s) => a + s.confidence, 0) / bucket.length;
      const band = confidenceBand(confAvg);
      bandCounts[band] += 1;

      // Per-learner component contributions, averaged across bucket
      let comp = 0, stab = 0, suf = 0, cons = 0, suppressed = 0;
      for (const s of bucket) {
        const chrono = chronoMap.get(`${s.learnerId}|${c.code}`) ?? [];
        const clustersAssessedForLearner = Array.from(chronoMap.keys()).filter((k) => k.startsWith(`${s.learnerId}|`)).length;
        comp += fCompleteness(clustersAssessedForLearner, totalClusters);
        stab += fStability(chrono);
        suf += fSufficiency(chrono.length);
        cons += fConsistency(chrono);
        if (s.confidence < SUPPRESSION_CONFIDENCE) suppressed += 1;
      }
      const n = bucket.length;
      comp /= n; stab /= n; suf /= n; cons /= n;

      cells.push({
        track: t.name,
        cluster: c.code,
        value: round3(confAvg),
        band,
        completeness: round3(comp),
        stability: round3(stab),
        sufficiency: round3(suf),
        consistency: round3(cons),
        suppressedLearners: suppressed,
        totalLearners: n,
      });

      sumConf += confAvg; cntConf += 1;
      sumComp += comp; sumStab += stab; sumSuf += suf; sumCons += cons;
    }
  }

  const indexMean = cntConf === 0 ? 0 : sumConf / cntConf;
  const completenessMean = cntConf === 0 ? 0 : sumComp / cntConf;
  const totalCells = cells.length;
  const suppressionRate = totalCells === 0 ? 0 : bandCounts.suppressed / totalCells;

  const result = {
    tracks: tracks.map((t) => t.name),
    clusters: clusters.map((c) => c.code),
    cells,
    kpis: {
      indexMean: round3(indexMean),
      completenessMean: round3(completenessMean),
      suppressionRate: round3(suppressionRate),
      cellsGreen: bandCounts.green,
      cellsAmber: bandCounts.amber,
      cellsGrey: bandCounts.grey,
      cellsSuppressed: bandCounts.suppressed,
    },
    componentBreakdown: {
      completeness: round3(cntConf === 0 ? 0 : sumComp / cntConf),
      stability: round3(cntConf === 0 ? 0 : sumStab / cntConf),
      sufficiency: round3(cntConf === 0 ? 0 : sumSuf / cntConf),
      consistency: round3(cntConf === 0 ? 0 : sumCons / cntConf),
    },
  };

  return result;
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;
