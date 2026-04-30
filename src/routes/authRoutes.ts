import { Router } from 'express';
import * as ctrl from '../controllers/authController.js';
import * as signup from '../controllers/v3SignupController.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { validate } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';
import { loginRateLimiter } from '../middleware/rateLimit.js';
import { LoginBody, RefreshBody, LogoutBody, HandoffBody } from '../schemas/auth.js';

const router = Router();

router.post('/login',   loginRateLimiter, validate(LoginBody),   asyncHandler(ctrl.postLogin));
router.post('/refresh',                   validate(RefreshBody), asyncHandler(ctrl.postRefresh));
router.post('/handoff',                   validate(HandoffBody), asyncHandler(ctrl.postHandoff));
router.post('/logout',                    validate(LogoutBody),  asyncHandler(ctrl.postLogout));
router.get('/me', requireAuth, asyncHandler(ctrl.getMe));

// v3 — public signup endpoints (institution + employer self-signup; learner via invite code)
router.post('/signup/institution', loginRateLimiter, asyncHandler(signup.postInstitutionSignup));
router.post('/signup/employer',    loginRateLimiter, asyncHandler(signup.postEmployerSignup));
router.post('/signup/learner',     loginRateLimiter, asyncHandler(signup.postLearnerSignup));

export default router;
