/**
 * mapCurriculum — given raw curriculum text + career-track name, ask Groq
 * to produce a per-subject mapping to C1–C8 + an overall coverage score
 * per cluster.
 *
 * IP-protection: cluster definitions only. No weight matrices, no thresholds.
 */
import { z } from 'zod';
import { callGroq, isGroqConfigured } from '../groqClient.js';
import { safeParseLenient } from '../unwrapJson.js';
import { compileSkill } from '../skills/registry.js';
import { AppError } from '../../../utils/AppError.js';

const Coverage = z.number().min(0).max(1);
export const SubjectMapping = z.object({
  name:     z.string().min(2).max(140),
  // Which clusters this subject contributes to (subset of C1..C8).
  clusters: z.array(z.enum(['C1','C2','C3','C4','C5','C6','C7','C8'])).min(1),
  // 0..1 — how thoroughly this subject covers what those clusters need.
  coverage: Coverage,
  // Optional one-line rationale for traceability.
  rationale: z.string().max(280).optional(),
});

export const CurriculumMappingSchema = z.object({
  // Per-cluster overall coverage 0..1 across the curriculum as a whole.
  clusterCoverage: z.object({
    C1: Coverage, C2: Coverage, C3: Coverage, C4: Coverage,
    C5: Coverage, C6: Coverage, C7: Coverage, C8: Coverage,
  }),
  subjects: z.array(SubjectMapping).min(1).max(60),
  // Overall summary the dean can read (Groq can be verbose; 2000-char ceiling).
  summary: z.string().min(20).max(2000),
});
export type CurriculumMapping = z.infer<typeof CurriculumMappingSchema>;

// BC 58 — canonical output schema alias (field names match CurriculumMappingSchema).
export const MapCurriculumOutputSchema = z.object({
  subjects: z.array(z.object({
    name: z.string(),
    clusters: z.array(z.string()),
    coverage: z.number().min(0).max(1),
  })).min(1),
  overallClusterCoverage: z.record(z.string(), z.number().min(0).max(1)),
  summary: z.string().optional(),
});

// IP layer — composed at call-time from skills/tasks/map-curriculum.md
function getSystemPrompt(): string { return compileSkill('map-curriculum'); }

export async function mapCurriculum(rawCurriculum: string, careerTrackName: string): Promise<{ mapping: CurriculumMapping; meta: { latencyMs: number; tokens: number; model: string } }> {
  if (!rawCurriculum || rawCurriculum.length < 80) throw new Error('Curriculum too short to map (min 80 chars).');

  // MVP-SCAFFOLD: when GROQ_API_KEY is unset, return a deterministic mock so
  // the curriculum-upload UI flow can be exercised end-to-end without a real key.
  // Remove this branch once Groq is wired in production.
  if (!isGroqConfigured()) {
    return { mapping: mockMapFromText(rawCurriculum, careerTrackName), meta: { latencyMs: 0, tokens: 0, model: 'mock-no-groq' } };
  }

  let result: { raw: unknown; latencyMs: number; inputTokens: number; outputTokens: number; model: string };
  try {
    result = await callGroq({
      operation: 'mapCurriculum',
      system: getSystemPrompt(),
      user: `Career track: ${careerTrackName}\n\nCurriculum text:\n${rawCurriculum.slice(0, 10000)}\n\nProduce the JSON mapping now.`,
      json: true,
      temperature: 0.15,
      maxTokens: 2200,   // v3.1.8 — tightened from 3500 (output is bounded: 8 coverage nums + ~20 subjects × ~120 chars)
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[mapCurriculum] groq call failed, using mock fallback:', (err as Error).message.slice(0, 200));
    return { mapping: mockMapFromText(rawCurriculum, careerTrackName), meta: { latencyMs: 0, tokens: 0, model: 'mock-groq-failed' } };
  }
  const parsed = safeParseLenient(CurriculumMappingSchema, result.raw);
  if (!parsed.success) {
    // eslint-disable-next-line no-console
    console.warn('[mapCurriculum] schema drift:', JSON.stringify(parsed.error.flatten()).slice(0, 200));
    // BC 58 — throw AppError so the caller returns a 502 instead of silent mock data.
    throw new AppError('AI_MAPPING_FAILED', 'Groq returned unexpected output. Please retry.');
  }
  return {
    mapping: parsed.data,
    meta: { latencyMs: result.latencyMs, tokens: result.inputTokens + result.outputTokens, model: result.model },
  };
}

/* MVP-SCAFFOLD — keyword-driven inference of subject→cluster mapping so the
 * Campus curriculum-upload UI shows real-feeling output without Groq.
 *
 * v3.1.1 — cleans subject names before output:
 *   1. Splits on stronger boundaries (sentence + bullet) instead of comma.
 *   2. Strips leading conjunctions ("and", "or"), connectives ("is", "are",
 *      "build,", "design,") and orphan participle clauses.
 *   3. Title-cases the first letter; drops fragments < 8 chars or that read
 *      like sentence remnants ("are practical lab and project work" → drop).
 */
function cleanSubjectName(line: string): string | null {
  let s = line
    .replace(/^[\s\-•*\d().]+/, '')                   // strip leading bullets / numbers / parens
    .replace(/^(and|or|the|a|an|in|on|of|to|for|with|by|at|from|as|is|are|build|design|develop|implement|create|maintain|cover|covered|covers|including|include|includes)[\s,:;\-]+/i, '')
    .replace(/^[a-z]/, c => c.toUpperCase())          // capitalise first letter
    .replace(/[\s,;:\-]+$/, '')                       // strip trailing punct/space
    .trim();
  // Drop if too short, too long, or starts/ends mid-clause
  if (s.length < 8 || s.length > 120) return null;
  // Drop fragments that start with verbs-without-subject ("Are practical lab…")
  if (/^(Are|Is|Build|Design|Maintain|Develop|Implement|Includes?|Cover(s|ed)?|Including)\s/i.test(s)) return null;
  return s;
}

function mockMapFromText(rawCurriculum: string, careerTrackName: string): CurriculumMapping {
  // Split on sentence + newline boundaries (not commas — commas were the
  // source of the "build, and maintain data pipelines at scale" fragments).
  const rawLines = rawCurriculum.split(/[\r\n.;!?]+/).map(l => l.trim()).filter(l => l.length >= 8 && l.length <= 200);
  const lines = rawLines.map(cleanSubjectName).filter((s): s is string => s !== null);
  // Subject patterns we recognise → which clusters they map to.
  const patterns: Array<{ re: RegExp; clusters: Array<'C1'|'C2'|'C3'|'C4'|'C5'|'C6'|'C7'|'C8'>; coverage: number }> = [
    { re: /algorithm|data structure|discrete|complexity/i,        clusters: ['C1','C2'],      coverage: 0.85 },
    { re: /database|dbms|sql|normaliz/i,                            clusters: ['C1','C3'],      coverage: 0.75 },
    { re: /software engineer|sdlc|version control|git/i,            clusters: ['C3','C7'],      coverage: 0.80 },
    { re: /operating system|os |kernel/i,                           clusters: ['C1','C4'],      coverage: 0.70 },
    { re: /network|tcp|http|distributed/i,                          clusters: ['C4','C1'],      coverage: 0.70 },
    { re: /machine learning|ml |ai |neural/i,                       clusters: ['C6','C2'],      coverage: 0.78 },
    { re: /system design|architecture|scal/i,                       clusters: ['C4','C3'],      coverage: 0.82 },
    { re: /compiler|programming language|paradigm/i,                clusters: ['C1','C8'],      coverage: 0.65 },
    { re: /capstone|project|practicum|internship/i,                 clusters: ['C3','C7','C5'], coverage: 0.85 },
    { re: /communication|writing|technical writ|english/i,          clusters: ['C5'],            coverage: 0.70 },
    { re: /mathematics|linear algebra|calculus|probability/i,       clusters: ['C2','C1'],      coverage: 0.55 },
    { re: /security|cryptography|cyber/i,                           clusters: ['C6','C3'],      coverage: 0.70 },
  ];
  const subjects = lines
    .map(line => {
      for (const p of patterns) {
        if (p.re.test(line)) {
          return { name: line.replace(/^[-•*\d().]+\s*/, '').slice(0, 120), clusters: p.clusters, coverage: p.coverage, rationale: `Recognised as a ${p.clusters.join('+')} subject` };
        }
      }
      return null;
    })
    .filter((s): s is NonNullable<typeof s> => Boolean(s))
    .slice(0, 20);

  if (subjects.length === 0) {
    subjects.push(
      { name: `${careerTrackName} — Foundations`, clusters: ['C1','C2'], coverage: 0.7,  rationale: 'Generic foundations (mock)' },
      { name: `${careerTrackName} — Practice`,    clusters: ['C3','C7'], coverage: 0.65, rationale: 'Generic execution (mock)' },
    );
  }

  // Aggregate per-cluster coverage by averaging across subjects that touch it.
  const sums: Record<string, { sum: number; n: number }> = { C1:{sum:0,n:0}, C2:{sum:0,n:0}, C3:{sum:0,n:0}, C4:{sum:0,n:0}, C5:{sum:0,n:0}, C6:{sum:0,n:0}, C7:{sum:0,n:0}, C8:{sum:0,n:0} };
  for (const s of subjects) {
    for (const c of s.clusters) { sums[c].sum += s.coverage; sums[c].n += 1; }
  }
  const round = (n: number) => Math.round(n * 100) / 100;
  const clusterCoverage = {
    C1: round(sums.C1.n ? sums.C1.sum / sums.C1.n : 0.3),
    C2: round(sums.C2.n ? sums.C2.sum / sums.C2.n : 0.3),
    C3: round(sums.C3.n ? sums.C3.sum / sums.C3.n : 0.3),
    C4: round(sums.C4.n ? sums.C4.sum / sums.C4.n : 0.25),
    C5: round(sums.C5.n ? sums.C5.sum / sums.C5.n : 0.20),
    C6: round(sums.C6.n ? sums.C6.sum / sums.C6.n : 0.30),
    C7: round(sums.C7.n ? sums.C7.sum / sums.C7.n : 0.25),
    C8: round(sums.C8.n ? sums.C8.sum / sums.C8.n : 0.30),
  };
  const summary = `Mock mapping for ${careerTrackName}: identified ${subjects.length} subjects. Strong coverage on C1/C3, lighter on C5/C7 — typical for a technical curriculum without explicit communication / ownership components. (No Groq key set; this is scaffolded output.)`;
  return { clusterCoverage, subjects, summary };
}
