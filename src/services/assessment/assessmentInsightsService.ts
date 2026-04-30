/**
 * Assessment Insights — KPIs + histogram + per-cluster stats + bank health.
 * Augmented with a server-computed narrative block (`insights` + `summary`)
 * matching the pattern used in campusPortfolioService.ts so the UI can render
 * plain-English lines without re-deriving them client-side.
 */
import { prisma } from '../../config/db.js';
import { AppError } from '../../utils/AppError.js';
import { AttemptKind, type ClusterCode } from '@prisma/client';
import { confidenceScore } from '../competency/formulas.js';

const HIST_BUCKETS: Array<{ lo: number; hi: number }> = [
  { lo: 0,  hi: 20 },
  { lo: 20, hi: 40 },
  { lo: 40, hi: 55 },
  { lo: 55, hi: 68 },
  { lo: 68, hi: 80 },
  { lo: 80, hi: 90 },
  { lo: 90, hi: 101 },
];

export async function getAssessmentInsights(institutionId: string) {
  const iv = await prisma.indexVersion.findFirst({
    where: { institutionId },
    orderBy: { effectiveFrom: 'desc' },
  });
  if (!iv) throw new AppError('NOT_FOUND', 'No index version configured');
  const thresholds = iv.thresholds as Record<string, number>;

  const [attempts, clusters, contentItems, bankItems] = await Promise.all([
    prisma.attempt.findMany({
      where: { learner: { institutionId } },
      orderBy: { takenAt: 'desc' },
    }),
    prisma.competencyCluster.findMany({ orderBy: { code: 'asc' } }),
    prisma.contentBankItem.findMany(),
    prisma.assessmentBankItem.findMany(),
  ]);

  const now = Date.now();
  const THIRTY_DAYS_MS = 30 * 24 * 3600 * 1000;
  const NINETY_DAYS_MS = 90 * 24 * 3600 * 1000;
  const last30 = attempts.filter((a) => now - a.takenAt.getTime() <= THIRTY_DAYS_MS).length;
  const last90 = attempts.filter((a) => now - a.takenAt.getTime() <= NINETY_DAYS_MS).length;
  const prev30 = attempts.filter((a) => {
    const d = now - a.takenAt.getTime();
    return d > THIRTY_DAYS_MS && d <= 2 * THIRTY_DAYS_MS;
  }).length;

  const byClusterRaw = new Map<ClusterCode, number[]>();
  const retakesByLearnerCluster = new Map<string, number>();
  const timeSecsAll: number[] = [];
  for (const a of attempts) {
    const arr = byClusterRaw.get(a.clusterCode) ?? [];
    arr.push(a.scoreNorm);
    byClusterRaw.set(a.clusterCode, arr);
    timeSecsAll.push(a.timeSecs);
    if (a.kind === AttemptKind.retake) {
      const k = `${a.learnerId}|${a.clusterCode}`;
      retakesByLearnerCluster.set(k, (retakesByLearnerCluster.get(k) ?? 0) + 1);
    }
  }

  const avgScore = attempts.length === 0 ? 0 : attempts.reduce((a, x) => a + x.scoreNorm, 0) / attempts.length;
  const avgTime = timeSecsAll.length === 0 ? 0 : timeSecsAll.reduce((a, b) => a + b, 0) / timeSecsAll.length;

  let passCount = 0;
  let varianceFlagged = 0;
  const byCluster = clusters.map((c) => {
    const arr = byClusterRaw.get(c.code) ?? [];
    const n = arr.length;
    const threshold = thresholds[c.code] ?? 60;
    const pass = arr.filter((s) => s >= threshold).length;
    passCount += pass;
    const mean = n === 0 ? 0 : arr.reduce((a, b) => a + b, 0) / n;
    const variance = n === 0 ? 0 : arr.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
    const sd = Math.sqrt(variance);
    const varianceFlag = sd > 16;
    if (varianceFlag) varianceFlagged += 1;
    return {
      cluster: c.code,
      name: c.name,
      attempts: n,
      avgScore: round1(mean),
      stdDev: round1(sd),
      passRate: n === 0 ? 0 : round3(pass / n),
      varianceFlag,
    };
  });
  const passRate = attempts.length === 0 ? 0 : passCount / attempts.length;
  const retakeRate = attempts.length === 0
    ? 0
    : Array.from(retakesByLearnerCluster.values()).reduce((a, b) => a + b, 0) / attempts.length;

  const histogram = HIST_BUCKETS.map((b) => ({
    lo: b.lo,
    hi: b.hi,
    count: attempts.filter((a) => a.scoreNorm >= b.lo && a.scoreNorm < b.hi).length,
  }));

  const bankHealth = clusters.map((c) => {
    const content = contentItems.filter((i) => i.clusterCode === c.code).length;
    const baseline = bankItems.filter((i) => i.clusterCode === c.code && i.kind === 'baseline').length;
    const post = bankItems.filter((i) => i.clusterCode === c.code && i.kind === 'post_augmentation').length;
    const total = content + baseline + post;
    let coverage: 'strong' | 'adequate' | 'thin' = 'strong';
    if (total < 4) coverage = 'thin';
    else if (total < 6) coverage = 'adequate';
    return { cluster: c.code, name: c.name, contentItems: content, baselineItems: baseline, postAugItems: post, coverage };
  });

  // Narrative — headline, trend metrics, string insights
  const trend30 = prev30 === 0 ? 0 : (last30 - prev30) / Math.max(1, prev30);
  const strongestCluster = [...byCluster].sort((a, b) => b.passRate - a.passRate)[0];
  const weakestCluster   = [...byCluster].filter((c) => c.attempts > 0).sort((a, b) => a.passRate - b.passRate)[0];
  const thinBanks = bankHealth.filter((b) => b.coverage === 'thin');

  const insights: string[] = [];
  insights.push(`${attempts.length} attempts logged across ${byCluster.filter((c) => c.attempts > 0).length} clusters; pass rate ${(passRate * 100).toFixed(0)}%.`);
  if (strongestCluster && strongestCluster.attempts > 0) {
    insights.push(`Strongest cluster: ${strongestCluster.name} (${(strongestCluster.passRate * 100).toFixed(0)}% pass, avg ${strongestCluster.avgScore}).`);
  }
  if (weakestCluster && weakestCluster.attempts > 0 && weakestCluster !== strongestCluster) {
    insights.push(`Weakest cluster: ${weakestCluster.name} (${(weakestCluster.passRate * 100).toFixed(0)}% pass, avg ${weakestCluster.avgScore}) — augment here first.`);
  }
  if (varianceFlagged > 0) {
    insights.push(`${varianceFlagged} cluster${varianceFlagged !== 1 ? 's show' : ' shows'} wide score spread (stdDev > 16) — item calibration review recommended.`);
  }
  if (thinBanks.length > 0) {
    insights.push(`${thinBanks.length} cluster${thinBanks.length !== 1 ? 's have' : ' has'} thin bank coverage — add more items to improve confidence.`);
  }
  if (Math.abs(trend30) > 0.1) {
    const dir = trend30 > 0 ? 'up' : 'down';
    insights.push(`Attempt volume ${dir} ${Math.abs(trend30 * 100).toFixed(0)}% vs prior 30d.`);
  }

  const summary = {
    headline: attempts.length === 0
      ? 'No assessment activity yet — seed attempts to populate analytics.'
      : `${attempts.length} attempts • ${(passRate * 100).toFixed(0)}% pass rate • ${(retakeRate * 100).toFixed(0)}% retake rate.`,
    metrics: [
      { label: 'Attempts (30d)', value: last30,  trend: trend30 > 0.1 ? 'up' : trend30 < -0.1 ? 'down' : 'flat' },
      { label: 'Pass rate',       value: `${(passRate * 100).toFixed(0)}%`, trend: passRate >= 0.5 ? 'up' : 'down' },
      { label: 'Avg score',       value: round1(avgScore), trend: avgScore >= 65 ? 'up' : 'down' },
      { label: 'Retake rate',     value: `${(retakeRate * 100).toFixed(0)}%`, trend: retakeRate < 0.3 ? 'up' : 'down' },
    ] as Array<{ label: string; value: string | number; trend: 'up' | 'down' | 'flat' }>,
  };

  const confidence = confidenceScore({
    completeness: Math.min(1, byCluster.filter((c) => c.attempts > 0).length / 8),
    stability: 1 - Math.min(1, varianceFlagged / 8),
    sufficiency: Math.min(1, attempts.length / 200),
    consistency: 0.75,
  });

  return {
    kpis: {
      attemptsTotal: attempts.length,
      attemptsLast30d: last30,
      attemptsLast90d: last90,
      avgScore: round1(avgScore),
      avgTimeSecs: Math.round(avgTime),
      passRate: round3(passRate),
      retakeRate: round3(retakeRate),
      varianceFlagged,
      confidence: round3(confidence),
    },
    summary,
    insights,
    histogram,
    byCluster,
    bankHealth,
  };
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const round3 = (n: number) => Math.round(n * 1000) / 1000;
