import { prisma } from '../config/db.js';

export class StaleVersionError extends Error {
  constructor(entityType: string, entityId: string) {
    super(`Stale version for ${entityType}:${entityId} — refresh and retry`);
    this.name = 'StaleVersionError';
  }
}

// Generic optimistic update helper.
// Checks that the current DB version matches expectedVersion, then runs the update.
export async function optimisticUpdate<T>(opts: {
  entityType: 'EmployerRole' | 'CompetencyScore' | 'Curriculum';
  entityId: string;
  expectedVersion: number;
  updateFn: () => Promise<T>;
}): Promise<T> {
  // Get current version
  let currentVersion: number;
  if (opts.entityType === 'EmployerRole') {
    const row = await prisma.employerRole.findUnique({ where: { id: opts.entityId }, select: { version: true } });
    currentVersion = row?.version ?? -1;
  } else if (opts.entityType === 'CompetencyScore') {
    const row = await prisma.competencyScore.findUnique({ where: { id: opts.entityId }, select: { version: true } });
    currentVersion = row?.version ?? -1;
  } else {
    const row = await prisma.curriculum.findUnique({ where: { id: opts.entityId }, select: { version: true } });
    currentVersion = row?.version ?? -1;
  }
  if (currentVersion !== opts.expectedVersion) {
    throw new StaleVersionError(opts.entityType, opts.entityId);
  }
  return opts.updateFn();
}
