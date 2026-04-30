/**
 * Campus Opportunity Matching — institution-wide view of how learners match
 * against employer role targets. Returns an aggregate % that is internally
 * consistent with the per-cluster bars (same numerator & denominator), plus
 * an explicit matchDrivers breakdown so the UI can explain WHY the score is X.
 */
import { prisma } from '../../config/db.js';
import { confidenceScore } from '../competency/formulas.js';
import type { ClusterCode } from '@prisma/client';

/**
 * Weighted match — min(scoreWeighted, target)/target × weight, summed and
 * normalised by total weight. This is the SAME shape the cluster bars use,
 * so the aggregate is the weighted mean of the bars.
 */
function matchScore(
  learnerScores: Record<string, number>,
  roleTargets: Record<string, number>,
  roleWeights: Record<string, number>,
): number {
  let weighted = 0;
  let totalWeight = 0;
  for (const [code, target] of Object.entries(roleTargets)) {
    const w = roleWeights[code] ?? 0;
    if (w === 0) continue;
    const score = learnerScores[code] ?? 0;
    const fraction = target > 0 ? Math.min(1, score / target) : 1;
    weighted += fraction * w;
    totalWeight += w;
  }
  return totalWeight > 0 ? weighted / totalWeight : 0;
}

export async function getOpportunityMatching(institutionId: string) {
  const learners = await prisma.learner.findMany({
    where: { institutionId },
    include: { scores: true },
  });

  const learnerScoreMaps = new Map<string, Record<string, number>>();
  const learnerConfAvg = new Map<string, number>();
  for (const l of learners) {
    const m: Record<string, number> = {};
    for (const s of l.scores) m[s.clusterCode] = s.scoreWeighted;
    learnerScoreMaps.set(l.id, m);
    learnerConfAvg.set(l.id, l.scores.length === 0
      ? 0
      : l.scores.reduce((a, s) => a + s.confidence, 0) / l.scores.length);
  }

  const roles = await prisma.employerRole.findMany({
    include: { employer: true, careerTrack: true },
  });
  const clusters = await prisma.competencyCluster.findMany();
  const clusterNames = new Map(clusters.map((c) => [c.code, c.name]));

  function extractTarget(val: unknown): number {
    if (typeof val === 'number') return val;
    if (val && typeof val === 'object') {
      const o = val as Record<string, number>;
      return o['target'] ?? o['min'] ?? 0;
    }
    return 0;
  }

  const roleRows = roles.map((role) => {
    const rawTargets = (role.clusterTargets ?? {}) as Record<string, unknown>;
    const targets: Record<string, number> = Object.fromEntries(
      Object.entries(rawTargets).map(([k, v]) => [k, extractTarget(v)])
    );
    const weights = (role.clusterWeights ?? {}) as Record<string, number>;

    const learnerMatches = learners.map((l) => {
      const scores = learnerScoreMaps.get(l.id) ?? {};
      const match = matchScore(scores, targets, weights);
      return { learnerId: l.id, name: l.name, match };
    }).sort((a, b) => b.match - a.match);

    const qualified = learnerMatches.filter((m) => m.match >= 0.7);
    const nearlyQualified = learnerMatches.filter((m) => m.match >= 0.5 && m.match < 0.7);

    // Per-cluster breakdown: institution-avg score vs role target.
    // Use ALL weighted clusters so aggregate == weighted mean of bars.
    const weightedClusterCodes = (Object.keys(targets) as ClusterCode[]).filter((c) => (weights[c] ?? 0) > 0);
    const clusterBreakdown = weightedClusterCodes.map((code) => {
      const avgScore = learners.length > 0
        ? learners.reduce((a, l) => a + (learnerScoreMaps.get(l.id)?.[code] ?? 0), 0) / learners.length
        : 0;
      const target = targets[code];
      const weight = weights[code] ?? 0;
      const fraction = target > 0 ? Math.min(1, avgScore / target) : 0;
      const meets = avgScore >= target;
      return {
        clusterCode: code,
        clusterName: clusterNames.get(code) ?? code,
        institutionAvg: Number(avgScore.toFixed(1)),
        target,
        weight: Number(weight.toFixed(3)),
        coverage: Number(fraction.toFixed(3)),       // 0..1 — what the bar fills to
        contribution: Number((fraction * weight).toFixed(4)),
        meets,
        // severity relative to its own weight: positive drivers raise aggregate; negatives drag it down.
        delta: Number((avgScore - target).toFixed(1)),
      };
    });

    // Aggregate match — same formula as cluster contributions sum / weight sum.
    const totalWeight = clusterBreakdown.reduce((a, c) => a + c.weight, 0);
    const avgMatch = totalWeight === 0
      ? 0
      : clusterBreakdown.reduce((a, c) => a + c.contribution, 0) / totalWeight;

    // Explicit match drivers — so UI can say "69% because C1/C3 strong even though C2/C5 weak"
    const positive = clusterBreakdown
      .filter((c) => c.meets)
      .sort((a, b) => b.contribution - a.contribution)
      .slice(0, 3)
      .map((c) => ({ clusterCode: c.clusterCode, clusterName: c.clusterName, contribution: c.contribution, delta: c.delta }));
    const negative = clusterBreakdown
      .filter((c) => !c.meets)
      .sort((a, b) => (b.target - b.institutionAvg) * b.weight - (a.target - a.institutionAvg) * a.weight)
      .slice(0, 3)
      .map((c) => ({ clusterCode: c.clusterCode, clusterName: c.clusterName, contribution: c.contribution, delta: c.delta }));

    const misMatchClusters = clusterBreakdown.filter((c) => !c.meets).map((c) => c.clusterCode);

    return {
      roleId: role.id,
      roleTitle: role.title,
      employerName: role.employer.name,
      employerArchetype: role.employer.archetype ?? '—',
      careerTrackName: role.careerTrack.name,
      seatsPlanned: role.seatsPlanned,
      qualifiedCount: qualified.length,
      nearlyQualifiedCount: nearlyQualified.length,
      avgMatch: Number((avgMatch * 100).toFixed(1)),          // percent, consistent with cluster bars
      avgMatchDec: Number(avgMatch.toFixed(3)),               // 0..1 for downstream math
      topCandidates: learnerMatches.slice(0, 3).map((m) => ({ name: m.name, match: Number((m.match * 100).toFixed(1)) })),
      clusterBreakdown,
      matchDrivers: { positive, negative },
      misMatchClusters,
    };
  }).sort((a, b) => b.qualifiedCount - a.qualifiedCount);

  const totalRoles = roleRows.length;
  const rolesWithCandidates = roleRows.filter((r) => r.qualifiedCount > 0).length;
  const totalQualifications = roleRows.reduce((a, r) => a + r.qualifiedCount, 0);

  const clusterMismatchCount: Record<string, number> = {};
  for (const r of roleRows) {
    for (const c of r.misMatchClusters) {
      clusterMismatchCount[c] = (clusterMismatchCount[c] ?? 0) + 1;
    }
  }
  const topMismatch = Object.entries(clusterMismatchCount).sort(([, a], [, b]) => b - a)[0];
  const topMismatchName = topMismatch ? (clusterNames.get(topMismatch[0] as ClusterCode) ?? topMismatch[0]) : null;

  const insights: string[] = [];
  if (rolesWithCandidates < totalRoles) {
    insights.push(`${totalRoles - rolesWithCandidates} role${totalRoles - rolesWithCandidates !== 1 ? 's have' : ' has'} no qualifying candidates yet — check cluster thresholds.`);
  }
  if (topMismatchName) {
    insights.push(`${topMismatchName} is the most common cluster causing mis-matches across ${topMismatch[1]} roles.`);
  }
  const nearlyRows = roleRows.filter((r) => r.nearlyQualifiedCount > 0);
  if (nearlyRows.length > 0) {
    const best = nearlyRows[0];
    insights.push(`${best.nearlyQualifiedCount} learner${best.nearlyQualifiedCount !== 1 ? 's are' : ' is'} within reach of qualifying for ${best.roleTitle} — targeted augmentation could unlock placements.`);
  }

  // Confidence — average learner confidence, tempered by coverage
  const confValues = Array.from(learnerConfAvg.values());
  const avgLearnerConf = confValues.length === 0 ? 0 : confValues.reduce((a, b) => a + b, 0) / confValues.length;
  const confidence = confidenceScore({
    completeness: totalRoles === 0 ? 0 : rolesWithCandidates / totalRoles,
    stability: avgLearnerConf,
    sufficiency: Math.min(1, learners.length / 50),
    consistency: 0.7,
  });

  const result = {
    stats: {
      totalRoles,
      rolesWithCandidates,
      totalLearners: learners.length,
      totalQualifications,
      confidence: Number(confidence.toFixed(3)),
      coverageRate: totalRoles === 0 ? 0 : Number((rolesWithCandidates / totalRoles).toFixed(3)),
    },
    insights,
    roles: roleRows,
  };

  return result;
}
