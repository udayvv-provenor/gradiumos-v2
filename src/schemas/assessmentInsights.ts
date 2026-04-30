import { z } from 'zod';
import { ClusterCode } from './common.js';

export const AssessmentKpis = z.object({
  attemptsTotal: z.number().int().nonnegative(),
  attemptsLast30d: z.number().int().nonnegative(),
  avgScore: z.number().min(0).max(100),
  avgTimeSecs: z.number().nonnegative(),
  passRate: z.number().min(0).max(1),
  retakeRate: z.number().min(0).max(1),
  varianceFlagged: z.number().int().nonnegative(),
});

export const ClusterAttempts = z.object({
  cluster: ClusterCode,
  name: z.string(),
  attempts: z.number().int().nonnegative(),
  avgScore: z.number().min(0).max(100),
  stdDev: z.number().nonnegative(),
  passRate: z.number().min(0).max(1),
  varianceFlag: z.boolean(),
});

export const ScoreHistogramBucket = z.object({
  lo: z.number(),
  hi: z.number(),
  count: z.number().int().nonnegative(),
});

export const BankHealth = z.object({
  cluster: ClusterCode,
  name: z.string(),
  contentItems: z.number().int().nonnegative(),
  baselineItems: z.number().int().nonnegative(),
  postAugItems: z.number().int().nonnegative(),
  coverage: z.enum(['strong', 'adequate', 'thin']),
});

export const AssessmentInsightsResponse = z.object({
  kpis: AssessmentKpis,
  histogram: z.array(ScoreHistogramBucket),
  byCluster: z.array(ClusterAttempts),
  bankHealth: z.array(BankHealth),
});

export type AssessmentInsightsResponse = z.infer<typeof AssessmentInsightsResponse>;
