/**
 * Placement Alignment — realistic outcomes backed by the Placement table.
 *
 * We read realised Placement rows (seeded across institutions / cohorts / roles)
 * rather than deriving placement via a hash threshold. This gives a single
 * source of truth for both the KPI card and the supporting narrative
 * (placementRate, numerator/denominator, CTC distribution, cohort breakdown).
 *
 * If no Placement rows exist we fall back to the legacy deterministic-hash
 * simulation so the page still renders in fresh environments.
 */
import { prisma } from '../../config/db.js';
import { AppError } from '../../utils/AppError.js';
import { Archetype, type ClusterCode } from '@prisma/client';
import {
  bandFor, matchScore, readinessScore,
  completeness, stability, sufficiency, consistency, confidenceScore,
} from '../competency/formulas.js';

// Legacy fallback only — used when no Placement rows have been seeded.
const FALLBACK_COMPANIES: Record<Archetype, string[]> = {
  Product: ['Stripe', 'Razorpay', 'Flipkart', 'Zerodha', 'Zoho', 'Swiggy', 'PhonePe', 'Atlassian'],
  Service: ['Infosys', 'TCS', 'Wipro', 'Accenture', 'Cognizant', 'HCL', 'Capgemini', 'LTIMindtree'],
  MassRecruiter: ['Byju\u2019s', 'UrbanClap', 'Amazon WH', 'Zomato Ops', 'Ola Ops', 'Reliance Retail'],
};
const FALLBACK_SALARY: Record<Archetype, [number, number]> = {
  Product: [8, 16],
  Service: [4.5, 7.5],
  MassRecruiter: [3.5, 5.5],
};

function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function det01(seed: string): number {
  return (hashStr(seed) % 100000) / 100000;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
  return sorted[idx];
}

export async function getPlacementAlignment(institutionId: string) {
  const iv = await prisma.indexVersion.findFirst({
    where: { institutionId },
    orderBy: { effectiveFrom: 'desc' },
  });
  if (!iv) throw new AppError('NOT_FOUND', 'No index version configured');
  const weights    = iv.weights    as Record<string, number>;
  const thresholds = iv.thresholds as Record<string, number>;

  const [learners, clusters, realPlacements] = await Promise.all([
    prisma.learner.findMany({
      where: { institutionId },
      include: { track: true, cohort: true, scores: true },
    }),
    prisma.competencyCluster.findMany({ orderBy: { code: 'asc' } }),
    prisma.placement.findMany({
      where: { learner: { institutionId } },
      include: { employer: true, learner: { include: { track: true, cohort: true } } },
      orderBy: { joinDate: 'desc' },
    }),
  ]);

  const avgThreshold = Object.values(thresholds).reduce((a, b) => a + b, 0) / Object.keys(thresholds).length;

  // Per-learner match/readiness map (used both for KPIs and the scatter plot)
  type LearnerRow = {
    learnerId: string;
    learnerName: string;
    trackId: string;
    cohortId: string;
    cohortName: string;
    archetype: Archetype;
    readinessScore: number;
    matchScore: number;
    band: 'Above' | 'Near' | 'Below';
  };
  const lrows: LearnerRow[] = learners.map((l) => {
    const readiness = readinessScore(
      l.scores.map((s) => ({ scoreWeighted: s.scoreWeighted, weight: weights[s.clusterCode] ?? 0 })),
    );
    const archetype = l.track.archetype as Archetype;
    const aw = clusters.reduce<Record<ClusterCode, number>>((acc, c) => {
      acc[c.code] = (c.archetypeWeights as Record<string, number>)[archetype] ?? 0;
      return acc;
    }, {} as Record<ClusterCode, number>);
    const match = matchScore(
      l.scores.map((s) => ({
        scoreWeighted: s.scoreWeighted,
        target: thresholds[s.clusterCode] ?? 60,
        weight: aw[s.clusterCode] ?? 0,
      })),
    );
    return {
      learnerId: l.id,
      learnerName: l.name,
      trackId: l.trackId,
      cohortId: l.cohortId,
      cohortName: l.cohort?.name ?? '—',
      archetype,
      readinessScore: round1(readiness),
      matchScore: round3(match),
      band: bandFor(readiness, avgThreshold),
    };
  });
  const byLearner = new Map(lrows.map((r) => [r.learnerId, r]));

  // Realised placements (from Placement table) — ground truth
  const haveReal = realPlacements.length > 0;

  type Placed = {
    learnerId: string;
    learnerName: string;
    trackName: string;
    archetype: Archetype;
    company: string;
    salaryLpa: number;
    readinessScore: number;
    matchScore: number;
    placedAt: string;
  };
  const placements: Placed[] = [];
  const donutCounts: Record<Archetype, number> = {
    [Archetype.Product]: 0, [Archetype.Service]: 0, [Archetype.MassRecruiter]: 0,
  };
  const byBand: Record<'Above' | 'Near' | 'Below', { eligible: number; placed: number }> = {
    Above: { eligible: 0, placed: 0 },
    Near:  { eligible: 0, placed: 0 },
    Below: { eligible: 0, placed: 0 },
  };
  const placedSet = new Set<string>();
  const ctcs: number[] = [];
  let salarySum = 0;
  let matchSum = 0;

  // Eligibility tally across the whole cohort
  let readyEligible = 0;
  for (const r of lrows) {
    const eligible = r.band !== 'Below';
    if (eligible) readyEligible += 1;
    byBand[r.band].eligible += 1;
  }

  if (haveReal) {
    for (const p of realPlacements) {
      const lrow = byLearner.get(p.learnerId);
      if (!lrow) continue;
      placedSet.add(p.learnerId);
      const archetype = (p.learner.track.archetype as Archetype) ?? Archetype.Service;
      donutCounts[archetype] += 1;
      // A learner who was placed is by definition eligible
      if (lrow.band === 'Below') byBand[lrow.band].eligible += 0; // already counted above
      byBand[lrow.band].placed += 1;
      ctcs.push(p.ctcLpa);
      salarySum += p.ctcLpa;
      matchSum += lrow.matchScore;
      placements.push({
        learnerId: p.learnerId,
        learnerName: p.learner.name,
        trackName: p.learner.track.name,
        archetype,
        company: p.employer.name,
        salaryLpa: round1(p.ctcLpa),
        readinessScore: lrow.readinessScore,
        matchScore: lrow.matchScore,
        placedAt: p.joinDate.toISOString(),
      });
    }
  } else {
    // Deterministic fallback — still realistic (median ~9 LPA, outliers up to ~22)
    for (const l of learners) {
      const lrow = byLearner.get(l.id)!;
      const eligible = lrow.band !== 'Below';
      const seed = det01(l.id);
      const placeProb = clamp(lrow.matchScore * 0.70 + (eligible ? 0.20 : 0), 0, 0.82);
      const placed = eligible && seed < placeProb;
      if (!placed) continue;
      placedSet.add(l.id);
      const archetype = lrow.archetype;
      const list = FALLBACK_COMPANIES[archetype];
      const company = list[Math.floor(det01(l.id + '|co') * list.length)];
      const [lo, hi] = FALLBACK_SALARY[archetype];
      // Heavy tail: 5% above hi×1.5
      const outlier = det01(l.id + '|out') < 0.05 ? 1.5 : 1.0;
      const salary = Math.round((lo + (hi - lo) * (0.2 + lrow.matchScore * 0.8)) * outlier * 10) / 10;
      donutCounts[archetype] += 1;
      byBand[lrow.band].placed += 1;
      ctcs.push(salary);
      salarySum += salary;
      matchSum += lrow.matchScore;
      placements.push({
        learnerId: l.id,
        learnerName: l.name,
        trackName: l.track.name,
        archetype,
        company,
        salaryLpa: salary,
        readinessScore: lrow.readinessScore,
        matchScore: lrow.matchScore,
        placedAt: new Date(Date.now() - Math.floor(det01(l.id + '|dt') * 60) * 86400000).toISOString(),
      });
    }
  }

  const placedCount = placedSet.size;

  // Ensure "eligible" denominator always includes placed learners — we can't
  // have a placement rate > 100%. If a learner has been placed (real-world
  // outcome), they are by definition eligible.
  let effectiveEligible = readyEligible;
  for (const lid of placedSet) {
    const r = byLearner.get(lid);
    if (!r) continue;
    if (r.band === 'Below') effectiveEligible += 1;
  }

  // CTC distribution — median, p25, p75, p95, max
  const sortedCtc = [...ctcs].sort((a, b) => a - b);
  const ctcDistribution = {
    count: sortedCtc.length,
    medianLpa: round1(percentile(sortedCtc, 0.5)),
    p25Lpa:    round1(percentile(sortedCtc, 0.25)),
    p75Lpa:    round1(percentile(sortedCtc, 0.75)),
    p95Lpa:    round1(percentile(sortedCtc, 0.95)),
    maxLpa:    round1(sortedCtc[sortedCtc.length - 1] ?? 0),
    minLpa:    round1(sortedCtc[0] ?? 0),
    meanLpa:   round1(placedCount === 0 ? 0 : salarySum / placedCount),
  };

  const donut = (Object.keys(donutCounts) as Archetype[]).map((a) => ({
    archetype: a,
    count: donutCounts[a],
    pct: placedCount === 0 ? 0 : round3(donutCounts[a] / placedCount),
  }));

  const byBandOut = (['Above', 'Near', 'Below'] as const).map((b) => ({
    band: b,
    eligible: byBand[b].eligible,
    placed: byBand[b].placed,
    placementRate: byBand[b].eligible === 0 ? 0 : round3(byBand[b].placed / byBand[b].eligible),
  }));

  placements.sort((a, b) => (a.placedAt < b.placedAt ? 1 : -1));

  // Cohort rollup
  const cohortAgg = new Map<string, { cohortName: string; totalEligible: number; placed: number; ctcs: number[] }>();
  for (const r of lrows) {
    const entry = cohortAgg.get(r.cohortId) ?? { cohortName: r.cohortName, totalEligible: 0, placed: 0, ctcs: [] };
    if (r.band !== 'Below') entry.totalEligible += 1;
    cohortAgg.set(r.cohortId, entry);
  }
  for (const p of placements) {
    const lrow = byLearner.get(p.learnerId);
    if (!lrow) continue;
    const entry = cohortAgg.get(lrow.cohortId);
    if (entry) {
      entry.placed += 1;
      entry.ctcs.push(p.salaryLpa);
      // Grow denominator to include the placed learner if they weren't in 'Above/Near'
      if (lrow.band === 'Below') entry.totalEligible += 1;
    }
  }
  const byCohort = Array.from(cohortAgg.entries()).map(([cohortId, v]) => {
    const sorted = [...v.ctcs].sort((a, b) => a - b);
    return {
      cohortId,
      cohortName: v.cohortName,
      eligible: v.totalEligible,
      placed: v.placed,
      placementRate: v.totalEligible === 0 ? 0 : round3(v.placed / v.totalEligible),
      medianLpa: round1(percentile(sorted, 0.5)),
      p75Lpa: round1(percentile(sorted, 0.75)),
    };
  }).sort((a, b) => b.placementRate - a.placementRate);

  // Scatter
  const scatter = lrows.map((r) => ({
    learnerId: r.learnerId,
    learnerName: r.learnerName,
    readinessScore: r.readinessScore,
    matchScore: r.matchScore,
    placed: placedSet.has(r.learnerId),
    archetype: placedSet.has(r.learnerId) ? r.archetype : null,
    company: placements.find((p) => p.learnerId === r.learnerId)?.company ?? null,
  }));

  const employers = await prisma.employer.findMany({
    include: { pipelines: true },
  }).catch(() => [] as Array<{ id: string; name: string; archetype: Archetype; pipelines: { id: string }[] }>);
  const employerBreakdown = employers.length === 0
    ? null
    : employers.map((e) => ({
        employerId: e.id,
        name: e.name,
        archetype: e.archetype as Archetype,
        pipedCount: e.pipelines.length,
      }));

  // Confidence — drawn from learner score confidences, weighted by sample size
  const allConf = learners.flatMap((l) => l.scores.map((s) => s.confidence));
  const avgConf = allConf.length === 0 ? 0 : allConf.reduce((a, b) => a + b, 0) / allConf.length;
  const placementRateDec = effectiveEligible === 0 ? 0 : placedCount / effectiveEligible;
  const confidence = confidenceScore({
    completeness: Math.min(1, learners.length / Math.max(1, effectiveEligible)),
    stability: avgConf,
    sufficiency: Math.min(1, placedCount / 20),
    consistency: 1 - Math.min(1, Math.abs(placementRateDec - 0.6) * 1.2),
  });

  const kpis = {
    placedCount,
    readyEligible: effectiveEligible,
    totalLearners: learners.length,
    placementRate: round3(placementRateDec),           // single source of truth
    placementRatePct: Math.round(placementRateDec * 100),
    matchRate: placedCount === 0 ? 0 : round3(matchSum / placedCount),
    avgSalaryLpa: placedCount === 0 ? 0 : round1(salarySum / placedCount),
    medianSalaryLpa: ctcDistribution.medianLpa,
    confidence: round3(confidence),
    source: haveReal ? 'placement_table' : 'derived',
  };
  const headline = headlineFor(placedCount, effectiveEligible, ctcDistribution.medianLpa);

  return {
    kpis,
    headline,
    ctcDistribution,
    donut,
    scatter,
    byBand: byBandOut,
    byCohort,
    placements,
    employerBreakdown,
  };
}

function headlineFor(placed: number, eligible: number, medianLpa: number): string {
  if (eligible === 0) return 'No placement-eligible learners yet.';
  const pct = Math.round((placed / eligible) * 100);
  if (placed === 0) return `${eligible} learners placement-ready; no offers closed yet.`;
  return `${pct}% of placement-eligible learners (${placed}/${eligible}) have offers at a median ${medianLpa} LPA.`;
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const round3 = (n: number) => Math.round(n * 1000) / 1000;
function clamp(n: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, n)); }

// Surface unused imports to keep the import list lean; keep these referenced.
void completeness; void stability; void sufficiency; void consistency;
