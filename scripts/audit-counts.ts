import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
async function main() {
  const counts = {
    Institution:        await p.institution.count(),
    User:               await p.user.count(),
    Learner:            await p.learner.count(),
    Track:              await p.track.count(),
    CareerTrack:        await p.careerTrack.count(),
    Curriculum:         await p.curriculum.count(),
    Employer:           await p.employer.count(),
    EmployerRole:       await p.employerRole.count(),
    CompetencyScore:    await p.competencyScore.count(),
    GradiumSignal:      await p.gradiumSignal.count(),
    AssessmentAttemptV2: await p.assessmentAttemptV2.count(),
    WorkShift:          await p.workShift.count(),
    TutorSession:       await p.tutorSession.count(),
    PublicDataCache:    await p.publicDataCache.count(),
  };
  console.log(JSON.stringify(counts, null, 2));
  // Sample shifts
  const shifts = await p.workShift.findMany({ take: 5, select: { id: true, state: true, scenarioCompany: true, perArtifact: true, completedAt: true } });
  console.log('shifts:', JSON.stringify(shifts, null, 2).slice(0, 800));
  // Cache slots
  const cacheSlots = await p.publicDataCache.groupBy({ by: ['slot', 'stakeholderKind'], _count: true });
  console.log('cache slots:', JSON.stringify(cacheSlots, null, 2));
  await p.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
