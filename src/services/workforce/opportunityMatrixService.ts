/**
 * Workforce Opportunity Matrix — (institution × role) cells with clear
 * partnership semantics.
 *
 *   existing  = institution has ≥1 Placement to this employer in past 12 months
 *   untapped  = avg cluster profile matches this employer's top roles BUT zero placements
 *   cells     = one per (institution, role) pair, with matchStrength (0..1),
 *               placementCount (history), and partnership flag
 *
 * Reads from seeded Placement rows when available; otherwise falls back to
 * pipeline decisions with stage='decisioned' + decision='offer'.
 */
import { prisma } from '../../config/db.js';
import { AppError } from '../../utils/AppError.js';
import { matchScore, SUPPRESSION_CONFIDENCE, confidenceScore } from '../competency/formulas.js';
import { ALL_CLUSTERS, parseTargets, parseWeights, round3 } from './helpers.js';
import type { ClusterCode } from '@prisma/client';

export async function getOpportunityMatrix(employerId: string) {
  const [employer, myRoles, allTracks, allLearners, placements, pipeline] = await Promise.all([
    prisma.employer.findUnique({ where: { id: employerId } }),
    prisma.employerRole.findMany({ where: { employerId, status: 'active' }, include: { careerTrack: true } }),
    prisma.track.findMany({ include: { institution: true } }),
    prisma.learner.findMany({ include: { scores: true, track: true } }),
    prisma.placement.findMany({
      where: { employerId, joinDate: { gte: new Date(Date.now() - 365 * 86400000) } },
      include: { learner: true },
    }),
    prisma.pipelineCandidate.findMany({
      where: { employerId, stage: 'decisioned', decision: 'offer' },
      include: { learner: true },
    }),
  ]);

  if (!employer) throw new AppError('NOT_FOUND', 'Employer not found');
  if (myRoles.length === 0) {
    return {
      stats: { rolesCount: 0, existingPartnerCount: 0, untappedPartnerCount: 0, confidence: 0 },
      roles: [],
      institutions: [],
      cells: [],
      existingPartners: [],
      untappedPartners: [],
    };
  }

  // Placement history — institution-level counts.
  const placedByInst = new Map<string, { count: number; learners: Set<string> }>();
  const insLookup = new Map(allTracks.map((t) => [t.id, t.institution.id]));
  const instInfo = new Map(allTracks.map((t) => [t.institution.id, t.institution]));
  const recordPlacement = (learnerId: string) => {
    const learner = allLearners.find((l) => l.id === learnerId);
    if (!learner) return;
    const instId = learner.track.institutionId;
    const entry = placedByInst.get(instId) ?? { count: 0, learners: new Set<string>() };
    entry.count += 1;
    entry.learners.add(learnerId);
    placedByInst.set(instId, entry);
  };
  for (const p of placements) recordPlacement(p.learnerId);
  // If the Placement table is empty, fall back to offer decisions.
  if (placements.length === 0) {
    for (const p of pipeline) recordPlacement(p.learnerId);
  }

  // Per-role avg targets/weights for matching institution profiles
  const roleProfiles = myRoles.map((r) => ({
    roleId: r.id,
    roleTitle: r.title,
    careerTrackId: r.careerTrackId,
    careerTrackName: r.careerTrack.name,
    seatsPlanned: r.seatsPlanned,
    weights: parseWeights(r.clusterWeights),
    targets: parseTargets(r.clusterTargets),
  }));

  // Group learners by institution for avg cluster profile
  const learnersByInst = new Map<string, typeof allLearners>();
  for (const l of allLearners) {
    const ins = l.track.institutionId;
    const arr = learnersByInst.get(ins) ?? [];
    arr.push(l);
    learnersByInst.set(ins, arr);
  }

  type Cell = {
    institutionId: string;
    institutionName: string;
    roleId: string;
    roleTitle: string;
    careerTrackName: string;
    poolSize: number;
    matchStrength: number;        // 0..1 avg match across pool
    qualifyingPool: number;       // learners with match >= 0.7
    placementCount: number;       // historical placements from this inst to this employer (1yr)
  };

  const cells: Cell[] = [];
  for (const [instId, learners] of learnersByInst.entries()) {
    const inst = instInfo.get(instId);
    if (!inst) continue;
    const placementInfo = placedByInst.get(instId);
    const placementCount = placementInfo?.count ?? 0;

    for (const r of roleProfiles) {
      // Restrict pool to learners on tracks mapped to this role's career track
      const pool = learners.filter((l) => l.track.careerTrackId === r.careerTrackId);
      if (pool.length === 0) continue;
      let sumMatch = 0; let qualifying = 0;
      for (const l of pool) {
        const byCode = new Map<ClusterCode, { score: number; confidence: number }>();
        for (const s of l.scores) byCode.set(s.clusterCode, { score: s.scoreWeighted, confidence: s.confidence });
        let num = 0;
        let totalWeight = 0; // denominator: ALL clusters in role spec
        for (const c of ALL_CLUSTERS) {
          const w = r.weights[c] ?? 0;
          const t = r.targets[c]?.target ?? 0;
          if (w <= 0 || t <= 0) continue;
          totalWeight += w;
          const sv = byCode.get(c);
          if (!sv || sv.confidence < SUPPRESSION_CONFIDENCE) continue;
          num += (Math.min(sv.score, t) / t) * w;
        }
        const m = totalWeight === 0 ? 0 : Math.min(1, Math.max(0, num / totalWeight));
        sumMatch += m;
        if (m >= 0.7) qualifying += 1;
      }
      const avg = pool.length === 0 ? 0 : sumMatch / pool.length;
      cells.push({
        institutionId: instId,
        institutionName: inst.name,
        roleId: r.roleId,
        roleTitle: r.roleTitle,
        careerTrackName: r.careerTrackName,
        poolSize: pool.length,
        matchStrength: round3(avg),
        qualifyingPool: qualifying,
        placementCount: placementCount,
      });
    }
  }

  // Aggregate per institution for the partner classification
  const instAgg = new Map<string, {
    institutionId: string;
    institutionName: string;
    bestMatchStrength: number;
    avgMatchStrength: number;
    totalQualifying: number;
    placementCount: number;
    topRole: { roleId: string; roleTitle: string; matchStrength: number } | null;
  }>();
  for (const c of cells) {
    const entry = instAgg.get(c.institutionId) ?? {
      institutionId: c.institutionId,
      institutionName: c.institutionName,
      bestMatchStrength: 0,
      avgMatchStrength: 0,
      totalQualifying: 0,
      placementCount: c.placementCount,
      topRole: null as { roleId: string; roleTitle: string; matchStrength: number } | null,
    };
    entry.totalQualifying += c.qualifyingPool;
    if (c.matchStrength > entry.bestMatchStrength) {
      entry.bestMatchStrength = c.matchStrength;
      entry.topRole = { roleId: c.roleId, roleTitle: c.roleTitle, matchStrength: c.matchStrength };
    }
    instAgg.set(c.institutionId, entry);
  }
  for (const [, entry] of instAgg.entries()) {
    const myCells = cells.filter((c) => c.institutionId === entry.institutionId);
    entry.avgMatchStrength = myCells.length === 0
      ? 0
      : round3(myCells.reduce((a, b) => a + b.matchStrength, 0) / myCells.length);
  }

  const existingPartners = Array.from(instAgg.values())
    .filter((i) => i.placementCount > 0)
    .sort((a, b) => b.placementCount - a.placementCount)
    .map((i) => ({
      institutionId: i.institutionId,
      institutionName: i.institutionName,
      placementCount: i.placementCount,
      bestMatchStrength: i.bestMatchStrength,
      avgMatchStrength: i.avgMatchStrength,
      topRole: i.topRole,
    }));
  const untappedPartners = Array.from(instAgg.values())
    .filter((i) => i.placementCount === 0 && i.bestMatchStrength >= 0.6)
    .sort((a, b) => b.bestMatchStrength - a.bestMatchStrength)
    .map((i) => ({
      institutionId: i.institutionId,
      institutionName: i.institutionName,
      bestMatchStrength: i.bestMatchStrength,
      avgMatchStrength: i.avgMatchStrength,
      totalQualifying: i.totalQualifying,
      topRole: i.topRole,
      reason: `Avg cluster profile meets role targets (${Math.round(i.bestMatchStrength * 100)}%) but no placement history.`,
    }));

  const confidence = confidenceScore({
    completeness: Math.min(1, cells.length / (myRoles.length * 5)),
    stability: Math.min(1, existingPartners.length / 3),
    sufficiency: Math.min(1, allLearners.length / 100),
    consistency: 0.75,
  });

  return {
    stats: {
      rolesCount: myRoles.length,
      institutionsCount: instAgg.size,
      existingPartnerCount: existingPartners.length,
      untappedPartnerCount: untappedPartners.length,
      confidence: round3(confidence),
    },
    roles: roleProfiles.map((r) => ({ roleId: r.roleId, roleTitle: r.roleTitle, careerTrackName: r.careerTrackName, seatsPlanned: r.seatsPlanned })),
    institutions: Array.from(instAgg.values()).sort((a, b) => b.placementCount - a.placementCount || b.avgMatchStrength - a.avgMatchStrength),
    cells,
    existingPartners,
    untappedPartners,
  };
}
