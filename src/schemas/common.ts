import { z } from 'zod';

export const PaginationQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type Pagination = z.infer<typeof PaginationQuery>;

export const ClusterCode = z.enum(['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8']);
export type ClusterCode = z.infer<typeof ClusterCode>;

export const Band = z.enum(['Below', 'Near', 'Above']);
export type Band = z.infer<typeof Band>;

export const TriggerType = z.enum(['mandatory', 'on_demand', 'stretch']);
export type TriggerType = z.infer<typeof TriggerType>;

export const AssignmentStatus = z.enum([
  'assigned',
  'in_progress',
  'awaiting_assessment',
  'complete',
]);
export type AssignmentStatus = z.infer<typeof AssignmentStatus>;

export const Role = z.enum(['DEAN', 'PLACEMENT_OFFICER', 'FACULTY_ADMIN', 'STUDENT', 'TA_LEAD', 'LEARNER']);
export type Role = z.infer<typeof Role>;

export const Archetype = z.enum(['Product', 'Service', 'MassRecruiter']);
export type Archetype = z.infer<typeof Archetype>;

export const envelope = <T extends z.ZodTypeAny>(data: T) =>
  z.object({ data, error: z.null() });

export const errorEnvelope = z.object({
  data: z.null(),
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.any().optional(),
  }),
});

export const IdParam = z.object({ id: z.string().min(1) });
