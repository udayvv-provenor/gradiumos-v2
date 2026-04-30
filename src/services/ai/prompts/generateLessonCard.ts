/**
 * generateLessonCard — produces ONE structured "lesson card" instead of a
 * free-form chat message. This is the foundation of the unique Lesson
 * Stream tutor UI (per the legal-differentiation requirement: no chat
 * bubbles, no standard code blocks, no Mermaid).
 *
 * Each card has a typed kind + structured fields that the UI renders with
 * its own custom layout — never as a markdown-chat string.
 *
 * IP-protection: same as tutorChat — cluster vocabulary in plain English,
 * no formula constants outbound.
 *
 * Mock fallback: deterministic kind + content based on the conversation
 * length (so the demo "feels" like a lesson without a real key).
 */
import { z } from 'zod';
import { callGroq, isGroqConfigured } from '../groqClient.js';
import { safeParseLenient } from '../unwrapJson.js';
import { compileSkill } from '../skills/registry.js';

export const LessonCardSchema = z.object({
  kind: z.enum(['explanation', 'question', 'example', 'reflection', 'check', 'detour']),
  title: z.string().min(2).max(120),
  body:  z.string().min(10).max(2000),
  // Optional structured slots for richer card types
  example:  z.object({
    before: z.string().max(800).optional(),
    after:  z.string().max(800).optional(),
    callout: z.string().max(280).optional(),
  }).optional(),
  check: z.object({
    options: z.array(z.object({ id: z.string().max(8), text: z.string().max(280) })).min(2).max(5),
    correctId: z.string().max(8),
    explanation: z.string().min(5).max(400),
  }).optional(),
  question: z.object({
    prompt: z.string().min(5).max(400),
    placeholder: z.string().max(120).optional(),
  }).optional(),
  // Editor-style annotations: small inline visual cues without using a code block
  annotations: z.array(z.object({
    label: z.string().max(40),
    text:  z.string().max(280),
  })).max(8).optional(),
  // Concept tags so the UI can show "we're covering X"
  conceptTags: z.array(z.string().min(2).max(40)).max(6).optional(),
  // Whether the card expects a learner action before the next card
  awaitsLearner: z.boolean(),
});
export type LessonCard = z.infer<typeof LessonCardSchema>;

export interface LessonContext {
  subtopicCode:   string;
  subtopicName:   string;
  clusterCode:    string;
  learnerLastResponse?: string | null;
  /** v3.1 — `wasCorrect` flows back from the client only for `check` cards.
   *  When it's false, the server forces a `detour` as the next allowed kind
   *  (re-explain or worked example), preventing forward progress until the
   *  learner is given a different angle. Spec'd boundary. */
  cardHistory:    Array<{ kind: string; title: string; learnerInput?: string; wasCorrect?: boolean }>;
}

// IP layer — composed at call-time from skills/tasks/generate-lesson-card.md
function getSystemPrompt(): string { return compileSkill('generate-lesson-card'); }

export async function generateLessonCard(ctx: LessonContext): Promise<{ card: LessonCard; meta: { latencyMs: number; tokens: number; model: string } }> {
  if (!isGroqConfigured()) {
    return { card: mockCard(ctx), meta: { latencyMs: 0, tokens: 0, model: 'mock-no-groq' } };
  }

  // Server-side rhythm enforcement — compute the allowed kinds for THIS turn
  // based on history and pin them in the user message. Llama is reliable when
  // the constraint is short and explicit; less so when buried in the system
  // prompt as one rule among many.
  const allowedKinds = computeAllowedKinds(ctx);
  const usedTitles = ctx.cardHistory.map((c) => c.title);

  const userMsg = `Subtopic: ${ctx.subtopicCode} — ${ctx.subtopicName} (cluster ${ctx.clusterCode})

Cards already shown in this lesson (most recent last):
${ctx.cardHistory.length === 0 ? '(none — this is the opening card)' : ctx.cardHistory.map((c, i) => `${i + 1}. [${c.kind}] ${c.title}${c.learnerInput ? ` → learner: "${c.learnerInput.slice(0, 200)}"` : ''}`).join('\n')}

${ctx.learnerLastResponse ? `Learner's most recent input: "${ctx.learnerLastResponse}"` : 'No learner input yet — produce the opening card.'}

CONSTRAINTS FOR THIS TURN (server-enforced — the system rules already explained why):
- The "kind" field of your card MUST be one of: ${allowedKinds.join(', ')}
- The "title" field MUST NOT match any of these prior titles: ${usedTitles.length === 0 ? '(none)' : JSON.stringify(usedTitles)}
- The "body" must cover a DIFFERENT facet of the topic than prior cards.

Produce the next lesson card now. JSON only.`;

  let result: { raw: unknown; latencyMs: number; inputTokens: number; outputTokens: number; model: string };
  try {
    result = await callGroq({
      operation: 'generateLessonCard',
      system: getSystemPrompt(),
      user: userMsg,
      json: true,
      temperature: 0.4,
      maxTokens: 1200,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[generateLessonCard] groq call failed, using mock fallback:', (err as Error).message.slice(0, 200));
    return { card: mockCard(ctx), meta: { latencyMs: 0, tokens: 0, model: 'mock-groq-failed' } };
  }
  const parsed = safeParseLenient(LessonCardSchema, result.raw);
  if (!parsed.success) {
    // eslint-disable-next-line no-console
    console.warn('[generateLessonCard] schema drift, using mock fallback:', JSON.stringify(parsed.error.flatten()).slice(0, 200));
    return { card: mockCard(ctx), meta: { latencyMs: result.latencyMs, tokens: 0, model: 'mock-schema-drift' } };
  }
  return {
    card: parsed.data,
    meta: { latencyMs: result.latencyMs, tokens: result.inputTokens + result.outputTokens, model: result.model },
  };
}

/* Compute the kinds Llama is allowed to choose from this turn, based on
 * conversation history. Mirrors the rules in skills/tasks/generate-lesson-card.md
 * but enforces them server-side because Llama drifts when given many rules
 * in the system prompt and only minimal history in the user message. */
function computeAllowedKinds(ctx: LessonContext): LessonCard['kind'][] {
  const h = ctx.cardHistory;
  const last = h[h.length - 1];
  const prev = h[h.length - 2];
  const lastInput = (ctx.learnerLastResponse ?? last?.learnerInput ?? '').toLowerCase();

  // Rule 1: opening card — only explanation or example
  if (h.length === 0) return ['explanation', 'example'];

  // Rule 2: confused learner → detour
  if (lastInput && /(\bi don'?t know\b|\bnot sure\b|\bconfused\b|\bexplain again\b|\bunclear\b|\bhelp\b|^.{1,20}$)/i.test(lastInput)) {
    return ['detour'];
  }

  // v3.1 — Rule 3a: failed check → MANDATORY detour. The check card carried
  // a `correctId`; the client compares the learner's pick and sets `wasCorrect`
  // in the cardHistory entry before sending. If the answer was wrong we
  // refuse to advance; the next card must be a re-explanation or worked example.
  if (last?.kind === 'check' && last?.wasCorrect === false) {
    return ['detour'];
  }

  // Rule 3b: passed (or unknown) check — explanation only (build forward)
  if (last?.kind === 'check') return ['explanation'];

  // Rule 5: just answered a question/reflection → explanation or example, NOT another question
  if ((last?.kind === 'question' || last?.kind === 'reflection') && lastInput) {
    return ['explanation', 'example', 'detour'];
  }

  // Rule 4: 2 info-cards in a row → MUST be interactive (question/reflection/check)
  const isInfo = (k?: string) => k === 'explanation' || k === 'example' || k === 'detour';
  if (isInfo(last?.kind) && isInfo(prev?.kind)) {
    return ['question', 'reflection', 'check'];
  }

  // Rule 6: lesson winding down — prefer detour or explanation
  if (h.length >= 6) return ['detour', 'explanation'];

  // Rule 7: anything not just-used (encourage variety)
  const recent = new Set(h.slice(-2).map((c) => c.kind));
  const allKinds: LessonCard['kind'][] = ['explanation', 'example', 'question', 'reflection', 'check', 'detour'];
  const fresh = allKinds.filter((k) => !recent.has(k));
  return fresh.length > 0 ? fresh : allKinds;
}

/* MVP-SCAFFOLD — deterministic card sequence so the unique Lesson Stream
 * UI can be exercised without a Groq key. Cycles through kinds based on
 * how many cards came before.
 *
 * v3.1 — also honors the check→detour rule: if the most-recent card was a
 * check that the learner got WRONG, return a hand-shaped detour card that
 * re-frames the concept rather than advancing. Mirrors the same boundary
 * the live Groq path enforces via computeAllowedKinds. */
function mockCard(ctx: LessonContext): LessonCard {
  const turn = ctx.cardHistory.length;
  const subjectName = ctx.subtopicName;
  const last = ctx.cardHistory[ctx.cardHistory.length - 1];

  // v3.1 — Failed-check detour. Learner picked wrong on the check card.
  // Don't advance; re-frame the underlying principle from a different angle.
  if (last?.kind === 'check' && last?.wasCorrect === false) {
    return {
      kind: 'detour',
      title: 'Let\'s look at this from a different angle',
      body: `Quick rewind. The check we just did had one specific test: does the FIRST sentence carry the conclusion? That's BLUF — Bottom Line Up Front.\n\nA helpful trick: imagine the reader only reads sentence one and stops. If they walk away knowing your point, you've got BLUF. If they walk away knowing only the setup or the context, you've buried the lede.\n\nNo penalty here — getting this one wrong is normal. The pattern is mechanical once you see it. Let's keep going.`,
      annotations: [
        { label: 'Pattern',  text: 'Conclusion in sentence one. Evidence after.' },
        { label: 'Test',     text: 'If reader stops at sentence one — do they know your point?' },
      ],
      conceptTags: ['BLUF — restated', 'Common mistake'],
      awaitsLearner: false,
    };
  }

  // Card 0 — opening explanation
  if (turn === 0) {
    return {
      kind: 'explanation',
      title: `Welcome to ${subjectName}`,
      body: `We're going to work through ${subjectName} together. The way this works: I'll show you concepts, ask you questions, and adapt as we go. There are no chat bubbles here — each card is a piece of the lesson, and you interact with it directly.\n\nTo start: this skill compounds across your career. Every PR, every doc, every message benefits when you do this well. Let's begin with what makes the difference.`,
      conceptTags: ['Lesson framing', 'Why it matters'],
      awaitsLearner: false,
    };
  }
  // Card 1 — example
  if (turn === 1) {
    return {
      kind: 'example',
      title: 'Before & after — a real PR description',
      body: 'Look at how the same information lands when written two ways. The change isn\'t about adding more — it\'s about putting the conclusion first.',
      example: {
        before: 'Hey team! So I was working on the issue from last week and I think I have a fix. The problem was that when users with multiple sessions tried to log out, only one session was being killed. I traced it through the auth middleware and found the issue. I changed it and added a test. Let me know what you think!',
        after:  'Fixes #3421 — logout now kills all sessions for the user. Was: deleteSession(sessionId) killed only the current session. Now: deleteSessionsForUser(userId). Risk: none. Test: new test in auth.test.ts covers multi-session.',
        callout: 'Conclusion in sentence one. Reviewer knows in 5 seconds whether to approve.',
      },
      conceptTags: ['BLUF — Bottom Line Up Front'],
      awaitsLearner: false,
    };
  }
  // Card 2 — reflection
  if (turn === 2) {
    return {
      kind: 'reflection',
      title: 'Your turn',
      body: 'Think about the last time you wrote something at work that you wish had landed more clearly. The one where you got back "wait, what are you asking?" or no response at all.',
      question: {
        prompt: 'In one or two sentences: what was confusing for the reader, and why did it land that way? (No wrong answers — this is to ground the rest of the lesson in your real work.)',
        placeholder: 'e.g. "My migration plan PR was 4 paragraphs and reviewers couldn\'t find the actual change…"',
      },
      conceptTags: ['Self-reflection'],
      awaitsLearner: true,
    };
  }
  // Card 3 — explanation building on reflection
  if (turn === 3) {
    return {
      kind: 'explanation',
      title: 'The 3 patterns of clear technical writing',
      body: `Whatever you wrote about probably violated one of three patterns. They're mechanical — once you see them, you can apply them to anything.\n\n1. **BLUF** (Bottom Line Up Front): the conclusion is the first sentence. Everything else is evidence.\n\n2. **Inverted pyramid**: most important fact at the top, supporting facts below, edge cases at the bottom. The opposite of how you discovered the answer.\n\n3. **Signposting**: tell the reader what's coming. Headings, numbered lists, bold key phrases. Walls of prose die in technical contexts.`,
      annotations: [
        { label: 'BLUF', text: 'Bottom Line Up Front — your conclusion is sentence one' },
        { label: 'Inverted pyramid', text: 'Important first, supporting second, edge cases last' },
        { label: 'Signposting', text: 'Headings + bold + numbered lists. Reader needs anchors' },
      ],
      conceptTags: ['BLUF', 'Inverted pyramid', 'Signposting'],
      awaitsLearner: false,
    };
  }
  // Card 4 — check
  if (turn === 4) {
    return {
      kind: 'check',
      title: 'Quick check — which is BLUF?',
      body: 'Same content, three openings. Which one follows BLUF?',
      check: {
        options: [
          { id: 'a', text: 'I was thinking about the deploy process and noticed a few things that could be improved across our pipeline…' },
          { id: 'b', text: 'Our deploy takes 14 minutes. I propose cutting it to 4 by parallelising the test stage.' },
          { id: 'c', text: 'After looking at our CI logs for a few hours, I have a recommendation that I think the team should consider when we get a moment to discuss…' },
        ],
        correctId: 'b',
        explanation: 'B states the problem (14 min) AND the proposal (4 min) in two sentences. A and C bury the actual recommendation behind framing. The reader knows in 5 seconds whether B is worth their time.',
      },
      conceptTags: ['BLUF in practice'],
      awaitsLearner: true,
    };
  }
  // Card 5 — question
  if (turn === 5) {
    return {
      kind: 'question',
      title: 'Apply it now',
      body: 'You missed a sprint deadline because you got blocked by a third-party API. Write the Slack message to your manager.',
      question: {
        prompt: 'Write the Slack message in 2-4 sentences. Use BLUF. State what happened, what you\'re doing about it, and what you need (if anything).',
        placeholder: 'Draft your message here…',
      },
      conceptTags: ['Applied BLUF', 'Stakeholder communication'],
      awaitsLearner: true,
    };
  }
  // Card 6+ — explanation wrap with detour back-reference
  return {
    kind: 'detour',
    title: 'A note before we move on',
    body: `Quick aside: notice how everything we've covered comes back to one principle — respect your reader's time. The patterns are mechanical, but the discipline is choosing to use them when you're tired and the deadline is close. That's where it gets hard.\n\nWe'll come back to the main thread next: how to apply this to long-form writing (design docs, post-mortems) where the same patterns scale up.`,
    conceptTags: ['Synthesis', 'Discipline over cleverness'],
    awaitsLearner: false,
  };
}
