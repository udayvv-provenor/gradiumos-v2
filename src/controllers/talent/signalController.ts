import type { Request, Response } from 'express';
import { ok } from '../../utils/response.js';
import * as svc from '../../services/talent/signalTalentService.js';

export async function getSignal(req: Request, res: Response) {
  const { careerTrackId } = req.query as { careerTrackId: string };
  ok(res, await svc.getSignal(req.auth!.sub, careerTrackId));
}

export async function generateSignal(req: Request, res: Response) {
  const { careerTrackId } = req.body as { careerTrackId: string };
  ok(res, await svc.generateSignal(req.auth!.sub, careerTrackId), 201);
}
