/**
 * marketIntelService — orchestrates Serper queries → AI synthesis → cache.
 *
 * Per Uday's 3-slot framing:
 *   slot 1 — Self-profile         (your own public footprint)
 *   slot 2 — Anonymised peer benchmark
 *   slot 3 — Actionable counterparty data
 * Plus: domain-news (shared cross-slot).
 *
 * One service, three callers (talent / workforce / campus). Each caller
 * passes their context (city, track, institution, archetype) and which
 * slots they want. Service returns the cached payload OR runs a fresh
 * query batch + AI synth + cache write.
 */
import { createHash } from 'crypto';
import { z } from 'zod';
import { prisma } from '../../config/db.js';
import { callGroq, isGroqConfigured } from '../ai/groqClient.js';
import { safeParseLenient } from '../ai/unwrapJson.js';
import { compileSkill } from '../ai/skills/registry.js';
import { serperSearchBatch, type QueryType, type SerperSearchResponse } from './serperClient.js';

const CACHE_TTL_HOURS = 24;

/* â”€â”€â”€ Output schemas (mirror the .md schema docs) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

export const MarketSnapshotSchema = z.object({
  headline: z.string().min(5).max(500),
  facts: z.array(z.object({
    claim:       z.string().min(5).max(500),
    source:      z.string().min(2).max(60),
    retrievedAt: z.string(),
    url:         z.string().optional(),
  })).max(10),
  topEntities: z.array(z.object({
    name:   z.string().min(2).max(120),
    type:   z.enum(['employer', 'institution', 'role', 'location', 'other']),
    metric: z.string().min(2).max(80),
  })).max(8),
  emptyState:       z.boolean(),
  emptyStateReason: z.string().optional(),
});
export type MarketSnapshot = z.infer<typeof MarketSnapshotSchema>;

export const PeerBenchmarkSchema = z.object({
  benchmark: z.object({
    metric:  z.string().min(2).max(160),
    value:   z.string().min(2).max(120),
    context: z.string().min(5).max(280),
  }),
  comparison: z.object({
    userValue: z.string().optional(),
    delta:     z.string().optional(),
  }).optional(),
  sources: z.array(z.object({
    source:      z.string(),
    retrievedAt: z.string(),
    url:         z.string().optional(),
  })).max(8),
  emptyState:       z.boolean(),
  emptyStateReason: z.string().optional(),
});
export type PeerBenchmark = z.infer<typeof PeerBenchmarkSchema>;

/* â”€â”€â”€ Cache helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

function ctxHash(ctx: Record<string, string>): string {
  const norm = Object.keys(ctx).sort().map((k) => `${k}=${ctx[k] ?? ''}`).join('|');
  return createHash('sha256').update(norm).digest('hex').slice(0, 16);
}

async function readCache(stakeholderKind: string, stakeholderId: string, slot: string, ctx: Record<string, string>): Promise<unknown | null> {
  const hash = ctxHash(ctx);
  const row = await prisma.publicDataCache.findUnique({
    where: { stakeholderKind_stakeholderId_slot_contextHash: { stakeholderKind, stakeholderId, slot, contextHash: hash } },
  });
  if (!row) return null;
  if (row.expiresAt < new Date()) return null;
  return row.payload;
}

async function writeCache(stakeholderKind: string, stakeholderId: string, slot: string, ctx: Record<string, string>, payload: unknown, fromFixture: boolean): Promise<void> {
  const hash = ctxHash(ctx);
  const expiresAt = new Date(Date.now() + CACHE_TTL_HOURS * 60 * 60 * 1000);
  await prisma.publicDataCache.upsert({
    where: { stakeholderKind_stakeholderId_slot_contextHash: { stakeholderKind, stakeholderId, slot, contextHash: hash } },
    update: { payload: payload as object, fromFixture, retrievedAt: new Date(), expiresAt },
    create: { stakeholderKind, stakeholderId, slot, contextHash: hash, payload: payload as object, fromFixture, expiresAt },
  });
}

/* â”€â”€â”€ Synthesis helper â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

interface SynthArgs<T> {
  skillName: string;
  schema:    z.ZodTypeAny;
  context:   string;     // human-readable context for the user message
  searchResults: SerperSearchResponse[];
  /** Fallback used when Groq isn't configured OR schema validation fails.
   *  Different output shapes (MarketSnapshot vs PeerBenchmark) need
   *  different fallbacks — caller passes the right one. */
  mockFallback: (searchResults: SerperSearchResponse[]) => T;
  /** Optional shape-pin to add to the user message. Helps Llama pick the
   *  right schema when a task can emit multiple shapes. */
  shapePin?:   string;
}

async function synthesise<T>({ skillName, schema, context, searchResults, mockFallback, shapePin }: SynthArgs<T>): Promise<T> {
  const formattedResults = searchResults.map((r, i) => {
    if (!r.topResult) return `### Query ${i + 1}: ${r.queryType}\n  Query: "${r.query}"\n  RESULT: (no usable result)`;
    return `### Query ${i + 1}: ${r.queryType}\n  Query: "${r.query}"\n  Top organic result:\n    Title: ${r.topResult.title}\n    Link: ${r.topResult.link}\n    Snippet: ${r.topResult.snippet}\n    Date: ${r.topResult.date ?? 'undated'}\n    Source: ${r.topResult.source ?? 'unknown'}`;
  }).join('\n\n');

  // Bypass switches:
  //   MARKET_INTEL_USE_MOCKS=true  → force pure-fixture mode (skip Groq entirely)
  //   GROQ_API_KEY unset/placeholder → no real Groq available
  const forceMock = process.env.MARKET_INTEL_USE_MOCKS === 'true';
  if (forceMock || !isGroqConfigured()) return mockFallback(searchResults);

  const userMsg = `Stakeholder context:\n${context}\n\nSearch result bundle (one query per source per the trusted-sources rule):\n\n${formattedResults}${shapePin ? `\n\n${shapePin}` : ''}\n\nProduce the JSON now.`;

  // Wrap Groq call so rate-limits / 5xx / network errors all degrade gracefully
  // to the mock fallback rather than 500'ing the whole market-intel request.
  let result: { raw: unknown };
  try {
    result = await callGroq({
      operation: skillName,
      system: compileSkill(skillName),
      user: userMsg,
      json: true,
      temperature: 0.15,
      maxTokens: 1500,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`[marketIntel] ${skillName} groq call failed, using mock fallback:`, (err as Error).message.slice(0, 200));
    return mockFallback(searchResults);
  }

  const parsed = safeParseLenient(schema, result.raw);
  if (!parsed.success) {
    // eslint-disable-next-line no-console
    console.warn(`[marketIntel] ${skillName} schema drift, using mock fallback:`, JSON.stringify(parsed.error.flatten()).slice(0, 200));
    return mockFallback(searchResults);
  }
  return parsed.data;
}

/* MVP-SCAFFOLD — assembles a MarketSnapshot from search results without
 * using Groq. Used when no key is configured OR when Groq drift fails
 * schema validation.
 *
 * v3.1 (post-IP-MVP audit): the previous implementation prefixed every
 * headline with "{n} sources surveyed:" which leaked the mock-fallback nature
 * onto Workforce + Campus Market Intel cards (the #1 visual repeat in the
 * audit). This version pulls the lead snippet's first sentence and tags
 * sources as a compact suffix (e.g. "— NIRF · ET HRSEA").
 */
function mockSynth(searchResults: SerperSearchResponse[]): MarketSnapshot {
  const usable = searchResults.filter((r) => r.topResult);
  if (usable.length === 0) {
    return {
      headline: 'No usable results found.',
      facts: [],
      topEntities: [],
      emptyState: true,
      emptyStateReason: 'All queries returned no organic results.',
    };
  }
  const facts = usable.slice(0, 5).map((r) => ({
    claim:       r.topResult!.snippet.slice(0, 280),
    source:      r.topResult!.source ?? r.queryType,
    retrievedAt: r.retrievedAt,
    url:         r.topResult!.link,
  }));

  // Lead snippet → first sentence (or first 180 chars) becomes the headline.
  const lead = usable[0]?.topResult?.snippet ?? '';
  const firstSentence = lead.split(/(?<=[.!?])\s+/)[0] ?? lead;
  let headline = firstSentence.length > 0 && firstSentence.length <= 200
    ? firstSentence.trim()
    : (lead.slice(0, 180).trim() + (lead.length > 180 ? '…' : ''));

  // If the lead is thin, splice in a fact from a second source.
  if (headline.length < 60 && usable[1]?.topResult) {
    const second = (usable[1].topResult.snippet.split(/(?<=[.!?])\s+/)[0] ?? '').trim();
    if (second && second.length < 140) headline = `${headline} · ${second}`;
  }

  // Compact source provenance suffix.
  const sourceTags = Array.from(new Set(
    usable.slice(0, 3).map((r) => r.topResult!.source ?? r.queryType)
  )).filter(Boolean);
  const suffix = sourceTags.length > 0 ? ` — ${sourceTags.join(' · ')}` : '';

  return {
    headline:    (headline + suffix).slice(0, 320),
    facts,
    topEntities: [],
    emptyState:  false,
  };
}

/* â”€â”€â”€ Public API: per-stakeholder market intel â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

export interface TalentMarketIntel {
  selfProfile:   MarketSnapshot;        // their college's placement record
  peerBenchmark: MarketSnapshot;        // peer learners at their tier
  counterparty:  MarketSnapshot;        // open roles + top hirers for their track
  domainNews:    MarketSnapshot;        // recent news for their target domain
}

export async function getTalentMarketIntel(args: {
  learnerId: string;
  institution: string;
  city:        string;
  track:       string;
  domain?:     string;
  forceRefresh?: boolean;
}): Promise<TalentMarketIntel> {
  const ctx = { city: args.city, track: args.track, institution: args.institution, domain: args.domain ?? args.track };
  const ctxKey = `learner=${args.learnerId} | track=${args.track} | city=${args.city}`;

  // SLOT 1: self-profile (their college's public placement)
  const selfProfile = (args.forceRefresh
    ? null
    : await readCache('talent', args.learnerId, 'self-profile', ctx)
  ) as MarketSnapshot | null
    ?? await (async () => {
      const results = await serperSearchBatch([
        { qt: 'institution-placement-record', ctx: { institution: args.institution, year: '2024' } },
      ]);
      const data = await synthesise<MarketSnapshot>({
        skillName: 'synthesise-institution-market',
        schema:    MarketSnapshotSchema,
        context:   `Slot: self-profile (the LEARNER's own college placement record).\nLearner: ${ctxKey}\nFrom Talent perspective — show their college's public placement evidence.`,
        searchResults: results,
        mockFallback: mockSynth,
      });
      await writeCache('talent', args.learnerId, 'self-profile', ctx, data, results.some((r) => r.fromFixture));
      return data;
    })();

  // SLOT 2: peer benchmark
  const peerBenchmark = (args.forceRefresh
    ? null
    : await readCache('talent', args.learnerId, 'peer-benchmark', ctx)
  ) as MarketSnapshot | null
    ?? await (async () => {
      const results = await serperSearchBatch([
        { qt: 'peer-placement-benchmark', ctx: { tier: '1', track: args.track, year: '2024' } },
      ]);
      const data = await synthesise<MarketSnapshot>({
        skillName: 'synthesise-institution-market',
        schema:    MarketSnapshotSchema,
        context:   `Slot: peer benchmark (anonymised peer learner placement at their tier).\n${ctxKey}\nProduce a band statistic, NOT per-institution names.`,
        searchResults: results,
        mockFallback: mockSynth,
      });
      await writeCache('talent', args.learnerId, 'peer-benchmark', ctx, data, results.some((r) => r.fromFixture));
      return data;
    })();

  // SLOT 3: counterparty (open roles + top hirers)
  const counterparty = (args.forceRefresh
    ? null
    : await readCache('talent', args.learnerId, 'counterparty', ctx)
  ) as MarketSnapshot | null
    ?? await (async () => {
      const results = await serperSearchBatch([
        { qt: 'open-roles-naukri',   ctx: { role: roleForTrack(args.track), city: args.city } },
        { qt: 'open-roles-linkedin', ctx: { role: roleForTrack(args.track), city: args.city } },
        { qt: 'salary-ambitionbox',  ctx: { role: roleForTrack(args.track), city: args.city } },
        { qt: 'salary-glassdoor',    ctx: { role: roleForTrack(args.track), city: args.city } },
      ]);
      const data = await synthesise<MarketSnapshot>({
        skillName: 'synthesise-talent-market',
        schema:    MarketSnapshotSchema,
        context:   `Slot: counterparty (open roles + top hirers + salary band for the LEARNER's chosen track).\n${ctxKey}`,
        searchResults: results,
        mockFallback: mockSynth,
      });
      await writeCache('talent', args.learnerId, 'counterparty', ctx, data, results.some((r) => r.fromFixture));
      return data;
    })();

  // SLOT 4: domain news
  const domainNews = (args.forceRefresh
    ? null
    : await readCache('talent', args.learnerId, 'domain-news', ctx)
  ) as MarketSnapshot | null
    ?? await (async () => {
      const results = await serperSearchBatch([
        { qt: 'hiring-news', ctx: { domain: args.domain ?? args.track, year: new Date().getFullYear().toString() } },
      ]);
      const data = await synthesise<MarketSnapshot>({
        skillName: 'synthesise-domain-news',
        schema:    MarketSnapshotSchema,
        context:   `Slot: domain news for the LEARNER's target track/domain.\n${ctxKey}`,
        searchResults: results,
        mockFallback: mockSynth,
      });
      await writeCache('talent', args.learnerId, 'domain-news', ctx, data, results.some((r) => r.fromFixture));
      return data;
    })();

  return { selfProfile, peerBenchmark, counterparty, domainNews };
}

export interface WorkforceMarketIntel {
  selfProfile:   MarketSnapshot;     // their employer's public footprint (TODO — placeholder for now)
  peerBenchmark: PeerBenchmark;      // peer competitor cluster targets + salary
  counterparty:  MarketSnapshot;     // top sourcing institutions
  domainNews:    MarketSnapshot;
}

export async function getWorkforceMarketIntel(args: {
  employerId: string;
  employerName: string;
  archetype: string;
  track:     string;
  city?:     string;
  forceRefresh?: boolean;
}): Promise<WorkforceMarketIntel> {
  const city = args.city ?? 'Bangalore';
  const ctx = { employer: args.employerName, archetype: args.archetype, track: args.track, city };
  const ctxKey = `employer=${args.employerName} | track=${args.track} | archetype=${args.archetype}`;

  // SLOT 2: peer benchmark (competitor JD asks)
  const peerBenchmark = (args.forceRefresh
    ? null
    : await readCache('workforce', args.employerId, 'peer-benchmark', ctx)
  ) as PeerBenchmark | null
    ?? await (async () => {
      const results = await serperSearchBatch([
        { qt: 'competitor-jds-naukri',   ctx: { role: roleForTrack(args.track), archetype: args.archetype } },
        { qt: 'competitor-jds-linkedin', ctx: { role: roleForTrack(args.track), archetype: args.archetype } },
        { qt: 'salary-ambitionbox',      ctx: { role: roleForTrack(args.track), city } },
      ]);
      const data = await synthesise<PeerBenchmark>({
        skillName: 'synthesise-employer-market',
        schema:    PeerBenchmarkSchema,
        context:   `Slot: peer benchmark (anonymised competitor cluster targets + salary).\n${ctxKey}\nReturn PeerBenchmark — never name competitors in slot 2.`,
        searchResults: results,
        mockFallback: mockBenchmark,
        shapePin: 'IMPORTANT — output shape MUST be PeerBenchmark, NOT MarketSnapshot. Required top-level keys: { "benchmark": { "metric", "value", "context" }, "sources": [...], "emptyState": bool }. Do NOT emit "headline", "facts", or "topEntities" — those belong to MarketSnapshot.',
      }).catch(() => mockBenchmark(results));
      await writeCache('workforce', args.employerId, 'peer-benchmark', ctx, data, results.some((r) => r.fromFixture));
      return data;
    })();

  // SLOT 3: counterparty (sourcing institutions)
  const counterparty = (args.forceRefresh
    ? null
    : await readCache('workforce', args.employerId, 'counterparty', ctx)
  ) as MarketSnapshot | null
    ?? await (async () => {
      const results = await serperSearchBatch([
        { qt: 'sourcing-pools-nirf', ctx: { track: args.track === 'SWE' ? 'CSE' : args.track, year: '2024' } },
      ]);
      const data = await synthesise<MarketSnapshot>({
        skillName: 'synthesise-employer-market',
        schema:    MarketSnapshotSchema,
        context:   `Slot: counterparty (top sourcing institutions for ${args.track}).\n${ctxKey}\nReturn MarketSnapshot — institution names ARE allowed in slot 3 (sourcing decisions).`,
        searchResults: results,
        mockFallback: mockSynth,
      });
      await writeCache('workforce', args.employerId, 'counterparty', ctx, data, results.some((r) => r.fromFixture));
      return data;
    })();

  const domainNews = (args.forceRefresh
    ? null
    : await readCache('workforce', args.employerId, 'domain-news', ctx)
  ) as MarketSnapshot | null
    ?? await (async () => {
      const results = await serperSearchBatch([
        { qt: 'hiring-news', ctx: { domain: args.track, year: new Date().getFullYear().toString() } },
      ]);
      const data = await synthesise<MarketSnapshot>({
        skillName: 'synthesise-domain-news',
        schema:    MarketSnapshotSchema,
        context:   `Slot: domain news for ${args.track}.\n${ctxKey}`,
        searchResults: results,
        mockFallback: mockSynth,
      });
      await writeCache('workforce', args.employerId, 'domain-news', ctx, data, results.some((r) => r.fromFixture));
      return data;
    })();

  // v3.1 — wire real employer self-profile from Serper. Two queries: hiring/careers
  // page mentions + Glassdoor/AmbitionBox reputation snapshot. The TA Lead sees
  // their OWN company's public hiring footprint as the leftmost slot — useful for
  // "what does the market see when they search for us?" framing.
  const selfProfile = (args.forceRefresh
    ? null
    : await readCache('workforce', args.employerId, 'self-profile', ctx)
  ) as MarketSnapshot | null
    ?? await (async () => {
      const results = await serperSearchBatch([
        { qt: 'employer-profile',   ctx: { employer: args.employerName, year: new Date().getFullYear().toString() } },
        { qt: 'employer-glassdoor', ctx: { employer: args.employerName } },
      ]);
      const data = await synthesise<MarketSnapshot>({
        skillName: 'synthesise-employer-market',
        schema:    MarketSnapshotSchema,
        context:   `Slot: self-profile (the EMPLOYER's own public hiring footprint + reputation snapshot).\n${ctxKey}\nFrom Workforce TA perspective — show what the market sees when they look up THIS employer.`,
        searchResults: results,
        mockFallback: mockSynth,
      });
      await writeCache('workforce', args.employerId, 'self-profile', ctx, data, results.some((r) => r.fromFixture));
      return data;
    })();

  return { selfProfile, peerBenchmark, counterparty, domainNews };
}

export interface CampusMarketIntel {
  selfProfile:   MarketSnapshot;     // their NIRF + NAAC + AISHE record
  peerBenchmark: MarketSnapshot;     // peer placement-rate band
  counterparty:  MarketSnapshot;     // top hirers from peer institutions
  domainNews:    MarketSnapshot;
}

export async function getCampusMarketIntel(args: {
  institutionId: string;
  institutionName: string;
  track: string;
  forceRefresh?: boolean;
}): Promise<CampusMarketIntel> {
  const ctx = { institution: args.institutionName, track: args.track };
  const ctxKey = `institution=${args.institutionName} | track=${args.track}`;

  const selfProfile = (args.forceRefresh
    ? null
    : await readCache('campus', args.institutionId, 'self-profile', ctx)
  ) as MarketSnapshot | null
    ?? await (async () => {
      // v3.1 — added 'institution-overview' as a third complementary query
      // because the previous site:nirfindia.org / site:naac.gov.in restrictions
      // were too tight (most institutions are indexed via aggregator pages, not
      // directly on the source). The broader query catches collegedunia /
      // careers360 / shiksha pages which DO carry NIRF rank text.
      const results = await serperSearchBatch([
        { qt: 'institution-nirf',     ctx: { institution: args.institutionName, year: '2024' } },
        { qt: 'institution-naac',     ctx: { institution: args.institutionName } },
        { qt: 'institution-overview', ctx: { institution: args.institutionName } },
      ]);
      const data = await synthesise<MarketSnapshot>({
        skillName: 'synthesise-institution-market',
        schema:    MarketSnapshotSchema,
        context:   `Slot: self-profile (the INSTITUTION's own NIRF + NAAC public record + general overview).\n${ctxKey}\nFrom Campus Dean perspective — surface this institution's own placement rate, NIRF rank, NAAC grade.`,
        searchResults: results,
        mockFallback: mockSynth,
      });
      await writeCache('campus', args.institutionId, 'self-profile', ctx, data, results.some((r) => r.fromFixture));
      return data;
    })();

  const peerBenchmark = (args.forceRefresh
    ? null
    : await readCache('campus', args.institutionId, 'peer-benchmark', ctx)
  ) as MarketSnapshot | null
    ?? await (async () => {
      const results = await serperSearchBatch([
        { qt: 'peer-placement-benchmark', ctx: { tier: '1', track: args.track === 'SWE' ? 'CSE' : args.track, year: '2024' } },
      ]);
      const data = await synthesise<MarketSnapshot>({
        skillName: 'synthesise-institution-market',
        schema:    MarketSnapshotSchema,
        context:   `Slot: peer benchmark (anonymised peer institutions placement rate band).\n${ctxKey}\nReturn band statistic; never browseable list of peer institutions.`,
        searchResults: results,
        mockFallback: mockSynth,
      });
      await writeCache('campus', args.institutionId, 'peer-benchmark', ctx, data, results.some((r) => r.fromFixture));
      return data;
    })();

  const counterparty = (args.forceRefresh
    ? null
    : await readCache('campus', args.institutionId, 'counterparty', ctx)
  ) as MarketSnapshot | null
    ?? await (async () => {
      const results = await serperSearchBatch([
        { qt: 'top-hirers-from-peers', ctx: { tier: '1', track: args.track === 'SWE' ? 'CSE' : args.track, year: '2024' } },
      ]);
      const data = await synthesise<MarketSnapshot>({
        skillName: 'synthesise-institution-market',
        schema:    MarketSnapshotSchema,
        context:   `Slot: counterparty (top hirers from peer-archetype institutions — Dean acts on these as MoU partners).\n${ctxKey}\nNamed employer entities ARE allowed.`,
        searchResults: results,
        mockFallback: mockSynth,
      });
      await writeCache('campus', args.institutionId, 'counterparty', ctx, data, results.some((r) => r.fromFixture));
      return data;
    })();

  const domainNews = (args.forceRefresh
    ? null
    : await readCache('campus', args.institutionId, 'domain-news', ctx)
  ) as MarketSnapshot | null
    ?? await (async () => {
      const results = await serperSearchBatch([
        { qt: 'hiring-news', ctx: { domain: args.track, year: new Date().getFullYear().toString() } },
      ]);
      const data = await synthesise<MarketSnapshot>({
        skillName: 'synthesise-domain-news',
        schema:    MarketSnapshotSchema,
        context:   `Slot: hiring trends news for ${args.track}.\n${ctxKey}`,
        searchResults: results,
        mockFallback: mockSynth,
      });
      await writeCache('campus', args.institutionId, 'domain-news', ctx, data, results.some((r) => r.fromFixture));
      return data;
    })();

  return { selfProfile, peerBenchmark, counterparty, domainNews };
}

/* Helpers */

function roleForTrack(track: string): string {
  // Simple track → typical role title mapping for the search query
  const map: Record<string, string> = {
    SWE: 'Software Engineer', DATA: 'Data Scientist', MLAI: 'Machine Learning Engineer',
    PRODUCT: 'Product Manager', DESIGN: 'Product Designer', FINTECH: 'Backend Engineer Payments',
    OPS: 'Operations Analyst', CUSTSUCCESS: 'Customer Success Manager',
  };
  return map[track] ?? 'Software Engineer';
}

function mockBenchmark(searchResults: SerperSearchResponse[]): PeerBenchmark {
  const usable = searchResults.filter((r) => r.topResult);
  if (usable.length === 0) {
    return {
      benchmark: { metric: 'Peer benchmark', value: 'No data', context: 'No usable search results.' },
      sources: [],
      emptyState: true,
      emptyStateReason: 'All queries returned no organic results.',
    };
  }
  return {
    benchmark: {
      metric:  'Peer competitor asks (aggregated)',
      value:   usable[0]!.topResult!.snippet.slice(0, 100),
      context: `Aggregated across ${usable.length} source(s).`,
    },
    sources: usable.slice(0, 3).map((r) => ({
      source: r.topResult!.source ?? r.queryType,
      retrievedAt: r.retrievedAt,
      url: r.topResult!.link,
    })),
    emptyState: false,
  };
}
