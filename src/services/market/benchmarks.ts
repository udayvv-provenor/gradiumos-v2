import type { ClusterCode } from '@prisma/client';

/**
 * Market benchmarks — peer-institution median readiness per cluster this term
 * and previous term. Used for "vs market" comparisons on the Overview insight
 * panel. Values are curated representative medians from the Brand Lexicon
 * reference data; in production these would be sourced from the recruiter
 * signal aggregator.
 */
export const MARKET_P50: Record<ClusterCode, number> = {
  C1: 62,
  C2: 60,
  C3: 58,
  C4: 56,
  C5: 62,
  C6: 54,
  C7: 57,
  C8: 58,
};

export const MARKET_P50_PREV: Record<ClusterCode, number> = {
  C1: 60,
  C2: 56,
  C3: 57,
  C4: 55,
  C5: 61,
  C6: 52,
  C7: 55,
  C8: 56,
};

export interface MarketMovementNote {
  cluster: ClusterCode;
  clusterName: string;
  deltaPts: number;
  reason: string;
}

export const MARKET_MOVEMENT_NOTE: MarketMovementNote = {
  cluster: 'C2',
  clusterName: 'Applied Problem Solving',
  deltaPts: 4,
  reason: 'Product archetype raised bar',
};

export function marketP50Mean(): number {
  const vals = Object.values(MARKET_P50);
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}
