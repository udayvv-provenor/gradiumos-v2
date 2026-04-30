/**
 * Tutor sessions — persisted to TutorSession with a transcript Json blob.
 *
 * v3 — replies come from real Groq calls when GROQ_API_KEY is configured.
 * Falls back to the deterministic tutorMock if Groq isn't set up so the
 * surface still demos cleanly without an API key.
 */
import type { ClusterCode, Prisma } from '@prisma/client';
import { prisma } from '../../config/db.js';
import { AppError } from '../../utils/AppError.js';
import { getLearnerIdOrThrow } from './learnerContext.js';
import { loadSubtopics } from './helpers.js';
import { openingMessage, tutorReply as mockTutorReply } from './tutorMock.js';
import { tutorReply as groqTutorReply, type LearnerBand } from '../ai/prompts/tutorChat.js';
import { signalBandFor } from '../competency/formulas.js';
import { featureFlags } from '../featureFlags/featureFlagService.js';
import { requireConsent } from '../consent/consentService.js';

interface TranscriptTurn { role: 'user' | 'tutor'; content: string; ts: string; conceptTags?: string[] }

function resolveSubtopic(clusterCode: ClusterCode, subtopicCode: string) {
  const all = loadSubtopics();
  const found = all.find((st) => st.code === subtopicCode && st.clusterCode === clusterCode);
  if (found) return found;
  // v3.1.6 — synthesise if well-formed code from this cluster
  if (new RegExp(`^${clusterCode}\\.[A-Z0-9][A-Z0-9-]{0,40}$`).test(subtopicCode)) {
    return {
      code: subtopicCode,
      clusterCode,
      name: subtopicCode.split('.')[1].split('-').map((w) => w[0] + w.slice(1).toLowerCase()).join(' '),
      required: false,
      inCurriculum: {} as Record<string, boolean>,
    };
  }
  throw new AppError('NOT_FOUND', 'Sub-topic not found');
}

export async function startSession(userId: string, payload: { clusterCode: ClusterCode; subtopicCode: string }) {
  // BC 72 — feature flag gate
  if (!await featureFlags.isEnabled('TUTOR_ENABLED')) {
    throw new AppError('FEATURE_DISABLED', 'AI Tutor is currently unavailable.');
  }
  const learnerId = await getLearnerIdOrThrow(userId);
  // BC 14 — DPDP consent gate before creating any tutor session
  await requireConsent(userId, 'tutor-AI');
  const subtopic = resolveSubtopic(payload.clusterCode, payload.subtopicCode);
  const opening: TranscriptTurn = {
    role: 'tutor',
    content: openingMessage({ code: subtopic.code, clusterCode: subtopic.clusterCode, name: subtopic.name }),
    ts: new Date().toISOString(),
  };
  const created = await prisma.tutorSession.create({
    data: {
      learnerId,
      clusterCode: payload.clusterCode,
      subtopicCode: payload.subtopicCode,
      transcript: [opening] as unknown as Prisma.InputJsonValue,
    },
  });
  return {
    id: created.id,
    clusterCode: created.clusterCode,
    subtopicCode: created.subtopicCode,
    startedAt: created.startedAt.toISOString(),
    transcript: [opening],
  };
}

export async function addTurn(userId: string, sessionId: string, content: string) {
  const learnerId = await getLearnerIdOrThrow(userId);
  // BC 73 — consent check before calling Groq
  await requireConsent(userId, 'tutor-AI');
  const session = await prisma.tutorSession.findUnique({ where: { id: sessionId } });
  if (!session || session.learnerId !== learnerId) throw new AppError('NOT_FOUND', 'Tutor session not found');
  if (session.endedAt) throw new AppError('CONFLICT', 'Session already ended');

  const transcript = Array.isArray(session.transcript)
    ? (session.transcript as unknown as TranscriptTurn[])
    : [];
  const now = new Date().toISOString();
  const userTurn: TranscriptTurn = { role: 'user', content, ts: now };
  const subtopic = resolveSubtopic(session.clusterCode, session.subtopicCode);
  const turnIdx = transcript.filter((t) => t.role === 'user').length;

  // v3 — real Groq tutor when key set, else deterministic mock
  let tutorContent: string;
  let turnConceptTags: string[] = [];
  if (process.env.GROQ_API_KEY && process.env.GROQ_API_KEY !== 'YOUR_GROQ_KEY_HERE') {
    try {
      // Derive a qualitative band from the learner's cluster score.
      // IP rule #2: no raw numeric cluster scores in Groq prompts.
      const scoreRow = await prisma.competencyScore.findFirst({
        where: { learnerId, clusterCode: session.clusterCode },
      });
      const learnerBand: LearnerBand = scoreRow
        ? (signalBandFor(scoreRow.scoreWeighted) as LearnerBand)
        : 'Emerging';
      const cluster = await prisma.competencyCluster.findUnique({ where: { code: session.clusterCode } });
      const history = transcript.map((t) => ({
        role: (t.role === 'tutor' ? 'assistant' : 'user') as 'user' | 'assistant',
        content: t.content,
      }));
      const { reply } = await groqTutorReply({
        clusterCode:  session.clusterCode,
        clusterName:  cluster?.name ?? session.clusterCode,
        clusterBlurb: cluster?.description ?? '',
        subTopic:     subtopic.name,
        learnerBand,
        history,
        userMessage:  content,
      });
      tutorContent = reply.reply;
      // BC 73 — capture concept_tags from the reply for end-session summary
      turnConceptTags = reply.conceptTags ?? [];
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[v3] tutor groq failed, falling back to mock:', (err as Error).message);
      tutorContent = mockTutorReply(
        { code: subtopic.code, clusterCode: subtopic.clusterCode, name: subtopic.name },
        session.id, turnIdx,
      );
    }
  } else {
    tutorContent = mockTutorReply(
      { code: subtopic.code, clusterCode: subtopic.clusterCode, name: subtopic.name },
      session.id, turnIdx,
    );
  }

  const tutorTurn: TranscriptTurn = {
    role: 'tutor',
    content: tutorContent,
    ts: new Date().toISOString(),
    ...(turnConceptTags.length > 0 ? { conceptTags: turnConceptTags } : {}),
  };
  const newTranscript = [...transcript, userTurn, tutorTurn];
  await prisma.tutorSession.update({
    where: { id: session.id },
    data: { transcript: newTranscript as unknown as Prisma.InputJsonValue },
  });
  return { id: session.id, transcript: newTranscript, reply: tutorTurn };
}

export async function getSession(userId: string, sessionId: string) {
  const learnerId = await getLearnerIdOrThrow(userId);
  const session = await prisma.tutorSession.findUnique({ where: { id: sessionId } });
  if (!session || session.learnerId !== learnerId) throw new AppError('NOT_FOUND', 'Tutor session not found');
  return {
    id: session.id,
    clusterCode: session.clusterCode,
    subtopicCode: session.subtopicCode,
    startedAt: session.startedAt.toISOString(),
    endedAt: session.endedAt?.toISOString() ?? null,
    transcript: session.transcript,
    rubric: session.rubric,
  };
}

export async function endSession(userId: string, sessionId: string) {
  const learnerId = await getLearnerIdOrThrow(userId);
  const session = await prisma.tutorSession.findUnique({ where: { id: sessionId } });
  if (!session || session.learnerId !== learnerId) throw new AppError('NOT_FOUND', 'Tutor session not found');

  const transcript = Array.isArray(session.transcript) ? (session.transcript as unknown as TranscriptTurn[]) : [];
  const userTurns = transcript.filter((t) => t.role === 'user').length;

  // Synthetic rubric: understanding delta scales with turn-count (capped).
  const understandingDelta = Math.min(0.4, 0.05 + userTurns * 0.04);
  const confidenceDelta = Math.min(0.3, 0.03 + userTurns * 0.03);

  // BC 74 — session summary: extract concept_tags from all tutor turns
  const conceptsCovered = Array.from(
    new Set(
      transcript
        .filter((t) => t.role === 'tutor' && Array.isArray(t.conceptTags))
        .flatMap((t) => t.conceptTags as string[]),
    ),
  );

  const suggestedNextSteps = conceptsCovered.length > 0
    ? [
        `Revisit the following concepts in a new session: ${conceptsCovered.slice(0, 3).join(', ')}.`,
        `Attempt an assessment on cluster ${session.clusterCode} to verify understanding.`,
        'Practice applying these concepts in a real project context.',
      ]
    : [
        `Start a new tutor session on ${session.subtopicCode} with more questions.`,
        `Attempt the ${session.clusterCode} assessment to measure your progress.`,
      ];

  const recommendedAssessmentCluster = session.clusterCode;

  // Store summary as a top-level key in the rubric JSON (TutorSession has no dedicated summary column)
  const rubricData = {
    understandingDelta: Math.round(understandingDelta * 1000) / 1000,
    confidenceDelta: Math.round(confidenceDelta * 1000) / 1000,
    turns: userTurns,
    summary: {
      conceptsCovered,
      suggestedNextSteps,
      recommendedAssessmentCluster,
    },
  };

  const updated = await prisma.tutorSession.update({
    where: { id: session.id },
    data: {
      endedAt: new Date(),
      rubric: rubricData as unknown as Prisma.InputJsonValue,
    },
  });
  return {
    id: updated.id,
    endedAt: updated.endedAt?.toISOString() ?? null,
    rubric: updated.rubric,
    summary: rubricData.summary,
  };
}
