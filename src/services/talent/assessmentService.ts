/**
 * Assessment bank + attempt grading. Items come from static assessmentBank.json;
 * attempts are persisted to AssessmentAttemptV2.
 */
import type { ClusterCode, AssessmentItemKind } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { prisma } from '../../config/db.js';
import { AppError } from '../../utils/AppError.js';
import { getLearnerIdOrThrow } from './learnerContext.js';
import {
  loadAssessmentBank, type AssessmentItem, det01,
} from './helpers.js';
import {
  scoreWeighted as scoreWeightedFn,
  confidenceScore,
  freshness as freshnessFormula,
  stability,
  sufficiency,
  consistency,
  completeness,
} from '../competency/formulas.js';
import { formulasVersion, SUPPRESSION_THRESHOLD } from '../competency/formulas.config.js';
import { signPayload } from '../signal/tokenSigner.js';
import { send as sendNotification } from '../notification/notificationService.js';

/**
 * Strips server-only fields AND normalizes field names to match the
 * frontend DTO shape expected by the talent-app QuestionRenderer:
 *   descriptive: rubricBullets → rubric, adds minWords
 *   simulation:  roleContext object → flat array, expectedOutputHint → expectedOutput
 */
function stripAnswers(item: AssessmentItem): Record<string, unknown> {
  if (item.kind === 'mcq') {
    const { correctOptionId: _c, ...rest } = item;
    void _c;
    return rest as Record<string, unknown>;
  }
  if (item.kind === 'descriptive') {
    return {
      id: item.id,
      clusterCode: item.clusterCode,
      kind: item.kind,
      title: item.title,
      prompt: item.prompt,
      timeLimitSec: item.timeLimitSec,
      rubric: item.rubricBullets,
      minWords: 50,
    };
  }
  if (item.kind === 'simulation') {
    const rc = item.roleContext;
    const roleContextArr = [
      ...(rc.you ? [{ label: 'You', description: rc.you, you: true }] : []),
      ...(rc.stakeholders ?? []).map((s) => ({ label: s.role, description: s.position, you: false })),
    ];
    return {
      id: item.id,
      clusterCode: item.clusterCode,
      kind: item.kind,
      title: item.title,
      prompt: item.prompt,
      timeLimitSec: item.timeLimitSec,
      roleContext: roleContextArr,
      expectedOutput: item.expectedOutputHint,
    };
  }
  // coding — fields already match frontend shape
  return item as unknown as Record<string, unknown>;
}

export async function listAssessments(userId: string, q: { clusterCode?: ClusterCode; careerTrackId?: string }) {
  const learnerId = await getLearnerIdOrThrow(userId);
  const items = loadAssessmentBank();
  const filtered = items.filter((i) => !q.clusterCode || i.clusterCode === q.clusterCode);
  // Return AssessmentListItemDTO[] directly (no wrapper object).
  const [clusterDefs, recentAttempts] = await Promise.all([
    prisma.competencyCluster.findMany({ orderBy: { code: 'asc' } }),
    prisma.assessmentAttemptV2.findMany({
      where: { learnerId },
      orderBy: { submittedAt: 'desc' },
      select: { assessmentRef: true, score: true },
    }),
  ]);
  const nameMap = new Map(clusterDefs.map((c) => [c.code, c.name]));
  // Build a map of assessmentRef → most recent score (list is already ordered desc).
  const latestScoreMap = new Map<string, number | null>();
  for (const attempt of recentAttempts) {
    if (!latestScoreMap.has(attempt.assessmentRef)) {
      latestScoreMap.set(attempt.assessmentRef, attempt.score ?? null);
    }
  }
  return filtered.map((i) => {
    const realScore = latestScoreMap.get(i.id) ?? null;
    return {
      id: i.id,
      clusterCode: i.clusterCode,
      clusterName: nameMap.get(i.clusterCode) ?? i.clusterCode,
      kind: i.kind,
      title: i.title,
      itemCount: 1,
      estMinutes: Math.ceil((i.timeLimitSec ?? 300) / 60),
      lastAttemptScore: realScore,
      lastAttemptConfidence: null,
    };
  });
}

export async function getAssessment(userId: string, id: string) {
  await getLearnerIdOrThrow(userId);
  const items = loadAssessmentBank();
  const found = items.find((i) => i.id === id);
  if (!found) throw new AppError('NOT_FOUND', 'Assessment item not found');
  // Look up clusterName from DB
  const { prisma: db } = await import('../../config/db.js');
  const clusterDef = await db.competencyCluster.findUnique({ where: { code: found.clusterCode } });
  // Return AssessmentDTO shape: wrap single item in items array
  return {
    id: found.id,
    title: found.title,
    clusterCode: found.clusterCode,
    clusterName: clusterDef?.name ?? found.clusterCode,
    kind: found.kind,
    estMinutes: Math.ceil((found.timeLimitSec ?? 300) / 60),
    items: [stripAnswers(found)],
  };
}

type SubmitAnswers =
  | { kind: 'mcq'; selectedOptionId: string }
  | { kind: 'descriptive'; text: string }
  | { kind: 'coding'; code: string }
  | { kind: 'simulation'; response: string };

interface ProctorFlags {
  tabSwitches?: number;
  copyAttempts?: number;
  fullscreenExits?: number;
}

export async function submitAttempt(
  userId: string,
  id: string,
  body: {
    careerTrackId?: string;
    timeSpentSec: number;
    answers: SubmitAnswers;
    proctorFlags?: ProctorFlags;
  },
) {
  const learnerId = await getLearnerIdOrThrow(userId);
  const items = loadAssessmentBank();
  const item = items.find((i) => i.id === id);
  if (!item) throw new AppError('NOT_FOUND', 'Assessment item not found');
  if (item.kind !== body.answers.kind) throw new AppError('VALIDATION_ERROR', 'Answer kind mismatch');

  let score = 0;
  let feedback: unknown = null;
  let aiAuthoredLikelihood: number | null = null;

  // BC 68 — Proctoring flags check
  const pf = body.proctorFlags ?? {};
  const proctorViolations = (pf.tabSwitches ?? 0) + (pf.fullscreenExits ?? 0);
  const proctorFlagged = proctorViolations >= 3;

  if (item.kind === 'mcq' && body.answers.kind === 'mcq') {
    // BC 65 — server-side MCQ grading
    const correct = body.answers.selectedOptionId === item.correctOptionId;
    score = correct ? 100 : 0;
    feedback = {
      correctOptionId: item.correctOptionId,
      selectedOptionId: body.answers.selectedOptionId,
      correct,
      explanation: (item as unknown as { explanation?: string }).explanation ?? null,
    };
  } else if (item.kind === 'descriptive' && body.answers.kind === 'descriptive') {
    // BC 66 — descriptive attempt with Groq grading
    const text = body.answers.text;
    const bullets = item.rubricBullets;

    // gradeDescriptive() handles Groq-vs-mock internally now (MVP-SCAFFOLD)
    // so we always call it. If both Groq AND its mock fail (unlikely), we
    // still drop to the legacy deterministic keyword grader below.
    let aiGraded: (ReturnType<typeof Object.assign> & { aiAuthoredLikelihood?: number }) | null = null;
    try {
      const { gradeDescriptive } = await import('../ai/prompts/gradeDescriptive.js');
      const rubricMap: Record<string, string> = {};
      bullets.forEach((b, i) => { rubricMap[`criterion_${i + 1}`] = b; });
      const { graded, meta } = await gradeDescriptive({
        question: item.prompt,
        rubric:   rubricMap,
        answer:   text,
        clusterCode: item.clusterCode,
      });
      score = graded.score;
      // BC 66 — capture aiAuthoredLikelihood from graded result
      aiAuthoredLikelihood = (graded as unknown as { aiAuthoredLikelihood?: number }).aiAuthoredLikelihood ?? null;
      aiGraded = { ...graded, model: meta.model, latencyMs: meta.latencyMs };
      feedback = { ai: aiGraded, fallback: false };
    } catch (err) {
      // Both Groq and its mock failed — log and fall through to legacy keyword grader.
      // eslint-disable-next-line no-console
      console.warn('[v3] gradeDescriptive failed, falling back to deterministic:', (err as Error).message);
    }
    if (aiGraded === null) {
      const lower = text.toLowerCase();
      const matched = bullets.map((b) => {
        const firstWord = b.split(/[^a-z]+/i).find((w) => w.length > 4)?.toLowerCase() ?? '';
        return { bullet: b, hit: firstWord.length > 0 && lower.includes(firstWord) };
      });
      const hits = matched.filter((m) => m.hit).length;
      const base = bullets.length === 0 ? 0 : hits / bullets.length;
      const jitter = det01(learnerId + '|' + id) * 0.1;
      score = Math.min(100, Math.round((base + jitter) * 100));
      feedback = { matchedBullets: matched, hits, total: bullets.length, fallback: true };
    }
  } else if (item.kind === 'coding' && body.answers.kind === 'coding') {
    const code = body.answers.code;
    const casesCount = item.testCases.length;
    // Deterministic: each case passes if code contains the expected answer substring OR
    // if code length ≥ 60 chars (proxy for "real attempt").
    const results = item.testCases.map((tc) => {
      const passes = code.includes(tc.expected) || (code.length > 60 && det01(learnerId + '|' + id + '|' + tc.input) > 0.35);
      return { input: tc.input, expected: tc.expected, pass: passes };
    });
    const passed = results.filter((r) => r.pass).length;
    score = casesCount === 0 ? 0 : Math.round((passed / casesCount) * 100);
    feedback = { testCases: results, passed, total: casesCount };
  } else if (item.kind === 'simulation' && body.answers.kind === 'simulation') {
    const response = body.answers.response;
    // Score on length + keyword hits against expectedOutputHint.
    const hintWords = item.expectedOutputHint.toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 4);
    const text = response.toLowerCase();
    const hits = hintWords.filter((w) => text.includes(w)).length;
    const base = hintWords.length === 0 ? 0 : hits / hintWords.length;
    const lengthFactor = Math.min(1, response.length / 600);
    score = Math.round(Math.min(100, (base * 0.6 + lengthFactor * 0.4) * 100));
    feedback = { hitKeywords: hintWords.filter((w) => text.includes(w)), total: hintWords.length, lengthFactor: Math.round(lengthFactor * 100) / 100 };
  } else {
    throw new AppError('VALIDATION_ERROR', 'Unsupported kind');
  }

  // BC 67 — AI-authored likelihood gate
  const aiSuspicious = aiAuthoredLikelihood !== null && aiAuthoredLikelihood > 0.85;

  // BC 68 — proctoring flag gate
  const isSuspicious = aiSuspicious || proctorFlagged;

  // v3 — extract aiFeedback envelope for the dedicated column (when descriptive went via Groq)
  const fbAny = feedback as { ai?: { model?: string } } | null;
  const isAi = !!(fbAny && typeof fbAny === 'object' && 'ai' in fbAny && fbAny.ai);
  const created = await prisma.assessmentAttemptV2.create({
    data: {
      learnerId,
      clusterCode: item.clusterCode,
      kind: item.kind as AssessmentItemKind,
      careerTrackId: body.careerTrackId ?? null,
      assessmentRef: item.id,
      score,
      timeSpentSec: body.timeSpentSec,
      answers: body.answers as unknown as Prisma.InputJsonValue,
      feedback: feedback as Prisma.InputJsonValue,
      aiFeedback: isAi ? (fbAny!.ai as unknown as Prisma.InputJsonValue) : Prisma.JsonNull,
      aiGradedAt: isAi ? new Date() : null,
      aiModel:    isAi ? (fbAny!.ai!.model ?? null) : null,
      // BC 66/67/68 — AI-authored likelihood, proctoring flags, suspicious flag
      aiAuthoredLikelihood: aiAuthoredLikelihood ?? null,
      proctorFlags: body.proctorFlags ? (body.proctorFlags as unknown as Prisma.InputJsonValue) : Prisma.JsonNull,
      suspicious: isSuspicious,
    },
  });

  // BC 67 — send institution notification if AI-authored
  if (aiSuspicious) {
    await notifyInstitutionStaff(learnerId, aiAuthoredLikelihood, false);
  }
  // BC 68 — send institution notification if proctoring flagged
  if (proctorFlagged) {
    await notifyInstitutionStaff(learnerId, null, true);
  }

  // BC 69+70+71 — recompute score and regenerate signal only if not suspicious
  if (!isSuspicious) {
    // Capture previous confidence before recomputing
    const prevScore = await prisma.competencyScore.findUnique({
      where: { learnerId_clusterCode: { learnerId, clusterCode: item.clusterCode as ClusterCode } },
      select: { confidence: true },
    });
    const previousConfidence = prevScore?.confidence ?? null;
    const recomputeResult = await recomputeCompetencyScore(learnerId, item.clusterCode);
    await maybeRegenerateSignal(
      learnerId,
      item.clusterCode,
      { scoreWeighted: recomputeResult.scoreWeighted, confidence: recomputeResult.confidence, freshness: recomputeResult.freshness },
      previousConfidence,
    );
  }

  const mcqFeedback = feedback as { correct?: boolean; explanation?: string | null } | null;
  return {
    id: created.id,
    assessmentRef: created.assessmentRef,
    clusterCode: created.clusterCode,
    kind: created.kind,
    score,
    correct: item.kind === 'mcq' ? (mcqFeedback?.correct ?? false) : undefined,
    explanation: item.kind === 'mcq' ? (mcqFeedback?.explanation ?? null) : undefined,
    timeSpentSec: created.timeSpentSec,
    submittedAt: created.submittedAt.toISOString(),
    suspicious: isSuspicious,
    feedback,
  };
}

export async function listAttempts(userId: string) {
  const learnerId = await getLearnerIdOrThrow(userId);
  const rows = await prisma.assessmentAttemptV2.findMany({
    where: { learnerId },
    orderBy: { submittedAt: 'desc' },
  });
  const mapped = rows.map((r) => ({
    id: r.id,
    assessmentRef: r.assessmentRef,
    clusterCode: r.clusterCode,
    kind: r.kind,
    score: r.score,
    timeSpentSec: r.timeSpentSec,
    submittedAt: r.submittedAt.toISOString(),
    careerTrackId: r.careerTrackId,
  }));

  return mapped;
}

// ─── BC 69 — CompetencyScore atomic recompute ────────────────────────────────

export async function recomputeCompetencyScore(
  learnerId: string,
  clusterCode: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  prismaOrTx: any = prisma,
): Promise<{ scoreWeighted: number; confidence: number; freshness: number; previousScore: number | null }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db: typeof prisma = prismaOrTx as any;

  // 1. Fetch all non-suspicious attempts for this learner+cluster
  const attempts = await db.assessmentAttemptV2.findMany({
    where: { learnerId, clusterCode: clusterCode as ClusterCode, suspicious: false },
    orderBy: { submittedAt: 'asc' },
  });

  const scores = attempts.map((a) => (a.score ?? 0) / 100); // normalise 0..1
  const recentScores = scores.slice(-5);
  const lastAttemptAt = attempts.length > 0 ? attempts[attempts.length - 1].submittedAt : null;
  const daysSince = lastAttemptAt
    ? (Date.now() - lastAttemptAt.getTime()) / (1000 * 60 * 60 * 24)
    : null;

  const sw = scoreWeightedFn(scores) * 100; // scale back to 0..100
  const conf = confidenceScore({
    completeness: completeness(1, 1), // single cluster — always 1/1
    stability: stability(recentScores),
    sufficiency: sufficiency(attempts.length),
    consistency: consistency(scores),
  });
  const fresh = freshnessFormula(daysSince);

  // 2. Get existing score for audit
  const existing = await db.competencyScore.findUnique({
    where: { learnerId_clusterCode: { learnerId, clusterCode: clusterCode as ClusterCode } },
  });

  // 3. Upsert CompetencyScore atomically (increment version)
  await db.competencyScore.upsert({
    where: { learnerId_clusterCode: { learnerId, clusterCode: clusterCode as ClusterCode } },
    create: {
      learnerId,
      clusterCode: clusterCode as ClusterCode,
      scoreWeighted: sw,
      confidence: conf,
      freshness: fresh,
      attemptsCount: attempts.length,
      lastAttemptAt,
      version: 1,
    },
    update: {
      scoreWeighted: sw,
      confidence: conf,
      freshness: fresh,
      attemptsCount: attempts.length,
      lastAttemptAt,
      version: { increment: 1 },
    },
  });

  // 4. Write AuditLog
  await db.auditLog.create({
    data: {
      userId: learnerId,
      action: 'score_recomputed',
      entityType: 'CompetencyScore',
      entityId: `${learnerId}:${clusterCode}`,
      before: existing
        ? ({ scoreWeighted: existing.scoreWeighted, confidence: existing.confidence } as Prisma.InputJsonValue)
        : Prisma.JsonNull,
      after: { scoreWeighted: sw, confidence: conf } as Prisma.InputJsonValue,
    },
  });

  return { scoreWeighted: sw, confidence: conf, freshness: fresh, previousScore: existing?.scoreWeighted ?? null };
}

// ─── BC 70-71 — Signal regeneration (idempotent) ─────────────────────────────

export async function maybeRegenerateSignal(
  learnerId: string,
  clusterCode: string,
  newScore: { scoreWeighted: number; confidence: number; freshness: number },
  previousConfidence: number | null,
): Promise<void> {
  const wasSupressed = previousConfidence === null || previousConfidence < SUPPRESSION_THRESHOLD;
  const isNowActive = newScore.confidence >= SUPPRESSION_THRESHOLD;
  const wasActive = !wasSupressed;

  // If confidence just dropped below threshold, revoke existing signal
  if (wasActive && !isNowActive) {
    await prisma.gradiumSignal.updateMany({
      where: { learnerId, clusterCode: clusterCode as ClusterCode, state: 'issued' },
      data: { state: 'revoked', revokedAt: new Date() },
    });
    return;
  }

  if (!isNowActive) return; // still suppressed, nothing to do

  // Check if existing valid signal is unchanged
  const existingSignal = await prisma.gradiumSignal.findFirst({
    where: { learnerId, clusterCode: clusterCode as ClusterCode, state: 'issued' },
    orderBy: { issuedAt: 'desc' },
  });

  // Idempotency: if score/confidence unchanged, keep existing signal (BC 71)
  if (existingSignal?.portableToken) {
    try {
      const parts = existingSignal.portableToken.split('.');
      const payload = JSON.parse(
        Buffer.from(parts[1], 'base64url').toString(),
      ) as { score?: number; confidence?: number };
      if (
        payload.score !== undefined &&
        payload.confidence !== undefined &&
        Math.abs(payload.score - newScore.scoreWeighted) < 0.001 &&
        Math.abs(payload.confidence - newScore.confidence) < 0.001
      ) {
        return; // No change — keep existing token
      }
    } catch {
      // malformed token — fall through to reissue
    }
    // Revoke old signal
    await prisma.gradiumSignal.update({
      where: { id: existingSignal.id },
      data: { state: 'revoked', revokedAt: new Date() },
    });
  }

  // Issue new signal — upsert since @@unique([learnerId, clusterCode])
  const token = signPayload({
    sub: learnerId,
    cluster: clusterCode,
    score: newScore.scoreWeighted,
    confidence: newScore.confidence,
    freshness: newScore.freshness,
    versionTag: formulasVersion,
  });

  const now = new Date();
  const expiresAt = new Date(now.getTime() + 2 * 365 * 24 * 60 * 60 * 1000);
  await prisma.gradiumSignal.upsert({
    where: { learnerId_clusterCode: { learnerId, clusterCode: clusterCode as ClusterCode } },
    create: {
      learnerId,
      clusterCode: clusterCode as ClusterCode,
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
}

// ─── BC 67/68 shared — suspicious notification helper ────────────────────────

async function notifyInstitutionStaff(
  learnerId: string,
  aiAuthoredLikelihood: number | null,
  proctorFlagged: boolean,
): Promise<void> {
  const learner = await prisma.learner.findUnique({
    where: { id: learnerId },
    select: { institutionId: true },
  });
  if (!learner) return;

  const deanUsers = await prisma.user.findMany({
    where: {
      institutionId: learner.institutionId,
      role: { in: ['DEAN', 'PLACEMENT_OFFICER'] },
    },
    select: { id: true },
  });

  if (deanUsers.length === 0) return;

  const body = proctorFlagged
    ? 'A learner attempt was flagged for proctoring violations (tab switches or fullscreen exits ≥ 3). Review required.'
    : `A learner attempt was flagged (AI-authored likelihood: ${((aiAuthoredLikelihood ?? 0) * 100).toFixed(0)}%). Review required.`;

  // BC 128 — suspicious_attempt is an institutional-admin event outside the
  // N1-N15 learner/employer catalogue; direct insert is intentional here.
  // Phase E can extend NotificationEvent if this needs email dispatch too.
  await prisma.notification.createMany({
    data: deanUsers.map((u) => ({
      userId: u.id,
      type: 'suspicious_attempt',
      title: 'Attempt flagged for review',
      body,
      deepLink: `/campus/learners/${learnerId}/attempts`,
    })),
  });
}
