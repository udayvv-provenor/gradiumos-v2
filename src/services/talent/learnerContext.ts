/**
 * Resolves the Learner.id for a logged-in user. All Talent endpoints are learner-scoped —
 * they resolve via the JWT user id, then look up the linked learner record. Returns the
 * learner with its institution + careerTrackEnrollments + scores prefetched since the
 * downstream services need those consistently.
 */
import { prisma } from '../../config/db.js';
import { AppError } from '../../utils/AppError.js';

export async function getLearnerIdOrThrow(userId: string): Promise<string> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new AppError('NOT_FOUND', 'User not found');
  if (user.role !== 'LEARNER') throw new AppError('AUTH_FORBIDDEN', 'Learner scope required');
  if (!user.learnerId) throw new AppError('AUTH_FORBIDDEN', 'Learner not linked to user');
  return user.learnerId;
}

export async function getLearnerWithScope(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      learner: {
        include: {
          institution: {
            include: { indexVersions: { orderBy: { effectiveFrom: 'desc' }, take: 1 } },
          },
          scores: true,
          careerTrackEnrollments: { include: { careerTrack: true } },
        },
      },
    },
  });
  if (!user || !user.learner) throw new AppError('AUTH_FORBIDDEN', 'Learner scope required');
  return { user, learner: user.learner };
}

export async function requireTrackEnrollment(learnerId: string, careerTrackId: string): Promise<void> {
  const e = await prisma.careerTrackEnrollment.findUnique({
    where: { learnerId_careerTrackId: { learnerId, careerTrackId } },
  });
  if (!e) throw new AppError('AUTH_FORBIDDEN', 'Learner not enrolled in this career track');
}
