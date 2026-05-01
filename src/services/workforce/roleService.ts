/**
 * EmployerRole CRUD — the hero write path.
 */
import { prisma } from '../../config/db.js';
import { AppError } from '../../utils/AppError.js';
import { ALL_CLUSTERS, parseTargets, parseWeights, weightsSum } from './helpers.js';
import type { RoleStatus, ClusterCode } from '@prisma/client';

/**
 * v3.1 — clusterWeights / clusterTargets are now OPTIONAL on create. If the
 * caller (the UI) doesn't supply them, we inherit from the parent CareerTrack's
 * defaults; the JD upload step then overwrites those with Groq-extracted values.
 * The TA Lead is no longer asked to know what "C1 weight 0.18" means.
 */
export interface RoleCreateInput {
  careerTrackId: string;
  title: string;
  seatsPlanned?: number;
  clusterWeights?: Record<string, number>;
  clusterTargets?: Record<string, { min: number; target: number; stretch: number } | number>;
}

export interface RoleUpdateInput {
  title?: string;
  seatsPlanned?: number;
  status?: RoleStatus;
  clusterWeights?: Record<string, number>;
  clusterTargets?: Record<string, { min: number; target: number; stretch: number } | number>;
}

function validateWeightsAndTargets(weightsRaw: Record<string, number>, targetsRaw: RoleCreateInput['clusterTargets']) {
  const weights = parseWeights(weightsRaw);
  const sum = weightsSum(weights);
  if (Math.abs(sum - 1) > 0.01) {
    throw new AppError('VALIDATION_ERROR', `Weights must sum to 1 ± 0.01 (got ${sum.toFixed(3)})`);
  }
  const targets = parseTargets(targetsRaw);
  for (const c of ALL_CLUSTERS) {
    const t = targets[c];
    if (!t) continue;
    if (t.target < 40 || t.target > 100) {
      throw new AppError('VALIDATION_ERROR', `Target for ${c} must be 40–100 (got ${t.target})`);
    }
  }
  return { weights, targets };
}

export async function listRoles(employerId: string) {
  const rows = await prisma.employerRole.findMany({
    where: { employerId },
    include: {
      careerTrack: true,
      // BC-fix: count Shortlist rows with state='piped' (learner-initiated applications)
      // _count.pipelines counted PipelineCandidate rows (employer-initiated) — wrong model
      shortlists: { select: { state: true }, where: { state: 'piped' } },
    },
    orderBy: { createdAt: 'desc' },
  });
  return rows.map((r) => toRoleDTO(r, r.shortlists.length));
}

export async function getRole(employerId: string, roleId: string) {
  const r = await prisma.employerRole.findUnique({
    where: { id: roleId },
    include: {
      careerTrack: true,
      shortlists: { select: { state: true }, where: { state: 'piped' } },
    },
  });
  if (!r || r.employerId !== employerId) throw new AppError('NOT_FOUND', 'Role not found');
  return toRoleDTO(r, r.shortlists.length);
}

/**
 * Default cluster weights + targets used when:
 *   - the caller didn't send any (the v3.1 hide-the-form path)
 *   - AND the parent CareerTrack also has no weights/targets configured
 * These are placeholders; the JD upload immediately overwrites with extracted
 * values. They exist purely so the role row is valid before a JD lands.
 */
const FALLBACK_WEIGHTS: Record<ClusterCode, number> = {
  C1: 0.18, C2: 0.16, C3: 0.15, C4: 0.16, C5: 0.10, C6: 0.10, C7: 0.10, C8: 0.05,
};
const FALLBACK_TARGETS: Record<ClusterCode, number> = {
  C1: 70, C2: 70, C3: 65, C4: 60, C5: 55, C6: 60, C7: 60, C8: 55,
};

export async function createRole(employerId: string, input: RoleCreateInput) {
  const ct = await prisma.careerTrack.findUnique({ where: { id: input.careerTrackId } });
  if (!ct) throw new AppError('NOT_FOUND', 'Career track not found');

  // v3.1 — if caller didn't send weights/targets (the new default), inherit
  // from the parent CareerTrack; if even that's empty, use FALLBACK constants.
  // The JD upload step overwrites both anyway.
  const ctWeights = parseWeights(ct.clusterWeights);
  const ctTargets = parseTargets(ct.clusterTargets);
  const weightsToValidate = input.clusterWeights
    ?? (Object.keys(ctWeights).length > 0 ? ctWeights : FALLBACK_WEIGHTS);
  const targetsToValidate = input.clusterTargets
    ?? (Object.keys(ctTargets).length > 0 ? ctTargets : FALLBACK_TARGETS);
  const { weights, targets } = validateWeightsAndTargets(weightsToValidate as Record<string, number>, targetsToValidate as RoleCreateInput['clusterTargets']);

  const role = await prisma.employerRole.create({
    data: {
      employerId,
      careerTrackId: input.careerTrackId,
      title: input.title,
      seatsPlanned: input.seatsPlanned ?? 1,
      status: 'active',
      clusterWeights: weights as object,
      clusterTargets: targets as object,
    },
    include: { careerTrack: true },
  });

  // Seed 8 DemandSignal rows (one per cluster) at the role's target.
  await prisma.demandSignal.createMany({
    data: ALL_CLUSTERS.map((c) => ({
      employerId,
      careerTrackId: input.careerTrackId,
      clusterCode: c,
      targetScore: Math.round(targets[c]?.target ?? 60),
      status: 'submitted',
    })),
  });

  return toRoleDTO(role);
}

export async function updateRole(employerId: string, roleId: string, input: RoleUpdateInput) {
  const existing = await prisma.employerRole.findUnique({ where: { id: roleId } });
  if (!existing || existing.employerId !== employerId) throw new AppError('NOT_FOUND', 'Role not found');
  const data: Record<string, unknown> = {};
  if (input.title !== undefined) data.title = input.title;
  if (input.seatsPlanned !== undefined) data.seatsPlanned = input.seatsPlanned;
  if (input.status !== undefined) data.status = input.status;
  if (input.clusterWeights !== undefined || input.clusterTargets !== undefined) {
    const w = input.clusterWeights ?? parseWeights(existing.clusterWeights) as Record<string, number>;
    const t = input.clusterTargets ?? parseTargets(existing.clusterTargets) as Record<string, { min: number; target: number; stretch: number }>;
    const { weights, targets } = validateWeightsAndTargets(w as Record<string, number>, t as RoleCreateInput['clusterTargets']);
    data.clusterWeights = weights as object;
    data.clusterTargets = targets as object;
  }
  const updated = await prisma.employerRole.update({
    where: { id: roleId },
    data,
    include: { careerTrack: true },
  });
  return toRoleDTO(updated);
}

function toRoleDTO(r: {
  id: string; employerId: string; careerTrackId: string; title: string; seatsPlanned: number;
  status: RoleStatus; clusterWeights: unknown; clusterTargets: unknown;
  createdAt: Date; updatedAt: Date;
  careerTrack: { id: string; name: string; code: string };
  jdText?: string | null;
  jdExtraction?: unknown;
}, applicantCount = 0) {
  const weights = parseWeights(r.clusterWeights);
  // v3 — clusterTargets are flat 0..100 numbers (set by JD-extract AI flow).
  // Legacy v2 wrapped them in {min,target,stretch} — we no longer do that.
  const rawTargets = (r.clusterTargets ?? {}) as Record<string, number | { target?: number }>;
  const flatTargets = ALL_CLUSTERS.reduce<Record<ClusterCode, number>>((acc, c) => {
    const v = rawTargets[c];
    acc[c] = typeof v === 'number'
      ? v
      : (typeof v === 'object' && v && typeof v.target === 'number' ? v.target : 0);
    return acc;
  }, {} as Record<ClusterCode, number>);
  const archetype = ((r.jdExtraction as { archetype?: string } | null)?.archetype) ?? 'Product';
  const extractedRequirements = ((r.jdExtraction as { extractedRequirements?: string[] } | null)?.extractedRequirements) ?? [];
  return {
    id:               r.id,
    careerTrackId:    r.careerTrackId,
    careerTrackName:  r.careerTrack.name,
    careerTrackCode:  r.careerTrack.code,
    title:            r.title,
    seatsPlanned:     r.seatsPlanned,
    status:           r.status,
    archetype,
    applicantCount,
    jdText:           r.jdText ?? undefined,
    extractedRequirements,
    clusterWeights:   ALL_CLUSTERS.reduce<Record<ClusterCode, number>>((acc, c) => { acc[c] = weights[c] ?? 0; return acc; }, {} as Record<ClusterCode, number>),
    clusterTargets:   flatTargets,
    createdAt:        r.createdAt.toISOString(),
    updatedAt:        r.updatedAt.toISOString(),
  };
}

export async function listCareerTracks() {
  const rows = await prisma.careerTrack.findMany({ orderBy: { code: 'asc' } });
  return rows.map((ct) => ({
    id: ct.id,
    code: ct.code,
    name: ct.name,
    archetype: ct.archetype,
    clusterWeights: parseWeights(ct.clusterWeights),
    clusterTargets: parseTargets(ct.clusterTargets),
  }));
}
