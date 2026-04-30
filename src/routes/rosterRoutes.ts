import { Router } from 'express';
import * as ctrl from '../controllers/rosterController.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { requireAuth, requireInstitutionScope } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { RosterQuery } from '../schemas/roster.js';

const router = Router();
router.use(requireAuth, requireInstitutionScope);

router.get('/learners', validate(RosterQuery, 'query'), asyncHandler(ctrl.listLearners));
router.get('/learners/:learnerId', asyncHandler(ctrl.getLearner));

export default router;
