import { z } from 'zod';

export const CareerTrackIdQuery = z.object({
  careerTrackId: z.string().min(1).optional(),
});

export const InstitutionsInsightQuery = z.object({
  careerTrackId: z.string().min(1).optional(),
});

export const CohortsInsightQuery = z.object({
  careerTrackId: z.string().min(1).optional(),
  institutionId: z.string().min(1).optional(),
});

export const CohortLearnersQuery = z.object({
  careerTrackId: z.string().min(1),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

export const CohortIdParam = z.object({ cohortId: z.string().min(1) });

export const PeerIntelQuery = z.object({
  careerTrackId: z.string().min(1).optional(),
});
