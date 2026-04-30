import { Router } from 'express';
import * as ctrl from '../controllers/settingsController.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { requireAuth, requireInstitutionScope } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth, requireInstitutionScope);

router.get('/institution', asyncHandler(ctrl.getSettings));

export default router;
