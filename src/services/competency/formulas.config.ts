/**
 * Canonical configuration for GradiumOS competency formulas.
 * All formula constants live here — consumers import from this file.
 * formulasVersion bumps when any constant or formula definition changes.
 */

export const formulasVersion = '1.2';

export const DECAY = 0.8;
export const FRESHNESS_WINDOW_DAYS = 180;

export const CONFIDENCE_WEIGHTS = {
  completeness: 0.35,
  stability:    0.30,
  sufficiency:  0.20,
  consistency:  0.15,
} as const;

/** Clusters with confidence below this threshold are suppressed from signal payloads. */
export const SUPPRESSION_THRESHOLD = 0.30;

/** ±BAND_TOLERANCE points around a threshold defines the "Near" band. */
export const BAND_TOLERANCE = 5;
