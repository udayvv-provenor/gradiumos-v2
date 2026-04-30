import { describe, it, expect } from 'vitest';
import { SUPPRESSION_THRESHOLD } from '../../src/services/competency/formulas.config.js';

describe('signalPayload suppression (BC 5)', () => {
  function buildSignalPayload(clusterScores: { cluster: string; score: number; confidence: number }[]) {
    return clusterScores.filter(c => c.confidence >= SUPPRESSION_THRESHOLD);
  }

  it('excludes clusters with confidence < 0.30', () => {
    const scores = [
      { cluster: 'C1', score: 70, confidence: 0.29 },
      { cluster: 'C2', score: 80, confidence: 0.30 },
    ];
    const payload = buildSignalPayload(scores);
    expect(payload).toHaveLength(1);
    expect(payload[0].cluster).toBe('C2');
  });

  it('includes clusters with confidence === 0.30', () => {
    const scores = [{ cluster: 'C1', score: 70, confidence: 0.30 }];
    const payload = buildSignalPayload(scores);
    expect(payload).toHaveLength(1);
  });

  it('returns empty array when all clusters suppressed', () => {
    const scores = [
      { cluster: 'C1', score: 70, confidence: 0.29 },
      { cluster: 'C2', score: 60, confidence: 0.10 },
    ];
    expect(buildSignalPayload(scores)).toHaveLength(0);
  });
});
