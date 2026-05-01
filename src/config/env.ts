import { z } from 'zod';
import * as dotenv from 'dotenv';

dotenv.config();

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  DATABASE_URL: z.string().min(1),
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL_DAYS: z.coerce.number().int().min(1).default(7),
  ALLOWED_ORIGINS: z.string().default('http://localhost:5273,http://localhost:5275,http://localhost:5277'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error']).default('info'),
  SIGNAL_PRIVATE_KEY_HEX: z.string().optional(), // 64-char hex seed; auto-generated if absent
  SIGNAL_PUBLIC_KEY_HEX: z.string().optional(),
  DEMO_MODE: z.enum(['true', 'false']).default('false'),
  // v3 — Groq integration. GROQ_API_KEY is read at call-time so the server
  // can boot without a key for non-AI smoke tests.
  GROQ_MODEL: z.string().default('llama-3.1-70b-versatile'),
  // v3 — local file storage root for uploaded JDs / curricula
  UPLOAD_DIR: z.string().default('./uploads'),
  // BC 30 — Sentry
  SENTRY_DSN: z.string().optional(),
  GIT_COMMIT: z.string().optional(),
  // BC 35-36 — Feature flags (env-var overrides)
  FEATURE_TUTOR_ENABLED: z.string().optional(),
  FEATURE_SPONSORED_PATHWAYS_ENABLED: z.string().optional(),
  FEATURE_VERIFIER_WIDGET_ENABLED: z.string().optional(),
  FEATURE_PROCTORING_ENABLED: z.string().optional(),
  // BC 46 — Resend email integration (optional; emails are skipped when absent)
  RESEND_API_KEY: z.string().optional(),
  // Option A — /metrics endpoint bearer token (optional; endpoint is open when absent)
  METRICS_TOKEN: z.string().optional(),
});

const parsed = EnvSchema.safeParse(process.env);
if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error('Invalid environment configuration:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
export type Env = typeof env;
