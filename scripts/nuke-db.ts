/**
 * nuke-db — empty every user-write table so a fresh demo walkthrough starts
 * from zero. Per Uday's call: "I want to see the AI pull details" — no
 * pre-seeded users, no pre-cached AI responses, no pre-loaded enrollments.
 *
 * Preserves: CompetencyCluster + CareerTrack platform-canonical rows (these
 * ARE the IP taxonomy, not user data).
 *
 * Run:  npx tsx scripts/nuke-db.ts
 */
import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();

async function main() {
  // Order matters — children first, parents last
  await p.publicDataCache.deleteMany();
  await p.tutorSession.deleteMany();
  await p.workShift.deleteMany();
  await p.assessmentAttemptV2.deleteMany();
  await p.attempt.deleteMany();
  await p.augmentationOutcome.deleteMany();
  await p.augmentationAssignment.deleteMany();
  await p.augmentationProgramme.deleteMany();
  await p.gradiumSignal.deleteMany();
  await p.competencyScore.deleteMany();
  await p.placement.deleteMany();
  await p.shortlist.deleteMany();
  await p.pipelineCandidate.deleteMany();
  await p.resume.deleteMany();
  await p.careerTrackEnrollment.deleteMany();
  await p.curriculum.deleteMany();
  await p.refreshToken.deleteMany();
  await p.user.deleteMany();
  await p.learner.deleteMany();
  await p.cohort.deleteMany();
  await p.indexVersion.deleteMany();
  await p.track.deleteMany();
  await p.employerRole.deleteMany();
  await p.employer.deleteMany();
  await p.institution.deleteMany();
  // Keep CompetencyCluster (platform IP) + CareerTrack catalogue.
  const remaining = {
    institutions: await p.institution.count(),
    users:        await p.user.count(),
    learners:     await p.learner.count(),
    cache:        await p.publicDataCache.count(),
    careerTracks: await p.careerTrack.count(),
    clusters:     await p.competencyCluster.count(),
  };
  console.log('DB nuked. Remaining (preserved):', JSON.stringify(remaining));
  await p.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
