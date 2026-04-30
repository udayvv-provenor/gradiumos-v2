import type { Request, Response } from 'express';
import { ok } from '../../utils/response.js';
import { AppError } from '../../utils/AppError.js';
import * as svc from '../../services/workforce/opportunityMatrixService.js';

function employerIdOrThrow(req: Request): string {
  const emp = req.auth?.emp;
  if (!emp) throw new AppError('AUTH_FORBIDDEN', 'Employer scope required');
  return emp;
}

export async function getMatrix(req: Request, res: Response) {
  ok(res, await svc.getOpportunityMatrix(employerIdOrThrow(req)));
}
