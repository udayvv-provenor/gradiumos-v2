import type { Request, Response } from 'express';
import { ok } from '../../utils/response.js';
import { AppError } from '../../utils/AppError.js';
import * as peer from '../../services/workforce/peerIntelService.js';

function employerIdOrThrow(req: Request): string {
  const emp = req.auth?.emp;
  if (!emp) throw new AppError('AUTH_FORBIDDEN', 'Employer scope required');
  return emp;
}

export async function peerIntel(req: Request, res: Response) {
  const q = req.query as { careerTrackId?: string };
  ok(res, await peer.getPeerDemand(employerIdOrThrow(req), q.careerTrackId));
}
