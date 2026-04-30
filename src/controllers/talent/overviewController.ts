import type { Request, Response } from 'express';
import { ok } from '../../utils/response.js';
import * as svc from '../../services/talent/learnerOverviewService.js';

export async function getTracks(req: Request, res: Response) {
  ok(res, await svc.getTracks(req.auth!.sub));
}

export async function getOverview(req: Request, res: Response) {
  const { careerTrackId } = req.query as { careerTrackId: string };
  ok(res, await svc.getOverview(req.auth!.sub, careerTrackId));
}

export async function getCompetencyProfile(req: Request, res: Response) {
  ok(res, await svc.getCompetencyProfile(req.auth!.sub));
}

export async function getDcrb(req: Request, res: Response) {
  const { careerTrackId } = req.query as { careerTrackId: string };
  ok(res, await svc.getDcrb(req.auth!.sub, careerTrackId));
}
