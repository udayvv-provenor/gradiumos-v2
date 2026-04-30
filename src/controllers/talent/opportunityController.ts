import type { Request, Response } from 'express';
import { ok } from '../../utils/response.js';
import * as svc from '../../services/talent/opportunityService.js';

export async function listOpportunities(req: Request, res: Response) {
  const { careerTrackId, minMatch } = req.query as unknown as { careerTrackId: string; minMatch?: string };
  const minMatchNum = minMatch !== undefined ? parseFloat(String(minMatch)) : undefined;
  ok(res, await svc.listOpportunities(req.auth!.sub, careerTrackId, Number.isFinite(minMatchNum) ? minMatchNum : undefined));
}

export async function getOpportunity(req: Request, res: Response) {
  const { roleId } = req.params as { roleId: string };
  ok(res, await svc.getOpportunity(req.auth!.sub, roleId));
}

export async function applyRole(req: Request, res: Response) {
  const { roleId } = req.params as { roleId: string };
  ok(res, await svc.applyRole(req.auth!.sub, roleId), 201);
}
