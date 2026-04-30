/**
 * Workforce shared helpers — deterministic RNG (FNV-1a), velocity, and
 * utilities for parsing weight/target JSON stored on EmployerRole/CareerTrack.
 */
import type { ClusterCode } from '@prisma/client';

export function det01(id: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 10000) / 10000;
}

export function velocityFor(id: string, centre = 0.8, spread = 1.0): number {
  const v = centre - spread / 2 + det01(id) * spread;
  return Math.round(Math.max(0, v) * 10) / 10;
}

export const ALL_CLUSTERS: ClusterCode[] = ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8'];

export interface ClusterTarget {
  min: number;
  target: number;
  stretch: number;
}

export type WeightsMap = Partial<Record<ClusterCode, number>>;
export type TargetsMap = Partial<Record<ClusterCode, ClusterTarget>>;

/**
 * Parse the clusterTargets JSON on an EmployerRole. Accepts both
 * { C1: {min,target,stretch} } and { C1: 68 } shapes (CareerTrack defaults).
 */
export function parseTargets(raw: unknown): TargetsMap {
  if (!raw || typeof raw !== 'object') return {};
  const out: TargetsMap = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!ALL_CLUSTERS.includes(k as ClusterCode)) continue;
    if (typeof v === 'number') {
      out[k as ClusterCode] = { min: Math.max(0, v - 10), target: v, stretch: Math.min(100, v + 10) };
    } else if (v && typeof v === 'object') {
      const obj = v as Record<string, number>;
      const target = Number(obj.target ?? 60);
      out[k as ClusterCode] = {
        min: Number(obj.min ?? Math.max(0, target - 10)),
        target,
        stretch: Number(obj.stretch ?? Math.min(100, target + 10)),
      };
    }
  }
  return out;
}

export function parseWeights(raw: unknown): WeightsMap {
  if (!raw || typeof raw !== 'object') return {};
  const out: WeightsMap = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!ALL_CLUSTERS.includes(k as ClusterCode)) continue;
    const n = Number(v);
    if (Number.isFinite(n)) out[k as ClusterCode] = n;
  }
  return out;
}

export function weightsSum(w: WeightsMap): number {
  let s = 0;
  for (const c of ALL_CLUSTERS) s += w[c] ?? 0;
  return s;
}

export function round1(n: number): number { return Math.round(n * 10) / 10; }
export function round3(n: number): number { return Math.round(n * 1000) / 1000; }

export function bandForMatch(match01: number): 'Above' | 'Near' | 'Below' {
  if (match01 >= 0.70) return 'Above';
  if (match01 >= 0.60) return 'Near';
  return 'Below';
}

/**
 * Average of a value map across clusters (used for e.g. weighted-average role targets).
 */
export function meanTargets(targetsList: TargetsMap[]): TargetsMap {
  const acc: Record<ClusterCode, { sum: number; n: number }> = {} as Record<ClusterCode, { sum: number; n: number }>;
  for (const t of targetsList) {
    for (const c of ALL_CLUSTERS) {
      const v = t[c];
      if (!v) continue;
      if (!acc[c]) acc[c] = { sum: 0, n: 0 };
      acc[c].sum += v.target;
      acc[c].n += 1;
    }
  }
  const out: TargetsMap = {};
  for (const c of ALL_CLUSTERS) {
    const a = acc[c];
    if (!a || a.n === 0) continue;
    const tgt = a.sum / a.n;
    out[c] = { min: Math.max(0, tgt - 10), target: tgt, stretch: Math.min(100, tgt + 10) };
  }
  return out;
}

export function meanWeights(weightsList: WeightsMap[]): WeightsMap {
  if (weightsList.length === 0) return {};
  const acc: WeightsMap = {};
  for (const w of weightsList) {
    for (const c of ALL_CLUSTERS) acc[c] = (acc[c] ?? 0) + (w[c] ?? 0);
  }
  const total = weightsSum(acc);
  if (total === 0) return {};
  const out: WeightsMap = {};
  for (const c of ALL_CLUSTERS) out[c] = (acc[c] ?? 0) / total;
  return out;
}
