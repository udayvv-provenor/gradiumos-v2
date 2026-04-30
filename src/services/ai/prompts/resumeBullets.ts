/**
 * resumeBullets — given a learner profile + matched role JD, produce a
 * full structured resume payload (headline, summary, sections with
 * title+items+bullets+tags) tailored to the role.
 *
 * IP-protection: no formula constants leave the prompt. Cluster scores are
 * passed as a plain {C1: 78, C2: 65, ...} map — those are the learner's
 * own derived scores, fine to share.
 */
import { z } from 'zod';
import { callGroq, isGroqConfigured } from '../groqClient.js';
import { safeParseLenient } from '../unwrapJson.js';

export const ResumeItemSchema = z.object({
  title:    z.string().min(1).max(200),
  subtitle: z.string().max(200).optional(),
  period:   z.string().max(80).optional(),
  bullets:  z.array(z.string().min(2).max(400)).max(8).optional(),
  tags:     z.array(z.string().min(1).max(40)).max(12).optional(),
});

export const ResumeSectionSchema = z.object({
  type:  z.enum(['experience', 'projects', 'skills', 'achievements', 'education']),
  title: z.string().min(2).max(80),
  items: z.array(ResumeItemSchema).min(1),
});

export const ResumePayloadSchema = z.object({
  headline: z.string().min(5).max(200),
  summary:  z.string().min(40).max(800),
  sections: z.array(ResumeSectionSchema).min(2).max(8),
});
export type ResumePayload = z.infer<typeof ResumePayloadSchema>;

const SYSTEM = `You are a senior tech recruiter writing a resume FOR a learner targeting a specific role. You receive:
- The learner's name, institution, current academic year.
- Their cluster scores 0..100 across C1..C8 (higher = stronger).
- The target role's title + employer + extracted requirements.
- Optional list of past projects / experiences the learner has provided.

Write a structured resume:
- A 1-line headline matched to the role.
- A 3–5 line summary that names specific strengths the role asks for.
- 4–6 sections. ALWAYS include: Experience, Projects, Skills, Achievements, Education. Drop a section only if there is genuinely nothing honest to say.
- Each item carries a title, optional subtitle (employer / venue / institute), optional period, optional bullets (specific, quantified, action-led), optional tags (technologies / methods).

Style:
- Quantify whenever possible ("reduced X by 38%").
- Action verb first ("Built", "Owned", "Reduced", "Designed").
- No buzzword soup. No "passionate about". No "team player".
- If a cluster score is low, do NOT write a bullet implying mastery in that area. Be honest.

Respond with ONLY the JSON. No prose, no markdown fences. Schema:
{ "headline": str, "summary": str, "sections": [{ "type": "experience"|"projects"|"skills"|"achievements"|"education", "title": str, "items": [{ "title": str, "subtitle"?: str, "period"?: str, "bullets"?: [str], "tags"?: [str] }] }] }`;

export async function resumeBullets(args: {
  learnerName: string;
  institution: string;
  cohortYear:  string;
  clusterScores: Record<string, number>;
  roleTitle:   string;
  employer:    string;
  requirements: string[];
  pastWork?:   string;
}): Promise<{ resume: ResumePayload; meta: { latencyMs: number; tokens: number; model: string } }> {
  if (!isGroqConfigured()) {
    return { resume: mockResume(args), meta: { latencyMs: 0, tokens: 0, model: 'mock-no-groq' } };
  }

  let result: { raw: unknown; latencyMs: number; inputTokens: number; outputTokens: number; model: string };
  try {
    result = await callGroq({
      operation: 'resumeBullets',
      system: SYSTEM,
      user: `Learner:
- Name: ${args.learnerName}
- Institution: ${args.institution}
- Cohort: ${args.cohortYear}

Cluster scores (0..100): ${JSON.stringify(args.clusterScores)}

Target role:
- Title: ${args.roleTitle}
- Employer: ${args.employer}
- Key requirements:
${args.requirements.map((r) => `  - ${r}`).join('\n')}

${args.pastWork ? `Learner-provided past work / experience:\n${args.pastWork.slice(0, 4000)}` : '(No past work provided.)'}

Write the resume JSON now.`,
      json: true,
      temperature: 0.4,
      maxTokens: 2200,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[resumeBullets] groq call failed, using mock fallback:', (err as Error).message.slice(0, 200));
    return { resume: mockResume(args), meta: { latencyMs: 0, tokens: 0, model: 'mock-groq-failed' } };
  }
  const parsed = safeParseLenient(ResumePayloadSchema, result.raw);
  if (!parsed.success) {
    // eslint-disable-next-line no-console
    console.warn('[resumeBullets] schema drift, using mock fallback:', JSON.stringify(parsed.error.flatten()).slice(0, 200));
    return { resume: mockResume(args), meta: { latencyMs: result.latencyMs, tokens: 0, model: 'mock-schema-drift' } };
  }
  return {
    resume: parsed.data,
    meta: { latencyMs: result.latencyMs, tokens: result.inputTokens + result.outputTokens, model: result.model },
  };
}

/* MVP-SCAFFOLD — deterministic resume payload built from learner data when
 * Groq isn't configured / fails. Picks the strongest 3 clusters and frames
 * past work around them. Honest about gaps. */
function mockResume(args: {
  learnerName: string; institution: string; cohortYear: string;
  clusterScores: Record<string, number>;
  roleTitle: string; employer: string; requirements: string[]; pastWork?: string;
}): ResumePayload {
  const sorted = Object.entries(args.clusterScores).sort(([, a], [, b]) => b - a);
  const topCluster = sorted[0]?.[0] ?? 'C1';
  const top3 = sorted.slice(0, 3).map(([c]) => c).join('+');
  return {
    headline: `${args.learnerName} — ${args.cohortYear}, ${args.institution} — targeting ${args.roleTitle} at ${args.employer}`,
    summary: `${args.cohortYear} ${args.institution} candidate. Strongest on ${top3}. Building toward ${args.roleTitle} requirements: ${args.requirements.slice(0, 2).join('; ')}.`,
    sections: [
      { type: 'experience', title: 'Experience', items: [
        { title: 'See past-work narrative', subtitle: 'Provided by learner', bullets: (args.pastWork ?? 'No past work provided yet.').split(/\n+/).filter((l) => l.trim()).slice(0, 3) },
      ]},
      { type: 'projects', title: 'Projects', items: [
        { title: `Self-directed project relevant to ${args.roleTitle}`, bullets: [`Demonstrated ${topCluster} strengths`] },
      ]},
      { type: 'skills', title: 'Skills', items: [
        { title: 'Strongest clusters', tags: sorted.slice(0, 4).map(([c, s]) => `${c}:${s}`) },
      ]},
      { type: 'education', title: 'Education', items: [
        { title: args.institution, subtitle: 'B.Tech / equivalent', period: args.cohortYear },
      ]},
    ],
  };
}
