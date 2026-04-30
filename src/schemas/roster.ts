import { z } from 'zod';
import { Band, ClusterCode, PaginationQuery } from './common.js';

export const RosterQuery = PaginationQuery.extend({
  q: z.string().optional(),
  band: Band.optional(),
  trackId: z.string().optional(),
  caeStatus: z.enum(['active', 'none']).optional(),
});

export const LearnerRow = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  trackName: z.string(),
  cohortName: z.string(),
  band: Band,
  readinessScore: z.number().min(0).max(100),
  signalGenerated: z.boolean(),
  activeAugmentations: z.number().int().nonnegative(),
  lastAssessedAt: z.string().nullable(),
});

export const RosterResponse = z.object({
  items: z.array(LearnerRow),
  page: z.number().int(),
  pageSize: z.number().int(),
  total: z.number().int(),
});

export const ClusterDetail = z.object({
  cluster: ClusterCode,
  name: z.string(),
  score: z.number().min(0).max(100).nullable(),
  threshold: z.number().min(0).max(100),
  confidence: z.number().min(0).max(1).nullable(),
  freshness: z.number().min(0).max(1).nullable(),
  band: Band.nullable(),
  suppressed: z.boolean(),
  attempts: z.number().int().nonnegative(),
});

export const LearnerDetail = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  trackName: z.string(),
  cohortName: z.string(),
  clusters: z.array(ClusterDetail),
  readinessScore: z.number().min(0).max(100),
  signalGenerated: z.boolean(),
});

export type RosterResponse = z.infer<typeof RosterResponse>;
export type LearnerDetail = z.infer<typeof LearnerDetail>;
