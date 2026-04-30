/**
 * gradeDescriptive — given a question prompt, the learner's answer, and a
 * grading rubric, produce a 0..100 score plus structured feedback.
 *
 * IP-protection: the rubric is provided per assessment item by the question
 * bank. We don't send formula constants or threshold tables.
 */
import { z } from 'zod';
import { callGroq, isGroqConfigured } from '../groqClient.js';
import { safeParseLenient } from '../unwrapJson.js';
import { compileSkill } from '../skills/registry.js';

export const GradedAnswerSchema = z.object({
  score:       z.number().int().min(0).max(100),
  // Per-criterion breakdown (criterion → 0..100)
  rubricScore: z.record(z.string(), z.number().int().min(0).max(100)),
  strengths:   z.array(z.string().min(2).max(280)).max(8),
  gaps:        z.array(z.string().min(2).max(280)).max(8),
  suggestions: z.array(z.string().min(2).max(280)).max(8),
  oneLine:     z.string().min(5).max(280),
  // BC 66 — AI-authored likelihood: 0 = human, 1 = likely AI-generated
  aiAuthoredLikelihood: z.number().min(0).max(1).optional().default(0),
});
export type GradedAnswer = z.infer<typeof GradedAnswerSchema>;

// IP layer — composed at call-time from skills/tasks/grade-descriptive.md
function getSystemPrompt(): string { return compileSkill('grade-descriptive'); }

export async function gradeDescriptive(args: {
  question: string;
  rubric:   string | Record<string, string>; // string description OR criterion -> description map
  answer:   string;
  clusterCode?: string;
}): Promise<{ graded: GradedAnswer; meta: { latencyMs: number; tokens: number; model: string } }> {
  const rubricText =
    typeof args.rubric === 'string'
      ? args.rubric
      : Object.entries(args.rubric).map(([k, v]) => `- ${k}: ${v}`).join('\n');

  // MVP-SCAFFOLD: when GROQ_API_KEY is unset, return a deterministic mock so
  // descriptive-assessment submission flows through to the UI feedback panel
  // without a real key. Remove this branch once Groq is wired in production.
  if (!isGroqConfigured()) {
    return { graded: mockGrade(args.answer, args.rubric), meta: { latencyMs: 0, tokens: 0, model: 'mock-no-groq' } };
  }

  let result: { raw: unknown; latencyMs: number; inputTokens: number; outputTokens: number; model: string };
  try {
    result = await callGroq({
      operation: 'gradeDescriptive',
      system: getSystemPrompt(),
      user: `Cluster: ${args.clusterCode ?? 'unspecified'}

Question:
${args.question}

Rubric:
${rubricText}

Learner's answer:
${args.answer.slice(0, 6000)}

Grade now. JSON only.`,
      json: true,
      temperature: 0.1,
      maxTokens: 1200,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[gradeDescriptive] groq call failed, using mock fallback:', (err as Error).message.slice(0, 200));
    return { graded: mockGrade(args.answer, args.rubric), meta: { latencyMs: 0, tokens: 0, model: 'mock-groq-failed' } };
  }

  const parsed = safeParseLenient(GradedAnswerSchema, result.raw);
  if (!parsed.success) {
    // eslint-disable-next-line no-console
    console.warn('[gradeDescriptive] schema drift, using mock fallback:', JSON.stringify(parsed.error.flatten()).slice(0, 200));
    return { graded: mockGrade(args.answer, args.rubric), meta: { latencyMs: result.latencyMs, tokens: 0, model: 'mock-schema-drift' } };
  }
  return {
    graded: parsed.data,
    meta: { latencyMs: result.latencyMs, tokens: result.inputTokens + result.outputTokens, model: result.model },
  };
}

/* MVP-SCAFFOLD — length-and-keyword heuristic so descriptive submissions get
 * a plausible score + structured feedback without hitting Groq. */
function mockGrade(answer: string, rubric: string | Record<string, string>): GradedAnswer {
  const trimmed = (answer ?? '').trim();
  const wordCount = trimmed ? trimmed.split(/\s+/).length : 0;
  // Length-based base score: 0 for empty, ramps to 70 by 80 words.
  const lengthScore = Math.min(70, Math.round((wordCount / 80) * 70));
  // Keyword bonus: looks for evidence of structured thinking.
  const lower = trimmed.toLowerCase();
  let bonus = 0;
  if (/because|therefore|trade.?off|however/.test(lower)) bonus += 8;
  if (/example|for instance|e\.g\./.test(lower)) bonus += 7;
  if (/\d/.test(lower)) bonus += 5;
  const score = Math.max(0, Math.min(100, lengthScore + bonus));

  const criteria = typeof rubric === 'string' ? ['structure', 'depth', 'clarity'] : Object.keys(rubric);
  const rubricScore: Record<string, number> = {};
  for (const c of criteria) {
    // Slight per-criterion jitter so it doesn't look uniform.
    const j = (c.length * 7) % 11 - 5;
    rubricScore[c] = Math.max(0, Math.min(100, score + j));
  }

  const strengths: string[] = [];
  const gaps: string[] = [];
  const suggestions: string[] = [];
  if (wordCount === 0) {
    gaps.push('No answer submitted.');
    suggestions.push('Write at least 60-100 words covering the rubric criteria.');
  } else {
    if (wordCount >= 60) strengths.push(`Sufficient length (${wordCount} words) to engage the prompt.`);
    else gaps.push(`Answer is short (${wordCount} words) — risks under-explaining.`);
    if (/because|therefore|trade.?off/.test(lower)) strengths.push('Shows reasoning with cause/consequence language.');
    else suggestions.push('Make your reasoning explicit: use "because…" / "the trade-off is…".');
    if (/example|for instance|\d/.test(lower)) strengths.push('Grounds the answer with a concrete example or number.');
    else suggestions.push('Add a concrete example or number to anchor the abstract claim.');
    if (wordCount > 250) gaps.push('Answer is long; tighten to the 2-3 strongest points.');
  }

  return {
    score,
    rubricScore,
    strengths: strengths.length ? strengths : ['Engaged the prompt directly.'],
    gaps:      gaps.length      ? gaps      : ['Could go deeper on the "why" behind your claim.'],
    suggestions: suggestions.length ? suggestions : ['Re-attempt with one concrete example added.'],
    oneLine: wordCount === 0
      ? 'No answer submitted — try again with at least 60-100 words.'
      : `Scored ${score}/100 (mock). ${score >= 70 ? 'Solid structure.' : score >= 50 ? 'On the right track — tighten reasoning.' : 'Needs more depth and concrete examples.'}`,
    aiAuthoredLikelihood: 0, // mock grader always returns 0 (human-authored assumption)
  };
}
