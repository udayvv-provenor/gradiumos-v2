import type { Request, Response } from 'express';
import { ok } from '../utils/response.js';
import * as demandService from '../services/demand/demandService.js';

export async function getDemand(req: Request, res: Response) {
  ok(res, await demandService.getDemandVsCoverage(req.auth!.inst));
}
