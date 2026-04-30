/**
 * extractJD — given raw JD text, ask Groq to produce structured cluster targets,
 * archetype, seniority, title and key requirements.
 *
 * IP-protection: the prompt describes the C1–C8 vocabulary in plain English
 * only. It does NOT include numerical weights, thresholds, or formula
 * constants. The LLM is told what each cluster MEANS, not how it is scored.
 */
import { z } from 'zod';
import { callGroq, isGroqConfigured } from '../groqClient.js';
import { safeParseLenient } from '../unwrapJson.js';
import { compileSkill } from '../skills/registry.js';
import { AppError } from '../../../utils/AppError.js';

const ClusterScore = z.number().min(0).max(100);
export const ExtractedJDSchema = z.object({
  extractedTitle:        z.string().min(2).max(200),
  archetype:             z.enum(['Product', 'Service', 'MassRecruiter']),
  seniority:             z.enum(['Junior', 'Mid', 'Senior']),
  // 0..100 score per cluster — "how strongly the JD demands this cluster"
  clusterTargets: z.object({
    C1: ClusterScore, C2: ClusterScore, C3: ClusterScore, C4: ClusterScore,
    C5: ClusterScore, C6: ClusterScore, C7: ClusterScore, C8: ClusterScore,
  }),
  extractedRequirements: z.array(z.string().min(3).max(280)).min(1).max(12),
  domain:                z.string().max(80).optional(),
});
export type ExtractedJD = z.infer<typeof ExtractedJDSchema>;

// BC 51 — canonical export for callers that import ExtractJDOutputSchema.
// Uses z.record for clusterTargets so it aligns with the BC 51 spec shape
// while still being validated through ExtractedJDSchema above.
export const ExtractJDOutputSchema = z.object({
  clusterTargets:        z.record(z.string(), z.number().min(0).max(100)),
  archetype:             z.string(),
  seniority:             z.string(),
  extractedTitle:        z.string(),
  extractedRequirements: z.array(z.string()),
});

// IP layer — system prompt is composed at call-time from the skill registry
// (see src/services/ai/skills/tasks/extract-jd.md). Edit the .md file, not here.
function getSystemPrompt(): string { return compileSkill('extract-jd'); }

export async function extractJD(rawJD: string): Promise<{ extracted: ExtractedJD; meta: { latencyMs: number; tokens: number; model: string } }> {
  if (!rawJD || rawJD.length < 40) throw new Error('JD too short to extract (minimum 40 chars).');

  // MVP-SCAFFOLD: when GROQ_API_KEY is unset, return a deterministic mock so
  // the JD-upload UI flow can be exercised end-to-end without a real key.
  // Remove this branch once Groq is wired in production.
  if (!isGroqConfigured()) {
    return { extracted: mockExtractFromText(rawJD), meta: { latencyMs: 0, tokens: 0, model: 'mock-no-groq' } };
  }

  let result: { raw: unknown; latencyMs: number; inputTokens: number; outputTokens: number; model: string };
  try {
    result = await callGroq({
      operation: 'extractJD',
      system: getSystemPrompt(),
      user: `Job description follows. Produce the JSON.\n\n${rawJD.slice(0, 8000)}`,
      json: true,
      temperature: 0.1,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[extractJD] groq call failed, using mock fallback:', (err as Error).message.slice(0, 200));
    return { extracted: mockExtractFromText(rawJD), meta: { latencyMs: 0, tokens: 0, model: 'mock-groq-failed' } };
  }
  const parsed = safeParseLenient(ExtractedJDSchema, result.raw);
  if (!parsed.success) {
    // eslint-disable-next-line no-console
    console.warn('[extractJD] schema drift — zod validation failed:', JSON.stringify(parsed.error.flatten()).slice(0, 200));
    throw new AppError('AI_EXTRACTION_FAILED', 'Groq returned unexpected output. Please retry.');
  }
  return {
    extracted: parsed.data,
    meta: { latencyMs: result.latencyMs, tokens: result.inputTokens + result.outputTokens, model: result.model },
  };
}

/* MVP-SCAFFOLD — text-shape inference so the UI shows real-feeling content
 * even without Groq. Deterministic from the input. */
function mockExtractFromText(rawJD: string): ExtractedJD {
  const lower = rawJD.toLowerCase();
  const archetype: ExtractedJD['archetype'] =
    /tcs|infosys|wipro|accenture|cognizant|capgemini/.test(lower) ? 'Service'
    : /walk-?in|bulk|mass|trainee|genc|wilp/.test(lower) ? 'MassRecruiter'
    : 'Product';
  const seniority: ExtractedJD['seniority'] =
    /(senior|staff|principal|lead|6\+|7\+|8\+|10\+)/.test(lower) ? 'Senior'
    : /(junior|fresh|entry|0-?2|intern)/.test(lower) ? 'Junior'
    : 'Mid';
  // Title heuristic: first non-empty line, capped.
  const firstLine = rawJD.split(/\r?\n/).map(l => l.trim()).find(l => l.length > 4 && l.length < 120) ?? 'Software Role';
  const title = firstLine.replace(/^[-#*]\s*/, '').slice(0, 100);
  // Cluster targets — bias by what shows up in the text.
  const has = (re: RegExp) => re.test(lower);
  const clusterTargets = {
    C1: 60 + (has(/algorithm|data structure|big.?o|complexity/) ? 15 : 0),
    C2: 60 + (has(/problem.solv|analytical|debug/) ? 12 : 0),
    C3: 65 + (has(/production|test|ci|cd|deploy|ship/) ? 13 : 0),
    C4: 55 + (has(/architect|design|trade.off|scale|distributed/) ? 15 : 0),
    C5: 50 + (has(/communicat|stakeholder|cross.?function|writ/) ? 15 : 0),
    C6: 50 + (has(/ml|fintech|security|domain|specialist|expert/) ? 15 : 0),
    C7: 55 + (has(/ownership|reliability|judgment|initiative|own/) ? 12 : 0),
    C8: 55 + (has(/pick.?up|new tools|new domain|adapt|learn/) ? 12 : 0),
  };
  // Pull up to 6 bullet-like fragments as requirements.
  const bullets = rawJD.split(/\r?\n/)
    .map(l => l.trim().replace(/^[-•*]\s*/, ''))
    .filter(l => l.length > 8 && l.length < 240)
    .slice(0, 6);
  const requirements = bullets.length >= 1 ? bullets : ['Strong fundamentals', 'Production experience', 'Clear communication'];
  return {
    extractedTitle:        title,
    archetype,
    seniority,
    clusterTargets,
    extractedRequirements: requirements,
    domain:                undefined,
  };
}
