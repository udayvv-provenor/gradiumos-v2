import type { Request, Response } from 'express';
import { ok } from '../utils/response.js';
import * as insight from '../services/overview/insightService.js';

export async function tracksInsight(req: Request, res: Response) {
  ok(res, await insight.getTracksInsight(req.auth!.inst));
}

export async function cohortsInsight(req: Request, res: Response) {
  const trackId = typeof req.query.trackId === 'string' && req.query.trackId ? req.query.trackId : undefined;
  ok(res, await insight.getCohortsInsight(req.auth!.inst, trackId));
}

export async function learnersInsight(req: Request, res: Response) {
  const trackId = typeof req.query.trackId === 'string' && req.query.trackId ? req.query.trackId : undefined;
  const cohortId = typeof req.query.cohortId === 'string' && req.query.cohortId ? req.query.cohortId : undefined;
  ok(res, await insight.getLearnersInsight(req.auth!.inst, trackId, cohortId));
}
