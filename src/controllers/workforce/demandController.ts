import type { Request, Response } from 'express';
import { ok } from '../../utils/response.js';
import { AppError } from '../../utils/AppError.js';
import * as demand from '../../services/workforce/demandService.js';
import type { DemandSubmitBody } from '../../schemas/workforce/demand.js';

function employerIdOrThrow(req: Request): string {
  const emp = req.auth?.emp;
  if (!emp) throw new AppError('AUTH_FORBIDDEN', 'Employer scope required');
  return emp;
}

export async function getDemand(req: Request, res: Response) {
  ok(res, await demand.getDemandHeatmap(employerIdOrThrow(req)));
}

export async function postDemand(req: Request, res: Response) {
  const body = req.body as DemandSubmitBody;
  ok(res, await demand.submitDemand(employerIdOrThrow(req), body), 201);
}
