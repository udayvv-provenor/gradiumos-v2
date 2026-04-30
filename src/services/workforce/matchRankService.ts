/**
 * Per-role learner ranking — Talent Discovery page.
 */
import { prisma } from '../../config/db.js';
import { AppError } from '../../utils/AppError.js';
import { matchScore, SUPPRESSION_CONFIDENCE, confidenceBand } from '../competency/formulas.js';
import { ALL_CLUSTERS, parseTargets, parseWeights, bandForMatch, round3, velocityFor } from './helpers.js';
import type { ClusterCode } from '@prisma/client';

export interface DiscoveryFilters {
  institutionId?: string;
  band?: 'Above' | 'Near' | 'Below';
  q?: string;
  limit?: number;
}

export async function rankLearnersForRole(employerId: string, roleId: string, filters: DiscoveryFilters = {}) {
  const role = await prisma.employerRole.findUnique({
    where: { id: roleId },
    include: { careerTrack: true },
  });
  if (!role || role.employerId !== employerId) {
    throw new AppError('NOT_FOUND', 'Role not found');
  }
  const weights = parseWeights(role.clusterWeights);
  const targets = parseTargets(role.clusterTargets);

  const trackFilter: { careerTrackId: string; institutionId?: string } = { careerTrackId: role.careerTrackId };
  if (filters.institutionId) trackFilter.institutionId = filters.institutionId;
  const tracks = await prisma.track.findMany({ where: trackFilter, include: { institution: true, cohorts: true } });
  if (tracks.length === 0) {
    return { roleId, rows: [] as Array<unknown> };
  }

  const learners = await prisma.learner.findMany({
    where: {
      trackId: { in: tracks.map((t) => t.id) },
      ...(filters.q ? { OR: [{ name: { contains: filters.q, mode: 'insensitive' as const } }, { email: { contains: filters.q, mode: 'insensitive' as const } }] } : {}),
    },
    include: { scores: true, track: { include: { institution: true } }, cohort: true },
  });

  const issued = await prisma.gradiumSignal.findMany({
    where: { learnerId: { in: learners.map((l) => l.id) }, state: 'issued' },
  });
  const signalSet = new Set(issued.map((s) => s.learnerId));

  const rows = learners.map((l) => {
    const byCode = new Map<ClusterCode, { score: number; confidence: number }>();
    for (const s of l.scores) byCode.set(s.clusterCode, { score: s.scoreWeighted, confidence: s.confidence });
    let num = 0;
    let totalWeight = 0; // denominator: ALL clusters in role spec
    for (const c of ALL_CLUSTERS) {
      const w = weights[c] ?? 0;
      const t = targets[c];
      if (w <= 0 || !t || t.target <= 0) continue;
      totalWeight += w;
      const sv = byCode.get(c);
      if (!sv || sv.confidence < SUPPRESSION_CONFIDENCE) continue;
      num += (Math.min(sv.score, t.target) / t.target) * w;
    }
    const match = totalWeight === 0 ? 0 : Math.min(1, Math.max(0, num / totalWeight));
    const confAvg = l.scores.length === 0 ? 0 : l.scores.reduce((a, s) => a + s.confidence, 0) / l.scores.length;
    const freshnessAvg = l.scores.length === 0 ? 0 : l.scores.reduce((a, s) => a + s.freshness, 0) / l.scores.length;
    return {
      learnerId: l.id,
      name: l.name,
      email: l.email,
      institutionId: l.track.institutionId,
      institutionName: l.track.institution.name,
      cohortId: l.cohortId,
      cohortName: l.cohort.name,
      matchScore: round3(match),
      band: bandForMatch(match),
      confidence: round3(confAvg),
      confidenceBand: confidenceBand(confAvg),
      freshness: round3(freshnessAvg),
      velocityPtsPerWeek: velocityFor(l.id, 0.8, 1.6),
      signalReady: signalSet.has(l.id),
    };
  });

  const filtered = filters.band ? rows.filter((r) => r.band === filters.band) : rows;
  filtered.sort((a, b) => b.matchScore - a.matchScore);
  const limit = filters.limit ?? 50;
  return {
    roleId,
    role: { id: role.id, title: role.title, careerTrackId: role.careerTrackId, careerTrackName: role.careerTrack.name },
    rows: filtered.slice(0, limit),
  };
}
