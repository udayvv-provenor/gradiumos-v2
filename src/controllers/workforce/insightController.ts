import type { Request, Response } from 'express';
import { ok } from '../../utils/response.js';
import { AppError } from '../../utils/AppError.js';
import * as svc from '../../services/workforce/insightWorkforceService.js';

function employerIdOrThrow(req: Request): string {
  const emp = req.auth?.emp;
  if (!emp) throw new AppError('AUTH_FORBIDDEN', 'Employer scope required');
  return emp;
}

export async function careerTracks(req: Request, res: Response) {
  ok(res, await svc.getCareerTracksInsight(employerIdOrThrow(req)));
}

export async function institutions(req: Request, res: Response) {
  const q = req.query as { careerTrackId?: string };
  ok(res, await svc.getInstitutionsInsight(employerIdOrThrow(req), q.careerTrackId));
}

export async function cohorts(req: Request, res: Response) {
  const q = req.query as unknown as { careerTrackId: string; institutionId: string };
  ok(res, await svc.getCohortsInsight(employerIdOrThrow(req), q.careerTrackId, q.institutionId));
}

export async function cohortLearners(req: Request, res: Response) {
  const q = req.query as unknown as { careerTrackId: string; limit?: number };
  const params = req.params as { cohortId: string };
  ok(res, await svc.getCohortLearners(employerIdOrThrow(req), params.cohortId, q.careerTrackId, q.limit));
}
