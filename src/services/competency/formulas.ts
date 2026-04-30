/**
 * Pure-function formulas from /Context §3C.
 * No side effects, no IO, no Prisma. Deterministic for identical inputs.
 * These are the canonical implementations used by every consumer.
 *
 * Constants are sourced from formulas.config.ts (single source of truth).
 */

export { DECAY, FRESHNESS_WINDOW_DAYS, SUPPRESSION_THRESHOLD as SUPPRESSION_CONFIDENCE } from './formulas.config.js';
import { DECAY, FRESHNESS_WINDOW_DAYS, SUPPRESSION_THRESHOLD } from './formulas.config.js';

export const GREY_UPPER = 0.40;
export const AMBER_UPPER = 0.70;

export type BandLabel = 'Below' | 'Near' | 'Above';
export type ConfidenceBand = 'green' | 'amber' | 'grey' | 'suppressed';

/**
 * score_weighted = Σ(score_norm[i] * 0.8^(n-i)) / Σ(0.8^(n-i))
 * scoresNormChronological: oldest → newest. Returns 0..100. Empty → 0.
 */
export function scoreWeighted(scoresNormChronological: number[]): number {
  const n = scoresNormChronological.length;
  if (n === 0) return 0;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    const w = Math.pow(DECAY, n - 1 - i);
    num += scoresNormChronological[i] * w;
    den += w;
  }
  return den === 0 ? 0 : num / den;
}

/**
 * completeness = fraction of expected clusters assessed at least once.
 */
export function completeness(clustersAssessed: number, clustersExpected: number): number {
  if (clustersExpected <= 0) return 0;
  return clamp01(clustersAssessed / clustersExpected);
}

/**
 * stability = 1 − (stdDev(recent scoreNorm) / 50), clamped 0..1.
 * Uses up to last 5 attempts.
 */
export function stability(recentScoresNorm: number[]): number {
  if (recentScoresNorm.length < 2) return recentScoresNorm.length === 1 ? 0.6 : 0;
  const last = recentScoresNorm.slice(-5);
  const mean = last.reduce((a, b) => a + b, 0) / last.length;
  const variance = last.reduce((a, b) => a + (b - mean) ** 2, 0) / last.length;
  const sd = Math.sqrt(variance);
  return clamp01(1 - sd / 50);
}

/**
 * sufficiency = min(attempts / target, 1). Target = 3 attempts.
 */
export function sufficiency(attempts: number, target = 3): number {
  if (target <= 0) return 0;
  return clamp01(attempts / target);
}

/**
 * consistency = 1 − |latest − weightedMean| / 100
 */
export function consistency(scoresNormChronological: number[]): number {
  if (scoresNormChronological.length === 0) return 0;
  const latest = scoresNormChronological[scoresNormChronological.length - 1];
  const w = scoreWeighted(scoresNormChronological);
  return clamp01(1 - Math.abs(latest - w) / 100);
}

/**
 * confidence = 0.35·completeness + 0.30·stability + 0.20·sufficiency + 0.15·consistency
 */
export function confidenceScore(parts: {
  completeness: number;
  stability: number;
  sufficiency: number;
  consistency: number;
}): number {
  return clamp01(
    0.35 * parts.completeness +
    0.30 * parts.stability +
    0.20 * parts.sufficiency +
    0.15 * parts.consistency,
  );
}

/**
 * freshness = max(0, 1 − daysSinceLastAttempt / 180)
 */
export function freshness(daysSinceLastAttempt: number | null): number {
  if (daysSinceLastAttempt === null || daysSinceLastAttempt < 0) return 0;
  return Math.max(0, 1 - daysSinceLastAttempt / FRESHNESS_WINDOW_DAYS);
}

/**
 * gap = threshold − scoreWeighted (positive = below threshold).
 */
export function gap(scoreWeightedValue: number, threshold: number): number {
  return threshold - scoreWeightedValue;
}

/**
 * severity = gap × weight (weight in 0..1).
 */
export function severity(gapValue: number, weight: number): number {
  return Math.max(0, gapValue) * weight;
}

/**
 * readiness = Σ(scoreWeighted_c × weight_c) — across all clusters.
 * weights must sum to 1.0 (we do not re-normalize).
 */
export function readinessScore(entries: { scoreWeighted: number; weight: number }[]): number {
  let acc = 0;
  for (const e of entries) acc += e.scoreWeighted * e.weight;
  return acc;
}

/**
 * match = Σ((min(scoreWeighted, target) / target) × weight_c)
 */
export function matchScore(
  entries: { scoreWeighted: number; target: number; weight: number }[],
): number {
  let num = 0;
  let den = 0;
  for (const e of entries) {
    if (e.target <= 0) continue;
    num += (Math.min(e.scoreWeighted, e.target) / e.target) * e.weight;
    den += e.weight;
  }
  return den === 0 ? 0 : clamp01(num / den);
}

/**
 * Band classification — uses threshold & a ±5 point tolerance for "Near".
 */
export function bandFor(scoreWeightedValue: number, threshold: number): BandLabel {
  if (scoreWeightedValue >= threshold) return 'Above';
  if (scoreWeightedValue >= threshold - 5) return 'Near';
  return 'Below';
}

/**
 * Confidence band with suppression rule (confidence < 0.30 → 'suppressed').
 */
export function confidenceBand(confidence: number | null): ConfidenceBand {
  if (confidence === null) return 'grey';
  if (confidence < SUPPRESSION_THRESHOLD) return 'suppressed';
  if (confidence < GREY_UPPER) return 'grey';
  if (confidence < AMBER_UPPER) return 'amber';
  return 'green';
}

/**
 * Signal band classification for a learner's weighted score.
 * Used in portable signal tokens and the public verifier endpoint.
 */
export type SignalBand = 'Emerging' | 'Developing' | 'Proficient' | 'Advanced';

export function signalBandFor(score: number): SignalBand {
  if (score >= 85) return 'Advanced';
  if (score >= 70) return 'Proficient';
  if (score >= 55) return 'Developing';
  return 'Emerging';
}

function clamp01(n: number): number {
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}
