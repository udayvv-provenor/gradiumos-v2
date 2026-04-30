/**
 * BC 10-12 — Public verifier endpoint.
 * BC 91   — PII audit: never returns learner name, email, or raw cluster scores.
 *
 * GET /api/v1/verify/:signalId — no authentication required.
 * Rate-limited: 30 requests per 60 seconds per IP.
 * Returns a privacy-safe verification result (no PII).
 * Response: { valid, learnerIdHash, band, careerTrack, issuedAt, expiresAt, kid }
 */

import { Router, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import crypto from 'node:crypto';
import { asyncHandler } from '../utils/asyncHandler.js';
import { prisma } from '../config/db.js';
import { verifyToken } from '../services/signal/tokenSigner.js';
import { signalBandFor } from '../services/competency/formulas.js';
import { publicKeyKid } from '../services/signal/tokenSigner.js';

const verifyRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req: Request) => req.ip ?? 'unknown',
  handler: (_req: Request, res: Response) => {
    res.status(429).json({ valid: false, error: 'Rate limit exceeded' });
  },
});

const router = Router();

router.get(
  '/verify/:signalId',
  verifyRateLimiter,
  asyncHandler(async (req: Request, res: Response) => {
    const { signalId } = req.params;

    const signal = await prisma.gradiumSignal.findUnique({
      where: { id: signalId },
    });

    if (!signal) {
      return res.status(404).json({ valid: false, error: 'Signal not found' });
    }

    // portableToken is the signed JWT-style token stored on the record
    const tokenStr = signal.portableToken;

    if (!tokenStr) {
      return res.status(404).json({ valid: false, error: 'Signal not found' });
    }

    const payload = verifyToken(tokenStr);

    if (!payload) {
      return res.status(200).json({ valid: false, error: 'Token invalid or expired' });
    }

    // Hash learnerId — no raw PII in the response (BC 91: no name/email/raw scores)
    const learnerIdHash = crypto
      .createHash('sha256')
      .update(signal.learnerId)
      .digest('hex');

    // band = qualitative label only — no numeric score in response
    const band = signalBandFor(payload.score);

    // careerTrack = cluster code from the signal record (no name lookup to avoid PII creep)
    const careerTrack = signal.clusterCode as string;

    return res.status(200).json({
      valid:        true,
      learnerIdHash,
      band,
      careerTrack,
      issuedAt:     signal.issuedAt,
      expiresAt:    signal.expiresAt,
      kid:          publicKeyKid(),
    });
  }),
);

export default router;
