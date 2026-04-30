import { buildApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { closeDb } from './config/db.js';
import { initSentry } from './config/sentry.js';

initSentry(); // BC 30 — must run before buildApp so Sentry can wrap Express
const app = buildApp();

const server = app.listen(env.PORT, () => {
  logger.info(`Gradium backend listening on :${env.PORT} [${env.NODE_ENV}]`);
});

async function shutdown(signal: string) {
  logger.info(`${signal} received — shutting down…`);
  server.close(async () => {
    await closeDb();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGINT',  () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
