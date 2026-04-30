/**
 * generateShift — AI generates a "Day-N at FictionalCo" WORK SHIFT scenario
 * for a learner. A shift is the headline assessment metaphor in v3.1.4: the
 * learner is dropped into a single fictional company for ~25 minutes, handles
 * 3-5 heterogeneous artifacts (PR diff, Slack thread, incident log, customer
 * email, meeting note), and gets per-artifact + aggregate AI grading.
 *
 * v3.1.5 — replaces the "individual MCQ off the bank" assessment metaphor
 * with the work-simulation paradigm Uday locked. NOT teaching, NOT learning —
 * rehearsal of the actual work.
 *
 * v3.1.7 — tightened prompt + lenient JSON unwrap to fix the "Groq returned
 * a wrapped shape" failure Uday spotted in walkthrough screenshots.
 *
 * IP-protection: only career-track NAME + cluster CODES + a target shape
 * (which clusters this shift focuses on) leave the building. No formula
 * constants, no archetype matrices, no learner-level scores in the prompt.
 */
import { z } from 'zod';
import { callGroq, isGroqConfigured } from '../groqClient.js';
import { safeParseLenient } from '../unwrapJson.js';

export const ShiftArtifactSchema = z.object({
  id:           z.string().min(2).max(40),
  clusterCode:  z.enum(['C1','C2','C3','C4','C5','C6','C7','C8']),
  artifactKind: z.enum(['pr-diff','slack','incident-log','customer-email','meeting-note','design-doc']),
  label:        z.string().min(2).max(60),       // "PR description", "Slack thread", etc.
  body:         z.string().min(40).max(2400),
  task:         z.string().min(20).max(400),
  rubric:       z.array(z.object({
                  criterion: z.string().min(5).max(80),
                  weight:    z.number().min(0.1).max(0.5),
                })).min(3).max(5),
  estimatedMinutes: z.number().int().min(3).max(15),
});

export const ShiftScenarioSchema = z.object({
  companyName:    z.string().min(2).max(60),
  companyContext: z.string().min(40).max(400),     // "what this company does, what your team does"
  role:           z.string().min(5).max(80),        // "Junior Backend Engineer"
  day:            z.number().int().min(1).max(365), // "Day 47"
  scenarioArc:    z.string().min(40).max(500),     // "today's situation" — 1 paragraph framing
  artifacts:      z.array(ShiftArtifactSchema).min(3).max(5),
});
export type ShiftScenario = z.infer<typeof ShiftScenarioSchema>;
export type ShiftArtifact = z.infer<typeof ShiftScenarioSchema>['artifacts'][number];

const SYSTEM_PROMPT = `You design a 25-minute WORK SHIFT for a learner at a fictional company.

This is NOT a quiz, NOT a teaching exercise, NOT a series of unrelated puzzles.
It is rehearsal of REAL WORK — the closest a junior engineer can get to their
first month on the job, before the job exists.

Hard rules:

1. ONE FICTIONAL COMPANY persists across ALL artifacts in the shift. The
   learner is at "AcmePay" or "Stride" or "Northwind" the whole time. Same
   teammates, same codebase, same Slack channels. Coherence > variety.

2. The artifacts are a HETEROGENEOUS MIX targeting different clusters from
   the focus list provided. A typical SDE shift might have:
     - A PR diff to review (C1 / C3)
     - A flaky test report (C2)
     - A Slack from manager asking for a status update (C5)
     - A production incident log (C3 / C7)
   The mix lets ONE shift exercise multiple competencies coherently.

3. Each artifact is a REALISTIC SHAPE — code diffs look like diffs, Slack
   threads have timestamps + people, logs are monospace, customer emails have
   subject + sender. NOT prose descriptions of the artifact.

4. Each artifact has a CONCRETE DELIVERABLE the learner produces in
   free-text — a Slack reply, a PR review comment, a triage decision, a
   one-paragraph postmortem, an architecture sketch.

5. Each artifact has a RUBRIC of 3-5 criteria with weights summing roughly
   to 1.0. Criteria must be observable in the deliverable text — no
   "the learner shows good values".

6. Voice throughout: a senior engineer setting up a real shift for a junior.
   Direct, specific, no academic framing.

The 8 GradiumOS clusters (use the codes literally — DO NOT invent):
  C1 Core Tech / C2 Problem Solving / C3 Execution / C4 Systems
  C5 Communication / C6 Domain / C7 Ownership / C8 Agility

CRITICAL OUTPUT SHAPE — the response MUST be a single JSON object whose
TOP-LEVEL KEYS are EXACTLY these (no wrapping in "data", "result", or any
other key; no markdown fences; no commentary before or after):
{
  "companyName": "<string, 2-60 chars>",
  "companyContext": "<string, 40-400 chars — what this company does + what your team does>",
  "role": "<string, 5-80 chars — e.g. 'Junior Backend Engineer'>",
  "day": <integer, 1-365 — e.g. 47>,
  "scenarioArc": "<string, 40-500 chars — today's situation, one paragraph>",
  "artifacts": [
    {
      "id": "<short slug, 2-40 chars>",
      "clusterCode": "<C1|C2|C3|C4|C5|C6|C7|C8>",
      "artifactKind": "<pr-diff|slack|incident-log|customer-email|meeting-note|design-doc>",
      "label": "<string, 2-60 chars>",
      "body": "<string, 40-2400 chars — the actual artifact content>",
      "task": "<string, 20-400 chars — what the learner produces>",
      "rubric": [{"criterion": "<5-80 chars>", "weight": <0.1-0.5>}, ...],   // 3-5 entries, weights ≈ sum to 1.0
      "estimatedMinutes": <integer, 3-15>
    },
    ... 3 to 5 artifacts total
  ]
}

Return JSON only. No \`\`\`json fences. No prose.`;

export interface GenerateShiftInput {
  careerTrackName: string;
  archetype:       'Product' | 'Service' | 'MassRecruiter' | 'Unknown';
  focusClusters:   string[];   // 3-5 clusters this shift should target
  difficulty?:     'junior' | 'mid';   // default 'junior'
}

export async function generateShift(input: GenerateShiftInput): Promise<{ scenario: ShiftScenario; meta: { latencyMs: number; tokens: number; model: string } }> {
  const userMsg = `Career track: ${input.careerTrackName}
Archetype: ${input.archetype}
Focus clusters (mix artifacts across these): ${input.focusClusters.join(', ')}
Level: ${input.difficulty ?? 'junior'} engineer

Design the shift scenario JSON now. 4 artifacts. Total estimated: 22-28 minutes.
Remember: top-level keys are companyName, companyContext, role, day, scenarioArc, artifacts. NO wrapper key.`;

  if (!isGroqConfigured()) {
    return { scenario: mockShift(input), meta: { latencyMs: 0, tokens: 0, model: 'mock-no-groq' } };
  }

  let result: { raw: unknown; latencyMs: number; inputTokens: number; outputTokens: number; model: string };
  try {
    result = await callGroq({
      operation:   'generateShift',
      system:      SYSTEM_PROMPT,
      user:        userMsg,
      json:        true,
      temperature: 0.6,
      maxTokens:   3500,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[generateShift] groq failed, using mock:', (err as Error).message.slice(0, 120));
    return { scenario: mockShift(input), meta: { latencyMs: 0, tokens: 0, model: 'mock-groq-failed' } };
  }

  // v3.1.7 — lenient unwrap: if Groq wrapped the JSON in {data:...} or
  // similar, try to recover without changing the schema.
  const parsed = safeParseLenient(ShiftScenarioSchema, result.raw);
  if (!parsed.success) {
    // eslint-disable-next-line no-console
    console.warn('[generateShift] schema drift even after unwrap, using mock:', JSON.stringify(parsed.error.flatten()).slice(0, 240));
    return { scenario: mockShift(input), meta: { latencyMs: result.latencyMs, tokens: 0, model: 'mock-schema-drift' } };
  }
  return {
    scenario: parsed.data,
    meta: { latencyMs: result.latencyMs, tokens: result.inputTokens + result.outputTokens, model: result.model },
  };
}

/* EMERGENCY FALLBACK — only fires when GROQ_API_KEY is missing OR the API
 * rate-limits / errors. Architecture commitment per Uday (v3.1.6): live-first.
 * The PRIMARY path is real Groq -> publicDataCache (run-once-by-anyone, then
 * pulled by everyone). This fallback returns a thin, obvious-stub scenario
 * so failures are LOUD in dev and the demo doesn't pretend a stub is real.
 * Production should never see this surface — if it does, the AI status
 * indicator on the UI will show "Fallback" and ops will know to investigate. */
function mockShift(input: GenerateShiftInput): ShiftScenario {
  // eslint-disable-next-line no-console
  console.warn('[generateShift] EMERGENCY FALLBACK FIRED — Groq unavailable. The shift below is a thin stub, NOT a real scenario. Investigate immediately.');
  const focus = input.focusClusters.length > 0 ? input.focusClusters : ['C1', 'C5'];
  return {
    companyName:    'EmergencyStub Inc',
    companyContext: 'AI generation is offline — this is a thin emergency stub so the UI does not crash. Real shifts come from live Groq + are cached in Postgres for re-use.',
    role:           'Engineer',
    day:            1,
    scenarioArc:    'Live AI is unreachable. Refresh after the system status indicator returns to green. Each shift is normally generated by Groq fresh per (track, focus-clusters) combo and cached server-side for 7 days.',
    artifacts:      buildMockArtifacts(focus, 'EmergencyStub'),
  };
}

function buildMockArtifacts(focusClusters: string[], _company: string): ShiftArtifact[] {
  // Emergency stub artifact — minimal text, NOT a polished scenario. Real
  // shifts come from Groq. If this surface is showing, the system status
  // indicator on the UI will be red.
  const stubFor = (cc: string): ShiftArtifact => ({
    id:           `stub-${cc.toLowerCase()}`,
    clusterCode:  cc as ShiftArtifact['clusterCode'],
    artifactKind: 'meeting-note',
    label:        `Stub artifact for ${cc}`,
    body:         `[EMERGENCY STUB] Live AI is offline. Real ${cc} artifacts are generated by Groq from the locked GradiumOS taxonomy and cached server-side. Refresh once the system status indicator is green.`,
    task:         `(Stub) Free-text response — minimum 10 chars to trigger the locked-formula evidence path so you can verify the loop end-to-end.`,
    rubric:       [
      { criterion: 'Stub criterion A', weight: 0.5 },
      { criterion: 'Stub criterion B', weight: 0.5 },
    ],
    estimatedMinutes: 3,
  });
  const focus = focusClusters.length > 0 ? focusClusters.slice(0, 4) : ['C1', 'C5', 'C3', 'C7'];
  return focus.map(stubFor);
}
