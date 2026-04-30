/**
 * Groq client — single point of contact with the Groq API.
 *
 * Uses the OpenAI-compatible groq-sdk. Reads GROQ_API_KEY + GROQ_MODEL from
 * env. Defaults to llama-3.1-70b-versatile (free tier).
 *
 * IP-protection envelope: every prompt is run through redact() before send.
 * If a prompt template tries to send any of the forbidden tokens (formula
 * constants, weight matrices, threshold values), the call refuses with a
 * loud error rather than silently leaking IP. CI grep gate is post-MVP;
 * this runtime check is the floor.
 *
 * Returns parsed JSON if `responseFormat: 'json'` is requested; otherwise
 * returns the raw text. zod validation is the caller's responsibility (each
 * prompt template owns its schema).
 */
import Groq from 'groq-sdk';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';

const FORBIDDEN_TOKENS = [
  // Formula constants (numeric)
  'DECAY=0.8',
  'DECAY = 0.8',
  'FRESHNESS_WINDOW_DAYS=180',
  'FRESHNESS_WINDOW_DAYS = 180',
  'SUPPRESSION_CONFIDENCE',
  // Confidence-mix weights specifically (the "weighted mix" IP)
  'completeness * 0.35',
  'stability * 0.30',
  'sufficiency * 0.20',
  'consistency * 0.15',
  '0.35 * completeness',
  // Generic weight tables
  'archetypeWeights',
  'clusterWeights:',
  'thresholds:',
];

/** True when a real Groq API key is configured. Prompt files check this to
 *  decide whether to call the live model or return MVP-SCAFFOLD mock data
 *  so the v3 UI flows can be exercised without a key. */
export function isGroqConfigured(): boolean {
  const apiKey = process.env.GROQ_API_KEY;
  return Boolean(apiKey && apiKey !== 'YOUR_GROQ_KEY_HERE' && apiKey.length >= 10);
}

let _client: Groq | null = null;
function client(): Groq {
  if (_client) return _client;
  if (!isGroqConfigured()) {
    throw new Error(
      'GROQ_API_KEY not set. Get a free key at https://console.groq.com and ' +
      'set GROQ_API_KEY in backend/.env',
    );
  }
  _client = new Groq({ apiKey: process.env.GROQ_API_KEY });
  return _client;
}

function redact(prompt: string): { ok: boolean; offendingToken?: string } {
  for (const t of FORBIDDEN_TOKENS) {
    if (prompt.includes(t)) return { ok: false, offendingToken: t };
  }
  return { ok: true };
}

export interface GroqCallOptions {
  /** Operator label for logs / metrics. e.g. "extractJD" */
  operation: string;
  /** System prompt (instructions). Forbidden-token check applies. */
  system: string;
  /** User prompt (the data to operate on). Forbidden-token check applies. */
  user: string;
  /** Force JSON object output. Default true. */
  json?: boolean;
  /** Temperature. Default 0.1 for extraction tasks; callers raise for chat. */
  temperature?: number;
  /** Max output tokens. Default 2000. */
  maxTokens?: number;
}

export interface GroqCallResult {
  /** Parsed JSON if json:true, else string. */
  raw: unknown;
  /** Tokens used (if reported by API). */
  inputTokens: number;
  outputTokens: number;
  /** Wall-clock latency in ms. */
  latencyMs: number;
  /** Model that actually answered. */
  model: string;
}

export async function callGroq(opts: GroqCallOptions): Promise<GroqCallResult> {
  const sysCheck = redact(opts.system);
  const userCheck = redact(opts.user);
  if (!sysCheck.ok) {
    throw new Error(`IP-protection guard: refusing to send forbidden token "${sysCheck.offendingToken}" in system prompt for operation "${opts.operation}"`);
  }
  if (!userCheck.ok) {
    throw new Error(`IP-protection guard: refusing to send forbidden token "${userCheck.offendingToken}" in user prompt for operation "${opts.operation}"`);
  }

  const model = env.GROQ_MODEL || 'llama-3.3-70b-versatile';
  const wantJson = opts.json !== false;
  const t0 = Date.now();
  const completion = await client().chat.completions.create({
    model,
    messages: [
      { role: 'system', content: opts.system },
      { role: 'user',   content: opts.user },
    ],
    temperature: opts.temperature ?? 0.1,
    max_tokens: opts.maxTokens ?? 2000,
    ...(wantJson ? { response_format: { type: 'json_object' as const } } : {}),
  });
  const latencyMs = Date.now() - t0;
  const text = completion.choices?.[0]?.message?.content ?? '';
  let raw: unknown = text;
  if (wantJson) {
    try { raw = JSON.parse(text); }
    catch (e) {
      logger.error({ op: opts.operation, text }, 'groq returned non-JSON despite json mode');
      throw new Error(`Groq returned non-JSON for operation ${opts.operation}: ${text.slice(0, 200)}`);
    }
  }
  const inputTokens  = completion.usage?.prompt_tokens     ?? 0;
  const outputTokens = completion.usage?.completion_tokens ?? 0;
  logger.info({
    op: opts.operation, model, latencyMs, inputTokens, outputTokens,
  }, 'groq call complete');
  return { raw, inputTokens, outputTokens, latencyMs, model };
}

/* ─── Streaming variant for tutor chat — returns an async iterator of deltas ── */
export async function* streamGroq(opts: Omit<GroqCallOptions, 'json'> & { history?: { role: 'user' | 'assistant'; content: string }[] }): AsyncGenerator<string> {
  const sysCheck = redact(opts.system);
  if (!sysCheck.ok) throw new Error(`IP guard: refusing forbidden token in system prompt for ${opts.operation}`);
  const messages: { role: 'system' | 'user' | 'assistant'; content: string }[] = [
    { role: 'system', content: opts.system },
    ...(opts.history ?? []),
    { role: 'user', content: opts.user },
  ];
  for (const m of messages) {
    const r = redact(m.content);
    if (!r.ok) throw new Error(`IP guard: forbidden token in message for ${opts.operation}`);
  }
  const model = env.GROQ_MODEL || 'llama-3.3-70b-versatile';
  const stream = await client().chat.completions.create({
    model, messages,
    temperature: opts.temperature ?? 0.6,
    max_tokens: opts.maxTokens ?? 600,
    stream: true,
  });
  for await (const chunk of stream) {
    const delta = chunk.choices?.[0]?.delta?.content ?? '';
    if (delta) yield delta;
  }
}
