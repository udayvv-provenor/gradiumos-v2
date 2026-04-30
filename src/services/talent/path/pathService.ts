/**
 * pathService — the Talent-side counterpart to gapService. Implements:
 *
 *   1. uploadAndParseResume — accept raw resume text, run parseResume AI
 *      prompt, persist parsed profile to Learner.resumeProfile.
 *
 *   2. recommendCareerTracks — match learner's resumeProfile against
 *      aggregated demand of every career track; return top-3 with fit %.
 *
 *   3. computeThreeWayMap — for a given learner + career track, return
 *      per-cluster: current (resume), college-eventual (curriculum
 *      coverage projected), demand (aggregated). Plus the gap to close.
 *
 *   4. computeAugmentationPath — list of subtopics the AI should teach
 *      now to close the gap, distinguishing "college will eventually
 *      cover this" (so we teach it earlier as bridge content) from
 *      "college doesn't cover this at all" (we teach it permanently).
 */
import { createHash } from 'crypto';
import type { ClusterCode } from '@prisma/client';
import { prisma } from '../../../config/db.js';
import { ALL_CLUSTERS, loadSubtopics } from '../helpers.js';
import { parseResume, type ParsedResume } from '../../ai/prompts/parseResume.js';
import { aggregateDemandForTrack, aggregateDemandAcrossTracks, type AggregatedDemand } from '../../aggregation/demandService.js';
import { getLearnerIdOrThrow } from '../learnerContext.js';

const CLUSTER_NAMES: Record<ClusterCode, string> = {
  C1: 'Core Tech',                       C2: 'Applied Problem Solving',
  C3: 'Engineering Execution',           C4: 'System & Product Thinking',
  C5: 'Communication & Collaboration',   C6: 'Domain Specialisation',
  C7: 'Ownership & Judgment',            C8: 'Learning Agility',
};

/* ─── 1. Upload + parse resume ─────────────────────────────────────── */

export async function uploadAndParseResume(userId: string, rawText: string): Promise<{ parsed: ParsedResume; learnerId: string }> {
  const learnerId = await getLearnerIdOrThrow(userId);

  // v3.1.8 — input-hash dedup. Re-uploading the same resume (or pasting the
  // same text twice) returns the cached parse instead of paying Groq again.
  const resumeHash = createHash('sha256').update(`parseResume:${rawText}:v1`).digest('hex').slice(0, 16);
  let parsed: ParsedResume;
  const cached = await prisma.publicDataCache.findFirst({
    where: { stakeholderKind: 'talent', stakeholderId: learnerId, slot: 'resume-parse', contextHash: resumeHash },
  });
  if (cached && cached.expiresAt > new Date() && cached.payload) {
    parsed = cached.payload as ParsedResume;
  } else {
    const live = await parseResume(rawText);
    parsed = live.parsed;
    if (!live.meta.model.startsWith('mock-')) {
      try {
        await prisma.publicDataCache.upsert({
          where:  { stakeholderKind_stakeholderId_slot_contextHash: { stakeholderKind: 'talent', stakeholderId: learnerId, slot: 'resume-parse', contextHash: resumeHash } },
          update: { payload: parsed as unknown as object, retrievedAt: new Date(), expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000), fromFixture: false },
          create: { stakeholderKind: 'talent', stakeholderId: learnerId, slot: 'resume-parse', contextHash: resumeHash, payload: parsed as unknown as object, fromFixture: false, expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000) },
        });
      } catch { /* non-fatal */ }
    }
  }
  await prisma.learner.update({
    where: { id: learnerId },
    data: {
      uploadedResumeText: rawText,
      uploadedResumeAt:   new Date(),
      // resumeProfile typed as Json in Prisma — cast through unknown to satisfy strict typing
      resumeProfile:      parsed as unknown as object,
    },
  });
  return { parsed, learnerId };
}

export async function getResumeProfile(userId: string): Promise<ParsedResume | null> {
  const learnerId = await getLearnerIdOrThrow(userId);
  const l = await prisma.learner.findUnique({
    where: { id: learnerId },
    select: { resumeProfile: true },
  });
  return (l?.resumeProfile as ParsedResume | null) ?? null;
}

/* ─── 2. Recommend career tracks ───────────────────────────────────── */

export interface TrackRecommendation {
  careerTrackId:    string;
  careerTrackName:  string;
  fitPct:           number;          // 0..100 — overall fit
  topMatchedClusters: { code: string; resume: number; demand: number; fit: number }[];
  topGapClusters:     { code: string; resume: number; demand: number; gap: number }[];
  reasoning:        string;          // 1-line explanation
}

export async function recommendCareerTracks(userId: string): Promise<TrackRecommendation[]> {
  const profile = await getResumeProfile(userId);
  if (!profile) throw new Error('No resume profile yet — upload a resume first.');

  const allDemand = await aggregateDemandAcrossTracks();
  const recommendations: TrackRecommendation[] = [];

  // EMPTY-PLATFORM FALLBACK — when employers haven't posted roles yet, the
  // aggregated demand for every track is zeros. In that state, fall back to
  // the canonical clusterTargets baked into each CareerTrack at seed time
  // (the "what this track typically demands" baseline). Recommendations are
  // marked with a `usingFallback` reasoning so the UI knows it's not a live
  // employer signal yet. (Same fallback flips off once any employer posts.)
  const tracks = await prisma.careerTrack.findMany({
    select: { id: true, name: true, clusterTargets: true },
  });
  const tracksById = new Map(tracks.map((t) => [t.id, t]));

  for (const dem of allDemand) {
    const track = tracksById.get(dem.careerTrackId);
    const usingFallback = dem.sampleSize === 0;
    // Use seeded canonical targets when no live employer demand
    const effectiveTargets: Record<string, number> = usingFallback
      ? (track?.clusterTargets as Record<string, number> | null ?? {})
      : (dem.clusterTargets as Record<string, number>);

    const fits = ALL_CLUSTERS.map((cc) => {
      const resume = profile.clusterScores[cc] ?? 0;
      const demand = effectiveTargets[cc] ?? 0;
      const fit = demand === 0 ? 100 : Math.min(100, Math.round((resume / demand) * 100));
      const gap = Math.max(0, demand - resume);
      return { code: cc, resume, demand, fit, gap };
    });
    const denom = fits.filter((f) => f.demand > 0);
    const fitPct = denom.length === 0 ? 0 : Math.round(denom.reduce((acc, f) => acc + f.fit, 0) / denom.length);
    const topMatchedClusters = [...fits].filter((f) => f.demand > 0).sort((a, b) => b.fit - a.fit).slice(0, 3).map((f) => ({ code: f.code, resume: f.resume, demand: f.demand, fit: f.fit }));
    const topGapClusters     = [...fits].filter((f) => f.gap > 0).sort((a, b) => b.gap - a.gap).slice(0, 3).map((f) => ({ code: f.code, resume: f.resume, demand: f.demand, gap: f.gap }));

    const fitNarrative = fitPct >= 75
      ? `Strong fit. Your resume matches the demand profile on ${topMatchedClusters.length} clusters (${topMatchedClusters.map((c) => c.code).join(', ')}).`
      : fitPct >= 55
        ? `Good fit with targeted gaps. Strongest on ${topMatchedClusters[0]?.code ?? '?'}; biggest gap on ${topGapClusters[0]?.code ?? '?'}.`
        : `Significant gaps. ${topGapClusters.length} clusters need work — biggest is ${topGapClusters[0]?.code ?? '?'}.`;
    const reasoning = usingFallback
      ? `${fitNarrative} (Demand profile is the canonical baseline — no employers have posted ${dem.careerTrackName} roles on the platform yet, so we're using the seeded target.)`
      : fitNarrative;

    recommendations.push({
      careerTrackId:    dem.careerTrackId,
      careerTrackName:  dem.careerTrackName,
      fitPct,
      topMatchedClusters,
      topGapClusters,
      reasoning,
    });
  }

  return recommendations.sort((a, b) => b.fitPct - a.fitPct);
}

/* ─── 3. Three-way map (current / path / goal per cluster) ─────────── */

export interface ThreeWayMapRow {
  clusterCode:        ClusterCode;
  clusterName:        string;
  current:            number;        // 0..100 — from resume
  currentConfidence:  number;        // 0..1
  collegeEventual:    number;        // 0..100 — projected from curriculum coverage
  demand:             number;        // 0..100 — aggregated demand
  gapVsDemand:        number;        // max(0, demand - max(current, collegeEventual))
  bridgeNeeded:       boolean;       // true when collegeEventual >= demand BUT we need it sooner
  permanentGap:       boolean;       // true when collegeEventual < demand (college won't close it)
}

export interface ThreeWayMap {
  learnerId:        string;
  careerTrackId:    string;
  careerTrackName:  string;
  rows:             ThreeWayMapRow[];
  overallReadiness: number;          // 0..100 averaging fit across clusters
  computedAt:       Date;
  hasResume:        boolean;
  hasCurriculum:    boolean;
}

export async function computeThreeWayMap(userId: string, careerTrackId: string): Promise<ThreeWayMap> {
  const learnerId = await getLearnerIdOrThrow(userId);
  const profile = await getResumeProfile(userId);
  const learner = await prisma.learner.findUnique({
    where: { id: learnerId },
    select: { institutionId: true, trackId: true },
  });
  if (!learner) throw new Error('Learner not found');

  // Curriculum coverage from learner's institution for this career track
  const curriculum = await prisma.curriculum.findFirst({
    where: { institutionId: learner.institutionId, careerTrackId },
    orderBy: { uploadedAt: 'desc' },
  });
  const coverage: Record<ClusterCode, number> = ALL_CLUSTERS.reduce(
    (acc, c) => { acc[c] = 0; return acc; },
    {} as Record<ClusterCode, number>,
  );
  if (curriculum && curriculum.clusterCoverage) {
    const cov = curriculum.clusterCoverage as Record<string, number>;
    for (const cc of ALL_CLUSTERS) {
      const v = cov[cc] ?? 0;
      coverage[cc] = v <= 1 ? Math.round(v * 100) : Math.round(v);
    }
  }

  const demand = await aggregateDemandForTrack(careerTrackId);

  const rows: ThreeWayMapRow[] = ALL_CLUSTERS.map((cc) => {
    const current           = profile?.clusterScores[cc] ?? 0;
    const currentConfidence = profile?.clusterConfidence[cc] ?? 0;
    const collegeEventual   = coverage[cc];
    const dem               = demand.clusterTargets[cc] ?? 0;
    const eventualBest      = Math.max(current, collegeEventual);
    const gapVsDemand       = Math.max(0, dem - eventualBest);
    return {
      clusterCode:       cc,
      clusterName:       CLUSTER_NAMES[cc],
      current,
      currentConfidence,
      collegeEventual,
      demand:            dem,
      gapVsDemand,
      // Bridge: college eventually covers it, but learner doesn't have it NOW
      bridgeNeeded:  collegeEventual >= dem && current < dem * 0.7,
      // Permanent gap: even after college, won't reach demand
      permanentGap:  collegeEventual < dem,
    };
  });

  const denom = rows.filter((r) => r.demand > 0);
  const overallReadiness = denom.length === 0 ? 0 : Math.round(
    denom.reduce((acc, r) => {
      const eventual = Math.max(r.current, r.collegeEventual);
      return acc + (eventual >= r.demand ? 100 : (eventual / r.demand) * 100);
    }, 0) / denom.length,
  );

  return {
    learnerId,
    careerTrackId:   demand.careerTrackId,
    careerTrackName: demand.careerTrackName,
    rows,
    overallReadiness,
    computedAt:      new Date(),
    hasResume:       profile !== null,
    hasCurriculum:   curriculum !== null,
  };
}

/* ─── 4. Augmentation path (subtopics AI should teach now) ─────────── */

export interface PathItem {
  subtopicCode:   string;
  subtopicName:   string;
  clusterCode:    ClusterCode;
  rationale:      'permanent_gap' | 'bridge_pre_college' | 'reinforce_weakness';
  priority:       number;       // 1 = highest
  inCollegeCurriculum: boolean; // does the learner's college teach this?
}

export interface AugmentationPath {
  learnerId:       string;
  careerTrackId:   string;
  careerTrackName: string;
  permanentGapItems: PathItem[];   // college won't cover — AI fills permanently
  bridgeItems:       PathItem[];   // college will eventually — AI bridges now
  reinforcementItems: PathItem[];  // resume weakness in cluster college covers well
  totalEstimatedHours: number;
}

export async function computeAugmentationPath(userId: string, careerTrackId: string): Promise<AugmentationPath> {
  const map = await computeThreeWayMap(userId, careerTrackId);
  const subtopics = loadSubtopics();
  const learner = await prisma.learner.findUnique({
    where: { id: map.learnerId },
    select: { institution: { select: { name: true } } },
  });
  const instKey = (learner?.institution?.name ?? '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 6);

  const perm: PathItem[] = [];
  const bridge: PathItem[] = [];
  const reinforce: PathItem[] = [];

  for (const row of map.rows) {
    if (row.gapVsDemand <= 5) continue;     // close enough — skip
    const subs = subtopics.filter((s) => s.clusterCode === row.clusterCode && s.required);
    for (const s of subs) {
      // Heuristic: institutional curriculum mapping (subtopics.json `inCurriculum.{INST}`)
      const inCol = (s.inCurriculum?.[instKey] ?? false) as boolean;
      const item: PathItem = {
        subtopicCode:        s.code,
        subtopicName:        s.name,
        clusterCode:         row.clusterCode,
        rationale:           'reinforce_weakness',
        priority:            row.gapVsDemand,
        inCollegeCurriculum: inCol,
      };
      if (row.permanentGap && !inCol) {
        perm.push({ ...item, rationale: 'permanent_gap' });
      } else if (row.bridgeNeeded && inCol) {
        bridge.push({ ...item, rationale: 'bridge_pre_college' });
      } else if (row.current < row.demand * 0.7) {
        reinforce.push(item);
      }
    }
  }

  const sortByPriority = (a: PathItem, b: PathItem) => b.priority - a.priority;
  perm.sort(sortByPriority);
  bridge.sort(sortByPriority);
  reinforce.sort(sortByPriority);

  // Rough hours estimate: 4hrs per subtopic for permanent, 2hrs for bridge, 2hrs for reinforce
  const totalEstimatedHours = perm.length * 4 + bridge.length * 2 + reinforce.length * 2;

  return {
    learnerId:       map.learnerId,
    careerTrackId:   map.careerTrackId,
    careerTrackName: map.careerTrackName,
    permanentGapItems: perm.slice(0, 8),
    bridgeItems:       bridge.slice(0, 8),
    reinforcementItems: reinforce.slice(0, 8),
    totalEstimatedHours,
  };
}

/* ─── 5. Aggregated demand passthrough (for Talent UI) ─────────────── */
export { aggregateDemandForTrack as getTrackDemand, type AggregatedDemand };
