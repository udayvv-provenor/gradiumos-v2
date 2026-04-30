import { Router } from 'express';
import * as ctrl from '../controllers/competencyController.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { requireAuth, requireInstitutionScope } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { DistributionQuery } from '../schemas/competency.js';

const router = Router();
router.use(requireAuth, requireInstitutionScope);

router.get('/distribution', validate(DistributionQuery, 'query'), asyncHandler(ctrl.getDistribution));

export default router;
