import { Router } from 'express';
import * as ctrl from '../controllers/programmeController.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { requireAuth, requireInstitutionScope, requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { ListProgrammesQuery, CreateProgrammeBody } from '../schemas/programme.js';

const router = Router();
router.use(requireAuth, requireInstitutionScope);

router.get('/',
  validate(ListProgrammesQuery, 'query'),
  asyncHandler(ctrl.listProgrammes),
);

router.post('/',
  requireRole('DEAN', 'FACULTY_ADMIN'),
  validate(CreateProgrammeBody),
  asyncHandler(ctrl.createProgramme),
);

export default router;
