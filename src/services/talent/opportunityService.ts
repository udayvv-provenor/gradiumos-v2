/**
 * Opportunity ranking — active roles for the learner's career track, scored via
 * matchScore against the role's clusterTargets. applyRole creates a Shortlist
 * in 'piped' state (learner-initiated application).
 */
import type { ClusterCode } from '@prisma/client';
import { prisma } from '../../config/db.js';
import { AppError } from '../../utils/AppError.js';
import { matchScore } from '../competency/formulas.js';
import { ALL_CLUSTERS, parseTargets, parseWeights, round3 } from './helpers.js';
import { getLearnerWithScope, requireTrackEnrollment } from './learnerContext.js';

function targetNumber(raw: unknown, fallback: number): number {
  if (typeof raw === 'number') return raw;
  if (raw && typeof raw === 'object') {
    const o = raw as Record<string, unknown>;
    const n = Number(o.target ?? o.min ?? o.stretch);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

export async function listOpportunities(userId: string, careerTrackId: string, minMatch?: number) {
  const { learner } = await getLearnerWithScope(userId);
  await requireTrackEnrollment(learner.id, careerTrackId);

  const careerTrack = await prisma.careerTrack.findUnique({ where: { id: careerTrackId } });
  if (!careerTrack) throw new AppError('NOT_FOUND', 'Career track not found');
  const trackTargets = parseTargets(careerTrack.clusterTargets);
  const trackWeights = parseWeights(careerTrack.clusterWeights);

  const roles = await prisma.employerRole.findMany({
    where: { careerTrackId, status: 'active' },
    include: { employer: true },
  });
  const scores = await prisma.competencyScore.findMany({ where: { learnerId: learner.id } });
  const scoreMap = new Map<ClusterCode, number>();
  for (const s of scores) scoreMap.set(s.clusterCode, s.scoreWeighted);

  const shortlists = await prisma.shortlist.findMany({ where: { learnerId: learner.id } });
  const shortlistByRole = new Map(shortlists.map((s) => [s.roleId, s]));

  const rows = roles.map((r) => {
    const roleTargetsRaw = (r.clusterTargets ?? {}) as Record<string, unknown>;
    const roleWeights = parseWeights(r.clusterWeights);
    const entries = ALL_CLUSTERS.map((c) => ({
      scoreWeighted: scoreMap.get(c) ?? 0,
      target: targetNumber(roleTargetsRaw[c], trackTargets[c] ?? 60),
      weight: roleWeights[c] ?? trackWeights[c] ?? 0,
    }));
    const ms = matchScore(entries);
    const perCluster = ALL_CLUSTERS.map((c, i) => ({
      clusterCode: c,
      score: scoreMap.get(c) ?? 0,
      target: entries[i].target,
      meets: (scoreMap.get(c) ?? 0) >= entries[i].target,
      weight: round3(entries[i].weight),
    }));
    const sl = shortlistByRole.get(r.id);
    return {
      roleId: r.id,
      title: r.title,
      employerId: r.employerId,
      employerName: r.employer.name,
      employerArchetype: r.employer.archetype,
      seatsPlanned: r.seatsPlanned,
      match: round3(ms),
      perCluster,
      applied: !!sl && sl.state === 'piped',
      shortlistState: sl?.state ?? null,
    };
  });

  const filtered = typeof minMatch === 'number' ? rows.filter((r) => r.match >= minMatch) : rows;
  filtered.sort((a, b) => b.match - a.match);

  return { rows: filtered };
}

export async function getOpportunity(userId: string, roleId: string) {
  const { learner } = await getLearnerWithScope(userId);
  const role = await prisma.employerRole.findUnique({
    where: { id: roleId },
    include: { employer: true, careerTrack: true },
  });
  if (!role) throw new AppError('NOT_FOUND', 'Role not found');
  await requireTrackEnrollment(learner.id, role.careerTrackId);

  const scores = await prisma.competencyScore.findMany({ where: { learnerId: learner.id } });
  const scoreMap = new Map<ClusterCode, number>();
  for (const s of scores) scoreMap.set(s.clusterCode, s.scoreWeighted);

  const trackTargets = parseTargets(role.careerTrack.clusterTargets);
  const roleTargetsRaw = (role.clusterTargets ?? {}) as Record<string, unknown>;
  const roleWeights = parseWeights(role.clusterWeights);
  const trackWeights = parseWeights(role.careerTrack.clusterWeights);
  const entries = ALL_CLUSTERS.map((c) => ({
    scoreWeighted: scoreMap.get(c) ?? 0,
    target: targetNumber(roleTargetsRaw[c], trackTargets[c] ?? 60),
    weight: roleWeights[c] ?? trackWeights[c] ?? 0,
  }));
  const ms = matchScore(entries);
  const sl = await prisma.shortlist.findUnique({
    where: { roleId_learnerId: { roleId, learnerId: learner.id } },
  });

  return {
    roleId: role.id,
    title: role.title,
    employerName: role.employer.name,
    employerArchetype: role.employer.archetype,
    seatsPlanned: role.seatsPlanned,
    careerTrackId: role.careerTrackId,
    match: round3(ms),
    perCluster: ALL_CLUSTERS.map((c, i) => ({
      clusterCode: c,
      score: scoreMap.get(c) ?? 0,
      target: entries[i].target,
      meets: (scoreMap.get(c) ?? 0) >= entries[i].target,
      weight: round3(entries[i].weight),
    })),
    applied: !!sl && sl.state === 'piped',
    shortlistState: sl?.state ?? null,
  };
}

export async function applyRole(userId: string, roleId: string) {
  const { learner } = await getLearnerWithScope(userId);
  const role = await prisma.employerRole.findUnique({ where: { id: roleId } });
  if (!role) throw new AppError('NOT_FOUND', 'Role not found');
  await requireTrackEnrollment(learner.id, role.careerTrackId);

  const existing = await prisma.shortlist.findUnique({
    where: { roleId_learnerId: { roleId, learnerId: learner.id } },
  });
  if (existing && existing.state === 'piped') {
    return { roleId, learnerId: learner.id, state: existing.state, alreadyApplied: true };
  }
  const up = await prisma.shortlist.upsert({
    where: { roleId_learnerId: { roleId, learnerId: learner.id } },
    create: { roleId, learnerId: learner.id, state: 'piped' },
    update: { state: 'piped' },
  });
  return { roleId, learnerId: learner.id, state: up.state, alreadyApplied: false };
}
