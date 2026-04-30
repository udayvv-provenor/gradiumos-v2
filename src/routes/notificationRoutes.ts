/**
 * BC 128-133 — Notification API (Phase D)
 *
 * Mounted at /api/v1/notifications (with requireAuth applied at mount in app.ts).
 *
 *   GET    /                    — list notifications for current user
 *   PATCH  /:id/read            — mark single notification as read
 *   PATCH  /read-all            — mark all unread as read
 */
import { Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ok, fail } from '../utils/response.js';
import { prisma } from '../config/db.js';

const router = Router();

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/v1/notifications
// Returns unread + read-within-90-days by default; full history with ?archive=true
// ─────────────────────────────────────────────────────────────────────────────

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const userId = req.auth!.sub;
    const archive = req.query['archive'] === 'true';

    // Default view: exclude notifications read > 90 days ago
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

    const whereClause = archive
      ? { userId }
      : {
          userId,
          OR: [
            { readAt: null },
            { readAt: { gte: ninetyDaysAgo } },
          ],
        };

    const notifications = await prisma.notification.findMany({
      where: whereClause,
      orderBy: { createdAt: 'desc' },
      take: 200, // safety cap
    });

    const unreadCount = notifications.filter((n) => n.readAt === null).length;

    ok(res, { notifications, unreadCount });
  }),
);

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/v1/notifications/read-all
// IMPORTANT: this must be registered BEFORE /:id/read to avoid "read-all"
// being captured as an :id param.
// ─────────────────────────────────────────────────────────────────────────────

router.patch(
  '/read-all',
  asyncHandler(async (req, res) => {
    const userId = req.auth!.sub;
    const now = new Date();

    const result = await prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: now },
    });

    ok(res, { updated: result.count });
  }),
);

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/v1/notifications/:id/read
// ─────────────────────────────────────────────────────────────────────────────

router.patch(
  '/:id/read',
  asyncHandler(async (req, res) => {
    const userId = req.auth!.sub;
    const { id } = req.params;

    const notification = await prisma.notification.findUnique({
      where: { id },
      select: { id: true, userId: true, readAt: true },
    });

    if (!notification) {
      fail(res, 404, 'NOT_FOUND', 'Notification not found');
      return;
    }

    if (notification.userId !== userId) {
      fail(res, 403, 'AUTH_FORBIDDEN', 'Not your notification');
      return;
    }

    const now = new Date();
    const updated = await prisma.notification.update({
      where: { id },
      data: { readAt: now },
      select: { id: true, readAt: true },
    });

    ok(res, updated);
  }),
);

export default router;
