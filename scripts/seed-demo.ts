/**
 * seed-demo — minimal demo accounts so screenshots / smoke can hit each portal.
 *
 * Creates:
 *   - SRM Institute  (Dean: krishnamurthy@srm.edu / DemoPass1!)
 *   - Freshworks employer  (TA: sarita@freshworks.com / DemoPass1!)
 *   - Arjun the learner under SRM  (arjun@srm.edu / DemoPass1!)
 *
 * Idempotent — re-runs upsert by email.
 */
import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../src/services/auth/passwordHasher.js';

const prisma = new PrismaClient();
const PASSWORD = 'DemoPass1!';

async function main() {
  const passwordHash = await hashPassword(PASSWORD);
  const inviteCode = 'SRMINVC1';

  // 1. Institution
  let inst = await prisma.institution.findFirst({ where: { name: 'SRM Institute of Science and Technology' } });
  if (!inst) {
    inst = await prisma.institution.create({
      data: {
        name: 'SRM Institute of Science and Technology',
        type: 'higher-ed',
        planValidUntil: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
        inviteCode,
      },
    });
  }

  // 2. Dean
  await prisma.user.upsert({
    where: { email: 'krishnamurthy@srm.edu' },
    update: { passwordHash, institutionId: inst.id, role: 'DEAN', name: 'Dr. Krishnamurthy' },
    create: { email: 'krishnamurthy@srm.edu', passwordHash, institutionId: inst.id, role: 'DEAN', name: 'Dr. Krishnamurthy' },
  });

  // 3. Index version (locked v1.2)
  let iv = await prisma.indexVersion.findFirst({ where: { institutionId: inst.id, versionTag: 'v1.2' } });
  if (!iv) {
    iv = await prisma.indexVersion.create({
      data: {
        institutionId: inst.id,
        versionTag: 'v1.2',
        effectiveFrom: new Date(),
        weights:    { C1: 0.18, C2: 0.14, C3: 0.14, C4: 0.12, C5: 0.12, C6: 0.10, C7: 0.10, C8: 0.10 },
        thresholds: { C1: 70, C2: 65, C3: 70, C4: 65, C5: 60, C6: 55, C7: 65, C8: 60 },
      },
    });
  }

  // 4. Career track + Track + Cohort
  let careerTrack = await prisma.careerTrack.findUnique({ where: { code: 'SWE' } });
  if (!careerTrack) {
    careerTrack = await prisma.careerTrack.create({
      data: {
        code: 'SWE',
        name: 'Software Engineer',
        clusterWeights: { C1: 0.18, C2: 0.14, C3: 0.14, C4: 0.12, C5: 0.12, C6: 0.10, C7: 0.10, C8: 0.10 },
        clusterTargets: { C1: 75, C2: 70, C3: 75, C4: 70, C5: 65, C6: 60, C7: 70, C8: 65 },
      },
    });
  }
  let track = await prisma.track.findFirst({ where: { institutionId: inst.id, name: 'B.Tech CSE' } });
  if (!track) {
    track = await prisma.track.create({
      data: { institutionId: inst.id, name: 'B.Tech CSE', careerTrackId: careerTrack.id },
    });
  }
  let cohort = await prisma.cohort.findFirst({ where: { institutionId: inst.id, name: 'CSE 2026 Batch' } });
  if (!cohort) {
    cohort = await prisma.cohort.create({
      data: { institutionId: inst.id, trackId: track.id, indexVersionId: iv.id, name: 'CSE 2026 Batch', startYear: 2022 },
    });
  }

  // 5. Learner + Learner User
  let learner = await prisma.learner.findUnique({ where: { email: 'arjun@srm.edu' } });
  if (!learner) {
    learner = await prisma.learner.create({
      data: {
        institutionId: inst.id, trackId: track.id, cohortId: cohort.id,
        name: 'Arjun Reddy', email: 'arjun@srm.edu',
      },
    });
  }
  await prisma.user.upsert({
    where: { email: 'arjun@srm.edu' },
    update: { passwordHash, institutionId: inst.id, learnerId: learner.id, role: 'LEARNER', name: 'Arjun Reddy' },
    create: { email: 'arjun@srm.edu', passwordHash, institutionId: inst.id, learnerId: learner.id, role: 'LEARNER', name: 'Arjun Reddy' },
  });

  // 6. Employer + TA Lead
  let employer = await prisma.employer.findUnique({ where: { name: 'Freshworks' } });
  if (!employer) {
    employer = await prisma.employer.create({ data: { name: 'Freshworks' } });
  }
  await prisma.user.upsert({
    where: { email: 'sarita@freshworks.com' },
    update: { passwordHash, employerId: employer.id, role: 'TA_LEAD', name: 'Sarita Rajan' },
    create: { email: 'sarita@freshworks.com', passwordHash, employerId: employer.id, role: 'TA_LEAD', name: 'Sarita Rajan' },
  });

  console.log(JSON.stringify({
    institution: inst.name,
    inviteCode: inst.inviteCode,
    accounts: [
      { portal: 'Campus 5273',    email: 'krishnamurthy@srm.edu', password: PASSWORD, role: 'DEAN' },
      { portal: 'Workforce 5275', email: 'sarita@freshworks.com', password: PASSWORD, role: 'TA_LEAD' },
      { portal: 'Talent 5277',    email: 'arjun@srm.edu',         password: PASSWORD, role: 'LEARNER' },
    ],
  }, null, 2));
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
