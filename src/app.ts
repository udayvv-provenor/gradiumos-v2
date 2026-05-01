import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import * as crypto from 'crypto';
import * as Sentry from '@sentry/node';
import { pinoHttp } from 'pino-http';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { errorMiddleware, notFoundMiddleware } from './middleware/error.js';
import { apiRateLimiter } from './middleware/rateLimit.js';
import { requireAuth } from './middleware/auth.js';
import { register, httpRequestCount, httpRequestDuration } from './middleware/metrics.js';

import authRoutes from './routes/authRoutes.js';
import overviewRoutes from './routes/overviewRoutes.js';
import competencyRoutes from './routes/competencyRoutes.js';
import programmeRoutes from './routes/programmeRoutes.js';
import rosterRoutes from './routes/rosterRoutes.js';
import settingsRoutes from './routes/settingsRoutes.js';
import demandRoutes from './routes/demandRoutes.js';
import signalConfidenceRoutes from './routes/signalConfidenceRoutes.js';
import assessmentInsightsRoutes from './routes/assessmentInsightsRoutes.js';
import placementRoutes from './routes/placementRoutes.js';
import insightRoutes from './routes/insightRoutes.js';
import workforceRoutes from './routes/workforceRoutes.js';
import talentRoutes from './routes/talentRoutes.js';
import campusPortfolioRoutes from './routes/campusPortfolioRoutes.js';
import wellKnownRoutes from './routes/wellKnownRoutes.js';
import verifyRoutes from './routes/verifyRoutes.js';
// BC 92-93 — Verifier widget HTML page (public, no auth, no portal frame)
import verifierWidgetRoutes from './routes/verifierWidgetRoutes.js';
import demoRoutes from './routes/demoRoutes.js';
// v3 — net-new endpoints (uploads, AI flows). Mounted under /api/v3.
import v3Routes from './routes/v3Routes.js';
// v3 — portal-shaped aliases for /api/campus/*, /api/workforce/*, /api/talent/*
// in the EXACT shapes the Claude-Design-generated portals expect. Mounted
// BEFORE the legacy routes so portal paths resolve to these handlers first.
import v3PortalRoutes from './routes/v3PortalRoutes.js';
// v3 Phase A — DPDP rights endpoints (BC 13–21)
import talentV1Routes from './routes/talentV1Routes.js';
import adminV1Routes from './routes/adminV1Routes.js';
// BC 62-64 — Learner bulk invite and campus v1 endpoints.
import campusV1Routes from './routes/campusV1Routes.js';
// v3 Phase B — workforce v1 endpoints (BC 50–56)
import workforceV1Routes from './routes/workforceV1Routes.js';
// BC 128-133 — Notification centre (Phase D).
import notificationRoutes from './routes/notificationRoutes.js';
// BC 172 — Feedback (public, soft-auth).
import feedbackRoutes from './routes/feedbackRoutes.js';
// note: /api/demo/counts (public) retained; /api/demo/version removed with v2 plumbing.

export function buildApp() {
  const app = express();

  // Trust Railway/Vercel reverse proxy so rate-limit sees real client IP
  // and res.locals.ip works correctly behind load balancers.
  app.set('trust proxy', 1);

  app.disable('x-powered-by');
  app.use(helmet());
  const allowedOrigins = process.env['ALLOWED_ORIGINS']
    ? process.env['ALLOWED_ORIGINS'].split(',').map((s) => s.trim())
    : ['http://localhost:5273', 'http://localhost:5275', 'http://localhost:5277'];
  app.use(cors({
    origin: allowedOrigins,
    credentials: false,
  }));
  app.use(express.json({ limit: '1mb' }));

  // BC 32 — pino-http with request-ID propagation
  app.use(pinoHttp({
    logger,
    genReqId: (req) => {
      const existing = req.headers['x-request-id'];
      if (typeof existing === 'string' && existing) return existing;
      return crypto.randomUUID();
    },
    customLogLevel: (_req, res, err) => {
      if (err || res.statusCode >= 500) return 'error';
      if (res.statusCode >= 400) return 'warn';
      return 'info';
    },
  }));

  // BC 32 — echo request-ID back to caller
  app.use((req, res, next) => {
    // pino-http attaches `id` directly on the request object via genReqId
    res.setHeader('X-Request-Id', (req as unknown as { id?: string }).id ?? '');
    next();
  });

  // BC 31 — request counter/histogram middleware
  app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      const route = req.route?.path ?? req.path;
      const labels = { method: req.method, route, status: String(res.statusCode) };
      httpRequestCount.inc(labels);
      httpRequestDuration.observe(labels, (Date.now() - start) / 1000);
    });
    next();
  });

  // BC 31 — /metrics endpoint (gated by METRICS_TOKEN bearer token when set)
  app.get('/metrics', async (req, res) => {
    const metricsToken = process.env['METRICS_TOKEN'];
    if (metricsToken) {
      const authHeader = req.headers['authorization'] ?? '';
      const provided = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
      if (!provided || provided !== metricsToken) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
    }
    res.set('Content-Type', register.contentType);
    res.end(await register.metrics());
  });

  // BC 33-34 — /api/v1/health (public, no auth)
  app.get('/health', (_req, res) => res.json({ status: 'ok', ts: new Date().toISOString() }));
  app.get('/api/v1/health', (_req, res) => res.json({ status: 'ok', version: '1.0.0', commit: process.env['GIT_COMMIT'] ?? 'dev' }));

  // Public well-known endpoint
  app.use('/.well-known', wellKnownRoutes);

  // Public verifier endpoint (no auth — rate-limited per IP inside the router)
  app.use('/api/v1', verifyRoutes);

  // BC 92-93 — Verifier widget HTML page (public, no auth, no portal frame)
  app.use('', verifierWidgetRoutes);

  // Public demo landing counts (unauthenticated — powers port 5170 hero stats)
  app.use('/api/demo', demoRoutes);

  // BC 172 — Feedback (public, no auth required; soft-extracts userId from JWT if present)
  app.use('/api/v1/feedback', feedbackRoutes);

  // Auth routes (rate-limited on login only)
  app.use('/api/auth', authRoutes);

  // Everything below the rate limiter requires a token
  app.use('/api', requireAuth, apiRateLimiter);

  // v3 portal-shaped aliases — MUST precede legacy mounts so portal paths win.
  app.use('/api', v3PortalRoutes);

  app.use('/api/overview', overviewRoutes);
  app.use('/api/competency', competencyRoutes);
  app.use('/api/campus/augmentation-programmes', programmeRoutes);
  app.use('/api/roster', rosterRoutes);
  app.use('/api/settings', settingsRoutes);
  app.use('/api/demand', demandRoutes);
  app.use('/api/signal-confidence', signalConfidenceRoutes);
  app.use('/api/assessment-insights', assessmentInsightsRoutes);
  app.use('/api/placement', placementRoutes);
  app.use('/api/overview/insight', insightRoutes);
  app.use('/api/workforce', workforceRoutes);
  app.use('/api/talent', talentRoutes);
  app.use('/api/campus', campusPortfolioRoutes);

  // v3 — net-new endpoints. requireAuth applied inside the router (uses
  // role-specific middleware per endpoint).
  app.use('/api/v3', v3Routes);

  // v3 Phase A — DPDP rights endpoints (BC 13–21).
  // requireAuth is added here; apiRateLimiter already covers /api/** above
  // but /api/v1/** is separate so we add auth explicitly.
  app.use('/api/v1/talent', requireAuth, talentV1Routes);
  app.use('/api/v1/admin',  requireAuth, adminV1Routes);
  // BC 62-64 — Campus v1 (learner bulk invite). requireAuth already applied above via /api.
  app.use('/api/v1/campus', requireAuth, campusV1Routes);
  // v3 Phase B — workforce v1 endpoints (BC 50–56).
  app.use('/api/v1/workforce', requireAuth, workforceV1Routes);
  // BC 128-133 — Notification centre (Phase D). requireAuth already applied via /api above.
  app.use('/api/v1/notifications', requireAuth, notificationRoutes);

  app.use(notFoundMiddleware);
  // BC 30 — Sentry error handler (captures unhandled errors; no-op when DSN absent)
  Sentry.setupExpressErrorHandler(app);
  app.use(errorMiddleware);
  return app;
}
