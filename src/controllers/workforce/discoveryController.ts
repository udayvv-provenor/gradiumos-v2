import type { Request, Response } from 'express';
import { ok } from '../../utils/response.js';
import { AppError } from '../../utils/AppError.js';
import * as match from '../../services/workforce/matchRankService.js';
import type { DiscoveryQuery } from '../../schemas/workforce/discovery.js';

function employerIdOrThrow(req: Request): string {
  const emp = req.auth?.emp;
  if (!emp) throw new AppError('AUTH_FORBIDDEN', 'Employer scope required');
  return emp;
}

export async function discovery(req: Request, res: Response) {
  const q = req.query as unknown as DiscoveryQuery;
  ok(res, await match.rankLearnersForRole(employerIdOrThrow(req), q.roleId, {
    institutionId: q.institutionId,
    band: q.band,
    q: q.q,
    limit: q.limit,
  }));
}
