import type { Request, Response } from 'express';
import type { ClusterCode } from '@prisma/client';
import { ok } from '../../utils/response.js';
import * as svc from '../../services/talent/assessmentService.js';
import type { AttemptSubmitBody } from '../../schemas/talent/assessment.js';

export async function listAssessments(req: Request, res: Response) {
  const q = req.query as { clusterCode?: ClusterCode; careerTrackId?: string };
  ok(res, await svc.listAssessments(req.auth!.sub, q));
}

export async function getAssessment(req: Request, res: Response) {
  const { id } = req.params as { id: string };
  ok(res, await svc.getAssessment(req.auth!.sub, id));
}

export async function submitAttempt(req: Request, res: Response) {
  const { id } = req.params as { id: string };
  const body = req.body as AttemptSubmitBody;
  ok(res, await svc.submitAttempt(req.auth!.sub, id, body), 201);
}

export async function listAttempts(req: Request, res: Response) {
  ok(res, await svc.listAttempts(req.auth!.sub));
}
