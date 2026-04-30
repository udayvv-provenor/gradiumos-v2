/**
 * v3 nuke — wipes ALL people-data while preserving CONFIG.
 *
 * After running, the database contains exactly what `seed.ts` produces:
 *   - 8 CompetencyCluster rows
 *   - 8 CareerTrack rows
 *   (no institutions, employers, learners, scores, attempts, sessions, roles)
 *
 * Use when you want a fresh empty platform without paying the cost of
 * `prisma migrate reset --force` (which drops + re-creates the entire DB).
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('v3 nuke — wiping people-data, preserving config');

  // Order matters — children before parents to avoid FK violations.
  // (Many tables cascade-delete via @relation onDelete: Cascade, but we run
  // explicit deletes to be deterministic and emit visible counts.)

  const ops: { label: string; fn: () => Promise<{ count: number }> }[] = [
    { label: 'AssessmentAttemptV2', fn: () => prisma.assessmentAttemptV2.deleteMany({}) },
    { label: 'Attempt',             fn: () => prisma.attempt.deleteMany({}) },
    { label: 'TutorSession',        fn: () => prisma.tutorSession.deleteMany({}) },
    { label: 'CompetencyScore',     fn: () => prisma.competencyScore.deleteMany({}) },
    { label: 'GradiumSignal',       fn: () => prisma.gradiumSignal.deleteMany({}) },
    { label: 'AugmentationOutcome', fn: () => prisma.augmentationOutcome.deleteMany({}) },
    { label: 'AugmentationAssignment', fn: () => prisma.augmentationAssignment.deleteMany({}) },
    { label: 'Resume',              fn: () => prisma.resume.deleteMany({}) },
    { label: 'Placement',           fn: () => prisma.placement.deleteMany({}) },
    { label: 'PipelineCandidate',   fn: () => prisma.pipelineCandidate.deleteMany({}) },
    { label: 'Shortlist',           fn: () => prisma.shortlist.deleteMany({}) },
    { label: 'CareerTrackEnrollment', fn: () => prisma.careerTrackEnrollment.deleteMany({}) },
    { label: 'Curriculum',          fn: () => prisma.curriculum.deleteMany({}) },
    { label: 'EmployerRole',        fn: () => prisma.employerRole.deleteMany({}) },
    { label: 'DemandSignal',        fn: () => prisma.demandSignal.deleteMany({}) },
    { label: 'RefreshToken',        fn: () => prisma.refreshToken.deleteMany({}) },
    { label: 'User',                fn: () => prisma.user.deleteMany({}) },
    { label: 'Learner',             fn: () => prisma.learner.deleteMany({}) },
    { label: 'Cohort',              fn: () => prisma.cohort.deleteMany({}) },
    { label: 'Track',               fn: () => prisma.track.deleteMany({}) },
    { label: 'IndexVersion',        fn: () => prisma.indexVersion.deleteMany({}) },
    { label: 'Employer',            fn: () => prisma.employer.deleteMany({}) },
    { label: 'Institution',         fn: () => prisma.institution.deleteMany({}) },
  ];

  for (const op of ops) {
    try {
      const r = await op.fn();
      if (r.count > 0) console.log(`  ✓ deleted ${r.count} ${op.label}`);
    } catch (e) {
      console.warn(`  · skipped ${op.label}:`, (e as Error).message.slice(0, 80));
    }
  }

  // Verify what remains
  const remaining = {
    competencyClusters: await prisma.competencyCluster.count(),
    careerTracks:       await prisma.careerTrack.count(),
    institutions:       await prisma.institution.count(),
    employers:          await prisma.employer.count(),
    users:              await prisma.user.count(),
    learners:           await prisma.learner.count(),
  };
  console.log('\nRemaining (should be all-zero except clusters + careerTracks):');
  console.log(JSON.stringify(remaining, null, 2));
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
