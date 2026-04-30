import { Router } from 'express';
import * as ctrl from '../controllers/demandController.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { requireAuth, requireInstitutionScope } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth, requireInstitutionScope);

router.get('/', asyncHandler(ctrl.getDemand));

export default router;
