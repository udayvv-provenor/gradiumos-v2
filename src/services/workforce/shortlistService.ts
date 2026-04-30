/**
 * Shortlist state transitions — watching → piped | dismissed.
 */
import { prisma } from '../../config/db.js';
import { AppError } from '../../utils/AppError.js';
import type { ShortlistState } from '@prisma/client';

export async function upsertShortlist(
  employerId: string,
  payload: { roleId: string; learnerId: string; state: ShortlistState },
) {
  const role = await prisma.employerRole.findUnique({ where: { id: payload.roleId } });
  if (!role || role.employerId !== employerId) throw new AppError('NOT_FOUND', 'Role not found');
  const learner = await prisma.learner.findUnique({ where: { id: payload.learnerId } });
  if (!learner) throw new AppError('NOT_FOUND', 'Learner not found');

  const row = await prisma.shortlist.upsert({
    where: { roleId_learnerId: { roleId: payload.roleId, learnerId: payload.learnerId } },
    create: { roleId: payload.roleId, learnerId: payload.learnerId, state: payload.state },
    update: { state: payload.state },
  });
  return { id: row.id, roleId: row.roleId, learnerId: row.learnerId, state: row.state };
}
