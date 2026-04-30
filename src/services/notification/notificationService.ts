/**
 * BC 128-148 — Notification service (Phase D)
 *
 * Single `send(event, recipientUserId, payload)` interface used by ALL callsites.
 * No direct Notification inserts or Resend calls anywhere else.
 *
 * Responsibilities:
 *   1. Rate-limit checks (N3 per-role, N8 24h cooldown, global 10 emails/h, 50 in-app/day)
 *   2. Resolve title + body from catalogue
 *   3. Write Notification row
 *   4. Fire Resend email (fire-and-forget, non-fatal)
 *   5. Write AuditLog
 */
import { prisma } from '../../config/db.js';
import { Prisma } from '@prisma/client';
import { logger } from '../../config/logger.js';
import { sendNotificationEmail } from '../email/emailService.js';

// ─── Event type catalogue ────────────────────────────────────────────────────

export type NotificationEvent =
  | 'signal_unlocked'           // N1 — Talent
  | 'signal_band_improved'      // N2 — Talent
  | 'new_role_match'            // N3 — Talent (rate-limited: once per role per learner)
  | 'near_miss'                 // N4 — Talent
  | 'application_status'        // N5 — Talent (transactional on terminal states)
  | 'pathway_completed'         // N6 — Talent (transactional)
  | 'new_application'           // N7 — Workforce
  | 'candidate_signal_updated'  // N8 — Workforce (daily digest rate-limit)
  | 'partnership_accepted'      // N9 — Workforce
  | 'new_cohort_match'          // N10 — Workforce
  | 'role_closed'               // N11 — Talent (transactional)
  | 'shortlisted'               // N12 — Talent
  | 'offer_decision'            // N13 — Talent (transactional)
  | 'partnership_request'       // N14 — Campus Dean
  | 'sponsored_pathway'         // N15 — Campus Dean

export type NotificationPayload = Record<string, unknown>;

// ─── Catalogue: title + body templates + email flag ─────────────────────────

interface CatalogueEntry {
  title: string;
  body: (p: NotificationPayload) => string;
  email: boolean;
  deepLink?: (p: NotificationPayload) => string;
}

const CATALOGUE: Record<NotificationEvent, CatalogueEntry> = {
  signal_unlocked: {
    title: 'Your Signal is live',
    body: () => 'Your competency signal has been unlocked. View your Signal.',
    email: true,
    deepLink: () => '/portfolio',
  },
  signal_band_improved: {
    title: 'Signal band improved',
    body: (p) => `Your band improved to ${String(p['newBand'] ?? '')}.`,
    email: true,
    deepLink: () => '/portfolio',
  },
  new_role_match: {
    title: 'New role match',
    body: (p) => `${String(p['title'] ?? 'A role')} at ${String(p['employer'] ?? 'an employer')} matches your profile above 80%.`,
    email: true,
    deepLink: (p) => `/opportunities${p['roleId'] ? `?highlight=${String(p['roleId'])}` : ''}`,
  },
  near_miss: {
    title: "You're close to a match",
    body: (p) => `You're within reach for ${String(p['title'] ?? 'a role')}. ${String(p['gapSummary'] ?? '')}`,
    email: true,
    deepLink: () => '/opportunities',
  },
  application_status: {
    title: 'Application update',
    body: (p) => `Your application for ${String(p['title'] ?? 'a role')} status: ${String(p['status'] ?? '')}.`,
    email: true,
    deepLink: () => '/opportunities',
  },
  pathway_completed: {
    title: 'Pathway completed',
    body: (p) => `You completed the ${String(p['pathwayName'] ?? '')} pathway. Your signal has been updated.`,
    email: true,
    deepLink: () => '/portfolio',
  },
  new_application: {
    title: 'New application received',
    body: (p) => `${String(p['candidateBand'] ?? 'A')} candidate applied to ${String(p['roleTitle'] ?? 'your role')}.`,
    email: true,
    deepLink: (p) => p['roleId'] ? `/roles/${String(p['roleId'])}` : '/roles',
  },
  candidate_signal_updated: {
    title: 'Candidate signal updated',
    body: (p) => `A candidate on ${String(p['roleTitle'] ?? 'your role')} updated their signal.`,
    email: true,
    deepLink: (p) => p['roleId'] ? `/roles/${String(p['roleId'])}/discovery` : '/roles',
  },
  partnership_accepted: {
    title: 'Partnership accepted',
    body: (p) => `${String(p['institutionName'] ?? 'An institution')} accepted your partnership request.`,
    email: true,
    deepLink: () => '/roles',
  },
  new_cohort_match: {
    title: 'New cohort match',
    body: (p) => `${String(p['institutionName'] ?? 'An institution')} joined GradiumOS with a high-fit cohort for ${String(p['careerTrack'] ?? 'your track')}.`,
    email: true,
    deepLink: () => '/roles',
  },
  role_closed: {
    title: 'Role closed',
    body: (p) => `The role ${String(p['title'] ?? '')} at ${String(p['employer'] ?? '')} is no longer accepting applications.`,
    email: true,
    deepLink: () => '/opportunities',
  },
  shortlisted: {
    title: 'You have been shortlisted',
    body: (p) => `Congratulations! You are shortlisted for ${String(p['title'] ?? '')} at ${String(p['employer'] ?? '')}.`,
    email: true,
    deepLink: () => '/opportunities',
  },
  offer_decision: {
    title: 'Application decision',
    body: (p) => `You received a decision on ${String(p['title'] ?? '')}: ${String(p['status'] ?? '')}.`,
    email: true,
    deepLink: () => '/opportunities',
  },
  partnership_request: {
    title: 'New partnership request',
    body: (p) => `${String(p['employerName'] ?? 'An employer')} would like to partner with your institution.`,
    email: true,
    deepLink: () => '/partnerships',
  },
  sponsored_pathway: {
    title: 'Pathway funded',
    body: (p) => `${String(p['employerName'] ?? 'An employer')} has sponsored a ${String(p['clusterName'] ?? '')} pathway for your institution.`,
    email: true,
    deepLink: () => '/career-tracks',
  },
};

// ─── Rate-limit helpers ──────────────────────────────────────────────────────

/** N3: skip if Notification for (userId, 'new_role_match') with this roleId already exists */
async function isN3Duplicate(userId: string, roleId: string): Promise<boolean> {
  const existing = await prisma.notification.findFirst({
    where: {
      userId,
      type: 'new_role_match',
      body: { contains: roleId },
    },
    select: { id: true },
  });
  return existing !== null;
}

/** N8: skip if a notification of this type was sent to userId in the last 24h */
async function isN8CooldownActive(userId: string): Promise<boolean> {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const existing = await prisma.notification.findFirst({
    where: {
      userId,
      type: 'candidate_signal_updated',
      createdAt: { gte: cutoff },
    },
    select: { id: true },
  });
  return existing !== null;
}

/** Global: max 10 email-type notifications per recipient per hour */
async function isEmailHourlyLimitReached(userId: string): Promise<boolean> {
  const cutoff = new Date(Date.now() - 60 * 60 * 1000);
  const count = await prisma.notification.count({
    where: {
      userId,
      // email-enabled events are all of them, so count all recent notifications
      createdAt: { gte: cutoff },
    },
  });
  return count >= 10;
}

/** Global: max 50 in-app notifications per recipient per day */
async function isDailyLimitReached(userId: string): Promise<boolean> {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const count = await prisma.notification.count({
    where: {
      userId,
      createdAt: { gte: cutoff },
    },
  });
  return count >= 50;
}

// ─── Main send function ──────────────────────────────────────────────────────

export async function send(
  event: NotificationEvent,
  recipientUserId: string,
  payload: NotificationPayload,
): Promise<void> {
  const entry = CATALOGUE[event];

  // ── Rate-limit checks ────────────────────────────────────────────────────

  // N3: one notification per role per learner
  if (event === 'new_role_match') {
    const roleId = String(payload['roleId'] ?? '');
    if (roleId && await isN3Duplicate(recipientUserId, roleId)) {
      logger.info({ event, userId: recipientUserId, roleId }, 'notification.skipped — N3 duplicate');
      return;
    }
  }

  // N8: max once per 24h per recipient
  if (event === 'candidate_signal_updated') {
    if (await isN8CooldownActive(recipientUserId)) {
      logger.info({ event, userId: recipientUserId }, 'notification.skipped — N8 24h cooldown');
      return;
    }
  }

  // Global daily in-app cap
  if (await isDailyLimitReached(recipientUserId)) {
    logger.info({ event, userId: recipientUserId }, 'notification.skipped — global daily limit reached');
    return;
  }

  // ── Resolve title + body ─────────────────────────────────────────────────

  const title = entry.title;
  const body = entry.body(payload);
  const deepLink = entry.deepLink ? entry.deepLink(payload) : undefined;

  // ── Write Notification row ───────────────────────────────────────────────

  const notification = await prisma.notification.create({
    data: {
      userId: recipientUserId,
      type: event,
      title,
      body,
      deepLink: deepLink ?? null,
    },
  });

  // ── Write AuditLog ───────────────────────────────────────────────────────

  try {
    await prisma.auditLog.create({
      data: {
        userId: recipientUserId,
        action: 'notification_sent',
        entityType: 'Notification',
        entityId: notification.id,
        before: Prisma.DbNull,
        after: { event, userId: recipientUserId } as Prisma.InputJsonValue,
      },
    });
  } catch (auditErr) {
    logger.warn({ auditErr, notificationId: notification.id }, 'notification.audit_write_failed — non-fatal');
  }

  // ── Send email (fire-and-forget) ─────────────────────────────────────────

  if (entry.email) {
    // Check global hourly email cap (best-effort; non-blocking)
    const emailLimited = await isEmailHourlyLimitReached(recipientUserId).catch(() => false);
    if (emailLimited) {
      logger.info({ event, userId: recipientUserId }, 'notification.email_skipped — hourly email limit');
      return;
    }

    // Resolve recipient email address
    const user = await prisma.user.findUnique({
      where: { id: recipientUserId },
      select: { email: true },
    }).catch(() => null);

    if (user?.email) {
      // TODO Phase E: replace with retry queue (BullMQ / pg-boss) for guaranteed delivery
      sendNotificationEmail({
        to: user.email,
        subject: title,
        body,
      }).catch((err: unknown) => {
        logger.warn({ err, event, userId: recipientUserId }, 'notification.email_failed — non-fatal, continuing');
      });
    }
  }
}
