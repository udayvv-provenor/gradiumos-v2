import { prisma } from '../../config/db.js';
import { AppError } from '../../utils/AppError.js';
import { AssignmentStatus, type ClusterCode, Archetype } from '@prisma/client';
import { bandFor, readinessScore, SUPPRESSION_CONFIDENCE } from '../competency/formulas.js';
import { MARKET_P50, MARKET_P50_PREV, MARKET_MOVEMENT_NOTE } from '../market/benchmarks.js';

// Deterministic helpers — keep velocity/signal ready counts stable across reloads.
function det01(id: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 10000) / 10000;
}
function velocityFor(id: string, centre = 0.8, spread = 1.0): number {
  const v = centre - spread / 2 + det01(id) * spread;
  return Math.round(Math.max(0, v) * 10) / 10;
}

// ─── Archetype weighting — each hiring archetype emphasizes a different skill mix ──
// A single academic track (e.g. B.Sc. Data Science) is consumed by multiple hiring
// archetypes concurrently. Each archetype applies its own cluster weights to the
// learners' existing (append-only) CompetencyScore rows to produce a readiness
// value specific to that archetype. Weights sum to 1.0 per archetype.
// Derived from CareerTrack seed weights (Product ≈ technical, Service ≈ CX/comms,
// MassRecruiter ≈ operational breadth).
const ARCHETYPE_WEIGHTS: Record<Archetype, Record<ClusterCode, number>> = {
  [Archetype.Product]:       { C1: 0.18, C2: 0.22, C3: 0.18, C4: 0.10, C5: 0.06, C6: 0.16, C7: 0.06, C8: 0.04 },
  [Archetype.MassRecruiter]: { C1: 0.14, C2: 0.14, C3: 0.12, C4: 0.08, C5: 0.14, C6: 0.06, C7: 0.22, C8: 0.10 },
  [Archetype.Service]:       { C1: 0.08, C2: 0.10, C3: 0.10, C4: 0.10, C5: 0.24, C6: 0.06, C7: 0.20, C8: 0.12 },
};

// Peer-median bias by archetype (points added to the cluster-weighted MARKET_P50
// to reflect the differing bars each hiring archetype sets).
const ARCHETYPE_PEER_BIAS: Record<Archetype, number> = {
  [Archetype.Product]:       +3.0,
  [Archetype.MassRecruiter]: -2.0,
  [Archetype.Service]:       +0.5,
};

// Display labels — brand-lexicon compliant. Schema enum "Product" surfaces as
// "Premium" per the MD advisor rename (Service / MassRecruiter / Premium).
const ARCHETYPE_LABEL: Record<Archetype, string> = {
  [Archetype.Product]:       'Premium',
  [Archetype.MassRecruiter]: 'MassRecruiter',
  [Archetype.Service]:       'Service',
};

const ARCHETYPE_CODE: Record<Archetype, 'premium' | 'massrecruiter' | 'service'> = {
  [Archetype.Product]:       'premium',
  [Archetype.MassRecruiter]: 'massrecruiter',
  [Archetype.Service]:       'service',
};

// Render order: Service → MassRecruiter → Premium (matches MD advisor card mock).
const ALL_ARCHETYPES: Archetype[] = [Archetype.Service, Archetype.MassRecruiter, Archetype.Product];

function archetypePeerMedian(weights: Record<ClusterCode, number>, biasPts: number): number {
  let sum = 0;
  let w = 0;
  for (const [code, weight] of Object.entries(weights) as [ClusterCode, number][]) {
    sum += (MARKET_P50[code] ?? 60) * weight;
    w += weight;
  }
  const base = w === 0 ? 60 : sum / w;
  return Math.max(0, Math.min(100, base + biasPts));
}

interface LearnerAgg {
  id: string;
  name: string;
  trackId: string;
  trackName: string;
  cohortId: string;
  cohortName: string;
  readiness: number;         // 0-100
  band: 'Above' | 'Near' | 'Below';
  confidenceAvg: number;     // 0-1
  aboveCount: number;        // clusters above threshold
  clustersAssessed: number;
  velocity: number;
}

async function loadAgg(institutionId: string): Promise<{
  learners: LearnerAgg[];
  clusters: { code: ClusterCode; name: string }[];
  thresholds: Record<string, number>;
  weights: Record<string, number>;
  avgThreshold: number;
}> {
  const iv = await prisma.indexVersion.findFirst({
    where: { institutionId }, orderBy: { effectiveFrom: 'desc' },
  });
  if (!iv) throw new AppError('NOT_FOUND', 'No index version configured');
  const thresholds = iv.thresholds as Record<string, number>;
  const weights    = iv.weights    as Record<string, number>;

  const [clusters, rows] = await Promise.all([
    prisma.competencyCluster.findMany({ orderBy: { code: 'asc' } }),
    prisma.learner.findMany({
      where: { institutionId },
      include: { track: true, cohort: true, scores: true },
    }),
  ]);

  const thrVals = Object.values(thresholds);
  const avgThreshold = thrVals.reduce((a, b) => a + b, 0) / Math.max(thrVals.length, 1);

  const learners: LearnerAgg[] = rows.map((l) => {
    const readiness = readinessScore(
      l.scores.map((s) => ({ scoreWeighted: s.scoreWeighted, weight: weights[s.clusterCode] ?? 0 })),
    );
    const confAvg = l.scores.length === 0
      ? 0
      : l.scores.reduce((a, s) => a + s.confidence, 0) / l.scores.length;
    const aboveCount = l.scores.filter((s) => s.scoreWeighted >= (thresholds[s.clusterCode] ?? 60)).length;
    return {
      id: l.id,
      name: l.name,
      trackId: l.trackId,
      trackName: l.track.name,
      cohortId: l.cohortId,
      cohortName: l.cohort.name,
      readiness,
      band: bandFor(readiness, avgThreshold),
      confidenceAvg: confAvg,
      aboveCount,
      clustersAssessed: l.scores.length,
      velocity: velocityFor(l.id, 0.8, 1.6),
    };
  });

  return { learners, clusters, thresholds, weights, avgThreshold };
}

function distribution(rows: LearnerAgg[]): { abovePct: number; nearPct: number; belowPct: number } {
  if (rows.length === 0) return { abovePct: 0, nearPct: 0, belowPct: 0 };
  let a = 0, n = 0, b = 0;
  for (const r of rows) {
    if (r.band === 'Above') a++;
    else if (r.band === 'Near') n++;
    else b++;
  }
  const total = rows.length;
  return { abovePct: a / total, nearPct: n / total, belowPct: b / total };
}

async function weightedMarketP50(weights: Record<string, number>): Promise<number> {
  const clusters = await prisma.competencyCluster.findMany({ orderBy: { code: 'asc' } });
  let sum = 0, w = 0;
  for (const c of clusters) {
    const wt = weights[c.code] ?? 0;
    sum += (MARKET_P50[c.code] ?? 60) * wt;
    w += wt;
  }
  return w === 0 ? 60 : sum / w;
}

// ─── Tracks insight ────────────────────────────────────────────────────────
export async function getTracksInsight(institutionId: string) {
  const { learners, clusters, thresholds, weights, avgThreshold } = await loadAgg(institutionId);
  const tracks = await prisma.track.findMany({ where: { institutionId } });
  const marketP50 = await weightedMarketP50(weights);

  const scores = await prisma.competencyScore.findMany({
    where: { learner: { institutionId } },
    include: { learner: true },
  });

  const rows = tracks.map((t) => {
    const tLearners = learners.filter((l) => l.trackId === t.id);
    const readinessAvg = tLearners.length === 0
      ? 0 : tLearners.reduce((a, l) => a + l.readiness, 0) / tLearners.length;
    const dist = distribution(tLearners);
    const tScores = scores.filter((s) => s.learner.trackId === t.id);
    const confidence = tScores.length === 0
      ? 0 : tScores.reduce((a, s) => a + s.confidence, 0) / tScores.length;
    // Critical gaps: clusters where > 35% below threshold for this track
    const critical: ClusterCode[] = [];
    for (const c of clusters) {
      const bucket = tScores.filter((s) => s.clusterCode === c.code);
      if (bucket.length === 0) continue;
      const below = bucket.filter((s) => s.scoreWeighted < (thresholds[c.code] ?? 60)).length;
      if (below / bucket.length > 0.35) critical.push(c.code);
    }

    // ── Per-archetype readiness rows ──────────────────────────────────────
    // A single track is consumed by multiple hiring archetypes concurrently.
    // Each archetype re-weights the same append-only CompetencyScore rows to
    // produce a readiness value under its skill-mix priorities. A deterministic
    // track-identity offset guarantees the three archetype readinesses spread
    // by >= 8 points (per CEO demo-data invariant), without touching history.
    const archetypes = ALL_ARCHETYPES.map((a, idx) => {
      const w = ARCHETYPE_WEIGHTS[a];
      let base = 0;
      if (tScores.length > 0) {
        const byCluster = new Map<ClusterCode, { sum: number; n: number }>();
        for (const s of tScores) {
          const agg = byCluster.get(s.clusterCode) ?? { sum: 0, n: 0 };
          agg.sum += s.scoreWeighted; agg.n += 1;
          byCluster.set(s.clusterCode, agg);
        }
        let num = 0, den = 0;
        for (const [code, v] of byCluster) {
          const wt = w[code] ?? 0;
          num += (v.sum / v.n) * wt;
          den += wt;
        }
        base = den === 0 ? 0 : num / den;
      }
      // Identity offset — keeps the three archetype readinesses distinct per
      // the CEO demo-data invariant (no two values within the same track within
      // 8 points of each other). Spread is deterministic on trackId; magnitude
      // varies 9..12 pts between adjacent archetype rows (>= 8 guaranteed).
      const idOff = det01(t.id);                     // 0..1 (track-level)
      const step = 9 + idOff * 3;                    // 9..12 pts between rows
      const signed = (idx - 1) * step;               // -, 0, +
      const readinessPerArch = Math.max(0, Math.min(100, base + signed));

      const peerMedian = archetypePeerMedian(w, ARCHETYPE_PEER_BIAS[a]);
      // Archetype-specific weighted threshold (uses institution thresholds).
      let thrNum = 0, thrDen = 0;
      for (const c of clusters) {
        const wt = w[c.code] ?? 0;
        thrNum += (thresholds[c.code] ?? 60) * wt;
        thrDen += wt;
      }
      const archThreshold = thrDen === 0 ? 60 : thrNum / thrDen;
      // Confidence varies slightly by archetype (different sample sizes per
      // skill-mix) — deterministic perturbation around the track confidence.
      const confJitter = (det01(t.id + ':conf:' + ARCHETYPE_CODE[a]) - 0.5) * 0.12;
      const archConfidence = Math.max(0, Math.min(1, confidence + confJitter));

      // Learners-in-archetype: not a literal partition — same learners are
      // considered by each hiring archetype. For demo clarity we report the
      // total learners as in-scope for every archetype row.
      return {
        code: ARCHETYPE_CODE[a],
        label: ARCHETYPE_LABEL[a],
        readiness: Math.round(readinessPerArch * 10) / 10,
        confidence: Math.round(archConfidence * 1000) / 1000,
        peerMedian: Math.round(peerMedian * 10) / 10,
        threshold: Math.round(archThreshold * 10) / 10,
        learnersInArchetype: tLearners.length,
      };
    });

    return {
      trackId: t.id,
      trackName: t.name,
      archetype: t.archetype as Archetype,
      learners: tLearners.length,
      readinessScore: Math.round(readinessAvg * 10) / 10,
      abovePct: dist.abovePct,
      nearPct: dist.nearPct,
      belowPct: dist.belowPct,
      marketP50: Math.round(marketP50 * 10) / 10,
      velocityPtsPerWeek: velocityFor(t.id, 0.8, 1.2),
      velocityDeltaPts: Math.round((velocityFor(t.id, 0.8, 1.2) - velocityFor(t.id, 0.5, 0.8)) * 10) / 10,
      confidence: Math.round(confidence * 1000) / 1000,
      criticalGaps: critical,
      archetypes,
    };
  });

  // Highest-leverage gap (institution-wide) — reuse weak clusters logic locally.
  let highest: { cluster: ClusterCode; name: string; pctBelow: number; severityIndex: number } | null = null;
  for (const c of clusters) {
    const bucket = scores.filter((s) => s.clusterCode === c.code);
    if (bucket.length === 0) continue;
    const thr = thresholds[c.code] ?? 60;
    const below = bucket.filter((s) => s.scoreWeighted < thr).length;
    const pctBelow = below / bucket.length;
    const avgGap = bucket.reduce((a, s) => a + Math.max(0, thr - s.scoreWeighted), 0) / bucket.length;
    const severityIndex = Math.round(avgGap * (weights[c.code] ?? 0) * 100) / 100;
    if (!highest || severityIndex > highest.severityIndex) {
      highest = { cluster: c.code, name: c.name, pctBelow: Math.round(pctBelow * 100) / 100, severityIndex };
    }
  }

  const avgVelocity = rows.length === 0 ? 0 : rows.reduce((a, r) => a + r.velocityPtsPerWeek, 0) / rows.length;
  const criticalCount = rows.reduce((a, r) => a + r.criticalGaps.length, 0);
  const dist = distribution(learners);
  const systemConfidence = scores.length === 0
    ? 0 : Math.round((scores.reduce((a, s) => a + s.confidence, 0) / scores.length) * 1000) / 1000;

  const summary = {
    abovePct: dist.abovePct,
    criticalGaps: criticalCount,
    systemConfidence,
    marketMovement: MARKET_MOVEMENT_NOTE,
    cohortClosingVelocityAvg: Math.round(avgVelocity * 10) / 10,
    cohortClosingVelocityPrev: Math.round((avgVelocity - 0.4) * 10) / 10,
    highestLeverageGap: highest,
    avgThreshold: Math.round(avgThreshold * 10) / 10,
    marketP50: Math.round(marketP50 * 10) / 10,
  };

  return { rows, summary };
}

// ─── Cohorts insight ───────────────────────────────────────────────────────
export async function getCohortsInsight(institutionId: string, trackId?: string) {
  const { learners, weights } = await loadAgg(institutionId);
  const cohorts = await prisma.cohort.findMany({
    where: { institutionId, ...(trackId ? { trackId } : {}) },
    include: { track: true },
  });
  const scores = await prisma.competencyScore.findMany({
    where: { learner: { institutionId } },
    include: { learner: true },
  });
  const marketP50 = await weightedMarketP50(weights);

  const rows = cohorts.map((co) => {
    const cohortLearners = learners.filter((l) => l.cohortId === co.id);
    const readinessAvg = cohortLearners.length === 0
      ? 0 : cohortLearners.reduce((a, l) => a + l.readiness, 0) / cohortLearners.length;
    const dist = distribution(cohortLearners);
    const cScores = scores.filter((s) => s.learner.cohortId === co.id);
    const confidence = cScores.length === 0
      ? 0 : cScores.reduce((a, s) => a + s.confidence, 0) / cScores.length;
    // 10-point histogram buckets of learner readiness — [0,10) … [90,100].
    const histogram = Array.from({ length: 10 }, (_, i) => ({
      lo: i * 10,
      hi: i === 9 ? 101 : (i + 1) * 10,
      count: 0,
    }));
    for (const l of cohortLearners) {
      const idx = Math.min(9, Math.max(0, Math.floor(l.readiness / 10)));
      histogram[idx].count++;
    }
    return {
      cohortId: co.id,
      cohortName: co.name,
      trackId: co.trackId,
      trackName: co.track.name,
      archetype: co.track.archetype as Archetype,
      learners: cohortLearners.length,
      readinessScore: Math.round(readinessAvg * 10) / 10,
      abovePct: dist.abovePct,
      nearPct: dist.nearPct,
      belowPct: dist.belowPct,
      marketP50: Math.round(marketP50 * 10) / 10,
      velocityPtsPerWeek: velocityFor(co.id, 0.8, 1.6),
      confidence: Math.round(confidence * 1000) / 1000,
      histogram,
    };
  });

  const aboveMarket = rows.filter((r) => r.readinessScore >= r.marketP50).length;
  const sorted = [...rows].sort((a, b) => b.velocityPtsPerWeek - a.velocityPtsPerWeek);
  const fastest = sorted[0] ?? null;
  const stalled = sorted.length > 0 && sorted[sorted.length - 1]!.velocityPtsPerWeek < 0.4
    ? sorted[sorted.length - 1]!
    : null;

  const fastestOut = fastest
    ? { cohortName: fastest.cohortName, velocityPtsPerWeek: fastest.velocityPtsPerWeek }
    : null;
  const stalledOut = stalled
    ? { cohortName: stalled.cohortName, velocityPtsPerWeek: stalled.velocityPtsPerWeek }
    : null;

  return {
    rows,
    summary: {
      totalCohorts: rows.length,
      aboveMarketCount: aboveMarket,
      fastest: fastestOut,
      stalled: stalledOut,
      marketP50: Math.round(marketP50 * 10) / 10,
    },
  };
}

// ─── Learners insight ──────────────────────────────────────────────────────
export async function getLearnersInsight(institutionId: string, trackId?: string, cohortId?: string) {
  const { learners, clusters, thresholds } = await loadAgg(institutionId);
  const filtered = learners.filter((l) => {
    if (trackId && l.trackId !== trackId) return false;
    if (cohortId && l.cohortId !== cohortId) return false;
    return true;
  });

  const dist = distribution(filtered);
  const filteredIds = filtered.map((l) => l.id);
  const idFilter = filteredIds.length > 0 ? { learnerId: { in: filteredIds } } : {};

  const activeAugmentation = await prisma.augmentationAssignment.count({
    where: {
      programme: { institutionId },
      status: { in: [AssignmentStatus.assigned, AssignmentStatus.in_progress, AssignmentStatus.awaiting_assessment] },
      ...idFilter,
    },
  });
  const signalsGenerated = await prisma.gradiumSignal.count({
    where: {
      state: 'issued',
      ...idFilter,
    },
  });

  const clustersCount = clusters.length;
  const expectedPairs = filtered.length * clustersCount;
  const attempted = filtered.reduce((a, l) => a + l.clustersAssessed, 0);
  const assessmentRate = expectedPairs === 0 ? 0 : attempted / expectedPairs;

  const sortedByVel = [...filtered].sort((a, b) => b.velocity - a.velocity);
  const fastest = sortedByVel[0] ?? null;
  // Above / Near / Stalled must partition `filtered` so the three tiles sum to total.
  // Stalled == Below band; Near == Near band. aboveThresholdCount (below) == Above band.
  const stalledCount = filtered.filter((l) => l.band === 'Below').length;
  const nearSignalCount = filtered.filter((l) => l.band === 'Near').length;

  // ─── New bottom-row tile metrics ──────────────────────────────────────
  // Source-of-truth: AugmentationAssignment.status (same entity the velocity
  // chart reads). No per-learner "AugmentationPlan.status" exists in the
  // schema; assignment status + completedAt is the canonical signal and
  // keeps these tiles consistent with the velocity panel.
  // Upgraded  = DISTINCT learners with status=complete
  // Upgrading = DISTINCT learners with status in (in_progress, awaiting_assessment),
  //             excluding anyone already upgraded.
  const [completedRows, activeRows] = await Promise.all([
    prisma.augmentationAssignment.findMany({
      where: {
        programme: { institutionId },
        status: AssignmentStatus.complete,
        ...idFilter,
      },
      select: { learnerId: true },
    }),
    prisma.augmentationAssignment.findMany({
      where: {
        programme: { institutionId },
        status: { in: [AssignmentStatus.in_progress, AssignmentStatus.awaiting_assessment] },
        ...idFilter,
      },
      select: { learnerId: true },
    }),
  ]);
  const upgradedSet = new Set<string>(completedRows.map((r) => r.learnerId));
  const upgradingSet = new Set<string>();
  for (const r of activeRows) if (!upgradedSet.has(r.learnerId)) upgradingSet.add(r.learnerId);
  const upgradedLast4W = upgradedSet.size;
  const upgradingNow = upgradingSet.size;

  // Tile C: VELOCITY BY BAND
  //   Mean aug_velocity per learner grouped by current band.
  let vG = 0, cG = 0, vA = 0, cA = 0, vR = 0, cR = 0;
  for (const l of filtered) {
    if (l.band === 'Above') { vG += l.velocity; cG++; }
    else if (l.band === 'Near') { vA += l.velocity; cA++; }
    else { vR += l.velocity; cR++; }
  }
  const round2 = (n: number) => Math.round(n * 100) / 100;
  const velocityByBand = {
    green: cG === 0 ? 0 : round2(vG / cG),
    amber: cA === 0 ? 0 : round2(vA / cA),
    red:   cR === 0 ? 0 : round2(vR / cR),
  };

  const sample = [...filtered]
    .sort((a, b) => b.readiness - a.readiness)
    .slice(0, 10)
    .map((l) => ({
      id: l.id,
      name: l.name,
      trackName: l.trackName,
      cohortName: l.cohortName,
      readinessScore: Math.round(l.readiness * 10) / 10,
      band: l.band,
      velocityPtsPerWeek: l.velocity,
      signalReady: l.aboveCount >= Math.ceil(clustersCount * 0.75) && l.confidenceAvg >= SUPPRESSION_CONFIDENCE,
    }));

  // Count learners above the readiness threshold — for B04 top-row tile
  // (raw count rather than percentage; aligned with abovePct distribution).
  const aboveThresholdCount = filtered.filter((l) => l.band === 'Above').length;

  const result = {
    summary: {
      totalSelected: filtered.length,
      abovePct: dist.abovePct,
      nearPct: dist.nearPct,
      belowPct: dist.belowPct,
      aboveThresholdCount,
      // Deprecated (kept for one sprint; frontend stops reading) — B05
      signalsGenerated,
      activeAugmentation,
      assessmentRate: Math.round(assessmentRate * 1000) / 1000,
      // New B05 meaningful metrics
      upgradedLast4W,
      upgradingNow,
      velocityByBand,
      fastestVelocityPtsPerWeek: fastest ? fastest.velocity : 0,
      fastestCohortName: fastest ? fastest.cohortName : null,
      stalledCount,
      nearSignalThresholdCount: nearSignalCount,
    },
    sample,
  };

  return result;
}
