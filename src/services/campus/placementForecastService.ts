/**
 * placementForecastService — for ONE institution + career track, forecast
 * how this institution's enrolled learners will place across all employer
 * roles in this track. Migrated from v2 demo's opportunityMatchingService
 * but scoped to one institution and one track.
 *
 * AI augmentation: optional summarise-placement-forecast skill produces
 * a 1-line headline + 1-2 sentence rationale per role. Graceful degrade.
 */
import { prisma } from '../../config/db.js';
import { ALL_CLUSTERS } from '../talent/helpers.js';
import { isGroqConfigured, callGroq } from '../ai/groqClient.js';
import { safeParseLenient } from '../ai/unwrapJson.js';
import { compileSkill } from '../ai/skills/registry.js';
import { z } from 'zod';

const SummarySchema = z.object({
  headline: z.string().min(5).max(500),
  perRole: z.array(z.object({
    roleId:    z.string(),
    rationale: z.string().min(5).max(280),
  })).max(15),
});

export interface PlacementForecastRow {
  roleId:           string;
  roleTitle:        string;
  employerName:     string;
  employerArchetype: string | null;  // v3.1 — null = pending (no JDs uploaded yet)
  seatsPlanned:     number;
  qualifyingCount:  number;       // learners @ this institution who match >=70%
  nearlyCount:      number;       // 50-69%
  avgMatchPct:      number;       // institution-wide average match %
  topCandidates:    { learnerId: string; name: string; matchPct: number }[];
  blockingCluster?: { code: string; gap: number };  // weakest cluster causing rejection
  rationale?:       string;       // AI per-role narrative
}

export interface PlacementForecast {
  institutionId:   string;
  institutionName: string;
  careerTrackId:   string;
  careerTrackName: string;
  cohortSize:      number;
  rows:            PlacementForecastRow[];
  headline?:       string;
  computedAt:      string;
}

function extractTarget(v: unknown): number {
  if (typeof v === 'number') return v;
  if (v && typeof v === 'object') {
    const o = v as Record<string, number>;
    return o['target'] ?? 0;
  }
  return 0;
}

function learnerMatch(learnerScores: Record<string, number>, roleTargets: Record<string, number>, roleWeights: Record<string, number>): number {
  let weighted = 0;
  let totalWeight = 0;
  for (const cc of ALL_CLUSTERS) {
    const w = roleWeights[cc] ?? 0;
    if (w === 0) continue;
    const target = roleTargets[cc] ?? 0;
    const score = learnerScores[cc] ?? 0;
    const fraction = target > 0 ? Math.min(1, score / target) : 1;
    weighted += fraction * w;
    totalWeight += w;
  }
  return totalWeight > 0 ? weighted / totalWeight : 0;
}

export async function computePlacementForecast(institutionId: string, idMaybeTrackOrCareer: string): Promise<PlacementForecast> {
  // Resolve Track or CareerTrack id (Campus exposes Track ids)
  let careerTrackId = idMaybeTrackOrCareer;
  let careerTrack = await prisma.careerTrack.findUnique({
    where: { id: idMaybeTrackOrCareer },
    select: { id: true, name: true },
  });
  if (!careerTrack) {
    const t = await prisma.track.findUnique({
      where: { id: idMaybeTrackOrCareer },
      select: { careerTrackId: true, careerTrack: { select: { id: true, name: true } } },
    });
    if (t?.careerTrack) { careerTrack = t.careerTrack; careerTrackId = t.careerTrackId!; }
  }
  if (!careerTrack) throw new Error(`Career track or institution track ${idMaybeTrackOrCareer} not found`);

  const institution = await prisma.institution.findUnique({
    where: { id: institutionId },
    select: { id: true, name: true },
  });
  if (!institution) throw new Error(`Institution ${institutionId} not found`);

  // Pull learners at this institution + their cluster scores
  const learners = await prisma.learner.findMany({
    where: { institutionId },
    include: { scores: true },
  });
  const learnerScoreMaps = new Map<string, { name: string; scores: Record<string, number> }>();
  for (const l of learners) {
    const m: Record<string, number> = {};
    for (const s of l.scores) m[s.clusterCode] = s.scoreWeighted;
    learnerScoreMaps.set(l.id, { name: l.name, scores: m });
  }

  // Pull all employer roles in this career track
  const roles = await prisma.employerRole.findMany({
    where: { careerTrackId, status: 'active' },
    include: { employer: { select: { name: true, archetype: true } } },
  });

  const QUALIFY = 0.70;
  const NEARLY  = 0.50;

  const rows: PlacementForecastRow[] = roles.map((role) => {
    const rawTargets = (role.clusterTargets ?? {}) as Record<string, unknown>;
    const targets = ALL_CLUSTERS.reduce<Record<string, number>>((acc, c) => { acc[c] = extractTarget(rawTargets[c]); return acc; }, {});
    const weights = (role.clusterWeights ?? {}) as Record<string, number>;

    const matches = learners.map((l) => {
      const m = learnerScoreMaps.get(l.id)!;
      return { learnerId: l.id, name: l.name, match: learnerMatch(m.scores, targets, weights) };
    }).sort((a, b) => b.match - a.match);

    const qualifying = matches.filter((m) => m.match >= QUALIFY);
    const nearly     = matches.filter((m) => m.match >= NEARLY && m.match < QUALIFY);
    const avgMatch   = matches.length === 0 ? 0 : matches.reduce((a, m) => a + m.match, 0) / matches.length;

    // Blocking cluster: cluster with the largest weighted gap across all learners
    let blockingCluster: { code: string; gap: number } | undefined;
    let maxBlockScore = 0;
    for (const cc of ALL_CLUSTERS) {
      const w = weights[cc] ?? 0;
      const target = targets[cc] ?? 0;
      if (w === 0 || target === 0) continue;
      const avgScore = learners.length === 0 ? 0 : learners.reduce((a, l) => a + (learnerScoreMaps.get(l.id)!.scores[cc] ?? 0), 0) / learners.length;
      const gap = Math.max(0, target - avgScore);
      const blockScore = gap * w;
      if (blockScore > maxBlockScore) {
        maxBlockScore = blockScore;
        blockingCluster = { code: cc, gap: Math.round(gap) };
      }
    }

    return {
      roleId:            role.id,
      roleTitle:         role.title,
      employerName:      role.employer.name,
      employerArchetype: role.employer.archetype,
      seatsPlanned:      role.seatsPlanned,
      qualifyingCount:   qualifying.length,
      nearlyCount:       nearly.length,
      avgMatchPct:       Math.round(avgMatch * 100),
      topCandidates:     matches.slice(0, 3).map((m) => ({ learnerId: m.learnerId, name: m.name, matchPct: Math.round(m.match * 100) })),
      blockingCluster,
    };
  }).sort((a, b) => b.qualifyingCount - a.qualifyingCount);

  // AI summarisation overlay
  let headline: string | undefined;
  if (isGroqConfigured() && rows.length > 0) {
    try {
      const result = await callGroq({
        operation: 'summarisePlacementForecast',
        system: compileSkill('summarise-placement-forecast'),
        user: `Institution: ${institution.name}
Career track: ${careerTrack.name}
Cohort size: ${learners.length} learners

Roles in track (in qualifying-count rank order):
${rows.map((r) => `- ${r.roleTitle} @ ${r.employerName} (${r.employerArchetype}, ${r.seatsPlanned} seats, roleId=${r.roleId}): qualifying=${r.qualifyingCount}, nearly=${r.nearlyCount}, avgMatch=${r.avgMatchPct}%, blockingCluster=${r.blockingCluster ? r.blockingCluster.code + ' gap ' + r.blockingCluster.gap : 'none'}, top: ${r.topCandidates.map((c) => c.name + ' ' + c.matchPct + '%').join(', ')}`).join('\n')}

Produce the JSON now.`,
        json: true,
        temperature: 0.2,
        maxTokens: 1500,
      });
      const parsed = safeParseLenient(SummarySchema, result.raw);
      if (parsed.success) {
        headline = parsed.data.headline;
        for (const e of parsed.data.perRole) {
          const row = rows.find((r) => r.roleId === e.roleId);
          if (row) row.rationale = e.rationale;
        }
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[placementForecast] summarise groq failed, skipping AI overlay:', (err as Error).message.slice(0, 200));
    }
  }

  return {
    institutionId:   institution.id,
    institutionName: institution.name,
    careerTrackId:   careerTrack.id,
    careerTrackName: careerTrack.name,
    cohortSize:      learners.length,
    rows,
    headline,
    computedAt:      new Date().toISOString(),
  };
}
