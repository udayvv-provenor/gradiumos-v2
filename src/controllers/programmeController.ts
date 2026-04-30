import type { Request, Response } from 'express';
import { ok } from '../utils/response.js';
import * as programmeService from '../services/augmentation/programmeService.js';
import type { ClusterCode, TriggerType, AssignmentStatus } from '@prisma/client';

export async function listProgrammes(req: Request, res: Response) {
  const q = req.query as { cohortId?: string; status?: AssignmentStatus };
  const items = await programmeService.listProgrammes(req.auth!.inst, {
    cohortId: q.cohortId,
    status: q.status,
  });
  ok(res, { items });
}

export async function createProgramme(req: Request, res: Response) {
  const body = req.body as { cohortId: string; clusterId: ClusterCode; triggerType: TriggerType };
  const result = await programmeService.assignCohortProgramme({
    institutionId: req.auth!.inst,
    cohortId: body.cohortId,
    clusterId: body.clusterId,
    triggerType: body.triggerType,
    createdByUserId: req.auth!.sub,
  });
  ok(res, result, 201);
}
