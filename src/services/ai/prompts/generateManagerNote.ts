/**
 * generateManagerNote — produces the end-of-shift "manager's read-out"
 * paragraph from the per-artifact submissions + grades. Real AI per Uday's
 * "the manager note isn't AI, that's a hidden mock" call (v3.1.7).
 *
 * Voice: an engineering manager who sat across from the learner and watched
 * them handle the day. Direct, specific, ownership-positive. NOT a teacher,
 * NOT a coach.
 *
 * Output: a single paragraph (4-7 sentences). No bullet lists, no headings.
 * Refers to specific artifacts by what was good or weak, not generic praise.
 */
import { z } from 'zod';
import { callGroq, isGroqConfigured } from '../groqClient.js';
import { safeParseLenient } from '../unwrapJson.js';

export const ManagerNoteSchema = z.object({
  managerNote: z.string().min(60).max(900),
});
export type ManagerNote = z.infer<typeof ManagerNoteSchema>;

const SYSTEM_PROMPT = `You are an engineering manager who watched a junior engineer
work a 25-minute shift. You will write a SINGLE PARAGRAPH (4-7 sentences) of
honest, specific, ownership-positive feedback.

Hard rules:
  - Refer to specific artifacts by their content, not generic praise.
    BAD: "Good job on the technical task."
    GOOD: "Your PR review caught the O(n*m) issue but missed naming the data scale."
  - One concrete strength, one concrete gap, one specific next step.
  - No corporate fluff. No "great work overall!". No exclamation marks.
  - First-person from the manager: "I'd want you to ..." / "You handled X by ...".
  - End with a concrete next step the learner can take this week.

Output JSON only — { "managerNote": "..." }. No markdown, no headings.`;

export interface ManagerNoteInput {
  companyName: string;
  role:        string;
  day:         number;
  overallScore: number;
  artifacts: Array<{
    label:        string;
    clusterCode:  string;
    score:        number;
    oneLine:      string;       // graded.oneLine from gradeDescriptive
    topGap?:      string | null;
  }>;
}

export async function generateManagerNote(input: ManagerNoteInput): Promise<{ managerNote: string; meta: { latencyMs: number; tokens: number; model: string } }> {
  if (!isGroqConfigured() || input.artifacts.length === 0) {
    return { managerNote: deterministicFallback(input), meta: { latencyMs: 0, tokens: 0, model: 'mock-no-groq' } };
  }
  const userMsg = `Company: ${input.companyName} (Day ${input.day})
Junior engineer's role: ${input.role}
Overall shift score: ${input.overallScore}/100

Artifacts they handled:
${input.artifacts.map((a, i) => `${i + 1}. [${a.clusterCode}] ${a.label} — score ${a.score}/100\n   Grader's one-line: ${a.oneLine}${a.topGap ? `\n   Biggest gap: ${a.topGap}` : ''}`).join('\n')}

Write your manager-note paragraph now. JSON only.`;

  let result: { raw: unknown; latencyMs: number; inputTokens: number; outputTokens: number; model: string };
  try {
    result = await callGroq({
      operation:   'generateManagerNote',
      system:      SYSTEM_PROMPT,
      user:        userMsg,
      json:        true,
      temperature: 0.4,
      maxTokens:   500,
    });
  } catch {
    return { managerNote: deterministicFallback(input), meta: { latencyMs: 0, tokens: 0, model: 'mock-groq-failed' } };
  }
  const parsed = safeParseLenient(ManagerNoteSchema, result.raw);
  if (!parsed.success) {
    return { managerNote: deterministicFallback(input), meta: { latencyMs: result.latencyMs, tokens: 0, model: 'mock-schema-drift' } };
  }
  return { managerNote: parsed.data.managerNote, meta: { latencyMs: result.latencyMs, tokens: result.inputTokens + result.outputTokens, model: result.model } };
}

function deterministicFallback(input: ManagerNoteInput): string {
  if (input.artifacts.length === 0) {
    return `You ended the shift without submitting any artifacts. The work simulation only teaches when you actually do it — take another shift this week.`;
  }
  const top = [...input.artifacts].sort((a, b) => b.score - a.score)[0];
  const bot = [...input.artifacts].sort((a, b) => a.score - b.score)[0];
  if (input.overallScore >= 75) {
    return `Solid shift overall (${input.overallScore}). Strongest moment: ${top.label} — ${top.oneLine.toLowerCase()} The ${bot.label} was your weakest at ${bot.score}, and there's room to tighten ${(bot.topGap ?? 'the specifics').toLowerCase()}. Keep this level on the ${bot.clusterCode} side and you'll be trusted with more autonomy quickly.`;
  }
  if (input.overallScore >= 55) {
    return `Mixed shift (${input.overallScore}). The ${top.label} is the bar to repeat. The ${bot.label} dropped to ${bot.score} and the gap was ${(bot.topGap ?? 'response specificity').toLowerCase()}. This week, take another shift focused on ${bot.clusterCode} before next sprint planning.`;
  }
  return `Tough shift (${input.overallScore}). One bad day doesn't define you, but ${(bot.topGap ?? 'response specificity').toLowerCase()} is the pattern to fix. The ${top.label} showed you have the instinct — let's run another shift this week and zoom in on ${bot.clusterCode}.`;
}
