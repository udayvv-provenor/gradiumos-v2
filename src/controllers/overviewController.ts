import type { Request, Response } from 'express';
import { ok } from '../utils/response.js';
import * as overviewService from '../services/overview/overviewService.js';

export async function getKpis(req: Request, res: Response) {
  ok(res, await overviewService.getKpis(req.auth!.inst));
}

export async function getWeakClusters(req: Request, res: Response) {
  const limit = Number(req.query.limit) || 3;
  ok(res, await overviewService.getWeakClusters(req.auth!.inst, limit));
}

export async function getReadinessByTrack(req: Request, res: Response) {
  ok(res, await overviewService.getReadinessByTrack(req.auth!.inst));
}

export async function getSignalMatrix(req: Request, res: Response) {
  ok(res, await overviewService.getSignalConfidenceMatrix(req.auth!.inst));
}
