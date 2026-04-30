/**
 * Demand Intelligence — employer-vs-market view with full peer benchmarking.
 *
 * Shape returned:
 *   cells:          existing per-(track,cluster) cell — my target vs market median
 *   byTrack:        [{careerTrackCode, volume, matchRate, timeToHire, peerMedian}]
 *   peerComparison: {median, p25, p75, thisCompany} per summary metric
 *   summary:        {totalSignals, careerTracksCovered, confidence}
 *
 * Every numeric metric populates even for tracks this employer has no roles
 * in, so the UI can render comparisons consistently.
 */
import { prisma } from '../../config/db.js';
import { AppError } from '../../utils/AppError.js';
import { ALL_CLUSTERS, round1, parseTargets, parseWeights } from './helpers.js';
import { matchScore, confidenceScore, SUPPRESSION_CONFIDENCE } from '../competency/formulas.js';
import type { ClusterCode } from '@prisma/client';

function percentile(nums: number[], p: number): number {
  if (nums.length === 0) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const idx = Math.min(s.length - 1, Math.floor(p * s.length));
  return s[idx];
}
function mean(nums: number[]): number {
  return nums.length === 0 ? 0 : nums.reduce((a, b) => a + b, 0) / nums.length;
}

export async function getDemandHeatmap(employerId: string) {
  const signals = await prisma.demandSignal.findMany({
    where: { employerId },
    include: { careerTrack: true },
  });

  // Market median (across all employers) per (careerTrack, cluster)
  const careerTrackIds = Array.from(new Set(signals.map((s) => s.careerTrackId)));
  const allCareerTracks = await prisma.careerTrack.findMany();
  const allSignals = await prisma.demandSignal.findMany();

  const medianByCT = new Map<string, Record<ClusterCode, number>>();
  for (const ct of allCareerTracks) {
    const per: Record<ClusterCode, number[]> = {} as Record<ClusterCode, number[]>;
    for (const c of ALL_CLUSTERS) per[c] = [];
    for (const s of allSignals) {
      if (s.careerTrackId === ct.id) per[s.clusterCode].push(s.targetScore);
    }
    const medians: Record<ClusterCode, number> = {} as Record<ClusterCode, number>;
    for (const c of ALL_CLUSTERS) medians[c] = percentile(per[c], 0.5);
    medianByCT.set(ct.id, medians);
  }

  // Heatmap cells — most-recent signal per (careerTrack, cluster) for this employer
  const latest = new Map<string, { careerTrackId: string; careerTrackName: string; clusterCode: ClusterCode; targetScore: number; status: string; createdAt: Date }>();
  for (const s of signals) {
    const key = `${s.careerTrackId}:${s.clusterCode}`;
    const ex = latest.get(key);
    if (!ex || ex.createdAt < s.createdAt) {
      latest.set(key, {
        careerTrackId: s.careerTrackId,
        careerTrackName: s.careerTrack.name,
        clusterCode: s.clusterCode,
        targetScore: s.targetScore,
        status: s.status,
        createdAt: s.createdAt,
      });
    }
  }
  const cells = Array.from(latest.values()).map((row) => {
    const market = medianByCT.get(row.careerTrackId)?.[row.clusterCode] ?? 0;
    return {
      careerTrackId: row.careerTrackId,
      careerTrackName: row.careerTrackName,
      clusterCode: row.clusterCode,
      myTarget: row.targetScore,
      marketMedian: round1(market),
      gap: round1(row.targetScore - market),
      status: row.status,
    };
  });

  // Compute a rich per-track metrics block — every track populated (never null).
  // Volume = seatsPlanned across all employers. matchRate = % of candidates
  // qualifying for this employer's average targets (0 if employer has no role
  // in the track, in which case we still return volume+peerMedian).
  const allRoles = await prisma.employerRole.findMany({ where: { status: 'active' } });
  const rolesByTrack = new Map<string, typeof allRoles>();
  for (const r of allRoles) {
    const list = rolesByTrack.get(r.careerTrackId) ?? [];
    list.push(r);
    rolesByTrack.set(r.careerTrackId, list);
  }

  const myRoles = allRoles.filter((r) => r.employerId === employerId);

  // Learner scores — used to compute matchRate per track
  const allScores = await prisma.competencyScore.findMany({
    include: { learner: { select: { id: true, trackId: true } } },
  });
  const tracks = await prisma.track.findMany();
  const trackToCareer = new Map(tracks.map((t) => [t.id, t.careerTrackId]));

  const scoresByCareer = new Map<string, Map<string, { code: ClusterCode; score: number; confidence: number }[]>>();
  for (const s of allScores) {
    const careerId = trackToCareer.get(s.learner.trackId);
    if (!careerId) continue;
    if (!scoresByCareer.has(careerId)) scoresByCareer.set(careerId, new Map());
    const inner = scoresByCareer.get(careerId)!;
    const arr = inner.get(s.learnerId) ?? [];
    arr.push({ code: s.clusterCode, score: s.scoreWeighted, confidence: s.confidence });
    inner.set(s.learnerId, arr);
  }

  // Peer time-to-hire — computed from PipelineCandidate weeks-to-decision per track.
  const pipeline = await prisma.pipelineCandidate.findMany({
    include: { role: true },
  });
  const ttByTrack = new Map<string, number[]>();       // all employers
  const ttByTrackMine = new Map<string, number[]>();   // just mine
  for (const p of pipeline) {
    if (!p.decidedAt) continue;
    const days = (p.decidedAt.getTime() - p.invitedAt.getTime()) / (1000 * 60 * 60 * 24);
    const ctId = p.role.careerTrackId;
    const arr = ttByTrack.get(ctId) ?? []; arr.push(days); ttByTrack.set(ctId, arr);
    if (p.role.employerId === employerId) {
      const mine = ttByTrackMine.get(ctId) ?? []; mine.push(days); ttByTrackMine.set(ctId, mine);
    }
  }

  const byTrack = allCareerTracks.map((ct) => {
    const rolesForTrack = rolesByTrack.get(ct.id) ?? [];
    const mine = myRoles.filter((r) => r.careerTrackId === ct.id);
    const volume = rolesForTrack.reduce((a, r) => a + r.seatsPlanned, 0);
    const mineVolume = mine.reduce((a, r) => a + r.seatsPlanned, 0);

    // matchRate for this employer: % of track learners qualifying for my avg targets.
    // If I have no role, fall back to market-avg targets.
    const ref = mine.length > 0 ? mine : rolesForTrack;
    let matchRate = 0;
    let myMatchRate = 0;
    if (ref.length > 0) {
      const tArr = ref.map((r) => parseTargets(r.clusterTargets));
      const wArr = ref.map((r) => parseWeights(r.clusterWeights));
      const tAvg: Partial<Record<ClusterCode, number>> = {};
      const wAvg: Partial<Record<ClusterCode, number>> = {};
      for (const c of ALL_CLUSTERS) {
        const ts = tArr.map((x) => x[c]?.target ?? 0).filter((n) => n > 0);
        if (ts.length > 0) tAvg[c] = ts.reduce((a, b) => a + b, 0) / ts.length;
        const ws = wArr.map((x) => x[c] ?? 0);
        if (ws.length > 0) wAvg[c] = ws.reduce((a, b) => a + b, 0) / ws.length;
      }
      const learners = scoresByCareer.get(ct.id);
      if (learners && learners.size > 0) {
        let matches = 0;
        const rates: number[] = [];
        for (const [, scores] of learners.entries()) {
          const entries: { scoreWeighted: number; target: number; weight: number }[] = [];
          const byCode = new Map<ClusterCode, { score: number; confidence: number }>();
          for (const s of scores) byCode.set(s.code, { score: s.score, confidence: s.confidence });
          for (const c of ALL_CLUSTERS) {
            const w = wAvg[c] ?? 0;
            const t = tAvg[c] ?? 0;
            const sv = byCode.get(c);
            if (w <= 0 || t <= 0 || !sv) continue;
            if (sv.confidence < SUPPRESSION_CONFIDENCE) continue;
            entries.push({ scoreWeighted: sv.score, target: t, weight: w });
          }
          const m = matchScore(entries);
          rates.push(m);
          if (m >= 0.7) matches += 1;
        }
        matchRate = learners.size === 0 ? 0 : matches / learners.size;
        myMatchRate = mean(rates);
      }
    }

    const peerMedian = percentile([...(ttByTrack.get(ct.id) ?? [])], 0.5);
    const timeToHireMine = mean([...(ttByTrackMine.get(ct.id) ?? [])]);

    return {
      careerTrackCode: ct.code,
      careerTrackName: ct.name,
      careerTrackId: ct.id,
      volume,                                // total seats across the market
      mineVolume,                            // my seats
      matchRate: Number(matchRate.toFixed(3)),           // % of candidates qualifying (0..1)
      myMatch: Number(myMatchRate.toFixed(3)),           // my avg match across candidates
      timeToHireDays: Number(timeToHireMine.toFixed(1)), // my avg — 0 when no history
      peerMedianDays: Number(peerMedian.toFixed(1)),     // market median
      hasMyRole: mine.length > 0,
    };
  }).sort((a, b) => b.volume - a.volume);

  // Peer comparison blocks — distributions across tracks
  const volumes = byTrack.map((t) => t.volume);
  const matchRates = byTrack.filter((t) => t.matchRate > 0).map((t) => t.matchRate);
  const tth = byTrack.filter((t) => t.peerMedianDays > 0).map((t) => t.peerMedianDays);

  const myTotalVolume = byTrack.reduce((a, t) => a + t.mineVolume, 0);
  const myAvgMatch = mean(byTrack.filter((t) => t.hasMyRole).map((t) => t.myMatch));
  const myAvgTth = mean(byTrack.filter((t) => t.hasMyRole && t.timeToHireDays > 0).map((t) => t.timeToHireDays));

  const peerComparison = {
    volume: {
      p25: Number(percentile(volumes, 0.25).toFixed(1)),
      median: Number(percentile(volumes, 0.5).toFixed(1)),
      p75: Number(percentile(volumes, 0.75).toFixed(1)),
      thisCompany: myTotalVolume,
    },
    matchRate: {
      p25: Number(percentile(matchRates, 0.25).toFixed(3)),
      median: Number(percentile(matchRates, 0.5).toFixed(3)),
      p75: Number(percentile(matchRates, 0.75).toFixed(3)),
      thisCompany: Number(myAvgMatch.toFixed(3)),
    },
    timeToHireDays: {
      p25: Number(percentile(tth, 0.25).toFixed(1)),
      median: Number(percentile(tth, 0.5).toFixed(1)),
      p75: Number(percentile(tth, 0.75).toFixed(1)),
      thisCompany: Number(myAvgTth.toFixed(1)),
    },
  };

  const confidence = confidenceScore({
    completeness: Math.min(1, signals.length / 16),
    stability: Math.min(1, allSignals.length / 40),
    sufficiency: Math.min(1, byTrack.filter((t) => t.hasMyRole).length / 3),
    consistency: 0.7,
  });

  return {
    cells,
    byTrack,
    peerComparison,
    summary: {
      totalSignals: signals.length,
      careerTracksCovered: careerTrackIds.length,
      confidence: Number(confidence.toFixed(3)),
    },
  };
}

export async function submitDemand(employerId: string, payload: { careerTrackId: string; clusterCode: ClusterCode; targetScore: number }) {
  const ct = await prisma.careerTrack.findUnique({ where: { id: payload.careerTrackId } });
  if (!ct) throw new AppError('NOT_FOUND', 'Career track not found');
  if (payload.targetScore < 0 || payload.targetScore > 100) {
    throw new AppError('VALIDATION_ERROR', 'targetScore must be 0..100');
  }
  const created = await prisma.demandSignal.create({
    data: {
      employerId,
      careerTrackId: payload.careerTrackId,
      clusterCode: payload.clusterCode,
      targetScore: payload.targetScore,
      status: 'submitted',
    },
  });
  return {
    id: created.id,
    careerTrackId: created.careerTrackId,
    clusterCode: created.clusterCode,
    targetScore: created.targetScore,
    status: created.status,
    createdAt: created.createdAt.toISOString(),
  };
}
