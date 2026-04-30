/**
 * inferTrackClusters — given a free-form career-track name (and optional
 * description), produce an 8-cluster weight distribution (sums to 1.0) +
 * 8-cluster target distribution (0..100 per cluster).
 *
 * v3.1.2 — replaces the hardcoded 8-canonical career tracks with dynamic
 * user creation. Each new track is mapped to the LOCKED IP cluster vocabulary
 * via this prompt. The cluster taxonomy + weight semantics are immutable;
 * the track namespace is open.
 *
 * IP-protection: prompt describes clusters in plain English only. No formula
 * constants, no archetype matrices, no thresholds outbound.
 */
import { z } from 'zod';
import { callGroq, isGroqConfigured } from '../groqClient.js';
import { safeParseLenient } from '../unwrapJson.js';

const ClusterScore = z.number().min(0).max(100);
const ClusterWeight = z.number().min(0).max(1);

export const InferredTrackClustersSchema = z.object({
  clusterWeights: z.object({
    C1: ClusterWeight, C2: ClusterWeight, C3: ClusterWeight, C4: ClusterWeight,
    C5: ClusterWeight, C6: ClusterWeight, C7: ClusterWeight, C8: ClusterWeight,
  }),
  clusterTargets: z.object({
    C1: ClusterScore, C2: ClusterScore, C3: ClusterScore, C4: ClusterScore,
    C5: ClusterScore, C6: ClusterScore, C7: ClusterScore, C8: ClusterScore,
  }),
  rationale: z.string().min(10).max(500),
});
export type InferredTrackClusters = z.infer<typeof InferredTrackClustersSchema>;

const SYSTEM_PROMPT = `You map a CAREER TRACK to GradiumOS's 8-cluster competency taxonomy.

The 8 clusters are FIXED (do not invent new ones):
  C1 — Core Technical Foundations (data structures, algorithms, computational thinking)
  C2 — Applied Problem Solving (translating ambiguous problems into structured solutions)
  C3 — Engineering Execution (production code, debugging, delivery discipline)
  C4 — System & Product Thinking (architecture, trade-offs, product reasoning)
  C5 — Communication & Collaboration (verbal, written, cross-team clarity)
  C6 — Domain Specialisation (specialist depth: ML, security, fintech, etc.)
  C7 — Ownership & Judgment (initiative, reliability, decision quality)
  C8 — Learning Agility (speed picking up new tools/domains)

You return TWO things per cluster:
  - weights: how MUCH this cluster matters for the track (0..1, all 8 sum to exactly 1.0)
  - targets: minimum competency LEVEL graduates need (0..100, where 50=entry, 70=solid, 85=strong)

Rules:
  - Weights MUST sum to 1.0 (±0.01 tolerance).
  - For a "Senior X" track, raise targets across the relevant clusters by ~10 points vs entry-level.
  - For research / academic tracks: weight C2 + C8 higher.
  - For industry production tracks: weight C3 + C7 higher.
  - For client-facing tracks: weight C5 + C7 higher.
  - For specialist tracks (ML, security, fintech): weight C6 strongly (0.20+).
  - Never weight any single cluster > 0.30 (forces well-roundedness).
  - C5/C7/C8 should always be ≥ 0.05 (they are universally relevant).

Output JSON only, this exact shape:
{
  "clusterWeights": { "C1": 0.18, "C2": 0.16, ..., "C8": 0.05 },
  "clusterTargets": { "C1": 70, "C2": 65, ..., "C8": 55 },
  "rationale": "One sentence per emphasis choice — why this track weights X higher than Y."
}`;

export interface TrackInferenceInput {
  trackName:        string;
  trackDescription?: string;
  scope?:           'institution' | 'employer' | 'system';
}

export async function inferTrackClusters(input: TrackInferenceInput): Promise<{ inferred: InferredTrackClusters; meta: { latencyMs: number; tokens: number; model: string } }> {
  const userMsg = `Career track name: "${input.trackName}"
${input.trackDescription ? `Description: "${input.trackDescription}"\n` : ''}Scope: ${input.scope ?? 'system'}

Produce the cluster weights + targets + rationale JSON now. Weights must sum to 1.0.`;

  if (!isGroqConfigured()) {
    return { inferred: mockInfer(input), meta: { latencyMs: 0, tokens: 0, model: 'mock-no-groq' } };
  }

  let result: { raw: unknown; latencyMs: number; inputTokens: number; outputTokens: number; model: string };
  try {
    result = await callGroq({
      operation: 'inferTrackClusters',
      system:    SYSTEM_PROMPT,
      user:      userMsg,
      json:      true,
      temperature: 0.2,
      maxTokens: 800,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[inferTrackClusters] groq call failed, using mock:', (err as Error).message.slice(0, 200));
    return { inferred: mockInfer(input), meta: { latencyMs: 0, tokens: 0, model: 'mock-groq-failed' } };
  }
  const parsed = safeParseLenient(InferredTrackClustersSchema, result.raw);
  if (!parsed.success) {
    // eslint-disable-next-line no-console
    console.warn('[inferTrackClusters] schema drift, using mock:', JSON.stringify(parsed.error.flatten()).slice(0, 200));
    return { inferred: mockInfer(input), meta: { latencyMs: result.latencyMs, tokens: 0, model: 'mock-schema-drift' } };
  }
  // Re-normalise weights to exactly 1.0 in case Llama drifted slightly
  const sum = Object.values(parsed.data.clusterWeights).reduce((a, b) => a + b, 0);
  if (sum > 0) {
    for (const k of Object.keys(parsed.data.clusterWeights) as Array<keyof typeof parsed.data.clusterWeights>) {
      parsed.data.clusterWeights[k] = Math.round((parsed.data.clusterWeights[k] / sum) * 100) / 100;
    }
  }
  return {
    inferred: parsed.data,
    meta: { latencyMs: result.latencyMs, tokens: result.inputTokens + result.outputTokens, model: result.model },
  };
}

/* MVP-SCAFFOLD — keyword-driven cluster inference so users can create tracks
 * without a Groq key. Recognises ~20 common track-name patterns; falls back
 * to a balanced default for anything unrecognised. */
function mockInfer(input: TrackInferenceInput): InferredTrackClusters {
  const lower = (input.trackName + ' ' + (input.trackDescription ?? '')).toLowerCase();

  // Bias matrix — how much to add to each cluster's BASE weight
  const bias: Record<string, [number, number, number, number, number, number, number, number]> = {
    //                  C1   C2   C3   C4   C5   C6   C7   C8
    'backend':         [0.04, 0.03, 0.05, 0.04, -0.02, -0.01, 0.01, -0.04],
    'frontend':        [0.02, 0.02, 0.05, 0.04, 0.00, -0.02, 0.01, 0.00],
    'fullstack':       [0.03, 0.03, 0.05, 0.05, -0.01, -0.02, 0.01, -0.04],
    'data':            [0.02, 0.05, 0.02, 0.02, 0.00, 0.06, -0.01, -0.04],
    'machine learning':[0.00, 0.04, 0.00, 0.03, 0.00, 0.10, -0.01, -0.04],
    'ml ':             [0.00, 0.04, 0.00, 0.03, 0.00, 0.10, -0.01, -0.04],
    'devops':          [0.02, 0.00, 0.06, 0.04, -0.02, 0.02, 0.04, -0.04],
    'sre':             [0.02, 0.00, 0.06, 0.04, -0.02, 0.02, 0.04, -0.04],
    'security':        [0.04, 0.02, 0.02, 0.02, -0.03, 0.10, 0.00, -0.05],
    'product man':     [-0.05, 0.03, -0.02, 0.08, 0.06, 0.00, 0.04, -0.06],
    'designer':        [-0.06, 0.03, -0.02, 0.06, 0.06, 0.02, 0.02, -0.05],
    'ux':              [-0.06, 0.03, -0.02, 0.06, 0.06, 0.02, 0.02, -0.05],
    'consult':         [-0.04, 0.04, -0.02, 0.03, 0.08, 0.00, 0.02, -0.05],
    'support':         [-0.04, 0.02, 0.02, -0.01, 0.10, -0.01, 0.02, -0.04],
    'fintech':         [0.02, 0.02, 0.04, 0.02, 0.00, 0.06, 0.00, -0.06],
    'qa ':             [0.00, 0.03, 0.06, 0.00, 0.00, 0.02, 0.02, -0.05],
    'mobile':          [0.02, 0.02, 0.05, 0.03, -0.01, 0.02, 0.00, -0.05],
    'embedded':        [0.05, 0.02, 0.04, 0.04, -0.03, 0.04, 0.00, -0.06],
    'research':        [0.02, 0.06, -0.02, 0.02, 0.00, 0.08, -0.02, -0.04],
  };

  // Base balanced distribution — exact spec defaults if nothing matches
  let weights = [0.15, 0.14, 0.14, 0.13, 0.12, 0.12, 0.10, 0.10];
  let matched: string | null = null;
  for (const [key, b] of Object.entries(bias)) {
    if (lower.includes(key)) {
      weights = weights.map((w, i) => w + b[i]);
      matched = key;
      break;
    }
  }

  // Senior bump → +5 to all non-trivial targets, plus +5% C7 weight redirected from C8
  const isSenior = /senior|staff|principal|lead|architect/.test(lower);
  if (isSenior) {
    weights[6] += 0.03;  // C7 ownership
    weights[7] -= 0.03;  // C8 agility (less critical for senior)
  }

  // Re-normalise to exactly 1.0 (handle any drift)
  const sum = weights.reduce((a, b) => a + b, 0);
  weights = weights.map(w => Math.max(0.03, w / sum));
  // Re-normalise again after floor enforcement
  const sum2 = weights.reduce((a, b) => a + b, 0);
  weights = weights.map(w => Math.round((w / sum2) * 100) / 100);

  // Fix rounding so they sum to 1.00 exactly
  const finalSum = weights.reduce((a, b) => a + b, 0);
  if (Math.abs(finalSum - 1) > 0.001) weights[0] += (1 - finalSum);

  const baseTargets = [70, 65, 65, 60, 55, 60, 60, 55];
  const targets = baseTargets.map(t => isSenior ? t + 8 : t);

  return {
    clusterWeights: {
      C1: Math.round(weights[0] * 100) / 100, C2: Math.round(weights[1] * 100) / 100,
      C3: Math.round(weights[2] * 100) / 100, C4: Math.round(weights[3] * 100) / 100,
      C5: Math.round(weights[4] * 100) / 100, C6: Math.round(weights[5] * 100) / 100,
      C7: Math.round(weights[6] * 100) / 100, C8: Math.round(weights[7] * 100) / 100,
    },
    clusterTargets: {
      C1: targets[0], C2: targets[1], C3: targets[2], C4: targets[3],
      C5: targets[4], C6: targets[5], C7: targets[6], C8: targets[7],
    },
    rationale: matched
      ? `Mock inference: track name matched "${matched}" pattern${isSenior ? ' + senior modifier' : ''}; weights biased accordingly.`
      : `Mock inference: no specific track pattern matched, using balanced default${isSenior ? ' + senior modifier' : ''}.`,
  };
}
