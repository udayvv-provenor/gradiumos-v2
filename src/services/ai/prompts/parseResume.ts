/**
 * parseResume — given raw resume text, ask Groq to extract C1..C8 estimated
 * scores + experience summary + a list of declared skills.
 *
 * IP-protection: prompt describes the cluster vocabulary in plain English
 * only (same as extractJD). No formula constants, no thresholds.
 *
 * Mock fallback: when GROQ_API_KEY isn't configured, infer scores from
 * keyword density + length heuristics. Tagged MVP-SCAFFOLD.
 */
import { z } from 'zod';
import { callGroq, isGroqConfigured } from '../groqClient.js';
import { safeParseLenient } from '../unwrapJson.js';
import { compileSkill } from '../skills/registry.js';

const ClusterScore = z.number().min(0).max(100);

export const ParsedResumeSchema = z.object({
  candidateName:  z.string().max(120).optional(),
  yearsExp:       z.number().min(0).max(50),
  archetype:      z.enum(['Product', 'Service', 'MassRecruiter', 'Unknown']),
  // 0..100 estimated competency score per cluster
  clusterScores: z.object({
    C1: ClusterScore, C2: ClusterScore, C3: ClusterScore, C4: ClusterScore,
    C5: ClusterScore, C6: ClusterScore, C7: ClusterScore, C8: ClusterScore,
  }),
  // 0..1 confidence per cluster — based on how much resume evidence exists
  clusterConfidence: z.object({
    C1: z.number().min(0).max(1), C2: z.number().min(0).max(1),
    C3: z.number().min(0).max(1), C4: z.number().min(0).max(1),
    C5: z.number().min(0).max(1), C6: z.number().min(0).max(1),
    C7: z.number().min(0).max(1), C8: z.number().min(0).max(1),
  }),
  declaredSkills:    z.array(z.string().min(1).max(60)).max(40),
  experienceSummary: z.string().min(20).max(800),
  evidenceHighlights: z.array(z.string().min(8).max(280)).max(8),
});
export type ParsedResume = z.infer<typeof ParsedResumeSchema>;

// IP layer — system prompt is composed at call-time from the skill registry
// (see src/services/ai/skills/tasks/parse-resume.md). Edit the .md file, not here.
function getSystemPrompt(): string { return compileSkill('parse-resume'); }

export async function parseResume(rawText: string): Promise<{ parsed: ParsedResume; meta: { latencyMs: number; tokens: number; model: string } }> {
  if (!rawText || rawText.length < 80) throw new Error('Resume too short to parse (min 80 chars).');

  if (!isGroqConfigured()) {
    return { parsed: mockParseResume(rawText), meta: { latencyMs: 0, tokens: 0, model: 'mock-no-groq' } };
  }

  // Groq call — degrade gracefully on rate-limit / 5xx / network errors.
  // Same pattern as marketIntelService.synthesise(): never let a Groq failure
  // become a 500 to the user; fall back to the deterministic mock parser.
  let result: { raw: unknown; latencyMs: number; inputTokens: number; outputTokens: number; model: string };
  try {
    result = await callGroq({
      operation: 'parseResume',
      system: getSystemPrompt(),
      user: `Resume follows. Produce the JSON profile.\n\n${rawText.slice(0, 10000)}`,
      json: true,
      temperature: 0.1,
      maxTokens: 2000,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[parseResume] groq call failed, using mock fallback:', (err as Error).message.slice(0, 200));
    return { parsed: mockParseResume(rawText), meta: { latencyMs: 0, tokens: 0, model: 'mock-groq-failed' } };
  }
  const parsed = safeParseLenient(ParsedResumeSchema, result.raw);
  if (!parsed.success) {
    // eslint-disable-next-line no-console
    console.warn('[parseResume] schema drift, using mock fallback:', JSON.stringify(parsed.error.flatten()).slice(0, 200));
    return { parsed: mockParseResume(rawText), meta: { latencyMs: result.latencyMs, tokens: 0, model: 'mock-schema-drift' } };
  }
  return {
    parsed: parsed.data,
    meta: { latencyMs: result.latencyMs, tokens: result.inputTokens + result.outputTokens, model: result.model },
  };
}

/* MVP-SCAFFOLD — keyword-density resume scorer so the UI can be exercised
 * without a Groq key. Deterministic from text content. */
function mockParseResume(rawText: string): ParsedResume {
  const lower = rawText.toLowerCase();
  const wordCount = rawText.split(/\s+/).filter(Boolean).length;

  // Years of experience — look for "X years" / "X+ years" patterns
  const yearsMatch = lower.match(/(\d+)\+?\s*(?:years?|yrs?)/);
  const yearsExp = yearsMatch ? Math.min(20, parseInt(yearsMatch[1], 10)) : 0;

  // Archetype heuristic
  const archetype: ParsedResume['archetype'] =
    /tcs|infosys|wipro|accenture|cognizant|capgemini/.test(lower) ? 'Service'
    : /razorpay|swiggy|freshworks|zomato|uber|airbnb|google|meta|amazon|microsoft|apple/.test(lower) ? 'Product'
    : 'Unknown';

  // Per-cluster keyword bands → score
  const has = (re: RegExp) => re.test(lower);
  const count = (re: RegExp) => (lower.match(re) || []).length;

  const clusterScores = {
    C1: clamp(40 + count(/\b(algorithm|data structure|big.?o|complexity|leetcode|codeforces)\b/g) * 8 + (has(/\b(python|java|c\+\+|rust|golang|go)\b/) ? 10 : 0)),
    C2: clamp(40 + count(/\b(problem.solv|analytical|reasoning|debug|root.cause)\b/g) * 7 + (has(/\b(competition|hackathon|olympiad)\b/) ? 12 : 0)),
    C3: clamp(35 + count(/\b(production|deploy|ci|cd|test|tdd|jenkins|github action|docker)\b/g) * 6 + (yearsExp >= 2 ? 15 : 0)),
    C4: clamp(35 + count(/\b(architect|design|trade.?off|microservice|distributed|scal|aws|gcp|azure)\b/g) * 7 + (yearsExp >= 4 ? 10 : 0)),
    C5: clamp(45 + count(/\b(presented|published|wrote|documented|cross.?functional|stakeholder|workshop)\b/g) * 5 + (has(/\b(blog|talk|conference)\b/) ? 10 : 0)),
    C6: clamp(40 + count(/\b(ml|machine learning|nlp|fintech|payments|security|crypto|healthtech|edtech|specialist)\b/g) * 8),
    C7: clamp(40 + count(/\b(led|owned|drove|initiative|launched|founded|architect)\b/g) * 6 + (yearsExp >= 3 ? 10 : 0)),
    C8: clamp(50 + count(/\b(picked up|new technology|adopted|migrated|learned|adapted)\b/g) * 5),
  };

  // Confidence: longer resume + more specific evidence = higher confidence
  const baseConf = Math.min(0.7, 0.3 + wordCount / 1500);
  const clusterConfidence = {
    C1: round01(baseConf + (clusterScores.C1 > 60 ? 0.1 : 0)),
    C2: round01(baseConf + (clusterScores.C2 > 60 ? 0.1 : 0)),
    C3: round01(baseConf + (yearsExp >= 2 ? 0.1 : -0.1)),
    C4: round01(baseConf + (yearsExp >= 4 ? 0.1 : -0.15)),
    C5: round01(baseConf - 0.1),  // C5 hard to infer from resumes
    C6: round01(baseConf + (clusterScores.C6 > 60 ? 0.1 : -0.05)),
    C7: round01(baseConf + (yearsExp >= 3 ? 0.05 : -0.1)),
    C8: round01(baseConf - 0.05),
  };

  // Declared skills — pull capitalized tech tokens (rough, but works for demo)
  const skillMatches = rawText.match(/\b(Python|Java|JavaScript|TypeScript|React|Node|Go|Rust|C\+\+|SQL|PostgreSQL|MongoDB|AWS|GCP|Azure|Docker|Kubernetes|Git|Linux|TensorFlow|PyTorch|FastAPI|Django|Flask|Spring|Express|GraphQL|REST|Redis|Kafka|Spark|Hadoop|Tableau|PowerBI|Figma|Photoshop)\b/g) ?? [];
  const declaredSkills = Array.from(new Set(skillMatches)).slice(0, 20);

  // Try to find candidate name — first non-empty line that looks like a name
  const lines = rawText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const candidateName = lines.find((l) => l.length > 3 && l.length < 60 && /^[A-Z][a-z]+(\s[A-Z][a-z]+)+/.test(l)) ?? undefined;

  // Evidence highlights — bullet-like fragments
  const bullets = rawText.split(/\r?\n/)
    .map((l) => l.trim().replace(/^[-•*]\s*/, ''))
    .filter((l) => l.length > 12 && l.length < 240 && /[a-zA-Z]/.test(l) && /\d|deploy|launch|built|ship|design|led/i.test(l))
    .slice(0, 5);

  const experienceSummary = `${yearsExp}-year ${archetype.toLowerCase()}-archetype background with strengths in ${
    Object.entries(clusterScores).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([c]) => c).join(' and ')
  }. Resume length ~${wordCount} words. (Mock parse — real Groq parsing produces tighter narratives.)`;

  return {
    candidateName,
    yearsExp,
    archetype,
    clusterScores,
    clusterConfidence,
    declaredSkills,
    experienceSummary,
    evidenceHighlights: bullets.length ? bullets : ['Resume parsed in mock mode — wire Groq for richer evidence extraction.'],
  };
}

function clamp(n: number): number { return Math.max(0, Math.min(100, Math.round(n))); }
function round01(n: number): number { return Math.max(0.05, Math.min(0.95, Math.round(n * 100) / 100)); }
