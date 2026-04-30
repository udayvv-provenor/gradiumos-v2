import type { Request, Response } from 'express';
import { ok } from '../utils/response.js';
import * as placementService from '../services/placement/placementService.js';

export async function getPlacementAlignment(req: Request, res: Response) {
  ok(res, await placementService.getPlacementAlignment(req.auth!.inst));
}
