import type { Request, Response } from 'express';
import { ok } from '../utils/response.js';
import * as competencyService from '../services/competency/competencyService.js';

export async function getDistribution(req: Request, res: Response) {
  const { cohortId, trackId } = req.query as { cohortId?: string; trackId?: string };
  ok(res, await competencyService.getDistribution(req.auth!.inst, { cohortId, trackId }));
}
