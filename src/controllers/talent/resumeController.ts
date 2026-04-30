import type { Request, Response } from 'express';
import { ok } from '../../utils/response.js';
import * as svc from '../../services/talent/resumeService.js';
import type { GenerateResumeBody } from '../../schemas/talent/resume.js';

export async function listResumes(req: Request, res: Response) {
  const { careerTrackId } = req.query as { careerTrackId?: string };
  ok(res, await svc.listResumes(req.auth!.sub, careerTrackId));
}

export async function generateResume(req: Request, res: Response) {
  const body = req.body as GenerateResumeBody;
  ok(res, await svc.generateResume(req.auth!.sub, body), 201);
}

export async function getResume(req: Request, res: Response) {
  const { id } = req.params as { id: string };
  ok(res, await svc.getResume(req.auth!.sub, id));
}

export async function getResumeHtml(req: Request, res: Response) {
  const { id } = req.params as { id: string };
  const html = await svc.getResumeHtml(req.auth!.sub, id);
  res.status(200).type('html').send(html);
}
