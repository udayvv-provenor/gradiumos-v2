import { Router } from 'express';
import * as ctrl from '../controllers/authController.js';
import * as signup from '../controllers/v3SignupController.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { validate } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';
import { loginRateLimiter, signupRateLimiter } from '../middleware/rateLimit.js';
import { LoginBody, RefreshBody, LogoutBody, HandoffBody } from '../schemas/auth.js';

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

export default router;
