import type { Request, Response } from 'express';
import { ok } from '../../utils/response.js';
import * as gap from '../../services/talent/gapIntelService.js';
import * as path from '../../services/talent/pathwayService.js';

export async function getGapIntel(req: Request, res: Response) {
  const { careerTrackId } = req.query as { careerTrackId: string };
  ok(res, await gap.getGapIntel(req.auth!.sub, careerTrackId));
}

export async function getCurriculumMap(req: Request, res: Response) {
  const { institutionId, careerTrackId } = req.query as { institutionId?: string; careerTrackId?: string };
  ok(res, await gap.getCurriculumMap(req.auth!.sub, institutionId, careerTrackId));
}

export async function listPathways(req: Request, res: Response) {
  const { status } = req.query as { status?: 'active' | 'completed' | 'available' };
  ok(res, await path.listPathways(req.auth!.sub, status));
}

export async function getPathway(req: Request, res: Response) {
  const { assignmentId } = req.params as { assignmentId: string };
  ok(res, await path.getPathway(req.auth!.sub, assignmentId));
}

export async function completeStep(req: Request, res: Response) {
  const { assignmentId, stepIdx } = req.params as unknown as { assignmentId: string; stepIdx: number };
  ok(res, await path.completeStep(req.auth!.sub, assignmentId, Number(stepIdx)));
}
