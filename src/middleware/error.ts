import type { ErrorRequestHandler, RequestHandler } from 'express';
import { AppError } from '../utils/AppError.js';
import { ConsentMissingError } from '../services/consent/consentService.js';
import { StaleVersionError } from '../utils/optimisticUpdate.js';
import { logger } from '../config/logger.js';

export const errorMiddleware: ErrorRequestHandler = (err, req, res, _next) => {
  // BC 14 — DPDP consent missing/revoked → 403
  if (err instanceof ConsentMissingError) {
    res.status(403).json({ data: null, error: { code: 'CONSENT_MISSING', purpose: err.purpose, message: err.message } });
    return;
  }
  // BC 37-38 — Optimistic concurrency stale version → 409
  if (err instanceof StaleVersionError) {
    res.status(409).json({ data: null, error: { code: 'STALE_VERSION', message: 'This was edited by another session. Refresh to see the latest.' } });
    return;
  }
  // Handle JSON parse errors (SyntaxError from express.json)
  if (err instanceof SyntaxError && 'status' in err && (err as any).status === 400) {
    res.status(400).json({ data: null, error: { code: 'BAD_REQUEST', message: 'Invalid JSON body', details: null } });
    return;
  }
  // Handle body too large (PayloadTooLargeError from express.json limit)
  if ((err as any).type === 'entity.too.large') {
    res.status(413).json({ data: null, error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body too large', details: null } });
    return;
  }
  if (err instanceof AppError) {
    res.status(err.status).json({ data: null, error: { code: err.code, message: err.message, details: err.details ?? null } });
    return;
  }
  logger.error({ err, path: req.path, method: req.method }, 'Unhandled error');
  res.status(500).json({ data: null, error: { code: 'INTERNAL', message: 'Internal server error' } });
};

// 3-arg request handler so Express does NOT treat this as an error handler.
// Mounted BEFORE errorMiddleware so unmatched routes produce NOT_FOUND while
// thrown AppErrors still propagate to errorMiddleware with their real status/code.
export const notFoundMiddleware: RequestHandler = (req, res, _next) => {
  res.status(404).json({ data: null, error: { code: 'NOT_FOUND', message: `No handler for ${req.method} ${req.path}` } });
};
