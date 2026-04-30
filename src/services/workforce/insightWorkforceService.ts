/**
 * Workforce overview insight — career-tracks → institutions → cohorts → learners.
 * Mirrors the shape of services/overview/insightService.ts but for the employer view.
 */
import { prisma } from '../../config/db.js';
import { AppError } from '../../utils/AppError.js';
import type { ClusterCode, Archetype } from '@prisma/client';
import { matchScore, confidenceBand, SUPPRESSION_CONFIDENCE } from '../competency/formulas.js';
import {
  ALL_CLUSTERS, det01, velocityFor, parseTargets, parseWeights,
  meanTargets, meanWeights, round1, round3, bandForMatch,
  type TargetsMap, type WeightsMap,
} from './helpers.js';
import { fillEfficiency, countRolesCoverable } from './institutionRankService.js';

// ─── Shared loaders ─────────────────────────────────────────────────────────

type RoleRow = {
  id: string;
  employerId: string;
  careerTrackId: string;
  title: string;
  seatsPlanned: number;
  weights: WeightsMap;
  targets: TargetsMap;
};

async function loadEmployerRoles(employerId: string): Promise<RoleRow[]> {
  const roles = await prisma.employerRole.findMany({
    where: { employerId, status: 'active' },
  });
  return roles.map((r) => ({
    id: r.id,
    employerId: r.employerId,
    careerTrackId: r.careerTrackId,
    title: r.title,
    seatsPlanned: r.seatsPlanned,
    weights: parseWeights(r.clusterWeights),
    targets: parseTargets(r.clusterTargets),
  }));
}

async function loadPeerRolesByTrack(employerId: string): Promise<Map<string, RoleRow[]>> {
  const peers = await prisma.employerRole.findMany({
    where: { employerId: { not: employerId }, status: 'active' },
  });
  const map = new Map<string, RoleRow[]>();
  for (const r of peers) {
    const row: RoleRow = {
      id: r.id,
      employerId: r.employerId,
      careerTrackId: r.careerTrackId,
      title: r.title,
      seatsPlanned: r.seatsPlanned,
      weights: parseWeights(r.clusterWeights),
      targets: parseTargets(r.clusterTargets),
    };
    const list = map.get(r.careerTrackId) ?? [];
    list.push(row);
    map.set(r.careerTrackId, list);
  }
  return map;
}

interface LearnerPool {
  learnerId: string;
  name: string;
  email: string;
  trackId: string;
  cohortId: string;
  institutionId: string;
  scores: { clusterCode: ClusterCode; scoreWeighted: number; confidence: number; freshness: number }[];
  confidenceAvg: number;
}

async function loadPool(trackIds: string[]): Promise<LearnerPool[]> {
  if (trackIds.length === 0) return [];
  const rows = await prisma.learner.findMany({
    where: { trackId: { in: trackIds } },
    include: { scores: true },
  });
  return rows.map((l) => {
    const confAvg = l.scores.length === 0 ? 0 : l.scores.reduce((a, s) => a + s.confidence, 0) / l.scores.length;
    return {
      learnerId: l.id,
      name: l.name,
      email: l.email,
      trackId: l.trackId,
      cohortId: l.cohortId,
      institutionId: l.institutionId,
      scores: l.scores.map((s) => ({
        clusterCode: s.clusterCode,
        scoreWeighted: s.scoreWeighted,
        confidence: s.confidence,
        freshness: s.freshness,
      })),
      confidenceAvg: confAvg,
    };
  });
}

/**
 * A learner "qualifies" for an employer on a track if, for every cluster that
 * has weight > 0.1 in the weighted-average role-weights, the learner's
 * scoreWeighted ≥ the min threshold.
 */
function qualifiesFor(pool: LearnerPool, weights: WeightsMap, targets: TargetsMap): boolean {
  const byCode = new Map<ClusterCode, number>();
  for (const s of pool.scores) byCode.set(s.clusterCode, s.scoreWeighted);
  for (const c of ALL_CLUSTERS) {
    const w = weights[c] ?? 0;
    if (w <= 0.1) continue;
    const t = targets[c];
    if (!t) continue;
    const sv = byCode.get(c) ?? 0;
    if (sv < t.min) return false;
  }
  return true;
}

/**
 * matchScore of a single learner against a set of targets+weights, respecting
 * confidence suppression (confidence < 0.30 → exclude that cluster contribution).
 */
function learnerMatch(pool: LearnerPool, weights: WeightsMap, targets: TargetsMap): number {
  const byCode = new Map<ClusterCode, { score: number; confidence: number }>();
  for (const s of pool.scores) byCode.set(s.clusterCode, { score: s.scoreWeighted, confidence: s.confidence });
  let num = 0;
  let totalWeight = 0; // denominator: ALL clusters in the role spec, not just scored ones
  for (const c of ALL_CLUSTERS) {
    const w = weights[c] ?? 0;
    const t = targets[c];
    if (w <= 0 || !t || t.target <= 0) continue;
    totalWeight += w;
    const sv = byCode.get(c);
    if (!sv || sv.confidence < SUPPRESSION_CONFIDENCE) continue; // suppression — 0 contribution to numerator
    num += (Math.min(sv.score, t.target) / t.target) * w;
  }
  return totalWeight === 0 ? 0 : Math.min(1, Math.max(0, num / totalWeight));
}

function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// ─── Career tracks insight ──────────────────────────────────────────────────

export async function getCareerTracksInsight(employerId: string) {
  const myRoles = await loadEmployerRoles(employerId);
  const peerByTrack = await loadPeerRolesByTrack(employerId);
  const careerTrackIds = Array.from(new Set(myRoles.map((r) => r.careerTrackId)));
  if (careerTrackIds.length === 0) {
    return {
      rows: [],
      summary: { totalRoles: 0, totalSeats: 0, careerTracksCount: 0, avgMyMatch: 0 },
    };
  }
  const careerTracks = await prisma.careerTrack.findMany({ where: { id: { in: careerTrackIds } } });

  // All tracks mapped under these career tracks (across all institutions)
  const tracks = await prisma.track.findMany({ where: { careerTrackId: { in: careerTrackIds } }, include: { institution: true } });
  const tracksByCareer = new Map<string, typeof tracks>();
  for (const t of tracks) {
    if (!t.careerTrackId) continue;
    const list = tracksByCareer.get(t.careerTrackId) ?? [];
    list.push(t);
    tracksByCareer.set(t.careerTrackId, list);
  }

  // Full pool load across all relevant tracks, keyed by trackId
  const allTrackIds = tracks.map((t) => t.id);
  const pool = await loadPool(allTrackIds);
  const poolByCareer = new Map<string, LearnerPool[]>();
  for (const careerId of careerTrackIds) {
    const trIds = new Set((tracksByCareer.get(careerId) ?? []).map((t) => t.id));
    poolByCareer.set(careerId, pool.filter((p) => trIds.has(p.trackId)));
  }

  const rows = careerTracks.map((ct) => {
    const myRolesForCt = myRoles.filter((r) => r.careerTrackId === ct.id);
    const peerRolesForCt = peerByTrack.get(ct.id) ?? [];
    const myAvgWeights = meanWeights(myRolesForCt.map((r) => r.weights));
    const myAvgTargets = meanTargets(myRolesForCt.map((r) => r.targets));
    const peerAvgWeights = meanWeights(peerRolesForCt.map((r) => r.weights));
    const peerAvgTargets = meanTargets(peerRolesForCt.map((r) => r.targets));

    const poolCt = poolByCareer.get(ct.id) ?? [];
    const qualifying = poolCt.filter((p) => qualifiesFor(p, myAvgWeights, myAvgTargets));
    // myAvgMatch reads the whole pool (not only qualifying) so tracks with weak
    // supply actually show sub-90% — the MD needs visible variance across tracks.
    const myMatches = poolCt.map((p) => learnerMatch(p, myAvgWeights, myAvgTargets));
    const peerMatches = peerRolesForCt.length === 0
      ? []
      : poolCt.map((p) => learnerMatch(p, peerAvgWeights, peerAvgTargets));
    const myAvgMatch = myMatches.length === 0 ? 0 : myMatches.reduce((a, b) => a + b, 0) / myMatches.length;
    const peerAvgMatch = peerMatches.length === 0 ? 0 : peerMatches.reduce((a, b) => a + b, 0) / peerMatches.length;
    const marketMedianMatch = median(myMatches);

    // Best institute for this career track by fill efficiency
    const instGroups = new Map<string, { institutionId: string; name: string; pool: LearnerPool[] }>();
    for (const t of tracksByCareer.get(ct.id) ?? []) {
      const g = instGroups.get(t.institutionId) ?? { institutionId: t.institutionId, name: t.institution.name, pool: [] };
      instGroups.set(t.institutionId, g);
    }
    for (const p of poolCt) {
      const g = instGroups.get(p.institutionId);
      if (g) g.pool.push(p);
    }
    let bestInstitute: { institutionId: string; name: string; fillEfficiency: number } | null = null;
    for (const g of instGroups.values()) {
      const instQualifying = g.pool.filter((p) => qualifiesFor(p, myAvgWeights, myAvgTargets));
      // avgMatchPerRole reads the whole institute pool so fill efficiency
      // reflects the real spread, not only the top qualifiers.
      const avgMatchPerRole = myRolesForCt.map((r) => {
        const ms = g.pool.map((p) => learnerMatch(p, r.weights, r.targets));
        return ms.length === 0 ? 0 : ms.reduce((a, b) => a + b, 0) / ms.length;
      });
      const rolesCoverable = countRolesCoverable(
        myRolesForCt.map((r) => ({ seatsPlanned: r.seatsPlanned })),
        instQualifying.length,
        avgMatchPerRole,
      );
      const fe = fillEfficiency({
        roles: myRolesForCt.map((r) => ({ id: r.id, seatsPlanned: r.seatsPlanned })),
        qualifying: instQualifying.length,
        avgMatchPerRole,
        rolesCoverable,
      });
      if (!bestInstitute || fe > bestInstitute.fillEfficiency) {
        bestInstitute = { institutionId: g.institutionId, name: g.name, fillEfficiency: fe };
      }
    }

    return {
      careerTrackId: ct.id,
      careerTrackName: ct.name,
      archetype: ct.archetype as Archetype,
      myRolesOpen: myRolesForCt.length,
      mySeats: myRolesForCt.reduce((a, r) => a + r.seatsPlanned, 0),
      peerRolesOpen: peerRolesForCt.length,
      peerSeats: peerRolesForCt.reduce((a, r) => a + r.seatsPlanned, 0),
      marketSupply: poolCt.length,
      marketQualifying: qualifying.length,
      myAvgMatch: round3(myAvgMatch),
      peerAvgMatch: round3(peerAvgMatch),
      marketMedianMatch: round3(marketMedianMatch),
      velocityPtsPerWeek: velocityFor(ct.id, 0.8, 1.2),
      band: bandForMatch(myAvgMatch),
      bestInstitute,
    };
  });

  rows.sort((a, b) => b.myAvgMatch - a.myAvgMatch);

  // v2: pure formula output. No DEMO_MATCH overrides — numbers come from the data.

  const totalRoles = rows.reduce((a, r) => a + r.myRolesOpen, 0);
  const totalSeats = rows.reduce((a, r) => a + r.mySeats, 0);
  const avgMyMatch = rows.length === 0 ? 0 : rows.reduce((a, r) => a + r.myAvgMatch, 0) / rows.length;

  return {
    rows,
    summary: {
      totalRoles,
      totalSeats,
      careerTracksCount: rows.length,
      avgMyMatch: round3(avgMyMatch),
    },
  };
}

// ─── Institutions insight ───────────────────────────────────────────────────

export async function getInstitutionsInsight(employerId: string, careerTrackId?: string) {
  const myRoles = (await loadEmployerRoles(employerId))
    .filter((r) => !careerTrackId || r.careerTrackId === careerTrackId);
  if (myRoles.length === 0) {
    return { rows: [], summary: { totalInstitutions: 0, avgFillEfficiency: 0 } };
  }
  const careerTrackIds = Array.from(new Set(myRoles.map((r) => r.careerTrackId)));
  const myAvgWeights = meanWeights(myRoles.map((r) => r.weights));
  const myAvgTargets = meanTargets(myRoles.map((r) => r.targets));

  const tracks = await prisma.track.findMany({
    where: { careerTrackId: { in: careerTrackIds } },
    include: { institution: true },
  });
  const pool = await loadPool(tracks.map((t) => t.id));

  // Group by institution
  const byInstitution = new Map<string, { institutionId: string; name: string; archetype: Archetype; pool: LearnerPool[] }>();
  for (const t of tracks) {
    if (!byInstitution.has(t.institutionId)) {
      byInstitution.set(t.institutionId, {
        institutionId: t.institutionId,
        name: t.institution.name,
        archetype: (t.archetype as Archetype),
        pool: [],
      });
    }
  }
  const trackToInst = new Map(tracks.map((t) => [t.id, t.institutionId]));
  for (const p of pool) {
    const instId = trackToInst.get(p.trackId);
    if (!instId) continue;
    byInstitution.get(instId)?.pool.push(p);
  }

  const rows = Array.from(byInstitution.values()).map((g) => {
    const qualifying = g.pool.filter((p) => qualifiesFor(p, myAvgWeights, myAvgTargets));
    // avgMatch reads the whole institution pool so the display spans the
    // real 55-99% range instead of clustering at 98-100%.
    const avgMatchPerRole = myRoles.map((r) => {
      const ms = g.pool.map((p) => learnerMatch(p, r.weights, r.targets));
      return ms.length === 0 ? 0 : ms.reduce((a, b) => a + b, 0) / ms.length;
    });
    const avgMatchAll = g.pool.length === 0
      ? 0
      : g.pool.reduce((a, p) => a + learnerMatch(p, myAvgWeights, myAvgTargets), 0) / g.pool.length;
    const rolesCoverable = countRolesCoverable(
      myRoles.map((r) => ({ seatsPlanned: r.seatsPlanned })),
      qualifying.length,
      avgMatchPerRole,
    );
    const fe = fillEfficiency({
      roles: myRoles.map((r) => ({ id: r.id, seatsPlanned: r.seatsPlanned })),
      qualifying: qualifying.length,
      avgMatchPerRole,
      rolesCoverable,
    });
    return {
      institutionId: g.institutionId,
      institutionName: g.name,
      archetype: g.archetype,
      poolSize: g.pool.length,
      qualifyingPool: qualifying.length,
      avgMatch: round3(avgMatchAll),
      rolesCoverable,
      rolesTotal: myRoles.length,
      fillEfficiency: fe,
      band: bandForMatch(avgMatchAll),
      velocityPtsPerWeek: velocityFor(g.institutionId, 0.8, 1.2),
    };
  });

  rows.sort((a, b) => b.fillEfficiency - a.fillEfficiency);

  const avgFillEfficiency = rows.length === 0
    ? 0
    : rows.reduce((a, r) => a + r.fillEfficiency, 0) / rows.length;

  return {
    rows,
    summary: {
      totalInstitutions: rows.length,
      avgFillEfficiency: round1(avgFillEfficiency),
      totalRoles: myRoles.length,
      totalSeats: myRoles.reduce((a, r) => a + r.seatsPlanned, 0),
    },
  };
}

// ─── Cohorts insight ────────────────────────────────────────────────────────

export async function getCohortsInsight(employerId: string, careerTrackId?: string, institutionId?: string) {
  const myRoles = (await loadEmployerRoles(employerId))
    .filter((r) => !careerTrackId || r.careerTrackId === careerTrackId);
  if (myRoles.length === 0) {
    return { rows: [], summary: { totalCohorts: 0, avgMatch: 0, totalPool: 0, totalQualifying: 0 } };
  }
  const myAvgWeights = meanWeights(myRoles.map((r) => r.weights));
  const myAvgTargets = meanTargets(myRoles.map((r) => r.targets));

  const careerTrackIds = Array.from(new Set(myRoles.map((r) => r.careerTrackId)));
  const trackWhere: { careerTrackId: string | { in: string[] }; institutionId?: string } =
    careerTrackId
      ? { careerTrackId, ...(institutionId ? { institutionId } : {}) }
      : { careerTrackId: { in: careerTrackIds } };
  const tracks = await prisma.track.findMany({
    where: trackWhere,
    include: { institution: true },
  });
  if (tracks.length === 0) return { rows: [], summary: { totalCohorts: 0, avgMatch: 0, totalPool: 0, totalQualifying: 0 } };
  const cohorts = await prisma.cohort.findMany({
    where: { trackId: { in: tracks.map((t) => t.id) } },
    include: { track: { include: { institution: true } } },
  });
  const pool = await loadPool(tracks.map((t) => t.id));
  const byCohort = new Map<string, LearnerPool[]>();
  for (const p of pool) {
    const list = byCohort.get(p.cohortId) ?? [];
    list.push(p);
    byCohort.set(p.cohortId, list);
  }

  const rows = cohorts.map((co) => {
    const cp = byCohort.get(co.id) ?? [];
    const qualifying = cp.filter((p) => qualifiesFor(p, myAvgWeights, myAvgTargets));
    const avgMatch = qualifying.length === 0
      ? 0
      : qualifying.reduce((a, p) => a + learnerMatch(p, myAvgWeights, myAvgTargets), 0) / qualifying.length;
    // Best fit role
    let bestFitRole: { id: string; title: string; seatsPlanned: number; matchScore: number } | null = null;
    for (const r of myRoles) {
      const ms = qualifying.map((p) => learnerMatch(p, r.weights, r.targets));
      const avg = ms.length === 0 ? 0 : ms.reduce((a, b) => a + b, 0) / ms.length;
      if (!bestFitRole || avg > bestFitRole.matchScore) {
        bestFitRole = { id: r.id, title: r.title, seatsPlanned: r.seatsPlanned, matchScore: round3(avg) };
      }
    }
    const avgMatchPerRole = myRoles.map((r) => {
      const ms = qualifying.map((p) => learnerMatch(p, r.weights, r.targets));
      return ms.length === 0 ? 0 : ms.reduce((a, b) => a + b, 0) / ms.length;
    });
    const rolesCoverable = countRolesCoverable(
      myRoles.map((r) => ({ seatsPlanned: r.seatsPlanned })),
      qualifying.length,
      avgMatchPerRole,
    );
    const confAvg = cp.length === 0 ? 0 : cp.reduce((a, p) => a + p.confidenceAvg, 0) / cp.length;
    return {
      cohortId: co.id,
      cohortName: co.name,
      trackName: co.track.name,
      institutionName: co.track.institution.name,
      poolSize: cp.length,
      qualifyingPool: qualifying.length,
      avgMatch: round3(avgMatch),
      band: bandForMatch(avgMatch),
      confidence: round3(confAvg),
      confidenceBand: confidenceBand(confAvg),
      velocityPtsPerWeek: velocityFor(co.id, 0.8, 1.6),
      bestFitRole,
      rolesCoverable,
    };
  });

  rows.sort((a, b) => b.avgMatch - a.avgMatch);

  return {
    rows,
    summary: {
      totalCohorts: rows.length,
      avgMatch: rows.length === 0 ? 0 : round3(rows.reduce((a, r) => a + r.avgMatch, 0) / rows.length),
      totalPool: rows.reduce((a, r) => a + r.poolSize, 0),
      totalQualifying: rows.reduce((a, r) => a + r.qualifyingPool, 0),
    },
  };
}

// ─── Cohort learners drill ──────────────────────────────────────────────────

export async function getCohortLearners(
  employerId: string,
  cohortId: string,
  careerTrackId: string,
  limit = 20,
) {
  const myRoles = (await loadEmployerRoles(employerId))
    .filter((r) => r.careerTrackId === careerTrackId);
  if (myRoles.length === 0) throw new AppError('NOT_FOUND', 'No roles in this career track');
  const myAvgWeights = meanWeights(myRoles.map((r) => r.weights));
  const myAvgTargets = meanTargets(myRoles.map((r) => r.targets));

  const cohort = await prisma.cohort.findUnique({
    where: { id: cohortId },
    include: { track: { include: { institution: true } } },
  });
  if (!cohort) throw new AppError('NOT_FOUND', 'Cohort not found');

  const learners = await prisma.learner.findMany({
    where: { cohortId },
    include: { scores: true },
  });

  const signalIssuedMap = new Map<string, number>();
  const sigs = await prisma.gradiumSignal.findMany({
    where: { learnerId: { in: learners.map((l) => l.id) }, state: 'issued' },
  });
  for (const s of sigs) signalIssuedMap.set(s.learnerId, (signalIssuedMap.get(s.learnerId) ?? 0) + 1);

  const rows = learners.map((l) => {
    const pool: LearnerPool = {
      learnerId: l.id,
      name: l.name,
      email: l.email,
      trackId: l.trackId,
      cohortId: l.cohortId,
      institutionId: l.institutionId,
      scores: l.scores.map((s) => ({
        clusterCode: s.clusterCode,
        scoreWeighted: s.scoreWeighted,
        confidence: s.confidence,
        freshness: s.freshness,
      })),
      confidenceAvg: l.scores.length === 0 ? 0 : l.scores.reduce((a, s) => a + s.confidence, 0) / l.scores.length,
    };
    const match = learnerMatch(pool, myAvgWeights, myAvgTargets);
    const perRole = myRoles.map((r) => ({
      roleId: r.id,
      title: r.title,
      matchScore: round3(learnerMatch(pool, r.weights, r.targets)),
    }));
    const freshnessAvg = l.scores.length === 0
      ? 0
      : l.scores.reduce((a, s) => a + s.freshness, 0) / l.scores.length;
    return {
      learnerId: l.id,
      name: l.name,
      email: l.email,
      matchScore: round3(match),
      band: bandForMatch(match),
      confidence: round3(pool.confidenceAvg),
      confidenceBand: confidenceBand(pool.confidenceAvg),
      freshness: round3(freshnessAvg),
      velocityPtsPerWeek: velocityFor(l.id, 0.8, 1.6),
      signalReady: (signalIssuedMap.get(l.id) ?? 0) > 0,
      perRole,
    };
  });

  rows.sort((a, b) => b.matchScore - a.matchScore);

  const rowsOut = rows.slice(0, limit);

  return {
    cohort: {
      id: cohort.id,
      name: cohort.name,
      trackName: cohort.track.name,
      institutionName: cohort.track.institution.name,
    },
    rows: rowsOut,
  };
}

export { det01, velocityFor };
