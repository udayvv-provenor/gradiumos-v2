import { z } from 'zod';
import { Band, ClusterCode } from './common.js';

export const KpiResponse = z.object({
  enrolledLearners: z.number().int().nonnegative(),
  assessmentRate: z.number().min(0).max(1),
  systemConfidence: z.number().min(0).max(1),
  aboveThresholdPct: z.number().min(0).max(1),
  activeAugmentation: z.number().int().nonnegative(),
  placementMatchedPct: z.number().min(0).max(1),
  signalsGenerated: z.number().int().nonnegative(),
});

export const WeakCluster = z.object({
  cluster: ClusterCode,
  name: z.string(),
  pctBelow: z.number().min(0).max(1),
  severityIndex: z.number(),
  confidence: z.number().min(0).max(1).nullable(),
  suppressed: z.boolean(),
});

export const TrackReadiness = z.object({
  trackId: z.string(),
  trackName: z.string(),
  learners: z.number().int(),
  abovePct: z.number().min(0).max(1),
  nearPct: z.number().min(0).max(1),
  belowPct: z.number().min(0).max(1),
});

export const SignalMatrixCell = z.object({
  track: z.string(),
  cluster: ClusterCode,
  value: z.number().min(0).max(1).nullable(),
  band: z.enum(['green', 'amber', 'grey', 'suppressed']),
});

export const SignalMatrixResponse = z.object({
  tracks: z.array(z.string()),
  clusters: z.array(ClusterCode),
  cells: z.array(SignalMatrixCell),
});

export type KpiResponse = z.infer<typeof KpiResponse>;
export type WeakCluster = z.infer<typeof WeakCluster>;
export type TrackReadiness = z.infer<typeof TrackReadiness>;
export type SignalMatrixResponse = z.infer<typeof SignalMatrixResponse>;
