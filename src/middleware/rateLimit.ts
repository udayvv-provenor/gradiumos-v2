import rateLimit from 'express-rate-limit';
import { fail } from '../utils/response.js';

export const loginRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  // Demo-friendly: 100/min/IP. Toggle round-trips, sub-agent probes, and
  // the user's manual testing all share the localhost IP bucket — 10/min
  // (the original) tripped repeatedly during the 2026-04-27 cycle and the
  // frontend surfaced it as a generic auth failure. 100/min is still safe
  // against credential stuffing in dev; production will use a stricter
  // limiter behind the real ingress.
  limit: 100,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: (_req, res) => {
    fail(res, 429, 'RATE_LIMITED', 'Too many login attempts; please try again shortly.');
  },
});

// Option B — dedicated signup limiter: 10 signups per 15 min per IP.
// Stricter than loginRateLimiter because account creation is rare;
// high volume = abuse (scraper, spammer, automated enrollment).
export const signupRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,   // 15 minutes
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: (_req, res) => {
    fail(res, 429, 'RATE_LIMITED', 'Too many signup attempts; please try again in 15 minutes.');
  },
});

export const apiRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 200,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => {
    const ip = req.ip ?? 'unknown';
    return req.auth?.sub ? `u:${req.auth.sub}` : `ip:${ip}`;
  },
  handler: (_req, res) => {
    fail(res, 429, 'RATE_LIMITED', 'Rate limit exceeded.');
  },
});
