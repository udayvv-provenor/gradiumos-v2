import type { Request, Response } from 'express';
import type { ClusterCode } from '@prisma/client';
import { ok } from '../../utils/response.js';
import * as svc from '../../services/talent/tutorService.js';

export async function startSession(req: Request, res: Response) {
  const body = req.body as { clusterCode: ClusterCode; subtopicCode: string };
  ok(res, await svc.startSession(req.auth!.sub, body), 201);
}

export async function addTurn(req: Request, res: Response) {
  const { id } = req.params as { id: string };
  const { content } = req.body as { content: string };
  ok(res, await svc.addTurn(req.auth!.sub, id, content));
}

export async function getSession(req: Request, res: Response) {
  const { id } = req.params as { id: string };
  ok(res, await svc.getSession(req.auth!.sub, id));
}

export async function endSession(req: Request, res: Response) {
  const { id } = req.params as { id: string };
  ok(res, await svc.endSession(req.auth!.sub, id));
}
