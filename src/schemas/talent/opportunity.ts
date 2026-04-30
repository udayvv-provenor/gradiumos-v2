import { z } from 'zod';

export const OpportunityQuery = z.object({
  careerTrackId: z.string().min(1),
  minMatch: z.coerce.number().min(0).max(1).optional(),
});
export type OpportunityQuery = z.infer<typeof OpportunityQuery>;
