import { z } from 'zod';

export const PipelineInviteBody = z.object({
  roleId: z.string().min(1),
  learnerId: z.string().min(1),
});

export const PipelineDecisionBody = z.object({
  stage: z.enum(['invited', 'assessed', 'decisioned']),
  decision: z.enum(['offer', 'hold', 'reject']).optional(),
});

export const PipelineIdParam = z.object({ id: z.string().min(1) });

export const ShortlistBody = z.object({
  roleId: z.string().min(1),
  learnerId: z.string().min(1),
  state: z.enum(['watching', 'dismissed', 'piped']),
});

export type PipelineInviteBody = z.infer<typeof PipelineInviteBody>;
export type PipelineDecisionBody = z.infer<typeof PipelineDecisionBody>;
export type ShortlistBody = z.infer<typeof ShortlistBody>;
