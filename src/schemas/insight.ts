import { z } from 'zod';
import { Band, ClusterCode, Archetype } from './common.js';

const BandDist = {
  abovePct: z.number().min(0).max(1),
  nearPct: z.number().min(0).max(1),
  belowPct: z.number().min(0).max(1),
};

export const MarketMovementNote = z.object({
  cluster: ClusterCode,
  clusterName: z.string(),
  deltaPts: z.number(),
  reason: z.string(),
});

export const HighestLeverageGap = z
  .object({
    cluster: ClusterCode,
    name: z.string(),
    pctBelow: z.number().min(0).max(1),
    severityIndex: z.number(),
  })
  .nullable();

export const ArchetypeReadinessRow = z.object({
  code: z.enum(['premium', 'massrecruiter', 'service']),
  label: z.string(),
  readiness: z.number(),
  confidence: z.number().min(0).max(1),
  peerMedian: z.number(),
  threshold: z.number(),
  learnersInArchetype: z.number().int().nonnegative(),
});

export const TrackInsightRow = z.object({
  trackId: z.string(),
  trackName: z.string(),
  archetype: Archetype,
  learners: z.number().int().nonnegative(),
  readinessScore: z.number(),
  ...BandDist,
  marketP50: z.number(),
  velocityPtsPerWeek: z.number(),
  velocityDeltaPts: z.number(),
  confidence: z.number().min(0).max(1),
  criticalGaps: z.array(ClusterCode),
  archetypes: z.array(ArchetypeReadinessRow),
});

export const TracksInsightResponse = z.object({
  rows: z.array(TrackInsightRow),
  summary: z.object({
    abovePct: z.number().min(0).max(1),
    criticalGaps: z.number().int().nonnegative(),
    systemConfidence: z.number().min(0).max(1),
    marketMovement: MarketMovementNote,
    cohortClosingVelocityAvg: z.number(),
    cohortClosingVelocityPrev: z.number(),
    highestLeverageGap: HighestLeverageGap,
    avgThreshold: z.number(),
    marketP50: z.number(),
  }),
});

export const CohortInsightRow = z.object({
  cohortId: z.string(),
  cohortName: z.string(),
  trackId: z.string(),
  trackName: z.string(),
  archetype: Archetype,
  learners: z.number().int().nonnegative(),
  readinessScore: z.number(),
  ...BandDist,
  marketP50: z.number(),
  velocityPtsPerWeek: z.number(),
  confidence: z.number().min(0).max(1),
});

export const CohortsInsightResponse = z.object({
  rows: z.array(CohortInsightRow),
  summary: z.object({
    totalCohorts: z.number().int().nonnegative(),
    aboveMarketCount: z.number().int().nonnegative(),
    fastest: z
      .object({ cohortName: z.string(), velocityPtsPerWeek: z.number() })
      .nullable(),
    stalled: z
      .object({ cohortName: z.string(), velocityPtsPerWeek: z.number() })
      .nullable(),
    marketP50: z.number(),
  }),
});

export const LearnerInsightRow = z.object({
  id: z.string(),
  name: z.string(),
  trackName: z.string(),
  cohortName: z.string(),
  readinessScore: z.number(),
  band: Band,
  velocityPtsPerWeek: z.number(),
  signalReady: z.boolean(),
});

export const LearnersInsightResponse = z.object({
  summary: z.object({
    totalSelected: z.number().int().nonnegative(),
    ...BandDist,
    signalsGenerated: z.number().int().nonnegative(),
    activeAugmentation: z.number().int().nonnegative(),
    assessmentRate: z.number().min(0).max(1),
    fastestVelocityPtsPerWeek: z.number(),
    fastestCohortName: z.string().nullable(),
    stalledCount: z.number().int().nonnegative(),
    nearSignalThresholdCount: z.number().int().nonnegative(),
  }),
  sample: z.array(LearnerInsightRow),
});

export type TracksInsightResponse = z.infer<typeof TracksInsightResponse>;
export type CohortsInsightResponse = z.infer<typeof CohortsInsightResponse>;
export type LearnersInsightResponse = z.infer<typeof LearnersInsightResponse>;
export type TrackInsightRow = z.infer<typeof TrackInsightRow>;
export type CohortInsightRow = z.infer<typeof CohortInsightRow>;
export type LearnerInsightRow = z.infer<typeof LearnerInsightRow>;
export type ArchetypeReadinessRow = z.infer<typeof ArchetypeReadinessRow>;
