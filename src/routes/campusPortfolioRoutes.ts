import { Router } from 'express';
import * as ctrl from '../controllers/campusPortfolioController.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { requireAuth, requireInstitutionScope } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth, requireInstitutionScope);

router.get('/portfolio', asyncHandler(ctrl.getPortfolio));
router.get('/opportunity-matching', asyncHandler(ctrl.getOpportunities));

export default router;
