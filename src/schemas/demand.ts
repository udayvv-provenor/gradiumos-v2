import { z } from 'zod';
import { Archetype, ClusterCode } from './common.js';

export const DemandCell = z.object({
  cluster: ClusterCode,
  archetype: Archetype,
  demandPct: z.number().min(0).max(1),
  coveragePct: z.number().min(0).max(1),
  gapPct: z.number(),
  band: z.enum(['ok', 'at_risk', 'critical']),
});

export const DemandClusterMeta = z.object({
  code: ClusterCode,
  name: z.string(),
  shortName: z.string(),
});

export const DemandResponse = z.object({
  archetypes: z.array(Archetype),
  clusters: z.array(DemandClusterMeta),
  cells: z.array(DemandCell),
  gapsByArchetype: z.record(Archetype, z.array(z.string())),
});

export type DemandResponse = z.infer<typeof DemandResponse>;
export type DemandCell = z.infer<typeof DemandCell>;
