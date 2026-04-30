/**
 * demandService — aggregates employer-role demand into career-track-level
 * signal. This is the "shared vocabulary" between Workforce, Campus, and
 * Talent: Workforce defines roles → we average to track demand → Campus
 * sees what their tracks need to teach to → Talent sees the goal-state.
 *
 * Aggregation rules (per Uday's architecture review):
 *   - SEAT-WEIGHTED average (a 1500-seat Cognizant role weighs more than a
 *     2-seat boutique role)
 *   - RECENCY decay (older JDs get lower weight; halflife ~180 days)
 *   - Only `active` roles count
 *   - Only roles with extracted JD data (clusterTargets non-empty) count
 *
 * Output shape: { clusterTargets: { C1..C8: 0..100 }, sampleSize, totalSeats,
 * topEmployers: [...], lastRefreshedAt }
 *
 * IP note: this only outputs aggregated cluster targets — never per-employer
 * weights, formula constants, or thresholds. Safe to send to Talent + Campus.
 */
import type { ClusterCode } from '@prisma/client';
import { prisma } from '../../config/db.js';
import { ALL_CLUSTERS } from '../talent/helpers.js';

// Recency decay halflife in days. Tunable later; not in the frozen IP table.
const RECENCY_HALFLIFE_DAYS = 180;

export interface AggregatedDemand {
  careerTrackId:    string;
  careerTrackName:  string;
  clusterTargets:   Record<ClusterCode, number>;   // 0..100, seat+recency weighted
  sampleSize:       number;                          // count of contributing roles
  totalSeats:       number;
  topEmployers:     { name: string; roleCount: number; seatTotal: number }[];
  lastRefreshedAt:  Date;
}

function recencyWeight(date: Date | null | undefined, now: Date): number {
  if (!date) return 0.3; // unknown date → low weight, but not zero
  const ageDays = Math.max(0, (now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
  // Exponential decay: weight = 0.5 ^ (age / halflife)
  return Math.pow(0.5, ageDays / RECENCY_HALFLIFE_DAYS);
}

function isClusterMap(v: unknown): v is Record<string, number> {
  if (!v || typeof v !== 'object') return false;
  const keys = Object.keys(v as Record<string, unknown>);
  return ALL_CLUSTERS.every((c) => typeof (v as Record<string, unknown>)[c] === 'number');
}

/** Aggregate demand for ONE career track. Accepts either a global CareerTrack id
 *  OR an institution-scoped Track id (the Campus portal exposes Track ids; the
 *  Workforce portal exposes CareerTrack ids — both flow into this function). */
export async function aggregateDemandForTrack(idMaybeTrackOrCareer: string): Promise<AggregatedDemand> {
  // Try CareerTrack first (Workforce-side, employer-roles linked directly to it)
  let track: { id: string; name: string; clusterTargets: unknown } | null = await prisma.careerTrack.findUnique({
    where: { id: idMaybeTrackOrCareer },
    select: { id: true, name: true, clusterTargets: true },
  });
  if (!track) {
    // Fall back: maybe it's an institution Track id; resolve to its CareerTrack
    const t = await prisma.track.findUnique({
      where: { id: idMaybeTrackOrCareer },
      select: { careerTrackId: true, careerTrack: { select: { id: true, name: true, clusterTargets: true } } },
    });
    if (t?.careerTrack) track = t.careerTrack;
  }
  if (!track) throw new Error(`Career track or institution track ${idMaybeTrackOrCareer} not found`);
  const careerTrackId = track.id;
  const canonicalTargets = (track.clusterTargets as Record<string, number> | null) ?? {};

  const roles = await prisma.employerRole.findMany({
    where: { careerTrackId, status: 'active' },
    select: {
      id: true,
      seatsPlanned: true,
      clusterTargets: true,
      jdUploadedAt: true,
      createdAt: true,
      employer: { select: { name: true } },
    },
  });

  // Filter to roles with valid extracted clusterTargets (skip ones with empty {} from before JD upload)
  const usable = roles.filter((r) => isClusterMap(r.clusterTargets));

  const now = new Date();
  // Per-cluster running weighted sum + total weight
  const sums: Record<ClusterCode, { sum: number; w: number }> = ALL_CLUSTERS.reduce(
    (acc, c) => { acc[c] = { sum: 0, w: 0 }; return acc; },
    {} as Record<ClusterCode, { sum: number; w: number }>,
  );

  let totalSeats = 0;
  const employerStats = new Map<string, { roleCount: number; seatTotal: number }>();

  for (const r of usable) {
    const seats = Math.max(1, r.seatsPlanned);
    const dateForRecency = r.jdUploadedAt ?? r.createdAt;
    const recency = recencyWeight(dateForRecency, now);
    const weight = seats * recency;

    const targets = r.clusterTargets as Record<string, number>;
    for (const cc of ALL_CLUSTERS) {
      sums[cc].sum += (targets[cc] ?? 0) * weight;
      sums[cc].w   += weight;
    }
    totalSeats += seats;

    const empName = r.employer.name;
    const cur = employerStats.get(empName) ?? { roleCount: 0, seatTotal: 0 };
    employerStats.set(empName, { roleCount: cur.roleCount + 1, seatTotal: cur.seatTotal + seats });
  }

  // Compute weighted means; if no usable data for a cluster, fall back to the
  // canonical clusterTargets baked into the CareerTrack at seed time. This
  // keeps the platform USABLE on day 1 — every learner sees a meaningful
  // demand profile even before any employer has posted a role. sampleSize
  // remains 0 so callers know it's the canonical baseline, not live data.
  const clusterTargets = ALL_CLUSTERS.reduce((acc, cc) => {
    acc[cc] = sums[cc].w > 0
      ? Math.round(sums[cc].sum / sums[cc].w)
      : Math.round((canonicalTargets[cc] as number | undefined) ?? 0);
    return acc;
  }, {} as Record<ClusterCode, number>);

  const topEmployers = Array.from(employerStats.entries())
    .map(([name, s]) => ({ name, ...s }))
    .sort((a, b) => b.seatTotal - a.seatTotal)
    .slice(0, 5);

  return {
    careerTrackId:   track.id,
    careerTrackName: track.name,
    clusterTargets,
    sampleSize:      usable.length,
    totalSeats,
    topEmployers,
    lastRefreshedAt: now,
  };
}

/** Aggregate demand across ALL active career tracks. Used for Talent's
 *  career-track recommendation: we match the learner's resume profile to
 *  every track's demand and rank by fit. */
export async function aggregateDemandAcrossTracks(): Promise<AggregatedDemand[]> {
  const tracks = await prisma.careerTrack.findMany({ select: { id: true } });
  const out: AggregatedDemand[] = [];
  for (const t of tracks) {
    out.push(await aggregateDemandForTrack(t.id));
  }
  return out;
}
