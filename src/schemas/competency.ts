import { z } from 'zod';
import { ClusterCode } from './common.js';

export const DistributionQuery = z.object({
  cohortId: z.string().optional(),
  trackId: z.string().optional(),
});

export const RadarPoint = z.object({
  cluster: ClusterCode,
  mean: z.number(),
  threshold: z.number(),
  p75: z.number(),
});

export const DistributionRow = z.object({
  cluster: ClusterCode,
  name: z.string(),
  mean: z.number(),
  threshold: z.number(),
  pctAbove: z.number().min(0).max(1),
  pctNear: z.number().min(0).max(1),
  pctBelow: z.number().min(0).max(1),
  confidence: z.number().min(0).max(1).nullable(),
  suppressed: z.boolean(),
});

export const DistributionResponse = z.object({
  radar: z.array(RadarPoint),
  table: z.array(DistributionRow),
});

export const RecordAttemptBody = z.object({
  learnerId: z.string().min(1),
  assessmentId: z.string().min(1),
  clusterId: ClusterCode,
  scoreRaw: z.number().min(0),
  maxScore: z.number().positive(),
  timeSecs: z.number().int().min(1).max(5400),
});

export type DistributionResponse = z.infer<typeof DistributionResponse>;
export type RecordAttemptBody = z.infer<typeof RecordAttemptBody>;
