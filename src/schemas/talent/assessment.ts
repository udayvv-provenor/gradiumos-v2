import { z } from 'zod';

export const AssessmentListQuery = z.object({
  clusterCode: z.enum(['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8']).optional(),
  careerTrackId: z.string().min(1).optional(),
});
export type AssessmentListQuery = z.infer<typeof AssessmentListQuery>;

// Discriminated answers per assessment kind.
const McqAnswers = z.object({
  kind: z.literal('mcq'),
  selectedOptionId: z.string().min(1),
});
const DescriptiveAnswers = z.object({
  kind: z.literal('descriptive'),
  text: z.string().min(1).max(8000),
});
const CodingAnswers = z.object({
  kind: z.literal('coding'),
  code: z.string().min(1).max(16000),
});
const SimulationAnswers = z.object({
  kind: z.literal('simulation'),
  response: z.string().min(1).max(8000),
});

export const AttemptSubmitBody = z.object({
  careerTrackId: z.string().min(1).optional(),
  timeSpentSec: z.coerce.number().int().min(0),
  answers: z.discriminatedUnion('kind', [McqAnswers, DescriptiveAnswers, CodingAnswers, SimulationAnswers]),
});
export type AttemptSubmitBody = z.infer<typeof AttemptSubmitBody>;
