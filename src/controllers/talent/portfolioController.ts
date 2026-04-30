import type { Request, Response } from 'express';
import { ok } from '../../utils/response.js';
import * as svc from '../../services/talent/portfolioService.js';

export async function getPortfolio(req: Request, res: Response) {
  ok(res, await svc.getPortfolio(req.auth!.sub));
}

export async function getEmployerView(req: Request, res: Response) {
  ok(res, await svc.getEmployerView(req.auth!.sub));
}
