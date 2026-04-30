import { prisma } from '../../config/db.js';
import { AppError } from '../../utils/AppError.js';

export async function getSettings(institutionId: string) {
  const inst = await prisma.institution.findUnique({
    where: { id: institutionId },
    include: {
      tracks: true,
      cohorts: { include: { track: true } },
      users: { orderBy: { name: 'asc' } },
      indexVersions: { orderBy: { effectiveFrom: 'desc' }, take: 1 },
    },
  });
  if (!inst) throw new AppError('NOT_FOUND', 'Institution not found');
  const iv = inst.indexVersions[0];
  if (!iv) throw new AppError('NOT_FOUND', 'No index version configured');
  const enrolled = await prisma.learner.count({ where: { institutionId } });

  return {
    institution: {
      id: inst.id,
      name: inst.name,
      type: inst.type,
      // BC 27/29 — kycStatus included so the frontend can show a pending banner.
      // Defaults to "Pending" at signup (schema default); updated via PATCH /api/v1/admin/kyc/institution/:id.
      kycStatus: inst.kycStatus,
      nirfRank:  inst.nirfRank  ?? null,
      naacGrade: inst.naacGrade ?? null,
      aisheCode: inst.aisheCode ?? null,
      enrolledLearners: enrolled,
      tracks: inst.tracks.map((t) => ({ id: t.id, name: t.name })),
      cohorts: inst.cohorts.map((c) => ({ id: c.id, name: c.name, trackName: c.track.name })),
    },
    plan: {
      name: inst.planName,
      validUntil: inst.planValidUntil.toISOString(),
      features: inst.planFeatures,
    },
    users: inst.users.map((u) => ({ id: u.id, name: u.name, email: u.email, role: u.role })),
    indexVersion: {
      id: iv.id,
      versionTag: iv.versionTag,
      effectiveFrom: iv.effectiveFrom.toISOString(),
      locked: iv.locked,
    },
  };
}
