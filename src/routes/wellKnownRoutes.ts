import { Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import * as ctrl from '../controllers/signalKeyController.js';

const router = Router();
router.get('/gradium-signal-key', asyncHandler(ctrl.getPublicKey));
export default router;
