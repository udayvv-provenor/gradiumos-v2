/**
 * roleInsight — the "rich Workforce Dashboard" backend per Uday's call:
 *   - Gap radar for the selected role: role.clusterTargets vs cohort competency
 *     averages (cross-portal aggregation from Campus learners)
 *   - Salary intelligence via Serper (Glassdoor / AmbitionBox snippets) →
 *     Groq normalises to {min, median, max} INR LPA
 *   - Recommended sourcing colleges via Groq → Serper enrichment → Groq
 *     ranking. The Groq→Serper→Groq pipeline Uday described.
 *   - Mini GitHub talent preview (top 3 from githubTalentDiscovery cache)
 *
 * v3.1.10. Heavy caching: salary 30d, sourcing colleges 14d.
 *
 * Architecture position: ONE bundled endpoint feeds the Workforce Dashboard
 * and the per-role detail page so the TA Lead sees the full picture without
 * triggering 5 separate Groq calls per render.
 */
import { z } from 'zod';
import { createHash } from 'crypto';
import { prisma } from '../../config/db.js';
import { callGroq, isGroqConfigured } from '../ai/groqClient.js';
import { safeParseLenient } from '../ai/unwrapJson.js';
import { serperSearch } from '../publicData/serperClient.js';

const SLOT_SALARY  = 'role-salary';
const SLOT_COLLEGES = 'role-sourcing-colleges';

/* ─── Salary intelligence ─────────────────────────────────────────── */

export const SalaryIntelSchema = z.object({
  currency: z.string().default('INR LPA'),
  band:     z.string().nullable().optional(),       // "Junior" / "Mid" / "Senior"
  min:      z.union([z.number(), z.string(), z.null()]).optional().transform((v) => {
    if (v == null) return null;
    if (typeof v === 'number') return v;
    const m = String(v).match(/(\d+(?:\.\d+)?)/);
    return m ? parseFloat(m[1]) : null;
  }),
  median:   z.union([z.number(), z.string(), z.null()]).optional().transform((v) => {
    if (v == null) return null;
    if (typeof v === 'number') return v;
    const m = String(v).match(/(\d+(?:\.\d+)?)/);
    return m ? parseFloat(m[1]) : null;
  }),
  max:      z.union([z.number(), z.string(), z.null()]).optional().transform((v) => {
    if (v == null) return null;
    if (typeof v === 'number') return v;
    const m = String(v).match(/(\d+(?:\.\d+)?)/);
    return m ? parseFloat(m[1]) : null;
  }),
  sources:  z.array(z.string()).max(6).optional().default([]),
  oneLine:  z.string().min(2).max(280).optional().nullable(),
});
export type SalaryIntel = z.infer<typeof SalaryIntelSchema>;

const SALARY_PROMPT = `You normalise compensation snippets for an Indian engineering role into structured ranges.

Inputs: 5-10 search snippets from Glassdoor, AmbitionBox, Naukri, LinkedIn for "<role> salary <city>".

Rules:
  - Output INR LPA (lakhs per annum). If a source quotes monthly INR, multiply by 12 and divide by 100000.
  - "min" = bottom decile / "starts at"; "max" = top decile; "median" = the value most commonly cited.
  - "band" = Junior (0-3 yrs), Mid (3-7 yrs), Senior (7+ yrs) — pick the dominant band the snippets describe.
  - "sources" = max 5 source domains (just the domain, e.g. "ambitionbox.com").
  - "oneLine" = a single sentence the TA can copy: e.g. "Mid-level SWE in Bangalore: 12-22 LPA, median 16 LPA across Glassdoor/AmbitionBox."
  - If snippets give nothing useful for a field, return null. Do NOT invent numbers.

Output JSON ONLY with these top-level keys: currency, band, min, median, max, sources, oneLine. No wrapper key.`;

export async function getSalaryIntel(args: {
  roleId: string;
  roleTitle: string;
  city: string;
  forceRefresh?: boolean;
}): Promise<{ intel: SalaryIntel; source: 'live'|'db-cache'|'fallback' }> {
  const hash = createHash('sha256').update(`salary:${args.roleTitle.toLowerCase()}|${args.city.toLowerCase()}:v1`).digest('hex').slice(0, 16);
  if (!args.forceRefresh) {
    const cached = await prisma.publicDataCache.findFirst({
      where: { stakeholderKind: 'workforce', stakeholderId: args.roleId, slot: SLOT_SALARY, contextHash: hash },
    });
    if (cached && cached.expiresAt > new Date() && cached.payload) {
      return { intel: cached.payload as unknown as SalaryIntel, source: 'db-cache' };
    }
  }
  const empty: SalaryIntel = { currency: 'INR LPA', band: null, min: null, median: null, max: null, sources: [], oneLine: null };
  if (!isGroqConfigured()) return { intel: empty, source: 'fallback' };

  // 1. Pull two salary search snippets in parallel
  const [g, a] = await Promise.all([
    serperSearch('salary-glassdoor', { role: args.roleTitle, city: args.city }).catch(() => null),
    serperSearch('salary-ambitionbox', { role: args.roleTitle, city: args.city }).catch(() => null),
  ]);
  const snippets: string[] = [];
  for (const r of [g, a]) {
    if (!r?.allResults) continue;
    for (const item of r.allResults.slice(0, 5)) {
      snippets.push(`${item.title}\n${item.link}\n${item.snippet ?? ''}`);
    }
  }
  if (snippets.length === 0) return { intel: empty, source: 'fallback' };

  // 2. Groq normalises
  let raw: unknown; let model = 'mock-no-call';
  try {
    const r = await callGroq({
      operation:  'roleSalary',
      system:     SALARY_PROMPT,
      user:       `Role: ${args.roleTitle}\nCity: ${args.city}\n\nSnippets:\n${snippets.join('\n---\n').slice(0, 6000)}\n\nNormalise.`,
      json:       true,
      temperature: 0.1,
      maxTokens:  500,
    });
    raw = r.raw; model = r.model;
  } catch {
    return { intel: empty, source: 'fallback' };
  }
  const parsed = safeParseLenient(SalaryIntelSchema, raw);
  if (!parsed.success) return { intel: empty, source: 'fallback' };

  const isLive = !model.startsWith('mock-');
  if (isLive) {
    try {
      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      await prisma.publicDataCache.upsert({
        where:  { stakeholderKind_stakeholderId_slot_contextHash: { stakeholderKind: 'workforce', stakeholderId: args.roleId, slot: SLOT_SALARY, contextHash: hash } },
        update: { payload: parsed.data as unknown as object, retrievedAt: new Date(), expiresAt, fromFixture: false },
        create: { stakeholderKind: 'workforce', stakeholderId: args.roleId, slot: SLOT_SALARY, contextHash: hash, payload: parsed.data as unknown as object, fromFixture: false, expiresAt },
      });
    } catch { /* non-fatal */ }
  }
  return { intel: parsed.data, source: isLive ? 'live' : 'fallback' };
}

/* ─── Sourcing colleges (Groq → Serper → Groq pipeline) ───────────── */

export const SourcingCollegeSchema = z.object({
  name:        z.string().min(2).max(120),
  city:        z.string().nullable().optional(),
  nirfRank:    z.union([z.number(), z.string(), z.null()]).optional().transform((v) => {
    if (v == null) return null;
    if (typeof v === 'number') return Math.round(v);
    const m = String(v).match(/(\d+)/);
    return m ? parseInt(m[1]) : null;
  }),
  reasoning:   z.string().min(2).max(280).optional().nullable(),
  url:         z.string().url().nullable().optional(),
});
export type SourcingCollege = z.infer<typeof SourcingCollegeSchema>;
const SourcingCollegesArraySchema = z.array(SourcingCollegeSchema).min(1).max(12);

const SUGGEST_COLLEGES_PROMPT = `You suggest top Indian engineering colleges to source candidates from for a specific role.

Inputs: role title, archetype (Product / Service / MassRecruiter), city.

Rules:
  - Suggest 6-10 colleges that REGULARLY place graduates into the given archetype.
  - Mix tiers: 2-3 NIRF top-25, 2-3 NIRF 26-100, 1-3 strong tier-3 with the right specialisation.
  - DO NOT INVENT colleges. Use real Indian engineering institutions.
  - For each: name (full institution name) + city (best guess).

Output JSON ONLY: { "colleges": [{ "name": "...", "city": "..." }, ...] }`;

const RANK_COLLEGES_PROMPT = `You take a list of Indian colleges enriched with public placement-record snippets and rank them for a specific role + archetype.

For each college:
  - "name", "city" (carry over from input)
  - "nirfRank" — extract from snippet if present
  - "reasoning" — one sentence on why this college fits the role + archetype, citing visible evidence from the snippet

Output JSON ONLY: { "colleges": [{ "name", "city", "nirfRank", "reasoning", "url" }, ...] } sorted best-fit first.`;

export async function getRecommendedColleges(args: {
  roleId: string;
  roleTitle: string;
  archetype: string;
  city: string;
  forceRefresh?: boolean;
}): Promise<{ colleges: SourcingCollege[]; source: 'live'|'db-cache'|'fallback' }> {
  const hash = createHash('sha256').update(`colleges:${args.roleTitle.toLowerCase()}|${args.archetype}|${args.city.toLowerCase()}:v1`).digest('hex').slice(0, 16);
  if (!args.forceRefresh) {
    const cached = await prisma.publicDataCache.findFirst({
      where: { stakeholderKind: 'workforce', stakeholderId: args.roleId, slot: SLOT_COLLEGES, contextHash: hash },
    });
    if (cached && cached.expiresAt > new Date() && cached.payload) {
      return { colleges: cached.payload as unknown as SourcingCollege[], source: 'db-cache' };
    }
  }
  if (!isGroqConfigured()) return { colleges: [], source: 'fallback' };

  // STEP 1: Groq suggests college list
  let suggestionsRaw: unknown; let model1 = '';
  try {
    const r1 = await callGroq({
      operation:  'suggestColleges',
      system:     SUGGEST_COLLEGES_PROMPT,
      user:       `Role: ${args.roleTitle}\nArchetype: ${args.archetype}\nCity (preferred sourcing region): ${args.city}\n\nList 8 colleges as JSON.`,
      json:       true,
      temperature: 0.3,
      maxTokens:  800,
    });
    suggestionsRaw = r1.raw; model1 = r1.model;
  } catch {
    return { colleges: [], source: 'fallback' };
  }
  const suggestionsParsed = safeParseLenient(z.object({ colleges: z.array(z.object({ name: z.string(), city: z.string().nullable().optional() })).min(1).max(12) }), suggestionsRaw);
  if (!suggestionsParsed.success) return { colleges: [], source: 'fallback' };
  const suggested = suggestionsParsed.data.colleges.slice(0, 8);

  // STEP 2: Serper enriches each (placement record snippet)
  const enriched = await Promise.all(suggested.map(async (c) => {
    const r = await serperSearch('institution-placement-record', { institution: c.name }).catch(() => null);
    const top = r?.allResults?.[0];
    return {
      name: c.name,
      city: c.city ?? null,
      snippet: top?.snippet ?? '',
      url: top?.link ?? null,
    };
  }));

  // STEP 3: Groq ranks + reasons
  let rankedRaw: unknown; let model2 = '';
  try {
    const r2 = await callGroq({
      operation:  'rankColleges',
      system:     RANK_COLLEGES_PROMPT,
      user:       `Role: ${args.roleTitle}\nArchetype: ${args.archetype}\n\nColleges with placement snippets:\n${enriched.map((c) => `- ${c.name} (${c.city ?? 'unknown city'})\n  ${c.url ?? '(no link)'}\n  ${c.snippet}`).join('\n')}\n\nRank them.`,
      json:       true,
      temperature: 0.2,
      maxTokens:  1500,
    });
    rankedRaw = r2.raw; model2 = r2.model;
  } catch {
    return { colleges: [], source: 'fallback' };
  }
  const rankedParsed = safeParseLenient(z.object({ colleges: SourcingCollegesArraySchema }), rankedRaw);
  if (!rankedParsed.success) return { colleges: [], source: 'fallback' };

  const isLive = !model1.startsWith('mock-') && !model2.startsWith('mock-');
  if (isLive) {
    try {
      const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
      await prisma.publicDataCache.upsert({
        where:  { stakeholderKind_stakeholderId_slot_contextHash: { stakeholderKind: 'workforce', stakeholderId: args.roleId, slot: SLOT_COLLEGES, contextHash: hash } },
        update: { payload: rankedParsed.data.colleges as unknown as object, retrievedAt: new Date(), expiresAt, fromFixture: false },
        create: { stakeholderKind: 'workforce', stakeholderId: args.roleId, slot: SLOT_COLLEGES, contextHash: hash, payload: rankedParsed.data.colleges as unknown as object, fromFixture: false, expiresAt },
      });
    } catch { /* non-fatal */ }
  }
  return { colleges: rankedParsed.data.colleges, source: isLive ? 'live' : 'fallback' };
}

/* ─── Gap radar (cross-portal: role demand vs cohort averages) ────── */

export interface RoleGap {
  clusterCode: string;
  demand:     number;          // role.clusterTargets[c]
  cohortAvg:  number;          // average across all platform learners (capped to 100)
  gap:        number;          // max(0, demand - cohortAvg)
}

export async function getRoleGapRadar(args: { roleId: string }): Promise<{ rows: RoleGap[]; cohortSize: number }> {
  const role = await prisma.employerRole.findUnique({ where: { id: args.roleId }, select: { clusterTargets: true } });
  const demands = (role?.clusterTargets ?? {}) as Record<string, number>;
  const allScores = await prisma.competencyScore.findMany({ select: { clusterCode: true, scoreWeighted: true } });
  const sums: Record<string, { sum: number; n: number }> = {};
  for (const s of allScores) {
    const c = s.clusterCode as string;
    sums[c] = sums[c] ?? { sum: 0, n: 0 };
    sums[c].sum += s.scoreWeighted;
    sums[c].n += 1;
  }
  const cohortSize = new Set(allScores.map((s) => (s as unknown as { learnerId?: string }).learnerId)).size;
  const codes = ['C1','C2','C3','C4','C5','C6','C7','C8'];
  const rows: RoleGap[] = codes.map((c) => {
    const demand = Math.round(demands[c] ?? 0);
    const cohort = sums[c] ? Math.round(sums[c].sum / sums[c].n) : 0;
    return { clusterCode: c, demand, cohortAvg: cohort, gap: Math.max(0, demand - cohort) };
  });
  return { rows, cohortSize };
}
