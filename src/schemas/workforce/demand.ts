import { z } from 'zod';
import { ClusterCode } from '../common.js';

export const DemandSubmitBody = z.object({
  careerTrackId: z.string().min(1),
  clusterCode: ClusterCode,
  targetScore: z.number().int().min(0).max(100),
});

export type DemandSubmitBody = z.infer<typeof DemandSubmitBody>;
