/**
 * shiftEvidence — closes the loop between Apply / Shift submissions and the
 * frozen CompetencyScore IP formulas. Each artifact submission becomes ONE
 * evidence event for the relevant cluster.
 *
 * v3.1.5 — added so a shift submission moves the learner's dashboard radar.
 * Without this, the work-simulation popup would feel disconnected from the
 * rest of the platform — submissions would grade but the score wouldn't
 * change. This wiring is what makes the loop real.
 *
 * IP-protection: this file IMPORTS the locked formulas from formulas.ts.
 * It does NOT re-implement, modify, or expose any of the constants.
 */
import { prisma } from '../../config/db.js';
import {
  scoreWeighted,
  confidenceScore,
  freshness,
  completeness,
  stability,
  sufficiency,
  consistency,
} from '../competency/formulas.js';
import type { ClusterCode } from '@prisma/client';

export async function recordShiftEvidence(args: {
  learnerId:   string;
  clusterCode: string;
  artifactId:  string;
  score:       number;          // 0..100 from gradeDescriptive
  rubricCount: number;          // number of rubric criteria — used as evidence count
}): Promise<{ scoreWeighted: number; confidence: number; freshness: number }> {
  const { learnerId, clusterCode, score, rubricCount } = args;

  // Pull the existing CompetencyScore + recent attempts in this cluster as
  // "scores chronological" inputs to the locked formulas. We record this
  // submission as a fresh AssessmentAttemptV2 row first so it joins the
  // chronological history naturally.
  const now = new Date();

  // Persist the submission as an AssessmentAttemptV2 row tagged "shift"
  // so it shows up in the learner's history + counts toward attemptsCount.
  await prisma.assessmentAttemptV2.create({
    data: {
      learnerId,
      clusterCode: clusterCode as ClusterCode,
      kind:        'descriptive',
      assessmentRef: `shift:${args.artifactId}`,
      score,
      timeSpentSec: 0,                       // not tracked in shift mode
      answers:      { kind: 'shift-artifact' } as any,
      feedback:     { source: 'shift', rubricCount } as any,
      careerTrackId: null,
      submittedAt: now,
    },
  });

  // Recompute scoreWeighted using ALL attempts on this cluster (chronological,
  // newest last). The locked formula handles the half-life decay.
  const allAttempts = await prisma.assessmentAttemptV2.findMany({
    where:   { learnerId, clusterCode: clusterCode as ClusterCode },
    orderBy: { submittedAt: 'asc' },
    select:  { score: true, submittedAt: true },
  });
  const scoresChrono = allAttempts.map((a) => a.score ?? 0).filter((n): n is number => typeof n === 'number');
  const newScoreWeighted = scoreWeighted(scoresChrono);

  // Confidence — composed from completeness × stability × sufficiency × consistency
  // per the locked IP weights (0.35 / 0.30 / 0.20 / 0.15).
  // For a single-cluster recompute, completeness is bounded by how many
  // CLUSTERS the learner has touched at all. Compute that across the learner.
  const allClusterScores = await prisma.competencyScore.findMany({
    where:  { learnerId },
    select: { clusterCode: true },
  });
  const distinctClustersAssessed = new Set<string>(allClusterScores.map((c) => c.clusterCode as string));
  distinctClustersAssessed.add(clusterCode);   // include this one (might be first)

  const newConfidence = confidenceScore({
    completeness: completeness(distinctClustersAssessed.size, 8),
    stability:    stability(scoresChrono),
    sufficiency:  sufficiency(allAttempts.length),
    consistency:  consistency(scoresChrono),
  });

  // Freshness — submitted-just-now → freshness ≈ 1.0
  const newFreshness = freshness(0);

  // Upsert the CompetencyScore row — keeps the @@unique([learnerId, clusterCode]) constraint happy
  const ccTyped = clusterCode as ClusterCode;
  await prisma.competencyScore.upsert({
    where: { learnerId_clusterCode: { learnerId, clusterCode: ccTyped } },
    update: {
      scoreWeighted: newScoreWeighted,
      confidence:    newConfidence,
      freshness:     newFreshness,
      attemptsCount: allAttempts.length,
      lastAttemptAt: now,
    },
    create: {
      learnerId,
      clusterCode:   clusterCode as ClusterCode,
      scoreWeighted: newScoreWeighted,
      confidence:    newConfidence,
      freshness:     newFreshness,
      attemptsCount: allAttempts.length,
      lastAttemptAt: now,
    },
  });

  return { scoreWeighted: newScoreWeighted, confidence: newConfidence, freshness: newFreshness };
}
