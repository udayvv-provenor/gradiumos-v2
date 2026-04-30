/**
 * gapService — for Campus: computes the gap between the institution's
 * curriculum coverage on a career track AND the aggregated demand for that
 * track. Output highlights:
 *
 *   - per-cluster gap (demand - coverage, clamped at 0)
 *   - subjects most responsible for gaps (curriculum subjects with low
 *     coverage on high-demand clusters)
 *   - AI-suggested augmentation methods (mock-fall-back when no Groq key)
 *
 * Scope: pure read service. It does NOT mutate curriculum or demand data.
 * Re-runs on every request (cheap; cluster math is small).
 */
import type { ClusterCode } from '@prisma/client';
import { prisma } from '../../config/db.js';
import { ALL_CLUSTERS } from '../talent/helpers.js';
import { aggregateDemandForTrack, type AggregatedDemand } from './demandService.js';
import { z } from 'zod';
import { isGroqConfigured, callGroq } from '../ai/groqClient.js';
import { safeParseLenient } from '../ai/unwrapJson.js';
import { compileSkill } from '../ai/skills/registry.js';

// v3.1.8 — schema-validate Groq output (was just cast `as AugmentationSuggestion[]`)
const AugmentationSuggestionSchema = z.object({
  area:           z.string().min(2).max(120),
  currentState:   z.string().min(2).max(400),
  recommendation: z.string().min(2).max(600),
  effort:         z.enum(['low', 'medium', 'high']),
  exampleAction:  z.string().min(2).max(400),
});
const AugmentationSuggestionArraySchema = z.array(AugmentationSuggestionSchema).min(1).max(10);

export interface ClusterGap {
  clusterCode:     ClusterCode;
  clusterName:     string;
  curriculumPct:   number;       // 0..100 — what curriculum covers on this cluster
  demandPct:       number;       // 0..100 — what aggregated demand expects
  gapPct:          number;       // max(0, demand - curriculum)
  severity:        'critical' | 'moderate' | 'minor' | 'none';
}

export interface SubjectContribution {
  name:        string;
  coveragePct: number;            // 0..100 — its own coverage
  clusters:    string[];          // which clusters it touches
  gapImpact:   number;            // 0..1 — how much fixing this subject helps the gap
}

export interface AugmentationSuggestion {
  area:           string;          // e.g. "C5 Communication & Collaboration"
  currentState:   string;
  recommendation: string;          // 1-2 sentences
  effort:         'low' | 'medium' | 'high';
  exampleAction:  string;
}

export interface GapReport {
  careerTrackId:    string;
  careerTrackName:  string;
  institutionId:    string;
  curriculumId:     string | null;
  demand:           AggregatedDemand;
  perCluster:       ClusterGap[];
  topGapSubjects:   SubjectContribution[];
  augmentations:    AugmentationSuggestion[];
  overallReadiness: number;        // 0..100 — average of (1 - gap/demand) where demand>0
  computedAt:       Date;
}

const CLUSTER_NAMES: Record<ClusterCode, string> = {
  C1: 'Core Tech',                       C2: 'Applied Problem Solving',
  C3: 'Engineering Execution',           C4: 'System & Product Thinking',
  C5: 'Communication & Collaboration',   C6: 'Domain Specialisation',
  C7: 'Ownership & Judgment',            C8: 'Learning Agility',
};

function severity(gap: number): ClusterGap['severity'] {
  if (gap >= 25) return 'critical';
  if (gap >= 12) return 'moderate';
  if (gap >  3)  return 'minor';
  return 'none';
}

export async function computeGapReport(institutionId: string, idMaybeTrackOrCareer: string): Promise<GapReport> {
  // Accept Track id or CareerTrack id; resolve to global CareerTrack id for the
  // curriculum lookup (curricula are stored against careerTrackId, not Track).
  let careerTrackId = idMaybeTrackOrCareer;
  const directCt = await prisma.careerTrack.findUnique({
    where: { id: idMaybeTrackOrCareer }, select: { id: true },
  });
  if (!directCt) {
    const t = await prisma.track.findUnique({
      where: { id: idMaybeTrackOrCareer },
      select: { careerTrackId: true },
    });
    if (t?.careerTrackId) careerTrackId = t.careerTrackId;
  }

  // 1. Get the most recent curriculum for this institution+track
  const curriculum = await prisma.curriculum.findFirst({
    where: { institutionId, careerTrackId },
    orderBy: { uploadedAt: 'desc' },
  });

  // 2. Aggregate demand across all employer roles in this track
  const demand = await aggregateDemandForTrack(careerTrackId);

  // 3. Curriculum coverage (0..100 per cluster). If no curriculum uploaded, all zeros.
  const coverage: Record<ClusterCode, number> = ALL_CLUSTERS.reduce(
    (acc, c) => { acc[c] = 0; return acc; },
    {} as Record<ClusterCode, number>,
  );
  if (curriculum && curriculum.clusterCoverage) {
    const cov = curriculum.clusterCoverage as Record<string, number>;
    for (const cc of ALL_CLUSTERS) {
      // Coverage may be stored as 0..1 OR 0..100 depending on when it was persisted
      const v = cov[cc] ?? 0;
      coverage[cc] = v <= 1 ? Math.round(v * 100) : Math.round(v);
    }
  }

  // 4. Per-cluster gaps
  const perCluster: ClusterGap[] = ALL_CLUSTERS.map((cc) => {
    const dem = demand.clusterTargets[cc] ?? 0;
    const cov = coverage[cc];
    const gap = Math.max(0, dem - cov);
    return {
      clusterCode:   cc,
      clusterName:   CLUSTER_NAMES[cc],
      curriculumPct: cov,
      demandPct:     dem,
      gapPct:        gap,
      severity:      severity(gap),
    };
  });

  // 5. Top gap-contributing subjects
  const topGapSubjects: SubjectContribution[] = [];
  if (curriculum?.subjects && Array.isArray(curriculum.subjects)) {
    const subs = curriculum.subjects as Array<{ name: string; clusters: string[]; coverage: number }>;
    // Score each subject by sum of (gap on its clusters * (1 - subject's own coverage))
    const scored = subs.map((s) => {
      const clusterGapSum = (s.clusters ?? []).reduce(
        (acc, c) => acc + (perCluster.find((g) => g.clusterCode === c)?.gapPct ?? 0),
        0,
      );
      const ownCov = s.coverage <= 1 ? s.coverage * 100 : s.coverage;
      const impact = (clusterGapSum * (100 - ownCov)) / 10000;
      return { ...s, ownCov, impact };
    });
    topGapSubjects.push(
      ...scored
        .sort((a, b) => b.impact - a.impact)
        .slice(0, 5)
        .map((s) => ({
          name:        s.name,
          coveragePct: Math.round(s.ownCov),
          clusters:    s.clusters ?? [],
          gapImpact:   Math.round(s.impact * 100) / 100,
        })),
    );
  }

  // 6. AI augmentation suggestions (mock fallback when no Groq)
  const augmentations = await suggestAugmentations(perCluster, demand.careerTrackName);

  // 7. Overall readiness — averaged where demand > 0
  const denom = perCluster.filter((g) => g.demandPct > 0);
  const overallReadiness = denom.length === 0 ? 0 : Math.round(
    denom.reduce((acc, g) => acc + (g.curriculumPct >= g.demandPct ? 100 : (g.curriculumPct / g.demandPct) * 100), 0)
    / denom.length,
  );

  return {
    careerTrackId:    demand.careerTrackId,
    careerTrackName:  demand.careerTrackName,
    institutionId,
    curriculumId:     curriculum?.id ?? null,
    demand,
    perCluster,
    topGapSubjects,
    augmentations,
    overallReadiness,
    computedAt:       new Date(),
  };
}

/* ─── Augmentation suggestion (Groq with mock fallback) ─────────────── */

async function suggestAugmentations(perCluster: ClusterGap[], trackName: string): Promise<AugmentationSuggestion[]> {
  const criticalAndModerate = perCluster.filter((g) => g.severity === 'critical' || g.severity === 'moderate');
  if (criticalAndModerate.length === 0) {
    return [{
      area:           'Curriculum on track',
      currentState:   'Coverage matches or exceeds demand on all measured clusters.',
      recommendation: 'Maintain current curriculum and refresh annually as employer demand drifts.',
      effort:         'low',
      exampleAction:  'Schedule a quarterly review of new JD uploads vs. current coverage.',
    }];
  }

  if (!isGroqConfigured()) {
    return criticalAndModerate.map(mockSuggestion);
  }

  // Groq path — ask for structured JSON augmentation suggestions
  try {
    const result = await callGroq({
      operation: 'suggestAugmentations',
      // IP layer — composed from skills/tasks/suggest-augmentations.md
      system: compileSkill('suggest-augmentations'),
      user: `Career track: ${trackName}\n\nGaps to address:\n${criticalAndModerate.map((g) => `- ${g.clusterCode} ${g.clusterName}: curriculum at ${g.curriculumPct}, demand at ${g.demandPct}, gap ${g.gapPct} (${g.severity})`).join('\n')}\n\nProduce the JSON array now.`,
      json: true,
      temperature: 0.2,
      maxTokens: 1500,
    });
    // v3.1.8 — schema-validate via the lenient unwrapper. Handles
    // {augmentations:[...]}, {data:[...]}, top-level [...], and any other
    // single-key wrapper Groq might emit.
    const parsed = safeParseLenient(AugmentationSuggestionArraySchema, result.raw);
    if (parsed.success) return parsed.data;
    // eslint-disable-next-line no-console
    console.warn('[suggestAugmentations] schema drift, mocking:', JSON.stringify(parsed.error.flatten()).slice(0, 200));
    return criticalAndModerate.map(mockSuggestion);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[v3] suggestAugmentations groq failed, mocking:', (err as Error).message);
    return criticalAndModerate.map(mockSuggestion);
  }
}

/* MVP-SCAFFOLD — keyword-driven mock augmentation per cluster. */
function mockSuggestion(g: ClusterGap): AugmentationSuggestion {
  const recipes: Record<string, Omit<AugmentationSuggestion, 'area' | 'currentState'>> = {
    C1: { recommendation: 'Add a 2-credit "Production Algorithms Lab" running competitive-programming-style weekly contests with code review.', effort: 'medium', exampleAction: 'Pilot in semester 4 with 30 students; LeetCode/Codeforces-style problem sets graded weekly.' },
    C2: { recommendation: 'Introduce structured "case interview" practice in the soft-skills curriculum — Fermi estimation, ambiguous problem framing.', effort: 'low', exampleAction: 'Run a 6-week elective with weekly 90-min case sessions; pair seniors with juniors.' },
    C3: { recommendation: 'Make Git + CI mandatory in every project course from year 2 onward; add a 1-credit "Production Engineering Practice" module.', effort: 'medium', exampleAction: 'Mandate PR-based code review for the year-3 capstone; add GitHub Actions CI as a grading rubric item.' },
    C4: { recommendation: 'Add a System Design course in semester 6 covering trade-offs (CAP, SQL vs NoSQL, monolith vs microservices) with weekly whiteboarding.', effort: 'high', exampleAction: 'Hire 1-2 industry adjuncts to teach the course; partner with a local tech company for case studies.' },
    C5: { recommendation: 'Embed technical-writing rubrics into every project deliverable; add a 1-credit "Engineering Communication" workshop in year 1.', effort: 'low', exampleAction: 'Require a structured PR description template (BLUF + risk + test plan) for all year-2+ projects.' },
    C6: { recommendation: 'Build domain electives (Fintech, Health Tech, ML) with industry sponsors; require students to pick one by year 3.', effort: 'high', exampleAction: 'Survey graduating cohorts to identify highest-ROI domains; prototype with one elective in year 4.' },
    C7: { recommendation: 'Restructure the senior capstone as a self-directed 8-week sprint with weekly retrospectives and a written post-mortem.', effort: 'medium', exampleAction: 'Replace the rigid project rubric with a "what did you learn and what would you do differently" reflection requirement.' },
    C8: { recommendation: 'Add a "Pick a New Tool in 2 Weeks" assessment per semester — student picks an unfamiliar tech, builds a small project, presents it.', effort: 'low', exampleAction: 'Run as a 5% credit add-on in any year-3 course; library of approved unfamiliar tools curated by faculty.' },
  };
  const r = recipes[g.clusterCode] ?? { recommendation: 'Review curriculum mapping and identify a course that can be augmented.', effort: 'medium' as const, exampleAction: 'Convene a curriculum committee meeting.' };
  return {
    area:           `${g.clusterCode} ${g.clusterName}`,
    currentState:   `Curriculum covers ${g.curriculumPct}% on this cluster; aggregated employer demand expects ${g.demandPct}%. Gap of ${g.gapPct} points (${g.severity}).`,
    ...r,
  };
}
