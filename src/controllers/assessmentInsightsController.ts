import type { Request, Response } from 'express';
import { ok } from '../utils/response.js';
import * as assessmentInsightsService from '../services/assessment/assessmentInsightsService.js';

export async function getAssessmentInsights(req: Request, res: Response) {
  ok(res, await assessmentInsightsService.getAssessmentInsights(req.auth!.inst));
}
