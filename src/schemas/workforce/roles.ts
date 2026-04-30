import { z } from 'zod';
import { ClusterCode } from '../common.js';

const ClusterTargetTriplet = z.object({
  min: z.number().min(0).max(100),
  target: z.number().min(40).max(100),
  stretch: z.number().min(0).max(100),
});

export const ClusterWeightsMap = z.record(ClusterCode, z.number().min(0).max(1));
export const ClusterTargetsMap = z.record(ClusterCode, z.union([z.number().min(0).max(100), ClusterTargetTriplet]));

/**
 * v3.1 — `clusterWeights` and `clusterTargets` are no longer asked of the TA
 * Lead at role-creation time. NO TA knows what "C1 weight 0.18" means; that's
 * GradiumOS internal taxonomy. Both fields default to the parent CareerTrack's
 * weights/targets at creation, then get overwritten by Groq when the JD lands.
 *
 * Advanced users can still send them via this same endpoint (kept optional)
 * for the override path — but the UI hides the editor by default.
 */
export const RoleCreateBody = z.object({
  careerTrackId: z.string().min(1),
  title: z.string().min(2).max(200),
  seatsPlanned: z.number().int().min(1).max(500).optional(),
  clusterWeights: ClusterWeightsMap.optional(),
  clusterTargets: ClusterTargetsMap.optional(),
});

export const RoleUpdateBody = z.object({
  title: z.string().min(2).max(200).optional(),
  seatsPlanned: z.number().int().min(1).max(500).optional(),
  status: z.enum(['active', 'paused', 'closed']).optional(),
  clusterWeights: ClusterWeightsMap.optional(),
  clusterTargets: ClusterTargetsMap.optional(),
});

export const RoleIdParam = z.object({ id: z.string().min(1) });

export type RoleCreateBody = z.infer<typeof RoleCreateBody>;
export type RoleUpdateBody = z.infer<typeof RoleUpdateBody>;
