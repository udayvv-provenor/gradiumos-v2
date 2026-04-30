import { z } from 'zod';
import { AssignmentStatus, ClusterCode, TriggerType } from './common.js';

export const ListProgrammesQuery = z.object({
  cohortId: z.string().optional(),
  status: AssignmentStatus.optional(),
});

export const ProgrammeCard = z.object({
  id: z.string(),
  cohortId: z.string(),
  cohortName: z.string(),
  clusterId: ClusterCode,
  clusterName: z.string(),
  triggerType: TriggerType,
  status: AssignmentStatus,
  createdAt: z.string(),
  learners: z.number().int(),
  pathwayCompletionPct: z.number().min(0).max(1),
  assessmentTriggeredPct: z.number().min(0).max(1),
  assessmentCompletePct: z.number().min(0).max(1),
  avgDelta: z.number().nullable(),
});

export const ListProgrammesResponse = z.object({
  items: z.array(ProgrammeCard),
});

export const CreateProgrammeBody = z.object({
  cohortId: z.string().min(1),
  clusterId: ClusterCode,
  triggerType: z.enum(['mandatory', 'on_demand']),
});

export const CreateProgrammeResponse = z.object({
  programme: ProgrammeCard,
  assignmentsCreated: z.number().int().nonnegative(),
});

export type ProgrammeCard = z.infer<typeof ProgrammeCard>;
export type CreateProgrammeBody = z.infer<typeof CreateProgrammeBody>;
export type CreateProgrammeResponse = z.infer<typeof CreateProgrammeResponse>;
