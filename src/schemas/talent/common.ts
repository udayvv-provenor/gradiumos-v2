import { z } from 'zod';

export const CareerTrackIdQuery = z.object({
  careerTrackId: z.string().min(1).optional(),
});
export type CareerTrackIdQuery = z.infer<typeof CareerTrackIdQuery>;

export const CareerTrackIdRequired = z.object({
  careerTrackId: z.string().min(1),
});
export type CareerTrackIdRequired = z.infer<typeof CareerTrackIdRequired>;

export const AssignmentIdParam = z.object({ assignmentId: z.string().min(1) });
export type AssignmentIdParam = z.infer<typeof AssignmentIdParam>;

export const ClusterCodeParam = z.object({
  clusterCode: z.enum(['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8']),
});
export type ClusterCodeParam = z.infer<typeof ClusterCodeParam>;

export const SessionIdParam = z.object({ id: z.string().min(1) });
export type SessionIdParam = z.infer<typeof SessionIdParam>;

export const AssessmentIdParam = z.object({ id: z.string().min(1) });
export type AssessmentIdParam = z.infer<typeof AssessmentIdParam>;

export const ResumeIdParam = z.object({ id: z.string().min(1) });
export type ResumeIdParam = z.infer<typeof ResumeIdParam>;

export const RoleIdParam = z.object({ roleId: z.string().min(1) });
export type RoleIdParam = z.infer<typeof RoleIdParam>;

export const AttemptIdParam = z.object({ id: z.string().min(1) });
export type AttemptIdParam = z.infer<typeof AttemptIdParam>;

export const InstitutionAndCareerQuery = z.object({
  institutionId: z.string().min(1).optional(),
  careerTrackId: z.string().min(1).optional(),
});
export type InstitutionAndCareerQuery = z.infer<typeof InstitutionAndCareerQuery>;
