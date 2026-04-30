import type { Request, Response } from 'express';
import { ok } from '../utils/response.js';
import * as rosterService from '../services/roster/rosterService.js';

export async function listLearners(req: Request, res: Response) {
  const q = req.query as Record<string, string>;
  const result = await rosterService.listLearners({
    institutionId: req.auth!.inst,
    q: q.q,
    band: q.band as rosterService.BandLabel | undefined,
    trackId: q.trackId,
    caeStatus: q.caeStatus as 'active' | 'none' | undefined,
    page: Number(q.page) || 1,
    pageSize: Number(q.pageSize) || 20,
  });
  ok(res, result);
}

export async function getLearner(req: Request, res: Response) {
  const { learnerId } = req.params as { learnerId: string };
  const result = await rosterService.getLearner(req.auth!.inst, learnerId);
  ok(res, result);
}
