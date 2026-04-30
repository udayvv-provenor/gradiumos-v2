/**
 * GOLDEN PATH — Assign a new Augmentation Programme to an entire cohort.
 *
 * Contract (from docs/03-api-contract.md):
 *   POST /api/campus/augmentation-programmes
 *   body = { cohortId, clusterId, triggerType }
 *
 * Algorithm:
 *   1. Load cohort (must belong to caller's institution).
 *   2. Load content-bank items for the cluster → used as programme steps.
 *   3. Enforce unique (cohortId, clusterCode) — 409 if one already exists.
 *   4. In one transaction:
 *        - create AugmentationProgramme
 *        - create one AugmentationStep per content-bank item
 *        - create one AugmentationAssignment per learner in the cohort
 *
 * Reads are routed through the same service for consistency.
 */

import { Prisma, type ClusterCode, type TriggerType, AssignmentStatus } from '@prisma/client';
import { prisma } from '../../config/db.js';
import { AppError } from '../../utils/AppError.js';

export interface ProgrammeCardDTO {
  id: string;
  cohortId: string;
  cohortName: string;
  clusterId: ClusterCode;
  clusterName: string;
  triggerType: TriggerType;
  status: 'active' | 'awaiting_assessment' | 'complete';
  createdAt: string;
  learners: number;
  pathwayCompletionPct: number;
  assessmentTriggeredPct: number;
  assessmentCompletePct: number;
  avgDelta: number | null;
}

export async function listProgrammes(
  institutionId: string,
  filters: { cohortId?: string; status?: AssignmentStatus },
): Promise<ProgrammeCardDTO[]> {
  const rows = await prisma.augmentationProgramme.findMany({
    where: {
      institutionId,
      ...(filters.cohortId ? { cohortId: filters.cohortId } : {}),
    },
    include: {
      cohort: true,
      cluster: true,
      assignments: { include: { outcome: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  return rows.map((p) => buildCardFromRow(p));
}

export interface CreateProgrammeInput {
  institutionId: string;
  cohortId: string;
  clusterId: ClusterCode;
  triggerType: TriggerType;
  createdByUserId?: string;
}

export async function assignCohortProgramme(input: CreateProgrammeInput): Promise<{ programme: ProgrammeCardDTO; assignmentsCreated: number }> {
  const cohort = await prisma.cohort.findFirst({
    where: { id: input.cohortId, institutionId: input.institutionId },
    include: { track: true },
  });
  if (!cohort) throw new AppError('NOT_FOUND', 'Cohort not found in your institution');

  const cluster = await prisma.competencyCluster.findUnique({ where: { code: input.clusterId } });
  if (!cluster) throw new AppError('NOT_FOUND', `Unknown cluster ${input.clusterId}`);

  const existing = await prisma.augmentationProgramme.findUnique({
    where: { cohortId_clusterCode: { cohortId: input.cohortId, clusterCode: input.clusterId } },
  });
  if (existing) {
    throw new AppError('CONFLICT', `An active programme already exists for ${cohort.name} / ${input.clusterId}`);
  }

  const contentItems = await prisma.contentBankItem.findMany({
    where: { clusterCode: input.clusterId },
    orderBy: { createdAt: 'asc' },
  });
  if (contentItems.length === 0) {
    throw new AppError('CONFLICT', `No content-bank items exist for ${input.clusterId}; cannot build programme`);
  }

  const cohortLearners = await prisma.learner.findMany({
    where: { cohortId: input.cohortId },
    select: { id: true },
  });

  const title = `${cluster.shortName} — Cohort Augmentation`;

  const result = await prisma.$transaction(async (tx) => {
    const programme = await tx.augmentationProgramme.create({
      data: {
        institutionId: input.institutionId,
        cohortId: input.cohortId,
        clusterCode: input.clusterId,
        triggerType: input.triggerType,
        title,
        createdByUserId: input.createdByUserId ?? null,
        steps: {
          create: contentItems.map((c, idx) => ({
            orderIndex: idx + 1,
            title: c.title,
            kind: c.kind,
            estMinutes: c.estMinutes,
            contentItemId: c.id,
          })),
        },
      },
      include: { cohort: true, cluster: true, assignments: true, steps: true },
    });

    if (cohortLearners.length > 0) {
      await tx.augmentationAssignment.createMany({
        data: cohortLearners.map((l) => ({
          programmeId: programme.id,
          learnerId: l.id,
          status: AssignmentStatus.assigned,
          stepsTotal: contentItems.length,
          stepsComplete: 0,
        })),
      });
    }

    const fresh = await tx.augmentationProgramme.findUniqueOrThrow({
      where: { id: programme.id },
      include: { cohort: true, cluster: true, assignments: { include: { outcome: true } } },
    });
    return { fresh, count: cohortLearners.length };
  });

  return { programme: buildCardFromRow(result.fresh), assignmentsCreated: result.count };
}

// ──────────────────────────────────────────────

type RowWithRelations = Prisma.AugmentationProgrammeGetPayload<{
  include: { cohort: true; cluster: true; assignments: { include: { outcome: true } } };
}>;

function buildCardFromRow(p: RowWithRelations): ProgrammeCardDTO {
  const total = p.assignments.length;
  const pathwayDone = p.assignments.filter(
    (a) => a.status === AssignmentStatus.awaiting_assessment || a.status === AssignmentStatus.complete,
  ).length;
  const assessmentTriggered = pathwayDone;
  const complete = p.assignments.filter((a) => a.status === AssignmentStatus.complete).length;

  // Rough aggregate status for the card badge.
  let status: ProgrammeCardDTO['status'] = 'active';
  if (total > 0 && complete === total) status = 'complete';
  else if (total > 0 && pathwayDone === total) status = 'awaiting_assessment';

  return {
    id: p.id,
    cohortId: p.cohortId,
    cohortName: p.cohort.name,
    clusterId: p.clusterCode,
    clusterName: p.cluster.name,
    triggerType: p.triggerType,
    status,
    createdAt: p.createdAt.toISOString(),
    learners: total,
    pathwayCompletionPct: total === 0 ? 0 : pathwayDone / total,
    assessmentTriggeredPct: total === 0 ? 0 : assessmentTriggered / total,
    assessmentCompletePct: total === 0 ? 0 : complete / total,
    avgDelta: (() => {
      const deltas = p.assignments
        .map((a) => a.outcome?.delta)
        .filter((d): d is number => typeof d === 'number');
      if (deltas.length === 0) return null;
      return Math.round((deltas.reduce((a, b) => a + b, 0) / deltas.length) * 10) / 10;
    })(),
  };
}
