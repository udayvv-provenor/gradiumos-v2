import { z } from 'zod';

const General = z.object({
  variant: z.literal('general'),
  careerTrackId: z.string().min(1),
});
const MatchedCompany = z.object({
  variant: z.literal('matched_company'),
  careerTrackId: z.string().min(1),
  matchedRoleId: z.string().min(1),
});
const JdTailored = z.object({
  variant: z.literal('jd_tailored'),
  careerTrackId: z.string().min(1),
  jdText: z.string().min(20).max(10000),
});

export const GenerateResumeBody = z.discriminatedUnion('variant', [General, MatchedCompany, JdTailored]);
export type GenerateResumeBody = z.infer<typeof GenerateResumeBody>;

export const ResumesListQuery = z.object({
  careerTrackId: z.string().min(1).optional(),
});
export type ResumesListQuery = z.infer<typeof ResumesListQuery>;
