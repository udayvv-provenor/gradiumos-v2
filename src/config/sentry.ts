import * as Sentry from '@sentry/node';
import { env } from './env.js';

export function initSentry() {
  if (!env.SENTRY_DSN) return; // no-op in dev
  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.NODE_ENV,
    release: env.GIT_COMMIT ?? 'dev',
    tracesSampleRate: 0.1,
  });
}
