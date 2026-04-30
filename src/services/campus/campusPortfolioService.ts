/**
 * Campus Proof Portfolio — institution-wide aggregated view of learner evidence,
 * GradiumOS Signals, and portfolio completeness for the Board of Studies.
 */
import { prisma } from '../../config/db.js';
import { confidenceBand } from '../competency/formulas.js';
import type { ClusterCode } from '@prisma/client';

export async function getCampusPortfolio(institutionId: string) {
  const learners = await prisma.learner.findMany({
    where: { institutionId },
    include: {
      cohort: true,
      scores: true,
      signals: true,
    },
    orderBy: { name: 'asc' },
  });

  // Get all career track enrollments for these learners
  const learnerIds = learners.map((l) => l.id);
  const enrollments = await prisma.careerTrackEnrollment.findMany({
    where: { learnerId: { in: learnerIds } },
    include: { careerTrack: true },
  });
  const enrollMap = new Map<string, typeof enrollments[number][]>();
  for (const e of enrollments) {
    if (!enrollMap.has(e.learnerId)) enrollMap.set(e.learnerId, []);
    enrollMap.get(e.learnerId)!.push(e);
  }

  // Attempt counts per learner
  const attemptCounts = await prisma.attempt.groupBy({
    by: ['learnerId'],
    where: { learnerId: { in: learnerIds } },
    _count: { _all: true },
  });
  const attemptMap = new Map(attemptCounts.map((a) => [a.learnerId, a._count._all]));

  // Per-learner rows
  const rows = learners.map((l) => {
    const issuedSignals = l.signals.filter((s) => s.state === 'issued');
    const sampledClusters = l.scores.filter((s) => s.attemptsCount > 0).length;
    const avgConfidence = l.scores.length > 0
      ? l.scores.reduce((a, s) => a + s.confidence, 0) / l.scores.length : 0;
    const avgScore = l.scores.length > 0
      ? l.scores.reduce((a, s) => a + s.scoreWeighted, 0) / l.scores.length : 0;
    // Portfolio completeness: weighted across clusters sampled, signals issued, and attempts
    const completeness = Math.min(1,
      (sampledClusters / 8) * 0.4 +
      (issuedSignals.length / 8) * 0.4 +
      (Math.min(1, (attemptMap.get(l.id) ?? 0) / 20)) * 0.2
    );
    const primaryEnrollment = enrollMap.get(l.id)?.find((e) => e.isPrimary);

    return {
      learnerId: l.id,
      name: l.name,
      email: l.email,
      cohortName: l.cohort?.name ?? '—',
      trackCode: primaryEnrollment?.careerTrack.code ?? '—',
      trackName: primaryEnrollment?.careerTrack.name ?? '—',
      avgScore: Number(avgScore.toFixed(1)),
      avgConfidence: Number(avgConfidence.toFixed(3)),
      confidenceBand: confidenceBand(avgConfidence),
      clustersSampled: sampledClusters,
      signalsIssued: issuedSignals.length,
      signalState: issuedSignals.length > 0 ? 'issued' : sampledClusters >= 6 ? 'ready' : 'building',
      evidenceCount: attemptMap.get(l.id) ?? 0,
      portfolioCompleteness: Number(completeness.toFixed(3)),
    };
  });

  // Aggregate stats
  const totalLearners = rows.length;
  const withSignal = rows.filter((r) => r.signalState === 'issued').length;
  const signalReady = rows.filter((r) => r.signalState === 'ready').length;
  const avgSignalScore = rows.length > 0
    ? rows.reduce((a, r) => a + r.avgScore, 0) / rows.length : 0;
  const avgCompleteness = rows.length > 0
    ? rows.reduce((a, r) => a + r.portfolioCompleteness, 0) / rows.length : 0;

  // Insights for the chairman
  const topCluster = await _topEvidenceCluster(institutionId);
  const insights: string[] = [];
  if (signalReady > 0) insights.push(`${signalReady} learner${signalReady !== 1 ? 's are' : ' is'} signal-ready but haven't generated a GradiumOS Signal yet.`);
  if (topCluster) insights.push(`Deepest evidence: ${topCluster.clusterName} has the most assessed learners this term.`);
  const noEvidence = rows.filter((r) => r.evidenceCount === 0).length;
  if (noEvidence > 0) insights.push(`${noEvidence} learner${noEvidence !== 1 ? 's have' : ' has'} no assessment evidence yet — flag for outreach.`);
  if (avgCompleteness >= 0.7) insights.push(`Portfolio completion at ${(avgCompleteness * 100).toFixed(0)}% — strong cohort-wide evidence base.`);

  const out = {
    stats: {
      totalLearners,
      withSignal,
      signalReady,
      avgSignalScore: Number(avgSignalScore.toFixed(1)),
      avgCompleteness: Number(avgCompleteness.toFixed(3)),
    },
    insights,
    rows,
  };

  return out;
}

async function _topEvidenceCluster(institutionId: string) {
  const inst = await prisma.institution.findUnique({ where: { id: institutionId } });
  if (!inst) return null;
  const learners = await prisma.learner.findMany({ where: { institutionId }, select: { id: true } });
  const ids = learners.map((l) => l.id);
  const counts = await prisma.attempt.groupBy({
    by: ['clusterCode'],
    where: { learnerId: { in: ids } },
    _count: { _all: true },
    orderBy: { _count: { id: 'desc' } },
    take: 1,
  });
  if (counts.length === 0) return null;
  const code = counts[0].clusterCode as ClusterCode;
  const cluster = await prisma.competencyCluster.findUnique({ where: { code } });
  return cluster ? { clusterCode: code, clusterName: cluster.name } : null;
}
