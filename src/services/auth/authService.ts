import { prisma } from '../../config/db.js';
import { env } from '../../config/env.js';
import { AppError } from '../../utils/AppError.js';
import { addDays } from '../../utils/dates.js';
import { hashPassword, verifyPassword } from './passwordHasher.js';
import { signAccess, signRefresh, verifyAccess, verifyRefresh, hashToken } from './jwt.js';
import type { AccessClaims } from './jwt.js';

export interface LoginResult {
  accessToken: string;
  refreshToken: string;
  user: {
    id: string;
    email: string;
    name: string;
    role: AccessClaims['role'];
    institutionId: string;
    institutionName?: string;
    inviteCode?: string;
    employerId?: string;
    employerName?: string;
    archetype?: string;
  };
}

export async function login(email: string, password: string): Promise<LoginResult> {
  const user = await prisma.user.findUnique({
    where: { email: email.toLowerCase() },
    include: {
      institution: { select: { id: true, name: true, inviteCode: true } },
      employer:    { select: { id: true, name: true, archetype: true } },
    },
  });
  if (!user) throw new AppError('AUTH_INVALID', 'Invalid credentials');
  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) throw new AppError('AUTH_INVALID', 'Invalid credentials');

  const access = signAccess({
    sub: user.id,
    inst: user.institutionId ?? '',
    role: user.role,
    name: user.name,
    ...(user.employerId ? { emp: user.employerId } : {}),
  });
  const refresh = await issueRefreshToken(user.id);

  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

  return {
    accessToken: access,
    refreshToken: refresh,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      institutionId:   user.institutionId ?? '',
      institutionName: user.institution?.name,
      inviteCode:      user.institution?.inviteCode,
      employerId:      user.employer?.id,
      employerName:    user.employer?.name,
      archetype:       user.employer?.archetype ?? undefined,
    },
  };
}

export async function refresh(refreshToken: string): Promise<{ accessToken: string; refreshToken: string }> {
  const claims = verifyRefresh(refreshToken);
  const tokenHash = hashToken(refreshToken);
  const record = await prisma.refreshToken.findUnique({ where: { tokenHash } });
  if (!record || record.revokedAt || record.expiresAt < new Date() || record.userId !== claims.sub) {
    throw new AppError('AUTH_INVALID', 'Invalid refresh token');
  }
  const user = await prisma.user.findUnique({ where: { id: record.userId } });
  if (!user) throw new AppError('AUTH_INVALID', 'User no longer exists');

  // Rotate: revoke current, issue new
  const newRefresh = await issueRefreshToken(user.id);
  await prisma.refreshToken.update({
    where: { id: record.id },
    data: { revokedAt: new Date(), replacedBy: hashToken(newRefresh) },
  });

  const access = signAccess({
    sub: user.id,
    inst: user.institutionId ?? '',
    role: user.role,
    name: user.name,
    ...(user.employerId ? { emp: user.employerId } : {}),
  });
  return { accessToken: access, refreshToken: newRefresh };
}

/**
 * handoff — used by the Demo/Honest toggle to mint a fresh access+refresh pair
 * on this backend, given a valid access token from the OTHER backend.
 * Pre-conditions: identical JWT_ACCESS_SECRET, matching primary user IDs.
 */
export async function handoff(presentedAccessToken: string): Promise<{ accessToken: string; refreshToken: string }> {
  let claims: AccessClaims;
  try {
    claims = verifyAccess(presentedAccessToken);
  } catch {
    throw new AppError('AUTH_INVALID', 'Invalid or expired access token');
  }
  const user = await prisma.user.findUnique({ where: { id: claims.sub } });
  if (!user) throw new AppError('AUTH_INVALID', 'User not found in this backend');

  const access = signAccess({
    sub: user.id,
    inst: user.institutionId ?? '',
    role: user.role,
    name: user.name,
    ...(user.employerId ? { emp: user.employerId } : {}),
  });
  const refresh = await issueRefreshToken(user.id);
  return { accessToken: access, refreshToken: refresh };
}

export async function logout(refreshToken: string): Promise<void> {
  const tokenHash = hashToken(refreshToken);
  await prisma.refreshToken.updateMany({
    where: { tokenHash, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

async function issueRefreshToken(userId: string): Promise<string> {
  // Create the record first so we can use its id as the JTI and its hash as the unique key.
  const placeholder = await prisma.refreshToken.create({
    data: {
      userId,
      tokenHash: `pending-${Date.now()}-${Math.random()}`,
      expiresAt: addDays(new Date(), env.JWT_REFRESH_TTL_DAYS),
    },
  });
  const signed = signRefresh({ sub: userId, jti: placeholder.id });
  await prisma.refreshToken.update({
    where: { id: placeholder.id },
    data: { tokenHash: hashToken(signed) },
  });
  return signed;
}

export interface MeInstitutionScope {
  scope: 'institution';
  user: { id: string; email: string; name: string; role: AccessClaims['role']; institutionId: string; employerId: null };
  institution: { id: string; name: string; type: string; plan: { name: string; validUntil: string; features: string[] } };
  indexVersion: { id: string; versionTag: string; effectiveFrom: string; locked: boolean };
}
export interface MeEmployerScope {
  scope: 'employer';
  user: { id: string; email: string; name: string; role: AccessClaims['role']; institutionId: null; employerId: string };
  employer: { id: string; name: string; archetype: string | null; plan: string };  // v3.1 — null = pending
}
export interface MeLearnerScope {
  scope: 'learner';
  user: { id: string; email: string; name: string; role: AccessClaims['role']; institutionId: string; employerId: null; learnerId: string };
  institution: { id: string; name: string; type: string };
  learner: {
    id: string;
    name: string;
    email: string;
    institutionId: string;
    institutionName: string;
    cohortId: string;
    primaryCareerTrackId: string | null;
    // Canonical enrollment list (backend shape):
    careerTrackEnrollments: { careerTrackId: string; careerTrackCode: string; careerTrackName: string; isPrimary: boolean }[];
    // Flattened alias used by talent-app UI — same data, simpler shape:
    careerTracks: { id: string; code: string; name: string; isPrimary: boolean }[];
  };
}
export type MeResult = MeInstitutionScope | MeEmployerScope | MeLearnerScope;

export async function getMe(userId: string): Promise<MeResult> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      institution: { include: { indexVersions: { orderBy: { effectiveFrom: 'desc' }, take: 1 } } },
      employer: true,
      // v3.1.10 — also pull learner.track.careerTrack so we can backfill
      // an enrollment for legacy learners who signed up before auto-enrollment.
      learner: {
        include: {
          careerTrackEnrollments: { include: { careerTrack: true } },
          track:                  { include: { careerTrack: true } },
        },
      },
    },
  });
  if (!user) throw new AppError('NOT_FOUND', 'User not found');

  if (user.role === 'LEARNER' && user.learner && user.institution) {
    let enrollments = user.learner.careerTrackEnrollments.map((e) => ({
      careerTrackId: e.careerTrackId,
      careerTrackCode: e.careerTrack.code,
      careerTrackName: e.careerTrack.name,
      isPrimary: e.isPrimary,
    }));

    // v3.1.10 — backfill: if NO enrollments yet but the learner's institution
    // Track is linked to a CareerTrack, persist that enrollment now AND
    // include it in the response. Self-heals legacy learners.
    if (enrollments.length === 0 && user.learner.track?.careerTrack) {
      const ct = user.learner.track.careerTrack;
      try {
        await prisma.careerTrackEnrollment.create({
          data: { learnerId: user.learner.id, careerTrackId: ct.id, isPrimary: true },
        });
      } catch { /* unique conflict is fine */ }
      enrollments = [{ careerTrackId: ct.id, careerTrackCode: ct.code, careerTrackName: ct.name, isPrimary: true }];
    }

    const primary = enrollments.find((e) => e.isPrimary) ?? enrollments[0] ?? null;
    return {
      scope: 'learner',
      user: { id: user.id, email: user.email, name: user.name, role: user.role, institutionId: user.institution.id, employerId: null, learnerId: user.learner.id },
      institution: { id: user.institution.id, name: user.institution.name, type: user.institution.type },
      learner: {
        id: user.learner.id,
        name: user.learner.name,
        email: user.learner.email,
        institutionId: user.learner.institutionId,
        institutionName: user.institution.name,
        cohortId: user.learner.cohortId,
        primaryCareerTrackId: primary ? primary.careerTrackId : null,
        careerTrackEnrollments: enrollments,
        careerTracks: enrollments.map((e) => ({
          id: e.careerTrackId,
          code: e.careerTrackCode,
          name: e.careerTrackName,
          isPrimary: e.isPrimary,
        })),
      },
    };
  }

  if (user.employer) {
    return {
      scope: 'employer',
      user: { id: user.id, email: user.email, name: user.name, role: user.role, institutionId: null, employerId: user.employer.id },
      employer: {
        id: user.employer.id,
        name: user.employer.name,
        archetype: user.employer.archetype ?? null,  // v3.1 — null = pending classification
        plan: user.employer.plan,
      },
    };
  }

  if (!user.institution) throw new AppError('NOT_FOUND', 'No institution or employer for user');
  const iv = user.institution.indexVersions[0];
  if (!iv) throw new AppError('NOT_FOUND', 'No index version configured');
  return {
    scope: 'institution',
    user: { id: user.id, email: user.email, name: user.name, role: user.role, institutionId: user.institution.id, employerId: null },
    institution: {
      id: user.institution.id,
      name: user.institution.name,
      type: user.institution.type,
      plan: {
        name: user.institution.planName,
        validUntil: user.institution.planValidUntil.toISOString(),
        features: user.institution.planFeatures,
      },
    },
    indexVersion: {
      id: iv.id,
      versionTag: iv.versionTag,
      effectiveFrom: iv.effectiveFrom.toISOString(),
      locked: iv.locked,
    },
  };
}
