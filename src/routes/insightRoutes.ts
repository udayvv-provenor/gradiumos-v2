import { Router } from 'express';
import * as ctrl from '../controllers/insightController.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { requireAuth, requireInstitutionScope } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth, requireInstitutionScope);

router.get('/tracks',   asyncHandler(ctrl.tracksInsight));
router.get('/cohorts',  asyncHandler(ctrl.cohortsInsight));
router.get('/learners', asyncHandler(ctrl.learnersInsight));

export default router;
