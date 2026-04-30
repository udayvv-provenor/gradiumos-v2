import { Router } from 'express';
import * as ctrl from '../controllers/signalConfidenceController.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { requireAuth, requireInstitutionScope } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth, requireInstitutionScope);

router.get('/', asyncHandler(ctrl.getSignalConfidence));

export default router;
