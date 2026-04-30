import type { Request, Response } from 'express';
import { ok } from '../../utils/response.js';
import { AppError } from '../../utils/AppError.js';
import * as roleSvc from '../../services/workforce/roleService.js';
import type { RoleCreateBody, RoleUpdateBody } from '../../schemas/workforce/roles.js';

function employerIdOrThrow(req: Request): string {
  const emp = req.auth?.emp;
  if (!emp) throw new AppError('AUTH_FORBIDDEN', 'Employer scope required');
  return emp;
}

export async function listCareerTracks(_req: Request, res: Response) {
  ok(res, await roleSvc.listCareerTracks());
}

export async function listRoles(req: Request, res: Response) {
  ok(res, await roleSvc.listRoles(employerIdOrThrow(req)));
}

export async function createRole(req: Request, res: Response) {
  const body = req.body as RoleCreateBody;
  ok(res, await roleSvc.createRole(employerIdOrThrow(req), {
    careerTrackId: body.careerTrackId,
    title: body.title,
    seatsPlanned: body.seatsPlanned,
    clusterWeights: body.clusterWeights as Record<string, number>,
    clusterTargets: body.clusterTargets as Record<string, { min: number; target: number; stretch: number } | number>,
  }), 201);
}

export async function updateRole(req: Request, res: Response) {
  const body = req.body as RoleUpdateBody;
  const { id } = req.params as { id: string };
  ok(res, await roleSvc.updateRole(employerIdOrThrow(req), id, {
    title: body.title,
    seatsPlanned: body.seatsPlanned,
    status: body.status,
    clusterWeights: body.clusterWeights as Record<string, number> | undefined,
    clusterTargets: body.clusterTargets as Record<string, { min: number; target: number; stretch: number } | number> | undefined,
  }));
}
