/**
 * GradiumOS Signal — learner view.
 * Score per career track is the readinessScore (0..100) clamped by confidence.
 * Checklist (5 gates):
 *   1. ≥ 6 clusters sampled (attemptsCount > 0).
 *   2. All sampled clusters have confidence ≥ 0.4.
 *   3. No stale clusters (freshness > 0).
 *   4. A primary career-track enrollment exists.
 *   5. No active revocation for any issued signal.
 * Generation — writes one GradiumSignal row per cluster (upsert) and stamps
 * an Ed25519 portable token for each.
 */
import type { ClusterCode } from '@prisma/client';
import { prisma } from '../../config/db.js';
import { AppError } from '../../utils/AppError.js';
import { readinessScore, confidenceBand, bandFor } from '../competency/formulas.js';
import { publicKeyKid, signPayload } from '../signal/tokenSigner.js';
import { ALL_CLUSTERS, parseWeights, round1, round3 } from './helpers.js';
import { getLearnerWithScope, requireTrackEnrollment } from './learnerContext.js';

export interface SignalChecklist {
  clustersSampledOk: boolean;
  confidenceOk: boolean;
  freshnessOk: boolean;
  primaryTrackSet: boolean;
  noActiveRevocation: boolean;
}

export async function computeSignalScore(learnerId: string, careerTrackId: string) {
  const careerTrack = await prisma.careerTrack.findUnique({ where: { id: careerTrackId } });
  if (!careerTrack) throw new AppError('NOT_FOUND', 'Career track not found');
  const weights = parseWeights(careerTrack.clusterWeights);
  const scores = await prisma.competencyScore.findMany({ where: { learnerId } });

  const entries = ALL_CLUSTERS.map((c) => {
    const s = scores.find((x) => x.clusterCode === c);
    return { scoreWeighted: s?.scoreWeighted ?? 0, weight: weights[c] ?? 0 };
  });
  const score = readinessScore(entries);
  const avgConfidence = scores.length === 0
    ? 0
    : scores.reduce((a, s) => a + s.confidence, 0) / scores.length;

  return { score, confidence: avgConfidence };
}

function evaluateChecklist(
  scores: { clusterCode: ClusterCode; scoreWeighted: number; confidence: number; freshness: number; attemptsCount: number }[],
  hasPrimary: boolean,
  hasActiveRevocation: boolean,
): SignalChecklist {
  const sampled = scores.filter((s) => s.attemptsCount > 0);
  return {
    clustersSampledOk: sampled.length >= 6,
    confidenceOk: sampled.length > 0 && sampled.every((s) => s.confidence >= 0.4),
    freshnessOk: sampled.length > 0 && sampled.every((s) => s.freshness > 0),
    primaryTrackSet: hasPrimary,
    noActiveRevocation: !hasActiveRevocation,
  };
}

export async function getSignal(userId: string, careerTrackId: string) {
  const { learner } = await getLearnerWithScope(userId);
  await requireTrackEnrollment(learner.id, careerTrackId);

  const { score, confidence } = await computeSignalScore(learner.id, careerTrackId);
  const scores = await prisma.competencyScore.findMany({ where: { learnerId: learner.id } });
  const primary = learner.careerTrackEnrollments.find((e) => e.isPrimary);
  const revoked = await prisma.gradiumSignal.count({ where: { learnerId: learner.id, state: 'revoked' } });

  const checklist = evaluateChecklist(scores, !!primary, revoked > 0);
  const checklistPass = Object.values(checklist).every(Boolean);
  const sampledCount = scores.filter((s) => s.attemptsCount > 0).length;
  // Array-of-rows shape for UI — stable keys + human-readable labels/details.
  const checklistRows = [
    { key: 'clustersSampledOk', label: '\u2265\u00a06 clusters sampled',   pass: checklist.clustersSampledOk, detail: `${sampledCount}/8 sampled` },
    { key: 'confidenceOk',      label: 'All confidence \u2265\u00a00.40',  pass: checklist.confidenceOk,      detail: 'Per-cluster confidence above suppression' },
    { key: 'freshnessOk',       label: 'No stale clusters',                pass: checklist.freshnessOk,       detail: 'Recent attempts across sampled clusters' },
    { key: 'primaryTrackSet',   label: 'Primary track set',                pass: checklist.primaryTrackSet,   detail: 'One career track marked primary' },
    { key: 'noActiveRevocation',label: 'No active revocation',             pass: checklist.noActiveRevocation, detail: 'No revoked GradiumOS Signal records' },
  ];

  const issuedSignals = await prisma.gradiumSignal.findMany({
    where: { learnerId: learner.id, state: 'issued' },
    orderBy: { issuedAt: 'desc' },
  });

  // Enrich issued signals with competency score data for the per-cluster history table.
  const clusters = await prisma.competencyCluster.findMany({ orderBy: { code: 'asc' } });
  const clusterNameMap = new Map(clusters.map((c) => [c.code, c.name]));
  const careerTrack = await prisma.careerTrack.findUnique({ where: { id: careerTrackId } });
  const weights = careerTrack ? parseWeights(careerTrack.clusterWeights) : {};
  const targets = careerTrack ? (careerTrack.clusterTargets as Record<string, number>) : {};

  const issuedSignalsEnriched = issuedSignals.map((s) => {
    const scoreRow = scores.find((sc) => sc.clusterCode === s.clusterCode);
    const thr = targets[s.clusterCode] ?? 60;
    const sc = scoreRow?.scoreWeighted ?? 0;
    return {
      clusterCode: s.clusterCode,
      clusterName: clusterNameMap.get(s.clusterCode) ?? s.clusterCode,
      score: round1(sc),
      confidence: round3(scoreRow?.confidence ?? 0),
      band: bandFor(sc, thr),
      issuedAt: s.issuedAt?.toISOString() ?? null,
      expiresAt: s.expiresAt?.toISOString() ?? null,
      portableTokenPreview: s.portableToken ? s.portableToken.slice(0, 24) + '\u2026' : null,
    };
  });

  // All 8 cluster scores for the hero grid (independent of whether a signal was issued per cluster)
  const allClusterScores = clusters.map((c) => {
    const scoreRow = scores.find((sc) => sc.clusterCode === c.code);
    const thr = targets[c.code] ?? 60;
    const sc = scoreRow?.scoreWeighted ?? 0;
    return {
      clusterCode: c.code as ClusterCode,
      clusterName: c.name,
      score: round1(sc),
      confidence: round3(scoreRow?.confidence ?? 0),
      band: bandFor(sc, thr),
    };
  });

  return {
    careerTrackId,
    score: round1(score),
    confidence: round3(confidence),
    confidenceBand: confidenceBand(confidence),
    checklist: checklistRows,
    checklistPass,
    state: issuedSignals.length > 0 ? 'issued' : 'pending',
    issuedSignals: issuedSignalsEnriched,
    allClusterScores,
    kid: publicKeyKid(),
  };
}

export async function generateSignal(userId: string, careerTrackId: string) {
  const { learner } = await getLearnerWithScope(userId);
  await requireTrackEnrollment(learner.id, careerTrackId);

  const scores = await prisma.competencyScore.findMany({ where: { learnerId: learner.id } });
  const primary = learner.careerTrackEnrollments.find((e) => e.isPrimary);
  const revoked = await prisma.gradiumSignal.count({ where: { learnerId: learner.id, state: 'revoked' } });
  const checklist = evaluateChecklist(scores, !!primary, revoked > 0);
  const checklistPass = Object.values(checklist).every(Boolean);
  if (!checklistPass) {
    throw new AppError('SIGNAL_CHECKLIST_INCOMPLETE', 'Signal checklist incomplete', checklist);
  }

  const iv = learner.institution.indexVersions[0];
  if (!iv) throw new AppError('NOT_FOUND', 'No index version configured');

  const issued: { clusterCode: ClusterCode; portableToken: string; expiresAt: Date }[] = [];
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 60 * 60 * 24 * 365 * 2 * 1000); // 2y
  for (const s of scores) {
    if (s.attemptsCount === 0) continue;
    const token = signPayload({
      sub: learner.id,
      cluster: s.clusterCode,
      score: s.scoreWeighted,
      confidence: s.confidence,
      freshness: s.freshness,
      versionTag: iv.versionTag,
    });
    await prisma.gradiumSignal.upsert({
      where: { learnerId_clusterCode: { learnerId: learner.id, clusterCode: s.clusterCode } },
      create: {
        learnerId: learner.id,
        clusterCode: s.clusterCode,
        state: 'issued',
        portableToken: token,
        issuedAt: now,
        expiresAt,
      },
      update: {
        state: 'issued',
        portableToken: token,
        issuedAt: now,
        expiresAt,
        revokedAt: null,
      },
    });
    issued.push({ clusterCode: s.clusterCode, portableToken: token, expiresAt });
  }

  const { score, confidence } = await computeSignalScore(learner.id, careerTrackId);
  return {
    careerTrackId,
    score: round1(score),
    confidence: round3(confidence),
    issuedCount: issued.length,
    kid: publicKeyKid(),
    issued: issued.map((i) => ({
      clusterCode: i.clusterCode,
      portableToken: i.portableToken,
      expiresAt: i.expiresAt.toISOString(),
    })),
  };
}
