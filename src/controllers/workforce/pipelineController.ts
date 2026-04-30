import type { Request, Response } from 'express';
import { ok } from '../../utils/response.js';
import { AppError } from '../../utils/AppError.js';
import * as pipeline from '../../services/workforce/pipelineService.js';
import * as shortlist from '../../services/workforce/shortlistService.js';
import type { PipelineInviteBody, PipelineDecisionBody, ShortlistBody } from '../../schemas/workforce/pipeline.js';

function employerIdOrThrow(req: Request): string {
  const emp = req.auth?.emp;
  if (!emp) throw new AppError('AUTH_FORBIDDEN', 'Employer scope required');
  return emp;
}

export async function list(req: Request, res: Response) {
  ok(res, await pipeline.listPipeline(employerIdOrThrow(req)));
}

export async function invite(req: Request, res: Response) {
  const body = req.body as PipelineInviteBody;
  ok(res, await pipeline.invite(employerIdOrThrow(req), body), 201);
}

export async function decision(req: Request, res: Response) {
  const body = req.body as PipelineDecisionBody;
  const { id } = req.params as { id: string };
  ok(res, await pipeline.recordDecision(employerIdOrThrow(req), id, body));
}

export async function upsertShortlist(req: Request, res: Response) {
  const body = req.body as ShortlistBody;
  ok(res, await shortlist.upsertShortlist(employerIdOrThrow(req), body), 201);
}

export async function timeseries(req: Request, res: Response) {
  const windowDays = Math.min(180, Math.max(7, Number(req.query.days ?? 90)));
  ok(res, await pipeline.getPipelineTimeseries(employerIdOrThrow(req), windowDays));
}
