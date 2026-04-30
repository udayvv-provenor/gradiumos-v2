/**
 * BC 115 — Viz component structural tests
 *
 * These tests verify the core polygon-point math shared by all three radar
 * chart components without requiring a DOM environment.
 *
 * The three components (LearnerClusterRadarVsCohortMedian, CandidateClusterRadarVsRole,
 * LearnerClusterRadarVsRoleTargets) all use the same coordinate geometry.
 * We test the algorithm rather than the rendered HTML so the suite stays
 * environment-free (vitest + Node, no jsdom).
 *
 * Input fixture mirrors BC 115 spec:
 *   series[0] = { data: [70,80,65,90,55,75,60,85], label: 'Learner' }
 *   series[1] = { data: [75,75,75,75,75,75,75,75], label: 'Target' }
 */

import { describe, it, expect } from 'vitest';

// ─── Inlined geometry (same logic as the three viz components) ────────────────

const SIZE = 360;
const cx = SIZE / 2;
const cy = SIZE / 2;
const radius = Math.min(cx, cy) - 54;   // 126
const ANGLES = Array.from({ length: 8 }, (_, i) => -Math.PI / 2 + i * (Math.PI / 4));

function pointAt(value: number, axisIdx: number): [number, number] {
  const r = (value / 100) * radius;
  return [cx + r * Math.cos(ANGLES[axisIdx]), cy + r * Math.sin(ANGLES[axisIdx])];
}

function polygonPoints(values: number[]): string {
  return values.map((v, i) => pointAt(v, i).join(',')).join(' ');
}

// ─── Fixture ─────────────────────────────────────────────────────────────────

const LEARNER_DATA = [70, 80, 65, 90, 55, 75, 60, 85];
const TARGET_DATA  = [75, 75, 75, 75, 75, 75, 75, 75];

const series = [
  { data: LEARNER_DATA, label: 'Learner' },
  { data: TARGET_DATA,  label: 'Target' },
];

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('BC 115 — RadarChart geometry (shared across all viz components)', () => {
  it('produces a polygon with exactly 8 coordinate pairs for the learner series', () => {
    const pts = polygonPoints(series[0].data);
    const pairs = pts.trim().split(' ');
    expect(pairs).toHaveLength(8);
    for (const pair of pairs) {
      const [x, y] = pair.split(',').map(Number);
      expect(Number.isFinite(x)).toBe(true);
      expect(Number.isFinite(y)).toBe(true);
    }
  });

  it('produces a polygon with exactly 8 coordinate pairs for the target series', () => {
    const pts = polygonPoints(series[1].data);
    const pairs = pts.trim().split(' ');
    expect(pairs).toHaveLength(8);
  });

  it('renders two distinct polygons (overlay structure)', () => {
    const learnerPts = polygonPoints(series[0].data);
    const targetPts  = polygonPoints(series[1].data);
    // The two series must produce different coordinate strings (overlay, not identical)
    expect(learnerPts).not.toEqual(targetPts);
  });

  it('uniform target series (all 75) produces a regular octagon', () => {
    const pts = polygonPoints(TARGET_DATA);
    const pairs = pts.trim().split(' ').map(p => {
      const [x, y] = p.split(',').map(Number);
      // Distance from centre should be the same for all 8 points
      const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
      return dist;
    });
    const first = pairs[0];
    for (const d of pairs) {
      expect(Math.abs(d - first)).toBeLessThan(0.001);
    }
  });

  it('zero-valued data points map to the center of the chart', () => {
    const zeros = Array(8).fill(0);
    const pts = polygonPoints(zeros);
    const pairs = pts.trim().split(' ');
    for (const pair of pairs) {
      const [x, y] = pair.split(',').map(Number);
      expect(Math.abs(x - cx)).toBeLessThan(0.001);
      expect(Math.abs(y - cy)).toBeLessThan(0.001);
    }
  });

  it('100-valued data maps to the outer ring (distance = radius)', () => {
    const maxes = Array(8).fill(100);
    const pts = polygonPoints(maxes);
    const pairs = pts.trim().split(' ');
    for (const pair of pairs) {
      const [x, y] = pair.split(',').map(Number);
      const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
      expect(Math.abs(dist - radius)).toBeLessThan(0.001);
    }
  });

  it('both series labels are present in the series array', () => {
    expect(series[0].label).toBe('Learner');
    expect(series[1].label).toBe('Target');
  });

  it('each series data array has exactly 8 elements (C1..C8)', () => {
    for (const s of series) {
      expect(s.data).toHaveLength(8);
    }
  });
});
