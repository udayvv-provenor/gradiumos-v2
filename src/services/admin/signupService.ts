/**
 * Public signup endpoints for v3.
 *
 * Three flows:
 *   - signupInstitution → creates Institution + IndexVersion v1.2 + first DEAN
 *     user; returns the Institution invite code (shown to admin in Settings).
 *   - signupEmployer    → creates Employer + first TA_LEAD user.
 *   - signupLearner     → requires inviteCode; binds Learner to that
 *     institution's first Track + Cohort (or creates a default if none).
 */
import { prisma } from '../../config/db.js';
import { AppError } from '../../utils/AppError.js';
import { hashPassword } from '../auth/passwordHasher.js';
import { signAccess, signRefresh, hashToken } from '../auth/jwt.js';
import { addDays } from '../../utils/dates.js';
import { env } from '../../config/env.js';
import { Role, Archetype, ClusterCode, Prisma } from '@prisma/client';
import { randomBytes } from 'crypto';
import { seedDefaultConsent } from '../consent/consentService.js';
import { sendWelcomeEmail } from '../email/emailService.js';
import { sendVerificationEmail } from '../auth/passwordResetService.js';

const DEFAULT_WEIGHTS: Record<ClusterCode, number> = {
  C1: 0.18, C2: 0.16, C3: 0.15, C4: 0.16, C5: 0.10, C6: 0.10, C7: 0.10, C8: 0.05,
};
const DEFAULT_TARGETS: Record<ClusterCode, number> = {
  C1: 70, C2: 70, C3: 65, C4: 60, C5: 55, C6: 60, C7: 60, C8: 55,
};

function genInviteCode(): string {
  const charset = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(8);
  let code = '';
  for (let i = 0; i < 8; i++) code += charset[bytes[i] % charset.length];
  return code;
}

async function issueRefresh(userId: string): Promise<string> {
  const placeholder = await prisma.refreshToken.create({
    data: {
      userId,
      tokenHash: `pending-${Date.now()}-${Math.random()}`,
      expiresAt: addDays(new Date(), env.JWT_REFRESH_TTL_DAYS),
    },
  });
  const signed = signRefresh({ sub: userId, jti: placeholder.id });
  await prisma.refreshToken.update({ where: { id: placeholder.id }, data: { tokenHash: hashToken(signed) } });
  return signed;
}

interface AuthEnvelope {
  accessToken: string;
  refreshToken: string;
  user: { id: string; email: string; name: string; role: Role };
  context: Record<string, unknown>;
}

async function tokenisedEnvelope(userId: string, ctx: Record<string, unknown>): Promise<AuthEnvelope> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const access = signAccess({
    sub: user.id,
    inst: user.institutionId ?? '',
    role: user.role,
    name: user.name,
    ...(user.employerId ? { emp: user.employerId } : {}),
  });
  const refresh = await issueRefresh(user.id);
  return {
    accessToken: access,
    refreshToken: refresh,
    user: { id: user.id, email: user.email, name: user.name, role: user.role },
    context: ctx,
  };
}

export async function signupInstitution(args: {
  institutionName: string;
  /** v3.1 — optional. Defaults to 'higher-ed' server-side (column has @default). */
  type?: string;
  email: string;
  password: string;
  name: string;
}): Promise<AuthEnvelope & { inviteCode: string }> {
  const existing = await prisma.user.findUnique({ where: { email: args.email.toLowerCase() } });
  if (existing) throw new AppError('AUTH_EMAIL_TAKEN', 'An account with this email already exists.');
  if (args.password.length < 8) throw new AppError('AUTH_PASSWORD_WEAK', 'Password must be at least 8 characters.');

  const passwordHash = await hashPassword(args.password);
  const inviteCode = genInviteCode();
  let inst: Awaited<ReturnType<typeof prisma.institution.create>>;
  let user: Awaited<ReturnType<typeof prisma.user.create>>;
  try {
    inst = await prisma.institution.create({
      data: {
        name: args.institutionName,
        ...(args.type ? { type: args.type } : {}),     // server-side default kicks in if omitted
        planValidUntil: addDays(new Date(), 365),
        planFeatures: ['Overview', 'Curriculum Mapping', 'Augmentation', 'Roster', 'Signal'],
        inviteCode,
        // BC 27 — kycStatus intentionally omitted; schema default "Pending" applies automatically.
        // Updated by SUPER_ADMIN via PATCH /api/v1/admin/kyc/institution/:id (BC 28).
      },
    });
    await prisma.indexVersion.create({
      data: {
        institutionId: inst.id,
        versionTag: 'v1.2',
        effectiveFrom: new Date(),
        locked: true,
        weights: DEFAULT_WEIGHTS,
        thresholds: DEFAULT_TARGETS,
      },
    });
    user = await prisma.user.create({
      data: {
        email: args.email.toLowerCase(),
        passwordHash,
        name: args.name,
        role: Role.DEAN,
        institutionId: inst.id,
      },
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      throw new AppError('EMAIL_ALREADY_EXISTS', 'An account with this email already exists.');
    }
    throw e;
  }
  // BC 41 — include inviteCode in context so the frontend can display it in Settings.
  const env_ = await tokenisedEnvelope(user.id, { institutionId: inst.id, userId: user.id, institutionName: inst.name, inviteCode });
  void sendWelcomeEmail({ to: args.email, name: args.name, role: 'institution', inviteCode });
  // Option B — send email verification (fire-and-forget)
  void sendVerificationEmail(user.id, args.email, args.name);
  return { ...env_, inviteCode };
}

export async function signupEmployer(args: {
  employerName: string;
  /** v3.1 — optional. Stays null until first JD upload triggers
   *  recomputeEmployerArchetype(). UI shows "Pending classification" chip. */
  archetype?: Archetype;
  email: string;
  password: string;
  name: string;
}): Promise<AuthEnvelope> {
  const existing = await prisma.user.findUnique({ where: { email: args.email.toLowerCase() } });
  if (existing) throw new AppError('AUTH_EMAIL_TAKEN', 'An account with this email already exists.');
  if (args.password.length < 8) throw new AppError('AUTH_PASSWORD_WEAK', 'Password must be at least 8 characters.');

  const passwordHash = await hashPassword(args.password);
  let employer: Awaited<ReturnType<typeof prisma.employer.create>>;
  let user: Awaited<ReturnType<typeof prisma.user.create>>;
  try {
    employer = await prisma.employer.create({
      data: {
        name: args.employerName,
        ...(args.archetype ? { archetype: args.archetype } : {}),  // null = pending
        plan: 'growth',
        // BC 27 — kycStatus intentionally omitted; schema default "Pending" applies automatically.
        // Updated by SUPER_ADMIN via PATCH /api/v1/admin/kyc/employer/:id (BC 28).
      },
    });
    user = await prisma.user.create({
      data: {
        email: args.email.toLowerCase(),
        passwordHash,
        name: args.name,
        role: Role.TA_LEAD,
        employerId: employer.id,
      },
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      throw new AppError('EMAIL_ALREADY_EXISTS', 'An account with this email already exists.');
    }
    throw e;
  }
  // BC 42 — include both employerId and userId in context.
  const env_ = await tokenisedEnvelope(user.id, { employerId: employer.id, userId: user.id, employerName: employer.name });
  void sendWelcomeEmail({ to: args.email, name: args.name, role: 'employer' });
  // Option B — send email verification (fire-and-forget)
  void sendVerificationEmail(user.id, args.email, args.name);
  return env_;
}

export async function signupLearner(args: {
  inviteCode: string;
  email: string;
  password: string;
  name: string;
  /** BC 13 — IP address for ConsentRecord seeding. */
  ipAddress?: string;
}): Promise<AuthEnvelope & { institutionName: string }> {
  const inst = await prisma.institution.findUnique({ where: { inviteCode: args.inviteCode.trim().toUpperCase() } });
  // BC 43-44 — use INVALID_INVITE_CODE so the frontend can distinguish this from
  // a generic validation error and show the correct field-level message.
  if (!inst) throw new AppError('INVALID_INVITE_CODE', 'That institution invite code does not match any institution.');
  const existing = await prisma.user.findUnique({ where: { email: args.email.toLowerCase() } });
  if (existing) throw new AppError('AUTH_EMAIL_TAKEN', 'An account with this email already exists.');
  if (args.password.length < 8) throw new AppError('AUTH_PASSWORD_WEAK', 'Password must be at least 8 characters.');

  // Ensure the institution has at least one Track + Cohort to bind the learner to.
  // v3.1.10 — Track must be linked to a CareerTrack from day one. Without that
  // link, the Talent app's 3-way map button has nothing to navigate to (and
  // CareerTrackEnrollment can't be auto-created downstream).
  let track = await prisma.track.findFirst({ where: { institutionId: inst.id } });
  if (!track) {
    // Resolve a default canonical CareerTrack to link this auto-created Track to.
    // Prefer SWE; fall back to any canonical CareerTrack.
    let defaultCT = await prisma.careerTrack.findUnique({ where: { code: 'SWE' } });
    if (!defaultCT) {
      defaultCT = await prisma.careerTrack.findFirst({ where: { institutionId: null } });
    }
    track = await prisma.track.create({
      data: {
        institutionId: inst.id,
        name: 'B.Tech Computer Science & Engineering',
        careerTrackId: defaultCT?.id ?? null,
      },
    });
  } else if (!track.careerTrackId) {
    // Existing institution Track that was never linked — backfill now.
    const defaultCT = (await prisma.careerTrack.findUnique({ where: { code: 'SWE' } })) ??
                       (await prisma.careerTrack.findFirst({ where: { institutionId: null } }));
    if (defaultCT) {
      track = await prisma.track.update({ where: { id: track.id }, data: { careerTrackId: defaultCT.id } });
    }
  }
  let cohort = await prisma.cohort.findFirst({ where: { institutionId: inst.id, trackId: track.id } });
  if (!cohort) {
    let iv = await prisma.indexVersion.findFirst({ where: { institutionId: inst.id }, orderBy: { effectiveFrom: 'desc' } });
    if (!iv) {
      iv = await prisma.indexVersion.create({
        data: {
          institutionId: inst.id, versionTag: 'v1.2', effectiveFrom: new Date(), locked: true,
          weights: DEFAULT_WEIGHTS, thresholds: DEFAULT_TARGETS,
        },
      });
    }
    cohort = await prisma.cohort.create({
      data: {
        institutionId: inst.id,
        trackId: track.id,
        indexVersionId: iv.id,
        name: `Batch of ${new Date().getFullYear() + 1}`,
        startYear: new Date().getFullYear() - 3,
      },
    });
  }

  const passwordHash = await hashPassword(args.password);
  let learner: Awaited<ReturnType<typeof prisma.learner.create>>;
  let user: Awaited<ReturnType<typeof prisma.user.create>>;
  try {
    learner = await prisma.learner.create({
      data: {
        institutionId: inst.id,
        trackId: track.id,
        cohortId: cohort.id,
        name: args.name,
        email: args.email.toLowerCase(),
      },
    });

    // v3.1.10 — auto-create CareerTrackEnrollment so the learner has at least
    // one CareerTrack to navigate to in /me. Without this, Talent's 3-way map
    // button stays disabled forever even when curriculum has been uploaded.
    if (track.careerTrackId) {
      try {
        await prisma.careerTrackEnrollment.create({
          data: {
            learnerId:    learner.id,
            careerTrackId: track.careerTrackId,
            isPrimary:    true,
          },
        });
      } catch { /* unique-index conflict means already enrolled — fine */ }
    }

    user = await prisma.user.create({
      data: {
        email: args.email.toLowerCase(),
        passwordHash,
        name: args.name,
        role: Role.LEARNER,
        institutionId: inst.id,
        learnerId: learner.id,
      },
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      throw new AppError('EMAIL_ALREADY_EXISTS', 'An account with this email already exists.');
    }
    throw e;
  }

  // BC 13 — seed 4 default ConsentRecord rows for the new learner (all granted=true)
  // ipAddress is not available in the service layer; callers pass it via args or we fall back.
  await seedDefaultConsent(user.id, args.ipAddress ?? '');

  const env_ = await tokenisedEnvelope(user.id, { institutionId: inst.id, userId: user.id, institutionName: inst.name, learnerId: learner.id });
  void sendWelcomeEmail({ to: args.email, name: args.name, role: 'learner' });
  // Option B — send email verification (fire-and-forget)
  void sendVerificationEmail(user.id, args.email, args.name);
  return { ...env_, institutionName: inst.name };
}
