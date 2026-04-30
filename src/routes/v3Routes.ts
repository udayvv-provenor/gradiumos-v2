/**
 * v3-specific routes — endpoints net-new in v3 (uploads, AI-powered actions).
 * Mounted under /api/v3 to keep them clearly separate from the v2-inherited
 * routes during the build-out.
 */
import { Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { acceptUpload, normaliseUpload } from '../services/upload/uploadMiddleware.js';
import * as upload from '../controllers/v3UploadController.js';

const router = Router();

router.use(requireAuth);

// Campus — institution uploads curriculum for a career track
router.post(
  '/campus/career-tracks/:id/curriculum',
  requireRole('DEAN', 'PLACEMENT_OFFICER'),
  acceptUpload,
  normaliseUpload('institution'),
  asyncHandler(upload.postCurriculum),
);
router.get(
  '/campus/curricula',
  requireRole('DEAN', 'PLACEMENT_OFFICER'),
  asyncHandler(upload.getCurricula),
);

// Workforce — employer uploads JD for a role
router.post(
  '/workforce/roles/:id/jd',
  requireRole('TA_LEAD'),
  acceptUpload,
  normaliseUpload('employer'),
  asyncHandler(upload.postJD),
);

export default router;
