import { z } from 'zod';
import { ClusterCode } from './common.js';

export const ConfidenceBand = z.enum(['green', 'amber', 'grey', 'suppressed']);

export const ConfidenceCell = z.object({
  track: z.string(),
  cluster: ClusterCode,
  value: z.number().min(0).max(1).nullable(),
  band: ConfidenceBand,
  completeness: z.number().min(0).max(1),
  stability: z.number().min(0).max(1),
  sufficiency: z.number().min(0).max(1),
  consistency: z.number().min(0).max(1),
  suppressedLearners: z.number().int().nonnegative(),
  totalLearners: z.number().int().nonnegative(),
});

export const SignalConfidenceKpis = z.object({
  indexMean: z.number().min(0).max(1),
  completenessMean: z.number().min(0).max(1),
  suppressionRate: z.number().min(0).max(1),
  cellsGreen: z.number().int().nonnegative(),
  cellsAmber: z.number().int().nonnegative(),
  cellsGrey: z.number().int().nonnegative(),
  cellsSuppressed: z.number().int().nonnegative(),
});

export const SignalConfidenceResponse = z.object({
  tracks: z.array(z.string()),
  clusters: z.array(ClusterCode),
  cells: z.array(ConfidenceCell),
  kpis: SignalConfidenceKpis,
  componentBreakdown: z.object({
    completeness: z.number(),
    stability: z.number(),
    sufficiency: z.number(),
    consistency: z.number(),
  }),
});

export type SignalConfidenceResponse = z.infer<typeof SignalConfidenceResponse>;
export type ConfidenceCell = z.infer<typeof ConfidenceCell>;
