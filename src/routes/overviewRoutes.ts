import { Router } from 'express';
import * as ctrl from '../controllers/overviewController.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { requireAuth, requireInstitutionScope } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth, requireInstitutionScope);

router.get('/kpis',                    asyncHandler(ctrl.getKpis));
router.get('/weak-clusters',           asyncHandler(ctrl.getWeakClusters));
router.get('/readiness-by-track',      asyncHandler(ctrl.getReadinessByTrack));
router.get('/signal-confidence-matrix', asyncHandler(ctrl.getSignalMatrix));

export default router;
