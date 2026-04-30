/**
 * Unit tests for gapIntelService sub-topic ordering logic.
 * The service sorts sub-topics weakest-first (ascending mastery).
 * These tests verify the underlying subtopicMastery helper and ordering behaviour.
 * Zero DB / external calls.
 */
import { describe, it, expect } from 'vitest';
import { subtopicMastery } from '../../../src/services/talent/helpers.js';

describe('subtopicMastery — determinism', () => {
  it('same inputs produce same output', () => {
    const m1 = subtopicMastery('learner-1', 'C1.BIG-O', 75);
    const m2 = subtopicMastery('learner-1', 'C1.BIG-O', 75);
    expect(m1).toBe(m2);
  });

  it('output is in [0, 1]', () => {
    for (const score of [0, 25, 50, 75, 100]) {
      const m = subtopicMastery('learner-abc', 'C2.DP', score);
      expect(m).toBeGreaterThanOrEqual(0);
      expect(m).toBeLessThanOrEqual(1);
    }
  });

  it('higher cluster score yields higher mastery for same learner+topic', () => {
    const mLow = subtopicMastery('learner-1', 'C1.BIG-O', 10);
    const mMid = subtopicMastery('learner-1', 'C1.BIG-O', 55);
    const mHigh = subtopicMastery('learner-1', 'C1.BIG-O', 95);
    expect(mMid).toBeGreaterThan(mLow);
    expect(mHigh).toBeGreaterThan(mMid);
  });

  it('different subtopicCodes produce different masteries (almost always)', () => {
    const codes = ['C1.BIG-O', 'C1.HASH', 'C1.GRAPH', 'C1.SORT', 'C1.TREE'];
    const masteries = codes.map((c) => subtopicMastery('learner-xyz', c, 60));
    const unique = new Set(masteries.map((m) => m.toFixed(6)));
    // With 5 different codes and a hash-based jitter, virtually certain they differ
    expect(unique.size).toBeGreaterThan(1);
  });
});

describe('gapIntelService — subtopic ordering (weakest first)', () => {
  it('sort ascending by mastery puts lowest mastery first', () => {
    const learnerId = 'l-order-test';
    const clusterScore = 55;
    const codes = ['C1.A', 'C1.B', 'C1.C', 'C1.D'];
    const subtopics = codes.map((code) => ({
      code,
      mastery: subtopicMastery(learnerId, code, clusterScore),
    }));
    const sorted = [...subtopics].sort((a, b) => a.mastery - b.mastery);

    // First item must have the smallest mastery
    const minMastery = Math.min(...subtopics.map((s) => s.mastery));
    expect(sorted[0].mastery).toBe(minMastery);

    // Array is non-decreasing
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i].mastery).toBeGreaterThanOrEqual(sorted[i - 1].mastery);
    }
  });

  it('weakest-first ordering is stable across identical mastery values', () => {
    // When all scores are 0, all masteries are 0 → sort is stable (order preserved)
    const codes = ['C1.X', 'C1.Y', 'C1.Z'];
    const subtopics = codes.map((code) => ({
      code,
      mastery: subtopicMastery('learner-zero', code, 0),
    }));
    // All masteries are 0 (0/100 * jitter = 0)
    for (const s of subtopics) {
      expect(s.mastery).toBe(0);
    }
    const sorted = [...subtopics].sort((a, b) => a.mastery - b.mastery);
    expect(sorted.map((s) => s.code)).toEqual(codes); // stable — same order
  });
});
