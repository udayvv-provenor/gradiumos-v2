import type { Request, Response } from 'express';
import { ok } from '../../utils/response.js';
import { AppError } from '../../utils/AppError.js';
import * as analytics from '../../services/workforce/analyticsService.js';

function employerIdOrThrow(req: Request): string {
  const emp = req.auth?.emp;
  if (!emp) throw new AppError('AUTH_FORBIDDEN', 'Employer scope required');
  return emp;
}

export async function funnel(req: Request, res: Response) {
  ok(res, await analytics.getFunnel(employerIdOrThrow(req)));
}

export async function velocity(req: Request, res: Response) {
  ok(res, await analytics.getVelocity(employerIdOrThrow(req)));
}
