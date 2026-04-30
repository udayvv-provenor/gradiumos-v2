import { z } from 'zod';
import { Archetype } from './common.js';

export const PlacementKpis = z.object({
  placedCount: z.number().int().nonnegative(),
  readyEligible: z.number().int().nonnegative(),
  placementRate: z.number().min(0).max(1),
  matchRate: z.number().min(0).max(1),
  avgSalaryLpa: z.number().nonnegative(),
});

export const PlacementDonutSlice = z.object({
  archetype: Archetype,
  count: z.number().int().nonnegative(),
  pct: z.number().min(0).max(1),
});

export const PlacementScatterPoint = z.object({
  learnerId: z.string(),
  learnerName: z.string(),
  readinessScore: z.number().min(0).max(100),
  matchScore: z.number().min(0).max(1),
  placed: z.boolean(),
  archetype: Archetype.nullable(),
  company: z.string().nullable(),
});

export const PlacementByBand = z.object({
  band: z.enum(['Above', 'Near', 'Below']),
  eligible: z.number().int().nonnegative(),
  placed: z.number().int().nonnegative(),
  placementRate: z.number().min(0).max(1),
});

export const PlacementRow = z.object({
  learnerId: z.string(),
  learnerName: z.string(),
  trackName: z.string(),
  archetype: Archetype,
  company: z.string(),
  salaryLpa: z.number().nonnegative(),
  readinessScore: z.number().min(0).max(100),
  matchScore: z.number().min(0).max(1),
  placedAt: z.string(),
});

export const PlacementAlignmentResponse = z.object({
  kpis: PlacementKpis,
  donut: z.array(PlacementDonutSlice),
  scatter: z.array(PlacementScatterPoint),
  byBand: z.array(PlacementByBand),
  placements: z.array(PlacementRow),
});

export type PlacementAlignmentResponse = z.infer<typeof PlacementAlignmentResponse>;
