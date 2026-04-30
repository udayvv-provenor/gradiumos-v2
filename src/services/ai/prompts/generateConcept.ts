/**
 * generateConcept — AI generates a complete concept primer for a subtopic on
 * demand. Called when a learner navigates to a subtopic with NO hand-authored
 * concept JSON (40+ of 47 subtopics). Output is the same shape as the
 * hand-authored ones (markdown + diagrams + tutorOpener) so the UI doesn't
 * branch on source.
 *
 * v3.1.4 — added per Uday's "AI generated all parts, not just fallback" call.
 * Replaces the generic stub primer with a real AI-generated one. Cached in
 * the publicDataCache table per (subtopicCode, careerTrack) for 30 days so we
 * don't re-bill on every page load.
 *
 * IP-protection: cluster definitions only in the prompt; no formula constants,
 * no archetype matrices outbound.
 */
import { z } from 'zod';
import { callGroq, isGroqConfigured } from '../groqClient.js';
import { safeParseLenient } from '../unwrapJson.js';

const Diagram = z.object({
  type:    z.enum(['mermaid', 'svg', 'image']),
  caption: z.string().min(2).max(180),
  source:  z.string().min(10).max(2000),
});

export const ConceptSchema = z.object({
  title:                z.string().min(2).max(120),
  subtitle:             z.string().min(5).max(200),
  estimatedReadMinutes: z.number().int().min(3).max(20),
  markdown:             z.string().min(400).max(8000),
  diagrams:             z.array(Diagram).max(2),
  tutorOpener:          z.string().min(20).max(280),
});
export type GeneratedConcept = z.infer<typeof ConceptSchema>;

const SYSTEM_PROMPT = `You author a concept primer for a learner subtopic in the GradiumOS platform.

Voice: senior engineer talking to a junior at a startup. Direct, specific, no filler.
Tone: "this is what matters in real work, here's the mechanical pattern, here's what
goes wrong." NOT "let's explore this exciting topic together." Real-world examples
preferred over theory.

Required structure of the markdown:
  1. **Why this matters** — concrete cost of getting this wrong. Production incident,
     code-review pain, career-blocking gap. 80-150 words.
  2. **The 2-4 patterns / families** that cover ~80% of cases. Numbered list,
     each with a one-sentence rule + a concrete example.
  3. **How to read your own work for this** — mechanical rules. "When you see X,
     that's a Y." Bulleted.
  4. **The honest test** — "Before you call this done, ask…". 2 questions max.

Diagrams: 1-2 only. Use mermaid graph LR or graph TD. Avoid special characters
(², —, →, /, parens in node labels) — they break the renderer. Use plain ASCII.
Plain alphanumeric node labels with simple words; arrow descriptions are OK.

tutorOpener: ONE sentence opening question the AI tutor would ask the learner
to ground the lesson in their experience. Specific to this subtopic.

The 8 GradiumOS clusters (DO NOT invent new ones):
  C1 — Core Technical Foundations
  C2 — Applied Problem Solving
  C3 — Engineering Execution
  C4 — System & Product Thinking
  C5 — Communication & Collaboration
  C6 — Domain Specialisation
  C7 — Ownership & Judgment
  C8 — Learning Agility

Output JSON only, this exact shape:
{
  "title": "Subtopic name (concise)",
  "subtitle": "Cluster code — one-line framing of what this is",
  "estimatedReadMinutes": 8,
  "markdown": "Full primer markdown, ~600-1500 words",
  "diagrams": [{ "type": "mermaid", "caption": "...", "source": "graph LR\\n..." }],
  "tutorOpener": "One question that grounds the lesson in the learner's real work."
}`;

export interface GenerateConceptInput {
  subtopicCode: string;     // e.g. "C1.GRAPH-ALG"
  subtopicName: string;     // e.g. "Graph Algorithms"
  clusterCode:  string;     // e.g. "C1"
  clusterName:  string;     // e.g. "Core Technical Foundations"
}

export async function generateConcept(input: GenerateConceptInput): Promise<{ concept: GeneratedConcept; meta: { latencyMs: number; tokens: number; model: string } }> {
  const userMsg = `Subtopic: ${input.subtopicCode} — ${input.subtopicName}
Parent cluster: ${input.clusterCode} — ${input.clusterName}

Author the concept primer JSON now. Real-world voice. ASCII-only mermaid.`;

  if (!isGroqConfigured()) {
    return { concept: mockConcept(input), meta: { latencyMs: 0, tokens: 0, model: 'mock-no-groq' } };
  }

  let result: { raw: unknown; latencyMs: number; inputTokens: number; outputTokens: number; model: string };
  try {
    result = await callGroq({
      operation: 'generateConcept',
      system:    SYSTEM_PROMPT,
      user:      userMsg,
      json:      true,
      temperature: 0.4,
      maxTokens: 2200,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[generateConcept] groq failed, using mock:', (err as Error).message.slice(0, 200));
    return { concept: mockConcept(input), meta: { latencyMs: 0, tokens: 0, model: 'mock-groq-failed' } };
  }
  const parsed = safeParseLenient(ConceptSchema, result.raw);
  if (!parsed.success) {
    // eslint-disable-next-line no-console
    console.warn('[generateConcept] schema drift, using mock:', JSON.stringify(parsed.error.flatten()).slice(0, 200));
    return { concept: mockConcept(input), meta: { latencyMs: result.latencyMs, tokens: 0, model: 'mock-schema-drift' } };
  }
  return {
    concept: parsed.data,
    meta: { latencyMs: result.latencyMs, tokens: result.inputTokens + result.outputTokens, model: result.model },
  };
}

/* MVP-SCAFFOLD — high-quality concept generator that runs without Groq. Uses
 * the subtopic code/name + cluster context to produce real-feeling content,
 * matching the structure the Groq path produces. Quality is intentionally
 * higher than the previous "this content is being authored" placeholder. */
function mockConcept(input: GenerateConceptInput): GeneratedConcept {
  const { subtopicCode, subtopicName, clusterCode, clusterName } = input;

  // Per-cluster framing
  const CLUSTER_FRAMING: Record<string, { lens: string; cost: string }> = {
    C1: { lens: 'core technical fluency', cost: 'code that works on small data and breaks at scale' },
    C2: { lens: 'problem-solving under pressure', cost: 'over-engineering simple problems and freezing on hard ones' },
    C3: { lens: 'production engineering', cost: 'shipping code that breaks, then spending weeks on incidents' },
    C4: { lens: 'system design tradeoffs', cost: 'architecture decisions that paint your team into a corner' },
    C5: { lens: 'communication clarity', cost: 'good ideas no one acts on because the message is buried' },
    C6: { lens: 'domain depth', cost: 'shallow generalist work that gets disrupted by specialists' },
    C7: { lens: 'ownership and judgment', cost: 'shipping code then walking away — letting tech debt pile up' },
    C8: { lens: 'learning agility', cost: 'staying stuck on yesterday\'s tech while the field moves on' },
  };
  const framing = CLUSTER_FRAMING[clusterCode] ?? { lens: 'professional craft', cost: 'mediocre work' };

  const markdown = `## Why this matters

${subtopicName} sits in the **${clusterName}** cluster — the ${framing.lens} layer of professional engineering work. Get this wrong, and the cost is mechanical: ${framing.cost}.

This isn't theory. Every senior engineer you've worked with has internalised this skill in their first 2-3 years. The ones who didn't — you can spot them in code review. They're the ones whose PRs get the most comments, whose features take 3x longer than estimated, and who never quite understand why their work doesn't compound.

The good news: the patterns are mechanical. Once you can name them, you can apply them deliberately, every time.

## The 3 patterns you'll see most

1. **Pattern A — recognise the shape.** ${subtopicName} usually shows up as one of three recurring shapes. The first 80% of work is recognising which shape you have; the rest is mechanical execution.

2. **Pattern B — find the right primitive.** Once you've named the shape, there's almost always a standard primitive (a data structure, a code idiom, a workflow step) that fits. Engineers who fail here reinvent solutions instead of reaching for the right tool.

3. **Pattern C — verify before claiming done.** Senior engineers don't trust that their code works because it ran once. They have a mechanical test ("does this hold under X?") that they apply before merging.

## How to read your own work for ${subtopicName}

Mechanical heuristics:

- When you find yourself writing code you've never written before — check whether the pattern already has a name. It probably does.
- When you're hand-rolling something — check whether your standard library covers it.
- When you're stuck — articulate the constraint that's blocking you in one sentence. Half the time, that's enough to unblock.
- When something works — ask "what's the largest input this might see?" If you don't know, you don't know whether it works.

## The honest test

Before you call your work done, ask:

1. **Have you tried to break it?** If you haven't fed it weird inputs, you don't know if it works.
2. **Could a junior engineer maintain this?** If the answer is "only with my help" — you've left a load-bearing handle on yourself.

> **Bottom line:** ${subtopicName} compounds. Every PR you ship that demonstrates this skill makes your next one easier. Engineers who treat this as a checkbox stay junior; engineers who treat it as a habit move up.`;

  return {
    title:                subtopicName,
    subtitle:             `${clusterCode} — ${clusterName}`,
    estimatedReadMinutes: 8,
    markdown,
    diagrams: [
      {
        type:    'mermaid',
        caption: 'The 3-pattern recognition flow',
        source:  `graph LR\n    Start[Encountered work] --> Recog{Recognise shape}\n    Recog -->|Pattern A| Apply[Apply standard primitive]\n    Recog -->|Pattern B| Apply\n    Recog -->|Pattern C| Apply\n    Apply --> Verify{Verify before done}\n    Verify -->|passes| Ship[Ship with confidence]\n    Verify -->|fails| Recog\n    style Start fill:#dbeafe\n    style Recog fill:#fde68a\n    style Verify fill:#fde68a\n    style Ship fill:#86efac`,
      },
    ],
    tutorOpener: `Tell me about a time you encountered ${subtopicName} in real work — what was the situation, and how did you decide what to do?`,
  };
}
