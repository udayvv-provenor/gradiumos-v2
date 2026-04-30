/**
 * BC 46 — Email service via Resend.
 *
 * All functions are fire-and-forget safe: errors are caught and logged but
 * never re-thrown, so email failures never block signup or invite flows.
 *
 * When RESEND_API_KEY is absent the functions log at info level and return
 * immediately — useful for local dev and smoke tests without a Resend account.
 */
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';

export async function sendWelcomeEmail(opts: {
  to: string;
  name: string;
  role: 'institution' | 'employer' | 'learner';
  inviteCode?: string;
}): Promise<void> {
  if (!env.RESEND_API_KEY) {
    logger.info({ to: opts.to, role: opts.role }, 'email.welcome skipped — no RESEND_API_KEY');
    return;
  }
  try {
    const { Resend } = await import('resend');
    const resend = new Resend(env.RESEND_API_KEY);
    const subject =
      opts.role === 'learner'     ? 'Welcome to GradiumOS — start building your Signal' :
      opts.role === 'institution' ? 'Welcome to GradiumOS — your institution is live' :
                                    'Welcome to GradiumOS — your employer account is ready';
    const text = opts.inviteCode
      ? `Hi ${opts.name},\n\nYour institution is set up on GradiumOS.\nShare invite code ${opts.inviteCode} with your learners.\n\nGradiumOS Team`
      : `Hi ${opts.name},\n\nWelcome to GradiumOS.\n\nGradiumOS Team`;
    await resend.emails.send({
      from: 'GradiumOS <noreply@gradiumos.ai>',
      to: opts.to,
      subject,
      text,
    });
  } catch (err) {
    logger.warn({ err, to: opts.to }, 'email.welcome failed — non-fatal, continuing');
  }
}

// BC 128 — Generic notification email (Phase D). Used by notificationService for all 15 events.
// Fire-and-forget: errors are caught and logged at the callsite; never re-thrown.
export async function sendNotificationEmail(opts: { to: string; subject: string; body: string }): Promise<void> {
  if (!env.RESEND_API_KEY) {
    logger.info({ to: opts.to, subject: opts.subject }, 'email.notification skipped — no RESEND_API_KEY');
    return;
  }
  try {
    const { Resend } = await import('resend');
    const resend = new Resend(env.RESEND_API_KEY);
    await resend.emails.send({
      from: 'GradiumOS <noreply@gradiumos.ai>',
      to: opts.to,
      subject: opts.subject,
      text: `${opts.body}\n\nGradiumOS Team`,
    });
  } catch (err) {
    logger.warn({ err, to: opts.to }, 'email.notification failed — non-fatal, continuing');
  }
}

// BC 62-64 — Send an invite email to a learner with the institution's invite code.
// Unlike sendWelcomeEmail this throws on failure so the bulk-invite loop can
// record the per-row status accurately.
export async function sendInviteEmail(opts: { to: string; name: string; inviteCode: string }): Promise<void> {
  if (!env.RESEND_API_KEY) {
    logger.info({ to: opts.to }, 'email.invite skipped — no RESEND_API_KEY');
    return;
  }
  const { Resend } = await import('resend');
  const resend = new Resend(env.RESEND_API_KEY);
  await resend.emails.send({
    from: 'GradiumOS <noreply@gradiumos.ai>',
    to: opts.to,
    subject: `${opts.name}, you've been invited to GradiumOS`,
    text: `Hi ${opts.name},\n\nYou've been invited to join GradiumOS.\n\nUse invite code: ${opts.inviteCode}\nSign up at: https://gradiumos.ai/signup?code=${opts.inviteCode}\n\nGradiumOS Team`,
  });
}
