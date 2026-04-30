import { describe, it, expect } from 'vitest';
import {
  scoreWeighted,
  confidenceScore,
  freshness,
  bandFor,
  confidenceBand,
  readinessScore,
  matchScore,
  signalBandFor,
} from '../../src/services/competency/formulas.js';
import {
  DECAY,
  FRESHNESS_WINDOW_DAYS,
  CONFIDENCE_WEIGHTS,
  SUPPRESSION_THRESHOLD,
  BAND_TOLERANCE,
} from '../../src/services/competency/formulas.config.js';
import goldenProfiles from './formulas.golden.json' with { type: 'json' };

describe('scoreWeighted (0.8 decay)', () => {
  it('returns 0 for empty input', () => {
    expect(scoreWeighted([])).toBe(0);
  });
  it('equals the single value for n=1', () => {
    expect(scoreWeighted([80])).toBe(80);
  });
  it('weights the latest score highest', () => {
    // (0.8*60 + 1.0*80) / 1.8 = 71.111...
    expect(scoreWeighted([60, 80])).toBeCloseTo(71.111, 2);
  });
  it('produces stable values for 3 chronological scores', () => {
    // (0.64*50 + 0.8*60 + 1.0*80) / 2.44 ≈ 65.574
    expect(scoreWeighted([50, 60, 80])).toBeCloseTo(65.574, 2);
  });
});

describe('confidenceScore', () => {
  it('weights the 4 components exactly', () => {
    // 0.35*1 + 0.30*1 + 0.20*1 + 0.15*1 ≈ 1 (IEEE 754 multiplication yields 0.9999999999999999)
    expect(confidenceScore({ completeness: 1, stability: 1, sufficiency: 1, consistency: 1 })).toBeCloseTo(1, 10);
    // 0.35*0.5 + 0.30*1 + 0.20*0.33 + 0.15*1 = 0.175 + 0.3 + 0.066 + 0.15 = 0.691
    expect(confidenceScore({ completeness: 0.5, stability: 1, sufficiency: 0.33, consistency: 1 })).toBeCloseTo(0.691, 3);
  });
});

describe('freshness (180d window)', () => {
  it('is 1 on day zero', () => expect(freshness(0)).toBe(1));
  it('is 0.5 at 90 days', () => expect(freshness(90)).toBeCloseTo(0.5, 5));
  it('clamps to 0 beyond 180 days', () => expect(freshness(365)).toBe(0));
  it('treats null as 0', () => expect(freshness(null)).toBe(0));
});

describe('bandFor', () => {
  it('Above when >= threshold', () => expect(bandFor(70, 68)).toBe('Above'));
  it('Near within 5 points below', () => expect(bandFor(65, 68)).toBe('Near'));
  it('Below when > 5 points under', () => expect(bandFor(55, 68)).toBe('Below'));
});

describe('confidenceBand (suppression < 0.30)', () => {
  it('suppresses < 0.30', () => expect(confidenceBand(0.25)).toBe('suppressed'));
  it('grey on [0.30, 0.40)',  () => expect(confidenceBand(0.35)).toBe('grey'));
  it('amber on [0.40, 0.70)', () => expect(confidenceBand(0.55)).toBe('amber'));
  it('green on >= 0.70',      () => expect(confidenceBand(0.72)).toBe('green'));
  it('null → grey',           () => expect(confidenceBand(null)).toBe('grey'));
});

describe('readinessScore', () => {
  it('sum of score × weight', () => {
    const result = readinessScore([
      { scoreWeighted: 80, weight: 0.5 },
      { scoreWeighted: 60, weight: 0.5 },
    ]);
    expect(result).toBe(70);
  });
});

describe('matchScore', () => {
  it('caps at the target and normalises by weight', () => {
    const result = matchScore([
      { scoreWeighted: 100, target: 80, weight: 1 }, // min(100,80)/80 = 1
      { scoreWeighted: 40,  target: 80, weight: 1 }, // 40/80 = 0.5
    ]);
    expect(result).toBeCloseTo(0.75, 5);
  });
});

describe('formulas constants (BC 2)', () => {
  it('DECAY === 0.8', () => {
    expect(DECAY).toBe(0.8);
  });
  it('FRESHNESS_WINDOW_DAYS === 180', () => {
    expect(FRESHNESS_WINDOW_DAYS).toBe(180);
  });
  it('CONFIDENCE_WEIGHTS sum to 1.0', () => {
    const sum =
      CONFIDENCE_WEIGHTS.completeness +
      CONFIDENCE_WEIGHTS.stability +
      CONFIDENCE_WEIGHTS.sufficiency +
      CONFIDENCE_WEIGHTS.consistency;
    expect(sum).toBeCloseTo(1.0, 10);
  });
  it('CONFIDENCE_WEIGHTS.completeness === 0.35', () => {
    expect(CONFIDENCE_WEIGHTS.completeness).toBe(0.35);
  });
  it('CONFIDENCE_WEIGHTS.stability === 0.30', () => {
    expect(CONFIDENCE_WEIGHTS.stability).toBe(0.30);
  });
  it('CONFIDENCE_WEIGHTS.sufficiency === 0.20', () => {
    expect(CONFIDENCE_WEIGHTS.sufficiency).toBe(0.20);
  });
  it('CONFIDENCE_WEIGHTS.consistency === 0.15', () => {
    expect(CONFIDENCE_WEIGHTS.consistency).toBe(0.15);
  });
  it('SUPPRESSION_THRESHOLD === 0.30', () => {
    expect(SUPPRESSION_THRESHOLD).toBe(0.30);
  });
  it('BAND_TOLERANCE === 5', () => {
    expect(BAND_TOLERANCE).toBe(5);
  });
});

describe('formulas golden outputs (BC 3)', () => {
  for (const profile of goldenProfiles) {
    it(`scoreWeighted — ${profile.label}`, () => {
      const result = scoreWeighted(profile.scoreWeightedInput);
      expect(result).toBeCloseTo(profile.expectedScoreWeighted, 2);
    });
    it(`confidenceScore — ${profile.label}`, () => {
      const result = confidenceScore(profile.confidenceInput);
      expect(result).toBeCloseTo(profile.expectedConfidence, 3);
    });
  }
});

describe('signalBandFor (BC 4)', () => {
  it('0 → Emerging',   () => expect(signalBandFor(0)).toBe('Emerging'));
  it('54 → Emerging',  () => expect(signalBandFor(54)).toBe('Emerging'));
  it('55 → Developing',() => expect(signalBandFor(55)).toBe('Developing'));
  it('69 → Developing',() => expect(signalBandFor(69)).toBe('Developing'));
  it('70 → Proficient',() => expect(signalBandFor(70)).toBe('Proficient'));
  it('84 → Proficient',() => expect(signalBandFor(84)).toBe('Proficient'));
  it('85 → Advanced',  () => expect(signalBandFor(85)).toBe('Advanced'));
  it('100 → Advanced', () => expect(signalBandFor(100)).toBe('Advanced'));
});
