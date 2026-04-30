/**
 * unwrapJson — robust JSON-shape recovery for Groq responses.
 *
 * v3.1.7 — fixes the "Groq returned valid JSON but wrapped it" failure mode
 * Uday spotted in the walkthrough. Symptom: `safeParse` reports every
 * top-level field as Required; root cause: Groq decided to wrap the result
 * in `{ data: {...} }`, `{ result: {...} }`, `{ response: {...} }`,
 * `{ scenario: {...} }`, etc.
 *
 * Strategy:
 *   1. Try the parser on the raw payload as-is (the happy path).
 *   2. If it fails AND the payload is a single-key object whose value is
 *      itself an object (a wrapper shape), try the parser on the unwrapped
 *      value. Repeat up to 3 levels deep.
 *   3. Also try a small set of well-known wrapper keys explicitly.
 *   4. If still failing, return the original parse error so callers can
 *      log + fall back.
 *
 * This is permissive on the input side ONLY; the output schema (caller's
 * Zod schema) is unchanged. We never accept fields the schema rejects.
 *
 * Generic-typed via `ReturnType<T['safeParse']>` so callers get the EXACT
 * same return type they would from `schema.safeParse(...)` directly. No
 * narrowing loss.
 */
import type { ZodTypeAny } from 'zod';

const WRAPPER_KEYS = ['data', 'result', 'response', 'output', 'payload', 'scenario', 'concept', 'profile', 'graded', 'card', 'reply'];

export function safeParseLenient<T extends ZodTypeAny>(
  schema: T,
  raw: unknown,
  depth = 0,
): ReturnType<T['safeParse']> {
  // 1. Direct parse
  const direct = schema.safeParse(raw) as ReturnType<T['safeParse']>;
  if (direct.success) return direct;

  // Bail if too deep or not an object
  if (depth >= 3 || !raw || typeof raw !== 'object' || Array.isArray(raw)) return direct;

  const obj = raw as Record<string, unknown>;
  const keys = Object.keys(obj);

  // 2. Single-key wrapper — try the inner value
  if (keys.length === 1) {
    const inner = obj[keys[0]];
    if (inner && typeof inner === 'object') {
      const tryInner = safeParseLenient(schema, inner, depth + 1);
      if (tryInner.success) return tryInner;
    }
  }

  // 3. Known wrapper keys
  for (const wk of WRAPPER_KEYS) {
    if (wk in obj) {
      const inner = obj[wk];
      if (inner && typeof inner === 'object') {
        const tryInner = safeParseLenient(schema, inner, depth + 1);
        if (tryInner.success) return tryInner;
      }
    }
  }

  return direct;   // return the original error
}
