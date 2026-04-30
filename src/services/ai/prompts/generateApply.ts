/**
 * generateApply — AI generates a WORK-SIMULATION capstone scenario for a
 * subtopic. The Apply tab in Talent presents this as a "you are now an SDE
 * at a startup, here's the situation, here's the artifact, do the work" UX.
 *
 * v3.1.4 — replaces the "COMING SOON" Apply tab with a real scenario
 * generator. Per Uday's call: "NOT TEACHING, NOT LEARNING — more like work
 * simulation approach." This is the skeleton; the popup UI lands separately.
 *
 * IP-protection: cluster terms in plain English; no formula constants outbound.
 */
import { z } from 'zod';
import { callGroq, isGroqConfigured } from '../groqClient.js';
import { safeParseLenient } from '../unwrapJson.js';

export const ApplyScenarioSchema = z.object({
  scenarioTitle:  z.string().min(5).max(120),
  /** The role / context the learner is "playing" in this simulation. */
  roleContext:    z.string().min(20).max(300),
  /** The situation. Real-world flavour. */
  situation:      z.string().min(40).max(800),
  /** The artifact the learner sees — could be a PR diff, a customer email,
   *  a meeting transcript, an incident log. Free-form text. */
  artifact: z.object({
    label: z.string().min(2).max(60),     // e.g. "PR description", "Slack thread", "Production log"
    body:  z.string().min(20).max(2000),
  }),
  /** What the learner has to produce. */
  task:           z.string().min(20).max(400),
  /** Rubric criteria the AI will grade against (3-5 items). */
  rubric:         z.array(z.object({
    criterion: z.string().min(5).max(80),
    weight:    z.number().min(0.1).max(0.5),
  })).min(3).max(5),
  /** Estimated minutes the learner should spend. */
  estimatedMinutes: z.number().int().min(5).max(45),
});
export type ApplyScenario = z.infer<typeof ApplyScenarioSchema>;

const SYSTEM_PROMPT = `You design a WORK SIMULATION scenario for a learner. NOT a teaching exercise.
NOT a quiz. A real, plausible situation a junior engineer might face on day 30
of their first job — with a concrete artifact and a concrete deliverable.

Voice: a senior engineer setting up a realistic situation for a junior to handle.

The scenario must:
  - Place the learner in a specific ROLE at a specific (fictional) company.
  - Present a SITUATION that's grounded in real engineering work — not theoretical.
  - Include an ARTIFACT they'd see in real life: a PR diff, a Slack message,
    an incident log snippet, a customer email, a design doc, a meeting note.
  - Ask for a CONCRETE DELIVERABLE: a written response, a code change description,
    a triage decision, a stakeholder update, an architecture proposal.
  - Have a RUBRIC of 3-5 weighted criteria for AI grading.

The 8 GradiumOS clusters that competencies map to (use cluster context to make
the scenario relevant — e.g. C5 scenarios are communication-heavy; C7 scenarios
are about ownership decisions):
  C1 Core Tech / C2 Problem Solving / C3 Execution / C4 Systems / C5 Communication
  C6 Domain / C7 Ownership / C8 Agility

Output JSON only. Real fictional context (real company patterns, fake names).`;

export interface GenerateApplyInput {
  subtopicCode: string;
  subtopicName: string;
  clusterCode:  string;
  clusterName:  string;
}

export async function generateApply(input: GenerateApplyInput): Promise<{ scenario: ApplyScenario; meta: { latencyMs: number; tokens: number; model: string } }> {
  const userMsg = `Subtopic: ${input.subtopicCode} — ${input.subtopicName}
Cluster: ${input.clusterCode} — ${input.clusterName}

Design the work-simulation scenario JSON now.`;

  if (!isGroqConfigured()) {
    return { scenario: mockScenario(input), meta: { latencyMs: 0, tokens: 0, model: 'mock-no-groq' } };
  }

  let result: { raw: unknown; latencyMs: number; inputTokens: number; outputTokens: number; model: string };
  try {
    result = await callGroq({
      operation: 'generateApply',
      system:    SYSTEM_PROMPT,
      user:      userMsg,
      json:      true,
      temperature: 0.5,
      maxTokens: 2000,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[generateApply] groq failed, using mock:', (err as Error).message.slice(0, 120));
    return { scenario: mockScenario(input), meta: { latencyMs: 0, tokens: 0, model: 'mock-groq-failed' } };
  }
  const parsed = safeParseLenient(ApplyScenarioSchema, result.raw);
  if (!parsed.success) {
    // eslint-disable-next-line no-console
    console.warn('[generateApply] schema drift, using mock:', JSON.stringify(parsed.error.flatten()).slice(0, 200));
    return { scenario: mockScenario(input), meta: { latencyMs: result.latencyMs, tokens: 0, model: 'mock-schema-drift' } };
  }
  return {
    scenario: parsed.data,
    meta: { latencyMs: result.latencyMs, tokens: result.inputTokens + result.outputTokens, model: result.model },
  };
}

/* MVP-SCAFFOLD — high-quality scenario generator without Groq. Real-feeling
 * setup, plausible artifact, concrete deliverable. Cluster-flavored. */
function mockScenario(input: GenerateApplyInput): ApplyScenario {
  const { subtopicName, clusterCode } = input;

  const CLUSTER_FLAVORS: Record<string, { context: string; scenario: string; artifactLabel: string; artifactBody: string; task: string; rubric: { criterion: string; weight: number }[] }> = {
    C1: {
      context: 'You are a Backend Engineer (1 year experience) at SwiftPay, a payments startup. The team ships SDE-level code on production payment flows.',
      scenario: `A teammate's PR landed on staging two days ago. Today, the daily reconciliation job started timing out — it used to finish in 4 minutes, now it's running for 90+ minutes before the cron killed it. You're on triage. The PR touched the reconciliation service. ${subtopicName} is one of the things to look at.`,
      artifactLabel: 'PR description (the change that broke it)',
      artifactBody: `Title: Refactor reconciliation to use cleaner abstraction\n\nChanges:\n- Replaced raw SQL JOIN with a clean nested loop in JavaScript\n- For each transaction, look up the matching ledger entry via array.find()\n- Removed the ~40 lines of SQL — much more readable now!\n\nDB: ledger table has 12M rows. transactions table has 4M rows.`,
      task: 'Diagnose the root cause in plain English (3-5 sentences). Then propose the fix in one sentence. Specifically: what is the Big-O of the new code, and what would the right approach be?',
      rubric: [
        { criterion: 'Identifies the O(n*m) nested-loop performance issue correctly', weight: 0.35 },
        { criterion: 'Names the data scale (4M * 12M = 48 trillion ops) explicitly', weight: 0.25 },
        { criterion: 'Proposes a correct fix (SQL JOIN, hash map, indexed lookup)', weight: 0.25 },
        { criterion: 'Communicates clearly and concisely', weight: 0.15 },
      ],
    },
    C5: {
      context: 'You are a 2-year SDE at a payments startup. You missed a sprint deadline because a third-party API you depended on was rate-limiting your test environment.',
      scenario: 'Your engineering manager just pinged you on Slack: "Hey, what happened with the reconciliation feature? PMs are asking about Friday\'s demo." You need to write back NOW. Keep it short, lead with the bottom line, and say what you need (if anything).',
      artifactLabel: 'Slack thread',
      artifactBody: `[engineering-team channel]\n\nManager (10:42 AM): "Hey, what happened with the reconciliation feature? PMs are asking about Friday's demo."`,
      task: 'Write your reply (2-4 sentences). Lead with the bottom line. State what happened, what you\'re doing about it, and what you need (if anything).',
      rubric: [
        { criterion: 'Bottom Line Up Front — first sentence carries the conclusion', weight: 0.35 },
        { criterion: 'Explains the cause concisely without burying the lede', weight: 0.20 },
        { criterion: 'States current action / next step concretely', weight: 0.20 },
        { criterion: 'Asks a clear, specific ask (or explicitly says "no help needed")', weight: 0.15 },
        { criterion: 'Tone is professional, ownership-positive, not defensive', weight: 0.10 },
      ],
    },
    C7: {
      context: 'You are a 1.5-year backend engineer who shipped a payment retry feature 3 weeks ago. The feature has been quietly failing 8% of the time in production — nobody noticed until today, when a customer complained.',
      scenario: 'You read the production logs. The retry logic has an off-by-one in the backoff calculation that causes the third retry to fire 100ms after the second instead of 800ms. This means it hits the rate limit and fails. Your tech lead asks: "How did this slip through? What\'s your post-mortem look like?"',
      artifactLabel: 'Production log snippet',
      artifactBody: `2026-04-26 14:23:11 [retry-svc] attempt=1 backoff=200ms\n2026-04-26 14:23:11 [retry-svc] attempt=2 backoff=400ms\n2026-04-26 14:23:11 [retry-svc] attempt=3 backoff=100ms  ← BUG\n2026-04-26 14:23:11 [retry-svc] FAIL: 429 Rate limit exceeded\n2026-04-26 14:23:12 [retry-svc] FINAL FAIL transaction_id=txn_8f3a92`,
      task: 'Write a 3-paragraph post-mortem: (1) what happened, (2) why it slipped through, (3) what you\'ll change to prevent recurrence. Don\'t blame the system — focus on what YOU could have done differently.',
      rubric: [
        { criterion: 'Owns the failure without deflection', weight: 0.30 },
        { criterion: 'Diagnoses the technical root cause precisely', weight: 0.20 },
        { criterion: 'Identifies the testing/review gap that let it through', weight: 0.20 },
        { criterion: 'Proposes specific, actionable preventions (not "be more careful")', weight: 0.20 },
        { criterion: 'Tone is mature, ownership-positive', weight: 0.10 },
      ],
    },
  };

  const flavor = CLUSTER_FLAVORS[clusterCode] ?? CLUSTER_FLAVORS.C5;

  return {
    scenarioTitle:    `${subtopicName} — Day 30 Simulation`,
    roleContext:      flavor.context,
    situation:        flavor.scenario,
    artifact:         { label: flavor.artifactLabel, body: flavor.artifactBody },
    task:             flavor.task,
    rubric:           flavor.rubric,
    estimatedMinutes: 12,
  };
}
