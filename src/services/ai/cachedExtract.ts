/**
 * cachedExtract — input-hash-keyed AI extraction with DB-side reuse.
 *
 * v3.1.8 — addresses Uday's "if the same input has run already, just pull
 * it from DB; don't re-call Groq" requirement. Generalises the cache-check
 * pattern that was already in place for shift/apply/concept/public-profile,
 * and makes it the canonical wrapper for any AI extract over a deterministic
 * input (curriculum text, JD text, resume text, track-name lookup).
 *
 * Architecture position:
 *   - Input source: DB-LIVE stakeholder upload (curriculum / JD / resume) OR
 *                   text identifier (track name).
 *   - Idempotency: sha256(input) → contextHash. Same text = same row.
 *   - Cache scope: stakeholderKind + stakeholderId + slot + contextHash.
 *   - Persistence: publicDataCache table (existing). TTL configurable per slot.
 *   - Output: parsed-by-schema, OR fallback if Groq + retry both miss.
 *
 * IP-protection: this helper does NOT see the prompt; it only sees the input
 * hash + the schema. Prompt construction stays inside the per-prompt module
 * where the IP layer (cluster taxonomy + archetype rules) is owned.
 */
import { createHash } from 'crypto';
import { prisma } from '../../config/db.js';
import { safeParseLenient } from './unwrapJson.js';
import type { ZodTypeAny, infer as ZodInfer } from 'zod';

type Source = 'db-cache' | 'live-ai' | 'fallback';

export interface CachedExtractArgs<S extends ZodTypeAny> {
  /** Where this row lives in publicDataCache. stakeholderKind/Id scope it to
   *  the right entity (e.g. {kind:'campus', id: institutionId}). */
  scope:    { stakeholderKind: 'system' | 'campus' | 'workforce' | 'talent'; stakeholderId: string; slot: string };
  /** Free-form input that drives idempotency. String or any object — we
   *  JSON-stringify and sha256 it. Same input → same hash → reuse. */
  input:    string | object;
  /** Days the cache row stays valid. */
  ttlDays:  number;
  /** Zod schema the live call's response must satisfy. */
  schema:   S;
  /** The actual AI/Serper call. Only invoked on cache miss. Should return
   *  the raw response from the live API + the meta block. */
  generate: () => Promise<{ raw: unknown; meta: { latencyMs: number; tokens: number; model: string } }>;
  /** What to return when both cache miss + live call fail. */
  fallback: () => ZodInfer<S>;
  /** Optional version tag to invalidate old cached payloads when the prompt
   *  shape changes meaningfully. Default 'v1'. */
  version?: string;
}

export interface CachedExtractResult<S extends ZodTypeAny> {
  data:   ZodInfer<S>;
  source: Source;
  meta:   { latencyMs: number; tokens: number; model: string };
  /** sha256-derived contextHash that was used. Useful for debugging + for
   *  passing back to the client so cross-portal reads can deep-link. */
  hash:   string;
}

export async function cachedExtract<S extends ZodTypeAny>(args: CachedExtractArgs<S>): Promise<CachedExtractResult<S>> {
  const version = args.version ?? 'v1';
  const inputStr = typeof args.input === 'string' ? args.input : JSON.stringify(args.input);
  const hash = createHash('sha256')
    .update(`${args.scope.slot}:${inputStr}:${version}`)
    .digest('hex')
    .slice(0, 16);

  // 1. Cache check
  const cached = await prisma.publicDataCache.findFirst({
    where: {
      stakeholderKind: args.scope.stakeholderKind,
      stakeholderId:   args.scope.stakeholderId,
      slot:            args.scope.slot,
      contextHash:     hash,
    },
  });
  if (cached && cached.expiresAt > new Date() && cached.payload) {
    return {
      data:   cached.payload as ZodInfer<S>,
      source: 'db-cache',
      meta:   { latencyMs: 0, tokens: 0, model: 'db-cache' },
      hash,
    };
  }

  // 2. Live call
  let raw: unknown;
  let meta = { latencyMs: 0, tokens: 0, model: 'mock-no-call' };
  try {
    const result = await args.generate();
    raw  = result.raw;
    meta = result.meta;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`[cachedExtract:${args.scope.slot}] live call threw, using fallback:`, (err as Error).message.slice(0, 200));
    return { data: args.fallback(), source: 'fallback', meta: { ...meta, model: 'mock-call-failed' }, hash };
  }

  // 3. Schema check (lenient on input wrapping)
  const parsed = safeParseLenient(args.schema, raw);
  if (!parsed.success) {
    // eslint-disable-next-line no-console
    console.warn(`[cachedExtract:${args.scope.slot}] schema drift, using fallback:`, JSON.stringify(parsed.error.flatten()).slice(0, 240));
    return { data: args.fallback(), source: 'fallback', meta: { ...meta, model: 'mock-schema-drift' }, hash };
  }

  // 4. Persist (LIVE only — never cache fallbacks)
  const isLive = !meta.model.startsWith('mock-');
  if (isLive) {
    try {
      const expiresAt = new Date(Date.now() + args.ttlDays * 24 * 60 * 60 * 1000);
      await prisma.publicDataCache.upsert({
        where:  { stakeholderKind_stakeholderId_slot_contextHash: { stakeholderKind: args.scope.stakeholderKind, stakeholderId: args.scope.stakeholderId, slot: args.scope.slot, contextHash: hash } },
        update: { payload: parsed.data as unknown as object, retrievedAt: new Date(), expiresAt, fromFixture: false },
        create: { stakeholderKind: args.scope.stakeholderKind, stakeholderId: args.scope.stakeholderId, slot: args.scope.slot, contextHash: hash, payload: parsed.data as unknown as object, fromFixture: false, expiresAt },
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(`[cachedExtract:${args.scope.slot}] cache write failed (non-fatal):`, (err as Error).message.slice(0, 120));
    }
  }

  return {
    data:   parsed.data as ZodInfer<S>,
    source: isLive ? 'live-ai' : 'fallback',
    meta,
    hash,
  };
}
