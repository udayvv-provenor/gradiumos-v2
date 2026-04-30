/**
 * institutionPublicProfile — pulls an institution's public footprint
 * (NIRF rank/score, NAAC grade, AISHE enrolment proxy) on demand via
 * live Serper queries + Groq extraction, then caches the result in the
 * existing publicDataCache table.
 *
 * v3.1.6 — added per Uday's "live integrations + live data pulling on
 * spot, then store in DB, run-once-by-anyone, then pull later" call.
 *
 * Pattern (this is the canonical example for the rest of the platform):
 *   1. Request comes in for institution X
 *   2. Check publicDataCache (TTL 30 days)
 *   3. CACHE HIT → return (no external call)
 *   4. CACHE MISS → live Serper search × 3 (NIRF, NAAC, AISHE queries)
 *                → live Groq extraction (parses snippets into structured JSON)
 *                → write to publicDataCache
 *                → return
 *   5. Next caller for the same institution gets it from DB
 *
 * No hand-seeded NIRF data. No hardcoded ranks. The data lands in the
 * database once and is served from there forever (or until TTL).
 */
import { prisma } from '../../config/db.js';
import { serperSearch, isSerperConfigured } from './serperClient.js';
import { callGroq, isGroqConfigured } from '../ai/groqClient.js';
import { safeParseLenient } from '../ai/unwrapJson.js';
import { z } from 'zod';
import { createHash } from 'crypto';

// v3.1.10 — schema relaxed. Earlier strict enums on nirfBand/naacGrade/enrolmentRange
// rejected any Groq response that didn't EXACTLY match the enum string. In practice
// Groq returned things like "200+" / "Above 200" / "Not Accredited" which all
// failed the parse and dropped us to all-nulls fallback. Now we accept any
// nullable string and normalise post-hoc.
export const InstitutionPublicProfileSchema = z.object({
  nirfRank:       z.union([z.number(), z.string(), z.null()]).optional().transform((v) => {
    if (v === null || v === undefined) return null;
    if (typeof v === 'number') return Math.round(v);
    const m = String(v).match(/(\d+)/);
    return m ? parseInt(m[1]) : null;
  }),
  nirfScore:      z.union([z.number(), z.string(), z.null()]).optional().transform((v) => {
    if (v === null || v === undefined) return null;
    if (typeof v === 'number') return v;
    const m = String(v).match(/(\d+(?:\.\d+)?)/);
    return m ? parseFloat(m[1]) : null;
  }),
  nirfBand:       z.string().nullable().optional().transform((v) => v ?? null),
  naacGrade:      z.string().nullable().optional().transform((v) => v ?? null),
  state:          z.string().nullable().optional().transform((v) => v ?? null),
  enrolmentRange: z.string().nullable().optional().transform((v) => v ?? null),
  // Provenance — what URLs we used. Optional so Groq doesn't have to echo it.
  sources: z.array(z.object({ kind: z.string(), url: z.string().url(), snippet: z.string().max(500) })).max(8).optional().default([]),
  retrievedAt: z.string().optional().default(() => new Date().toISOString()),
});
export type InstitutionPublicProfile = z.infer<typeof InstitutionPublicProfileSchema>;

const SLOT = 'institution-public-profile';
const TTL_DAYS = 30;

const SYSTEM_PROMPT = `You extract an Indian institution's public profile from web search snippets.

Inputs: 3 batches of search snippets covering NIRF rank, NAAC grade, and AISHE/general metadata.

Extraction rules — be GENEROUS, infer when reasonable:
  - "nirfRank": the integer rank if mentioned ANYWHERE in any snippet (nirfindia.org, collegedunia, careers360, shiksha all carry it). If multiple years appear, take the most recent. Acceptable phrasings: "ranked 47", "NIRF 47", "Rank: 47", "Rank 047 in Engineering". If no rank mentioned anywhere, return null.
  - "nirfScore": numerical score 0-100 if mentioned (e.g. "score 65.4", "65.4/100").
  - "nirfBand": short string like "top-25" / "26-50" / "51-100" / "101-200" / "outside-200" / "unranked" — derive from nirfRank if present.
  - "naacGrade": exact NAAC letter grade if mentioned ("A++", "A+", "A", "B++", "B+", "B", "C") OR descriptive ("Accredited" / "Not Accredited"). If unclear, null.
  - "state": Indian state name if visible (Tamil Nadu, Karnataka, etc).
  - "enrolmentRange": rough bucket. Look for "X students" or "intake of N" mentions. Use "<1k", "1-5k", "5-10k", "10-25k", ">25k". If unclear, null.

Output exactly:
{
  "nirfRank":       <integer or null>,
  "nirfScore":      <number or null>,
  "nirfBand":       <string or null>,
  "naacGrade":      <string or null>,
  "state":          <string or null>,
  "enrolmentRange": <string or null>
}

JSON only. No wrapper key. No markdown fences. No commentary. If a field is genuinely unknown after reading ALL snippets, return null — but only after a real attempt to extract.`;

export async function getInstitutionPublicProfile(args: {
  institutionId: string;
  institutionName: string;
  forceRefresh?: boolean;
}): Promise<{ profile: InstitutionPublicProfile; source: 'live' | 'db-cache' | 'fallback' }> {
  const hash = createHash('sha256')
    .update(`institution-public:${args.institutionName.toLowerCase().trim()}:v1`)
    .digest('hex')
    .slice(0, 16);

  // 1. Cache check
  if (!args.forceRefresh) {
    const cached = await prisma.publicDataCache.findFirst({
      where: { stakeholderKind: 'campus', stakeholderId: args.institutionId, slot: SLOT, contextHash: hash },
    });
    if (cached && cached.expiresAt > new Date() && cached.payload) {
      return { profile: cached.payload as InstitutionPublicProfile, source: 'db-cache' };
    }
  }

  // 2. If Serper or Groq are unavailable, return a thin "unknown" profile
  if (!isSerperConfigured() || !isGroqConfigured()) {
    const fallback: InstitutionPublicProfile = {
      nirfRank: null, nirfScore: null, nirfBand: null, naacGrade: null,
      state: null, enrolmentRange: null, sources: [],
      retrievedAt: new Date().toISOString(),
    };
    return { profile: fallback, source: 'fallback' };
  }

  // 3. LIVE pulls — use the proper Serper query types (institution-nirf,
  // institution-naac, institution-overview). The ctx key MUST be `institution`
  // — that's the placeholder buildQuery() reads. v3.1.6 fix: previous version
  // shipped with `hiring-news` + `name` — those returned tech-trends articles
  // and never NIRF/NAAC content. Caused the "all nulls forever" bug.
  const [nirfRes, naacRes, metaRes] = await Promise.all([
    serperSearch('institution-nirf',     { institution: args.institutionName }).catch(() => null),
    serperSearch('institution-naac',     { institution: args.institutionName }).catch(() => null),
    serperSearch('institution-overview', { institution: args.institutionName }).catch(() => null),
  ]);

  // Build snippet bundle for AI extraction
  const snippetBundle = (label: string, res: typeof nirfRes) => {
    if (!res || !res.allResults) return `${label}: (no results)\n`;
    return `${label}:\n${res.allResults.slice(0, 5).map((r) => `- ${r.title}\n  ${r.link}\n  ${r.snippet ?? ''}`).join('\n')}\n`;
  };
  const userMsg = `Institution: ${args.institutionName}\n\n${snippetBundle('NIRF batch', nirfRes)}\n${snippetBundle('NAAC batch', naacRes)}\n${snippetBundle('Metadata batch', metaRes)}`;

  let groqRaw: unknown;
  try {
    const result = await callGroq({
      operation:   'extractInstitutionPublicProfile',
      system:      SYSTEM_PROMPT,
      user:        userMsg,
      json:        true,
      temperature: 0.1,
      maxTokens:   1200,
    });
    groqRaw = result.raw;
  } catch (err) {
    // Live extraction failed — return cache-empty signal, do NOT cache failure
    // eslint-disable-next-line no-console
    console.warn('[institutionPublicProfile] groq extraction failed:', (err as Error).message.slice(0, 200));
    const fallback: InstitutionPublicProfile = {
      nirfRank: null, nirfScore: null, nirfBand: null, naacGrade: null,
      state: null, enrolmentRange: null, sources: [],
      retrievedAt: new Date().toISOString(),
    };
    return { profile: fallback, source: 'fallback' };
  }

  // Add provenance from the live snippets
  const sources: InstitutionPublicProfile['sources'] = [];
  for (const [kind, res] of [['nirf', nirfRes], ['naac', naacRes], ['aishe', metaRes]] as const) {
    if (res?.topResult) sources.push({ kind, url: res.topResult.link, snippet: (res.topResult.snippet ?? '').slice(0, 280) });
  }
  const enriched = {
    ...((groqRaw as Record<string, unknown>) ?? {}),
    sources,
    retrievedAt: new Date().toISOString(),
  };

  const parsed = safeParseLenient(InstitutionPublicProfileSchema, enriched);
  if (!parsed.success) {
    // eslint-disable-next-line no-console
    console.warn('[institutionPublicProfile] schema drift:', JSON.stringify(parsed.error.flatten()).slice(0, 200));
    const fallback: InstitutionPublicProfile = {
      nirfRank: null, nirfScore: null, nirfBand: null, naacGrade: null,
      state: null, enrolmentRange: null, sources, retrievedAt: new Date().toISOString(),
    };
    return { profile: fallback, source: 'fallback' };
  }

  // 4. WRITE to DB cache so the next caller (any stakeholder) gets it free
  try {
    await prisma.publicDataCache.upsert({
      where:  { stakeholderKind_stakeholderId_slot_contextHash: { stakeholderKind: 'campus', stakeholderId: args.institutionId, slot: SLOT, contextHash: hash } },
      update: { payload: parsed.data as any, retrievedAt: new Date(), expiresAt: new Date(Date.now() + TTL_DAYS * 24 * 60 * 60 * 1000), fromFixture: false },
      create: { stakeholderKind: 'campus', stakeholderId: args.institutionId, slot: SLOT, contextHash: hash, payload: parsed.data as any, fromFixture: false, expiresAt: new Date(Date.now() + TTL_DAYS * 24 * 60 * 60 * 1000) },
    });
  } catch { /* non-fatal */ }

  return { profile: parsed.data, source: 'live' };
}
