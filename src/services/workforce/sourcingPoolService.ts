/**
 * sourcingPoolService — for ONE employer role, rank ON-PLATFORM institutions
 * by their fillEfficiency for that role. Migrated from v2 demo's
 * insightWorkforceService.getInstitutionsInsight but scoped to a single role
 * (the v2 version aggregates across all employer roles).
 *
 * Pairs with the public-data Serper sourcing intel — that one tells you "VIT
 * is a good source nationally", THIS one tells you "12 specific learners at
 * VIT are already at 78%+ match for THIS role".
 *
 * AI augmentation: optional explain-sourcing skill produces a 1-2 sentence
 * WHY rationale per institution. Cached + degrades gracefully on Groq fail.
 */
import { prisma } from '../../config/db.js';
import { ALL_CLUSTERS } from './helpers.js';
import { fillEfficiency, countRolesCoverable } from './institutionRankService.js';
import { isGroqConfigured, callGroq } from '../ai/groqClient.js';
import { safeParseLenient } from '../ai/unwrapJson.js';
import { compileSkill } from '../ai/skills/registry.js';
import { z } from 'zod';
import type { ClusterCode } from '@prisma/client';

const ExplainSchema = z.object({
  headline: z.string().min(5).max(500),
  perInstitution: z.array(z.object({
    institutionId: z.string(),
    rationale:     z.string().min(5).max(280),
  })).max(10),
});

export interface SourcingPoolRow {
  institutionId:   string;
  institutionName: string;
  poolSize:        number;
  qualifyingPool:  number;
  avgMatchPct:     number;
  rolesCoverable:  number;
  fillEfficiency:  number;
  topCandidates:   { name: string; matchPct: number }[];
  rationale?:      string;       // AI-generated WHY (optional — present if AI succeeded)
}

export interface SourcingPoolReport {
  roleId:    string;
  roleTitle: string;
  rows:      SourcingPoolRow[];
  headline?: string;
  computedAt: string;
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

export async function computeSourcingPools(roleId: string): Promise<SourcingPoolReport> {
  const role = await prisma.employerRole.findUnique({
    where: { id: roleId },
    include: { careerTrack: true },
  });
  if (!role) throw new Error(`Role ${roleId} not found`);

  const rawTargets = (role.clusterTargets ?? {}) as Record<string, unknown>;
  const targets = ALL_CLUSTERS.reduce<Record<string, number>>((acc, c) => { acc[c] = extractTarget(rawTargets[c]); return acc; }, {});
  const weights = (role.clusterWeights ?? {}) as Record<string, number>;

  // Pull every learner with scores, grouped by institution
  const learners = await prisma.learner.findMany({
    where: {},
    include: { scores: true, institution: { select: { id: true, name: true } } },
  });

  // Group by institution, compute per-learner match
  const byInst = new Map<string, { name: string; learners: { id: string; name: string; match: number }[] }>();
  for (const l of learners) {
    const scoresMap: Record<string, number> = {};
    for (const s of l.scores) scoresMap[s.clusterCode] = s.scoreWeighted;
    const match = learnerMatch(scoresMap, targets, weights);
    const cur = byInst.get(l.institutionId) ?? { name: l.institution.name, learners: [] };
    cur.learners.push({ id: l.id, name: l.name, match });
    byInst.set(l.institutionId, cur);
  }

  const QUALIFY_THRESHOLD = 0.70;
  const rows: SourcingPoolRow[] = Array.from(byInst.entries()).map(([instId, g]) => {
    const sorted = g.learners.slice().sort((a, b) => b.match - a.match);
    const qualifying = sorted.filter((l) => l.match >= QUALIFY_THRESHOLD);
    const avgMatch = sorted.length === 0 ? 0 : sorted.reduce((a, l) => a + l.match, 0) / sorted.length;
    const fe = fillEfficiency({
      roles:            [{ id: role.id, seatsPlanned: role.seatsPlanned }],
      qualifying:       qualifying.length,
      avgMatchPerRole:  [avgMatch],
      rolesCoverable:   countRolesCoverable([{ seatsPlanned: role.seatsPlanned }], qualifying.length, [avgMatch]),
    });
    return {
      institutionId:   instId,
      institutionName: g.name,
      poolSize:        g.learners.length,
      qualifyingPool:  qualifying.length,
      avgMatchPct:     Math.round(avgMatch * 100),
      rolesCoverable:  qualifying.length >= role.seatsPlanned ? 1 : 0,
      fillEfficiency:  fe,
      topCandidates:   sorted.slice(0, 3).map((l) => ({ name: l.name, matchPct: Math.round(l.match * 100) })),
    };
  }).sort((a, b) => b.fillEfficiency - a.fillEfficiency);

  // AI augmentation — explain WHY each institution ranked here (graceful degrade)
  let headline: string | undefined;
  if (isGroqConfigured() && rows.length > 0) {
    try {
      const result = await callGroq({
        operation: 'explainSourcing',
        system: compileSkill('explain-sourcing'),
        user: `Role: ${role.title} at this employer
Cluster targets: ${JSON.stringify(targets)}

Ranked institutions (in order):
${rows.map((r, i) => `${i + 1}. ${r.institutionName} (id=${r.institutionId}): pool=${r.poolSize}, qualifying=${r.qualifyingPool}, avgMatch=${r.avgMatchPct}%, fillEff=${r.fillEfficiency}, top candidates: ${r.topCandidates.map((c) => c.name + ' ' + c.matchPct + '%').join(', ')}`).join('\n')}

Produce the JSON now.`,
        json: true,
        temperature: 0.2,
        maxTokens: 1200,
      });
      const parsed = safeParseLenient(ExplainSchema, result.raw);
      if (parsed.success) {
        headline = parsed.data.headline;
        for (const e of parsed.data.perInstitution) {
          const row = rows.find((r) => r.institutionId === e.institutionId);
          if (row) row.rationale = e.rationale;
        }
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[sourcingPools] explain-sourcing groq failed, skipping AI overlay:', (err as Error).message.slice(0, 200));
    }
  }

  return {
    roleId:     role.id,
    roleTitle:  role.title,
    rows,
    headline,
    computedAt: new Date().toISOString(),
  };
}
