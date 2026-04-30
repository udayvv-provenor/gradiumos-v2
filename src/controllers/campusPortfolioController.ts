import type { Request, Response } from 'express';
import { ok } from '../utils/response.js';
import { getCampusPortfolio } from '../services/campus/campusPortfolioService.js';
import { getOpportunityMatching } from '../services/campus/opportunityMatchingService.js';

export async function getPortfolio(req: Request, res: Response) {
  ok(res, await getCampusPortfolio(req.auth!.inst));
}

export async function getOpportunities(req: Request, res: Response) {
  ok(res, await getOpportunityMatching(req.auth!.inst));
}
