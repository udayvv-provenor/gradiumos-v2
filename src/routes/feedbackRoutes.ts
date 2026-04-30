/**
 * BC 172 — POST /api/v1/feedback
 *
 * Public endpoint — no auth required. Creates a FeedbackRecord row.
 * If a valid JWT Bearer token is present in the Authorization header,
 * the userId claim is extracted and stored (soft-auth pattern).
 *
 * Body: { type: 'bug' | 'suggestion' | 'question', message: string, page?: string }
 * Response: { id, createdAt }
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import { ok, fail } from '../utils/response.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { prisma } from '../config/db.js';
import { verifyAccess } from '../services/auth/jwt.js';

const router = Router();

const VALID_TYPES = new Set(['bug', 'suggestion', 'question']);

/**
 * Soft-auth: attempt to read a valid JWT from the Authorization header.
 * Returns the userId string if successful, null otherwise.
 * Never throws — failures are silently ignored (unauthenticated feedback is fine).
 */
function extractUserIdSoft(req: Request): string | null {
  try {
    const header = req.header('authorization');
    if (!header || !header.startsWith('Bearer ')) return null;
    const token = header.slice(7).trim();
    const claims = verifyAccess(token);
    return claims.sub ?? null;
  } catch {
    return null;
  }
}

// ─── BC 172 — POST /api/v1/feedback ──────────────────────────────────────────

router.post(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    const { type, message, page } = req.body as {
      type?: string;
      message?: string;
      page?: string;
    };

    if (!type || !VALID_TYPES.has(type)) {
      fail(res, 400, 'VALIDATION', 'type must be one of: bug, suggestion, question');
      return;
    }
    if (!message || typeof message !== 'string' || message.trim() === '') {
      fail(res, 400, 'VALIDATION', 'message is required');
      return;
    }

    const userId = extractUserIdSoft(req);

    const record = await prisma.feedbackRecord.create({
      data: {
        userId,
        type,
        message: message.trim(),
        page: page && typeof page === 'string' && page.trim() ? page.trim() : null,
      },
    });

    ok(res, { id: record.id, createdAt: record.createdAt.toISOString() }, 201);
  }),
);

export default router;
