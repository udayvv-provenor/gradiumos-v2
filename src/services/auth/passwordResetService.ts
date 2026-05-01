/**
 * Option B — Password reset + email verification flows.
 *
 * Design decisions:
 *  - Verification token: 32-byte random hex stored in plain text in DB (single-use,
 *    short-lived). No need to hash because it's not a credential that persists after
 *    use — it's nulled out after verification.
 *  - Reset token: same approach. 32-byte hex, stored plain, nulled after use.
 *    TTL: 1 hour for reset, 24 hours for email verify.
 *  - Both flows are fire-and-forget safe: if email fails, the user can request again.
 *  - Demo accounts (SRMPILOT) skip email verify — emailVerified=true set by seed.
 */
import * as crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { prisma } from '../../config/db.js';
import { AppError } from '../../utils/AppError.js';
import { logger } from '../../config/logger.js';
import { sendNotificationEmail } from '../email/emailService.js';

const VERIFY_TTL_HOURS = 24;
const RESET_TTL_HOURS = 1;

/** Called after signup to send a verification email. Fire-and-forget. */
export async function sendVerificationEmail(userId: string, email: string, name: string): Promise<void> {
  const token = crypto.randomBytes(32).toString('hex');
  const expiry = new Date(Date.now() + VERIFY_TTL_HOURS * 60 * 60 * 1000);
  await prisma.user.update({
    where: { id: userId },
    data: { emailVerifyToken: token, emailVerifyExpiry: expiry },
  });
  // Portal URL — use talent portal URL as the base for learners; for others, use campus.
  // In production, swap these with real custom domains.
  const verifyUrl = `https://gradiumos-v2-backend-production.up.railway.app/api/auth/verify-email?token=${token}`;
  void sendNotificationEmail({
    to: email,
    subject: 'Verify your GradiumOS email address',
    body: `Hi ${name},\n\nClick the link below to verify your email (expires in ${VERIFY_TTL_HOURS} hours):\n\n${verifyUrl}\n\nIf you didn't sign up for GradiumOS, ignore this email.`,
  });
}

/** GET /api/auth/verify-email?token=... — marks the user's email as verified. */
export async function verifyEmail(token: string): Promise<{ email: string; name: string }> {
  if (!token || token.length !== 64) throw new AppError('VALIDATION', 'Invalid verification token');
  const user = await prisma.user.findUnique({ where: { emailVerifyToken: token } });
  if (!user) throw new AppError('NOT_FOUND', 'Verification link not found or already used');
  if (!user.emailVerifyExpiry || user.emailVerifyExpiry < new Date()) {
    throw new AppError('VALIDATION', 'Verification link has expired — request a new one');
  }
  await prisma.user.update({
    where: { id: user.id },
    data: {
      emailVerified: true,
      emailVerifiedAt: new Date(),
      emailVerifyToken: null,
      emailVerifyExpiry: null,
    },
  });
  logger.info({ userId: user.id, email: user.email }, 'email.verified');
  return { email: user.email, name: user.name };
}

/** POST /api/auth/forgot-password — sends a reset email. Always returns 200 (no user enumeration). */
export async function forgotPassword(email: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    // Silently return — don't leak whether the email exists
    logger.info({ email }, 'forgot-password: no user, silent return');
    return;
  }
  const token = crypto.randomBytes(32).toString('hex');
  const expiry = new Date(Date.now() + RESET_TTL_HOURS * 60 * 60 * 1000);
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordResetToken: token, passwordResetExpiry: expiry },
  });
  // The portal redirect depends on role — for now send a generic backend URL
  // that will redirect after reset. In production, map role → portal URL.
  const resetUrl = `https://talent-app-henna.vercel.app/reset-password?token=${token}`;
  void sendNotificationEmail({
    to: email,
    subject: 'Reset your GradiumOS password',
    body: `Hi ${user.name},\n\nClick the link below to reset your password (expires in ${RESET_TTL_HOURS} hour):\n\n${resetUrl}\n\nIf you didn't request this, ignore this email — your password won't change.`,
  });
  logger.info({ userId: user.id, email }, 'password.reset-email-sent');
}

/** POST /api/auth/reset-password — validates token and sets new password. */
export async function resetPassword(token: string, newPassword: string): Promise<void> {
  if (!token || token.length !== 64) throw new AppError('VALIDATION', 'Invalid reset token');
  if (!newPassword || newPassword.length < 8) throw new AppError('VALIDATION', 'Password must be at least 8 characters');
  const user = await prisma.user.findUnique({ where: { passwordResetToken: token } });
  if (!user) throw new AppError('NOT_FOUND', 'Reset link not found or already used');
  if (!user.passwordResetExpiry || user.passwordResetExpiry < new Date()) {
    throw new AppError('VALIDATION', 'Reset link has expired — request a new one');
  }
  const passwordHash = await bcrypt.hash(newPassword, 12);
  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash,
      passwordResetToken: null,
      passwordResetExpiry: null,
      // Revoke all existing refresh tokens on password change (security)
      refreshTokens: { deleteMany: {} },
    },
  });
  logger.info({ userId: user.id, email: user.email }, 'password.reset-complete');
}

/** POST /api/auth/resend-verification — resends the verification email. */
export async function resendVerification(email: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) return; // silent — no user enumeration
  if (user.emailVerified) return; // already verified — nothing to do
  await sendVerificationEmail(user.id, user.email, user.name);
}
