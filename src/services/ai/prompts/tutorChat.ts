/**
 * tutorChat — single-turn AI tutor reply for a learner working a specific
 * cluster + sub-topic.
 *
 * IP-protection: Groq never sees raw cluster scores, formula constants, or
 * confidence weights. Calibration uses a qualitative band name only.
 */
import { z } from 'zod';
import { callGroq, streamGroq } from '../groqClient.js';
import { safeParseLenient } from '../unwrapJson.js';

export const TutorReplySchema = z.object({
  reply:        z.string().min(2).max(4000),
  conceptTags:  z.array(z.string().min(1).max(60)).max(10).default([]),
  // 'continue' | 'check-in' | 'wrap-up' — small UX hint for the client.
  intent:       z.enum(['continue', 'check-in', 'wrap-up']).default('continue'),
});
export type TutorReply = z.infer<typeof TutorReplySchema>;

const SYSTEM_NON_STREAM = `You are an AI tutor inside the GradiumOS Talent portal. The learner is working on a specific competency cluster (one of C1–C8) and a sub-topic within it. You see:
- Cluster code + name + plain-language definition.
- Sub-topic name (the specific thing they want help with).
- The learner's current proficiency level (Emerging / Developing / Proficient / Advanced). Use this as a calibration signal.
- The last few turns of conversation.

Your tutoring style:
- Socratic by default — ask one focused question that surfaces the next concept the learner needs.
- Concrete examples > abstractions. If you explain a concept, ground it with a 4–8 line example.
- One concept per turn. Don't dump a wall of text.
- If the learner answers a check-in question, evaluate honestly and either advance or revisit.
- Never say "great question" / "as an AI". Be direct.
- Emerging/Developing → start simpler, build foundations. Proficient/Advanced → push harder, explore edge cases.

Output ONLY a JSON object with three fields:
{
  "reply": <your tutor message — markdown allowed for code blocks>,
  "conceptTags": [<short labels for what you covered, e.g. "BST traversal", "amortised analysis">],
  "intent": "continue" | "check-in" | "wrap-up"
}`;

const SYSTEM_STREAM = `You are an AI tutor inside the GradiumOS Talent portal helping a learner with a specific competency cluster + sub-topic.

Tutoring style:
- Socratic by default. One focused question or one focused explanation per turn.
- Concrete examples > abstractions. Use 4–8 line code/text examples when illustrating.
- One concept per turn. Don't dump walls of text.
- If learner answers a check-in, evaluate honestly: advance or revisit.
- Never say "great question" / "as an AI". Be direct.
- Emerging/Developing level → simpler foundations; Proficient/Advanced → push harder.

Reply with the tutor message directly. Markdown + code blocks OK. No preamble.`;

export type LearnerBand = 'Emerging' | 'Developing' | 'Proficient' | 'Advanced';

export async function tutorReply(args: {
  clusterCode:  string;
  clusterName:  string;
  clusterBlurb: string;
  subTopic:     string;
  learnerBand:  LearnerBand;
  history:      { role: 'user' | 'assistant'; content: string }[];
  userMessage:  string;
  /** v3.1.7 — when set, the learner is doing live work and you sit beside
   *  them. The artifact body is the ground truth to reason from. Be a
   *  partner, not a teacher. 2-3 sentence answers. Reference the artifact. */
  artifactContext?: string;
}): Promise<{ reply: TutorReply; meta: { latencyMs: number; tokens: number; model: string } }> {
  const partnerNote = args.artifactContext
    ? `\n\n[PARTNER MODE — the learner is doing real work right now. The artifact below is what they're looking at. Ground your answer in IT, not in generic theory. Keep answers to 2-3 sentences. Reference the artifact directly.]\nArtifact:\n${args.artifactContext.slice(0, 1500)}\n[end artifact]\n`
    : '';
  const userPrompt = `Cluster: ${args.clusterCode} — ${args.clusterName}
Cluster definition: ${args.clusterBlurb}
Sub-topic: ${args.subTopic}
Learner's current level: ${args.learnerBand}${partnerNote}

Last turns:
${args.history.map((h) => `${h.role}: ${h.content}`).join('\n').slice(0, 4000)}

Learner just said:
${args.userMessage.slice(0, 2000)}

Reply now (JSON only).`;

  const result = await callGroq({
    operation: 'tutorChat',
    system: SYSTEM_NON_STREAM,
    user: userPrompt,
    json: true,
    temperature: 0.55,
    maxTokens: 800,
  });
  const parsed = safeParseLenient(TutorReplySchema, result.raw);
  if (!parsed.success) {
    throw new Error(`tutorReply: schema failure: ${JSON.stringify(parsed.error.flatten())}`);
  }
  return {
    reply: parsed.data,
    meta: { latencyMs: result.latencyMs, tokens: result.inputTokens + result.outputTokens, model: result.model },
  };
}

/** Streaming variant — yields plaintext deltas. The client should accumulate
 *  the deltas and treat the full final string as the assistant turn. No JSON
 *  envelope on this path (callers wrap into a turn record themselves). */
export async function* tutorReplyStream(args: {
  clusterCode:  string;
  clusterName:  string;
  clusterBlurb: string;
  subTopic:     string;
  learnerBand:  LearnerBand;
  history:      { role: 'user' | 'assistant'; content: string }[];
  userMessage:  string;
}): AsyncGenerator<string> {
  const userPrompt = `Cluster: ${args.clusterCode} — ${args.clusterName}
Cluster definition: ${args.clusterBlurb}
Sub-topic: ${args.subTopic}
Learner's current level: ${args.learnerBand}

Learner just said:
${args.userMessage.slice(0, 2000)}`;

  yield* streamGroq({
    operation: 'tutorChat',
    system: SYSTEM_STREAM,
    user: userPrompt,
    history: args.history,
    temperature: 0.55,
    maxTokens: 800,
  });
}
