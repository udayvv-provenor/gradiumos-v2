/**
 * Learner overview — per-track list, per-track overview, dCRB Navigator,
 * and competency profile. All views per-learner; the active track is always
 * explicit in the query string.
 */
import type { ClusterCode } from '@prisma/client';
import { prisma } from '../../config/db.js';
import { AppError } from '../../utils/AppError.js';
import {
  bandFor, confidenceBand, freshness as freshnessFn, gap, readinessScore, matchScore,
} from '../competency/formulas.js';
import { ALL_CLUSTERS, parseTargets, parseWeights, round1, round3, subtopicMastery, velocityFor, loadSubtopics, institutionKey } from './helpers.js';
import { getLearnerWithScope, requireTrackEnrollment } from './learnerContext.js';

interface LearnerScoresByCluster {
  scoreWeighted: number;
  confidence: number;
  freshness: number;
  attemptsCount: number;
}

async function loadLearnerScores(learnerId: string): Promise<Partial<Record<ClusterCode, LearnerScoresByCluster>>> {
  const rows = await prisma.competencyScore.findMany({ where: { learnerId } });
  const map: Partial<Record<ClusterCode, LearnerScoresByCluster>> = {};
  for (const r of rows) {
    map[r.clusterCode] = {
      scoreWeighted: r.scoreWeighted,
      confidence: r.confidence,
      freshness: r.freshness,
      attemptsCount: r.attemptsCount,
    };
  }
  return map;
}

function avgConfidence(scores: Partial<Record<ClusterCode, LearnerScoresByCluster>>): number {
  const vals = Object.values(scores).filter((v): v is LearnerScoresByCluster => !!v);
  if (vals.length === 0) return 0;
  return vals.reduce((a, b) => a + b.confidence, 0) / vals.length;
}

export async function getTracks(userId: string) {
  const { learner } = await getLearnerWithScope(userId);
  const scores = await loadLearnerScores(learner.id);

  const tracks = await prisma.careerTrackEnrollment.findMany({
    where: { learnerId: learner.id },
    include: { careerTrack: true },
    orderBy: [{ isPrimary: 'desc' }, { enrolledAt: 'asc' }],
  });

  const signals = await prisma.gradiumSignal.findMany({
    where: { learnerId: learner.id },
    orderBy: { issuedAt: 'desc' },
  });

  // Count best-match roles per career track (learner's matchScore ≥ 0.6 vs role targets).
  const roles = await prisma.employerRole.findMany({ where: { status: 'active' } });

  return tracks.map((t) => {
    const weights  = parseWeights(t.careerTrack.clusterWeights);
    const targets  = parseTargets(t.careerTrack.clusterTargets);

    const readinessEntries = ALL_CLUSTERS.map((c) => ({
      scoreWeighted: scores[c]?.scoreWeighted ?? 0,
      weight: weights[c] ?? 0,
    }));
    const readiness = readinessScore(readinessEntries);

    const trackSignals = signals.filter((s) => s.state === 'issued');
    const trackSignalScore = trackSignals.length > 0
      ? Math.round(
          ALL_CLUSTERS.reduce((acc, c) => {
            const sc = scores[c]?.scoreWeighted ?? 0;
            const w  = weights[c] ?? 0;
            return acc + sc * w;
          }, 0),
        )
      : 0;

    const signalState = trackSignals.length > 0 ? 'issued' : (signals.length > 0 ? 'pending' : 'pending');

    // Best-match count — number of roles for this track where matchScore ≥ 0.6
    const trackRoles = roles.filter((r) => r.careerTrackId === t.careerTrackId);
    let bestMatchCount = 0;
    for (const r of trackRoles) {
      const roleTargets = parseTargets(r.clusterTargets);
      const roleWeights = parseWeights(r.clusterWeights);
      const entries = ALL_CLUSTERS.map((c) => ({
        scoreWeighted: scores[c]?.scoreWeighted ?? 0,
        target: roleTargets[c] ?? targets[c] ?? 60,
        weight: roleWeights[c] ?? 0,
      }));
      if (matchScore(entries) >= 0.6) bestMatchCount++;
    }

    // projectedReadyWeeks — approximate weeks to close weighted gap at a deterministic velocity.
    const vel = velocityFor(learner.id + '|' + t.careerTrackId, 1.0, 1.2);
    let weightedGap = 0;
    for (const c of ALL_CLUSTERS) {
      const sc = scores[c]?.scoreWeighted ?? 0;
      const tgt = targets[c] ?? 60;
      const w = weights[c] ?? 0;
      weightedGap += Math.max(0, tgt - sc) * w;
    }
    const projectedReadyWeeks = vel > 0 ? Math.max(0, Math.round(weightedGap / vel)) : 0;

    return {
      careerTrackId: t.careerTrackId,
      careerTrackName: t.careerTrack.name,
      careerTrackCode: t.careerTrack.code,
      isPrimary: t.isPrimary,
      readiness: round1(readiness),
      confidence: round3(avgConfidence(scores)),
      velocityPtsPerWeek: vel,
      signalScore: trackSignalScore,
      signalConfidence: round3(avgConfidence(scores)),
      signalState,
      projectedReadyWeeks,
      bestMatchCount,
    };
  });
}

export async function getOverview(userId: string, careerTrackId: string) {
  const { learner } = await getLearnerWithScope(userId);
  await requireTrackEnrollment(learner.id, careerTrackId);

  const careerTrack = await prisma.careerTrack.findUnique({ where: { id: careerTrackId } });
  if (!careerTrack) throw new AppError('NOT_FOUND', 'Career track not found');

  const scores = await loadLearnerScores(learner.id);
  const clusters = await prisma.competencyCluster.findMany({ orderBy: { code: 'asc' } });
  const weights = parseWeights(careerTrack.clusterWeights);
  const targets = parseTargets(careerTrack.clusterTargets);

  const readiness = readinessScore(ALL_CLUSTERS.map((c) => ({
    scoreWeighted: scores[c]?.scoreWeighted ?? 0,
    weight: weights[c] ?? 0,
  })));

  // cluster rows (every metric carries confidence).
  const clusterRows = clusters.map((c) => {
    const s = scores[c.code];
    const score = s?.scoreWeighted ?? 0;
    const thr = targets[c.code] ?? 60;
    return {
      clusterCode: c.code,
      clusterName: c.name,
      shortName: c.shortName,
      score: round1(score),
      threshold: thr,
      confidence: round3(s?.confidence ?? 0),
      confidenceBand: confidenceBand(s?.confidence ?? null),
      band: bandFor(score, thr),
      freshness: round3(s?.freshness ?? 0),
      attempts: s?.attemptsCount ?? 0,
    };
  });

  // Curriculum coverage — how many sub-topics are in the learner's institution's curriculum.
  const subtopics = loadSubtopics();
  const instKey = institutionKey(learner.institution.name);
  const required = subtopics.filter((st) => st.required);
  const covered = required.filter((st) => st.inCurriculum[instKey] === true);
  const curriculumCoverage = required.length === 0 ? 0 : covered.length / required.length;

  // topGaps — 3 largest (gap × weight) clusters, each with their sub-topic breakdown.
  const gapsRanked = ALL_CLUSTERS
    .map((code) => {
      const s = scores[code]?.scoreWeighted ?? 0;
      const thr = targets[code] ?? 60;
      const w = weights[code] ?? 0;
      const g = Math.max(0, gap(s, thr));
      return { code, gap: g, severity: g * w, score: s, threshold: thr };
    })
    .sort((a, b) => b.severity - a.severity);
  const topGaps = gapsRanked.filter((g) => g.gap > 0).slice(0, 3).map((g) => {
    const clusterScore = g.score;
    const subs = subtopics.filter((st) => st.clusterCode === g.code).map((st) => ({
      code: st.code,
      name: st.name,
      mastery: round3(subtopicMastery(learner.id, st.code, clusterScore)),
      required: st.required,
      inCurriculum: st.inCurriculum[instKey] === true,
      curriculumSource: st.curriculumSource ?? null,
    }));
    return {
      clusterCode: g.code,
      gap: round1(g.gap),
      threshold: g.threshold,
      score: round1(g.score),
      subtopics: subs,
    };
  });

  const gapsCount = gapsRanked.filter((g) => g.gap > 0).length;

  return {
    readiness: round1(readiness),
    confidence: round3(avgConfidence(scores)),
    confidenceBand: confidenceBand(avgConfidence(scores)),
    gapsCount,
    curriculumCoverage: round3(curriculumCoverage),
    velocity: velocityFor(learner.id + '|' + careerTrackId, 1.0, 1.2),
    clusterRows,
    topGaps,
  };
}

export async function getCompetencyProfile(userId: string) {
  const { learner } = await getLearnerWithScope(userId);
  const scores = await loadLearnerScores(learner.id);
  const clusters = await prisma.competencyCluster.findMany({ orderBy: { code: 'asc' } });

  // Use the learner institution's thresholds as a baseline.
  const iv = learner.institution.indexVersions[0];
  const institutionThresholds = iv ? (iv.thresholds as Record<string, number>) : {};

  // p75/entry thresholds — synthesized deterministically from cluster threshold.
  return {
    clusters: clusters.map((c) => {
      const s = scores[c.code];
      const thr = institutionThresholds[c.code] ?? 60;
      return {
        code: c.code,
        name: c.name,
        shortName: c.shortName,
        score: round1(s?.scoreWeighted ?? 0),
        threshold: thr,
        p75: Math.min(100, thr + 10),
        entry: Math.max(30, thr - 10),
        confidence: round3(s?.confidence ?? 0),
        confidenceBand: confidenceBand(s?.confidence ?? null),
        freshness: round3(s?.freshness ?? 0),
        band: bandFor(s?.scoreWeighted ?? 0, thr),
        attempts: s?.attemptsCount ?? 0,
      };
    }),
  };
}

export async function getDcrb(userId: string, careerTrackId: string) {
  const { learner } = await getLearnerWithScope(userId);
  await requireTrackEnrollment(learner.id, careerTrackId);
  const careerTrack = await prisma.careerTrack.findUnique({ where: { id: careerTrackId } });
  if (!careerTrack) throw new AppError('NOT_FOUND', 'Career track not found');

  const scores = await loadLearnerScores(learner.id);
  const weights = parseWeights(careerTrack.clusterWeights);
  const targets = parseTargets(careerTrack.clusterTargets);

  const rows = ALL_CLUSTERS.map((c) => {
    const s = scores[c];
    const score = s?.scoreWeighted ?? 0;
    const threshold = targets[c] ?? 60;
    const weight = weights[c] ?? 0;
    const g = Math.max(0, gap(score, threshold));
    return {
      clusterCode: c,
      weight: round3(weight),
      score: round1(score),
      threshold,
      gap: round1(g),
      band: bandFor(score, threshold),
      confidence: round3(s?.confidence ?? 0),
      confidenceBand: confidenceBand(s?.confidence ?? null),
    };
  });
  let weightedGap = 0;
  for (const r of rows) weightedGap += r.gap * r.weight;
  const velocity = velocityFor(learner.id + '|' + careerTrackId, 1.0, 1.2);
  const projectedWeeks = velocity > 0 ? Math.max(0, Math.ceil(weightedGap / velocity)) : 0;

  return { rows, weightedGap: round1(weightedGap), projectedWeeks, velocityPtsPerWeek: velocity };
}
