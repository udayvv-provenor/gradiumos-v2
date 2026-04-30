import { z } from 'zod';

export const PathwayStatusQuery = z.object({
  status: z.enum(['active', 'completed', 'available']).optional(),
});
export type PathwayStatusQuery = z.infer<typeof PathwayStatusQuery>;

export const StepCompleteParams = z.object({
  assignmentId: z.string().min(1),
  stepIdx: z.coerce.number().int().min(0),
});
export type StepCompleteParams = z.infer<typeof StepCompleteParams>;
