import { Router } from 'express';
import * as ctrl from '../controllers/authController.js';
import * as signup from '../controllers/v3SignupController.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { validate } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';
import { loginRateLimiter, signupRateLimiter } from '../middleware/rateLimit.js';
import { LoginBody, RefreshBody, LogoutBody, HandoffBody } from '../schemas/auth.js';
import {
  verifyEmail,
  forgotPassword,
  resetPassword,
  resendVerification,
} from '../services/auth/passwordResetService.js';

const router = Router();

router.post('/login',   loginRateLimiter, validate(LoginBody),   asyncHandler(ctrl.postLogin));
router.post('/refresh',                   validate(RefreshBody), asyncHandler(ctrl.postRefresh));
router.post('/handoff',                   validate(HandoffBody), asyncHandler(ctrl.postHandoff));
router.post('/logout',                    validate(LogoutBody),  asyncHandler(ctrl.postLogout));
router.get('/me', requireAuth, asyncHandler(ctrl.getMe));

// v3 — public signup endpoints (institution + employer self-signup; learner via invite code)
// Option B: signupRateLimiter (10/15min/IP) instead of loginRateLimiter (100/min/IP)
// — signup volume is orders of magnitude lower than login; high rate = abuse.
router.post('/signup/institution', signupRateLimiter, asyncHandler(signup.postInstitutionSignup));
router.post('/signup/employer',    signupRateLimiter, asyncHandler(signup.postEmployerSignup));
router.post('/signup/learner',     signupRateLimiter, asyncHandler(signup.postLearnerSignup));

// Option B — email verification + password reset (public, no auth required)
router.get('/verify-email', asyncHandler(async (req, res) => {
  const { ok } = await import('../utils/response.js');
  const token = typeof req.query['token'] === 'string' ? req.query['token'] : '';
  const result = await verifyEmail(token);
  // Redirect to success page rather than returning JSON — user clicked a link
  const successUrl = `https://talent-app-henna.vercel.app/login?verified=1&email=${encodeURIComponent(result.email)}`;
  res.redirect(302, successUrl);
}));

router.post('/forgot-password', loginRateLimiter, asyncHandler(async (req, res) => {
  const { ok } = await import('../utils/response.js');
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  await forgotPassword(email);
  // Always 200 — never leak whether the email exists
  ok(res, { message: 'If that email is registered, a reset link has been sent.' });
}));

router.post('/reset-password', asyncHandler(async (req, res) => {
  const { ok } = await import('../utils/response.js');
  const token    = typeof req.body?.token === 'string' ? req.body.token : '';
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  await resetPassword(token, password);
  ok(res, { message: 'Password updated. Please log in with your new password.' });
}));

router.post('/resend-verification', loginRateLimiter, asyncHandler(async (req, res) => {
  const { ok } = await import('../utils/response.js');
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  await resendVerification(email);
  ok(res, { message: 'If that email is registered and unverified, a new link has been sent.' });
}));

export default router;
