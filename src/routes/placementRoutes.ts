import { Router } from 'express';
import * as ctrl from '../controllers/placementController.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { requireAuth, requireInstitutionScope } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth, requireInstitutionScope);

router.get('/', asyncHandler(ctrl.getPlacementAlignment));

export default router;
