/**
 * Augmentation Pathways — the learner-facing view of AugmentationAssignment rows.
 * active    → assignments with status !== complete
 * completed → status === complete
 * available → programmes for clusters the learner has a gap in but no assignment yet
 */
import { prisma } from '../../config/db.js';
import { AppError } from '../../utils/AppError.js';
import type { ClusterCode, AssignmentStatus } from '@prisma/client';
import { getLearnerIdOrThrow } from './learnerContext.js';

type Status = 'active' | 'completed' | 'available';

export async function listPathways(userId: string, status?: Status) {
  const learnerId = await getLearnerIdOrThrow(userId);
  const learner = await prisma.learner.findUnique({
    where: { id: learnerId },
    include: { scores: true, cohort: true, institution: true },
  });
  if (!learner) throw new AppError('NOT_FOUND', 'Learner not found');

  const assignments = await prisma.augmentationAssignment.findMany({
    where: { learnerId },
    include: { programme: true },
    orderBy: { assignedAt: 'desc' },
  });

  // Enrich with cluster names
  const clusterDefs = await prisma.competencyCluster.findMany();
  const clusterNameMap = new Map(clusterDefs.map((c) => [c.code, c.name]));

  const activeRows = assignments
    .filter((a) => a.status !== 'complete')
    .map((a) => ({
      assignmentId: a.id,
      programmeId: a.programmeId,
      title: a.programme.title,
      clusterCode: a.programme.clusterCode,
      clusterName: clusterNameMap.get(a.programme.clusterCode as ClusterCode) ?? a.programme.clusterCode,
      status: a.status as AssignmentStatus,
      stepsCompleted: a.stepsComplete,
      stepsTotal: a.stepsTotal,
      progressPct: a.stepsTotal > 0 ? (a.stepsComplete / a.stepsTotal) * 100 : 0,
      assignedAt: a.assignedAt.toISOString(),
      startedAt: a.startedAt?.toISOString() ?? null,
      createdAt: a.assignedAt.toISOString(),
    }));

  const completedRows = assignments
    .filter((a) => a.status === 'complete')
    .map((a) => ({
      assignmentId: a.id,
      programmeId: a.programmeId,
      title: a.programme.title,
      clusterCode: a.programme.clusterCode,
      clusterName: clusterNameMap.get(a.programme.clusterCode as ClusterCode) ?? a.programme.clusterCode,
      status: 'completed' as const,
      stepsCompleted: a.stepsComplete,
      stepsTotal: a.stepsTotal,
      progressPct: 100,
      completedAt: a.completedAt?.toISOString() ?? null,
      createdAt: a.assignedAt.toISOString(),
    }));

  // available — programmes in this learner's cohort for clusters where the learner
  // has a gap (score < cluster threshold on their institution's index version).
  const iv = await prisma.indexVersion.findFirst({
    where: { institutionId: learner.institutionId },
    orderBy: { effectiveFrom: 'desc' },
  });
  const thresholds = (iv?.thresholds ?? {}) as Record<string, number>;
  const assignedProgrammeIds = new Set(assignments.map((a) => a.programmeId));
  const cohortProgrammes = await prisma.augmentationProgramme.findMany({
    where: { cohortId: learner.cohortId },
  });
  const availableRows = cohortProgrammes
    .filter((p) => !assignedProgrammeIds.has(p.id))
    .filter((p) => {
      const sc = learner.scores.find((s) => s.clusterCode === p.clusterCode)?.scoreWeighted ?? 0;
      const thr = thresholds[p.clusterCode] ?? 60;
      return sc < thr;
    })
    .map((p) => ({
      programmeId: p.id,
      title: p.title,
      clusterCode: p.clusterCode as ClusterCode,
      triggerType: p.triggerType,
    }));

  // Return plain arrays so the frontend hook (typed as PathwayAssignmentDTO[]) can call .map directly.
  // Available rows are shaped to match PathwayAssignmentDTO using programmeId as a synthetic assignmentId.
  const availableShaped = availableRows.map((p) => ({
    assignmentId: p.programmeId,   // no real assignment yet — use programmeId as key
    programmeId: p.programmeId,
    title: p.title,
    clusterCode: p.clusterCode,
    clusterName: '',
    status: 'assigned' as const,
    progressPct: 0,
    stepsTotal: 0,
    stepsCompleted: 0,
    createdAt: new Date().toISOString(),
  }));

  if (status === 'active')     return activeRows;
  if (status === 'completed')  return completedRows;
  if (status === 'available')  return availableShaped;
  return { active: activeRows, completed: completedRows, available: availableRows };
}

export async function getPathway(userId: string, assignmentId: string) {
  const learnerId = await getLearnerIdOrThrow(userId);
  const assignment = await prisma.augmentationAssignment.findUnique({
    where: { id: assignmentId },
    include: { programme: { include: { steps: { orderBy: { orderIndex: 'asc' } } } } },
  });
  if (!assignment || assignment.learnerId !== learnerId) {
    throw new AppError('NOT_FOUND', 'Pathway not found');
  }
  const clusterDefs2 = await prisma.competencyCluster.findMany();
  const clusterNameMap2 = new Map(clusterDefs2.map((c) => [c.code, c.name]));
  return {
    assignmentId: assignment.id,
    programmeId: assignment.programmeId,
    title: assignment.programme.title,
    clusterCode: assignment.programme.clusterCode,
    clusterName: clusterNameMap2.get(assignment.programme.clusterCode as ClusterCode) ?? assignment.programme.clusterCode,
    status: assignment.status,
    stepsCompleted: assignment.stepsComplete,
    stepsTotal: assignment.stepsTotal,
    progressPct: assignment.stepsTotal > 0 ? (assignment.stepsComplete / assignment.stepsTotal) * 100 : 0,
    createdAt: assignment.assignedAt.toISOString(),
    steps: assignment.programme.steps.map((s, idx) => ({
      idx,
      orderIndex: s.orderIndex,
      title: s.title,
      kind: s.kind,
      estMinutes: s.estMinutes,
      completed: idx < assignment.stepsComplete,
      content: (s as unknown as { content?: string }).content ?? null,
    })),
  };
}

export async function completeStep(userId: string, assignmentId: string, stepIdx: number) {
  const learnerId = await getLearnerIdOrThrow(userId);
  const assignment = await prisma.augmentationAssignment.findUnique({
    where: { id: assignmentId },
  });
  if (!assignment || assignment.learnerId !== learnerId) {
    throw new AppError('NOT_FOUND', 'Pathway not found');
  }
  if (stepIdx < 0 || stepIdx >= assignment.stepsTotal) {
    throw new AppError('VALIDATION_ERROR', 'Step index out of range');
  }
  const newComplete = Math.max(assignment.stepsComplete, stepIdx + 1);
  const newStatus: AssignmentStatus =
    newComplete >= assignment.stepsTotal
      ? 'awaiting_assessment'
      : assignment.status === 'assigned' ? 'in_progress' : assignment.status;

  const updated = await prisma.augmentationAssignment.update({
    where: { id: assignmentId },
    data: {
      stepsComplete: newComplete,
      status: newStatus,
      startedAt: assignment.startedAt ?? new Date(),
      gateUnlockedAt: newComplete >= assignment.stepsTotal ? new Date() : assignment.gateUnlockedAt,
    },
  });
  return {
    assignmentId: updated.id,
    stepsComplete: updated.stepsComplete,
    stepsTotal: updated.stepsTotal,
    status: updated.status,
  };
}
