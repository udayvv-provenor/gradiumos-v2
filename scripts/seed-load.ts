/**
 * BC 40 — Synthetic load-test data seed.
 *
 * Generates deterministic synthetic data:
 *   - 3 institutions across 3 NIRF tiers
 *   - 5 employers across 3 archetypes
 *   - 1500 learners spread across institutions
 *   - ~105K assessment attempts (70 per learner × 8 clusters)
 *
 * Safe to re-run: checks existing counts before inserting.
 * Target runtime: <60 seconds via batched createMany (batch size 500).
 */
import { PrismaClient, Archetype, ClusterCode } from '@prisma/client';
import * as crypto from 'crypto';

const prisma = new PrismaClient();

function seededRandom(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = Math.imul(s, 1664525) + 1013904223;
    return (s >>> 0) / 0xffffffff;
  };
}

function deterministicId(prefix: string, index: number): string {
  return crypto.createHash('sha256').update(`${prefix}-${index}`).digest('hex').slice(0, 24);
}

const CLUSTER_CODES: ClusterCode[] = ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8'];
const ASSESSMENT_KINDS = ['baseline', 'post_augmentation', 'retake'] as const;
const BATCH_SIZE = 500;

async function batchCreate<T>(items: T[], fn: (batch: T[]) => Promise<void>): Promise<void> {
  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    await fn(items.slice(i, i + BATCH_SIZE));
  }
}

async function main() {
  console.log('BC 40 — seed-load: deterministic synthetic data (seed=42)');

  // Safety check — skip if already seeded
  const existingLearners = await prisma.learner.count();
  if (existingLearners >= 1500) {
    console.log(`  Already seeded (${existingLearners} learners found). Skipping.`);
    return;
  }

  const rng = seededRandom(42);

  // ─── 1. Ensure base CareerTrack exists ────────────────────────────────────
  let careerTrack = await prisma.careerTrack.findFirst({ where: { code: 'SWE' } });
  if (!careerTrack) {
    const defaultWeights: Record<string, number> = { C1: 0.18, C2: 0.16, C3: 0.15, C4: 0.16, C5: 0.10, C6: 0.10, C7: 0.10, C8: 0.05 };
    const defaultTargets: Record<string, number> = { C1: 70, C2: 70, C3: 65, C4: 60, C5: 55, C6: 60, C7: 60, C8: 55 };
    careerTrack = await prisma.careerTrack.create({
      data: {
        code: 'SWE',
        name: 'Software Engineering',
        clusterWeights: defaultWeights,
        clusterTargets: defaultTargets,
        archetype: null,
      },
    });
  }

  // ─── 2. Institutions ──────────────────────────────────────────────────────
  const INST_CONFIGS = [
    { name: 'Tier 1 Institute of Technology', nirfRank: 5, naacGrade: 'A++' },
    { name: 'Tier 2 Engineering College', nirfRank: 45, naacGrade: 'A' },
    { name: 'Tier 3 Polytechnic Institute', nirfRank: 180, naacGrade: 'B+' },
  ];

  const institutions = await Promise.all(
    INST_CONFIGS.map((cfg, i) =>
      prisma.institution.upsert({
        where: { inviteCode: `LOAD-${i + 1}` },
        update: {},
        create: {
          name: cfg.name,
          inviteCode: `LOAD-${i + 1}`,
          nirfRank: cfg.nirfRank,
          naacGrade: cfg.naacGrade,
          kycStatus: 'Verified',
          planName: 'Institutional',
          planValidUntil: new Date('2030-12-31'),
        },
      })
    )
  );
  console.log(`  Created ${institutions.length} institutions`);

  // ─── 3. IndexVersions (one per institution) ───────────────────────────────
  const defaultWeights = { C1: 0.18, C2: 0.16, C3: 0.15, C4: 0.16, C5: 0.10, C6: 0.10, C7: 0.10, C8: 0.05 };
  const defaultThresholds = { C1: 70, C2: 70, C3: 65, C4: 60, C5: 55, C6: 60, C7: 60, C8: 55 };

  const indexVersions = await Promise.all(
    institutions.map(async (inst) => {
      const existing = await prisma.indexVersion.findFirst({ where: { institutionId: inst.id, versionTag: 'v1.0.0' } });
      if (existing) return existing;
      return prisma.indexVersion.create({
        data: {
          institutionId: inst.id,
          versionTag: 'v1.0.0',
          effectiveFrom: new Date('2024-01-01'),
          locked: true,
          weights: defaultWeights,
          thresholds: defaultThresholds,
        },
      });
    })
  );

  // ─── 4. Tracks and Cohorts (one per institution) ──────────────────────────
  const tracks = await Promise.all(
    institutions.map(async (inst) => {
      const existing = await prisma.track.findFirst({ where: { institutionId: inst.id, name: 'SWE' } });
      if (existing) return existing;
      return prisma.track.create({
        data: {
          institutionId: inst.id,
          name: 'SWE',
          careerTrackId: careerTrack!.id,
        },
      });
    })
  );

  const cohorts = await Promise.all(
    institutions.map(async (inst, i) => {
      const track = tracks[i];
      const iv = indexVersions[i];
      const existing = await prisma.cohort.findFirst({ where: { institutionId: inst.id, name: 'Batch 2024' } });
      if (existing) return existing;
      return prisma.cohort.create({
        data: {
          institutionId: inst.id,
          trackId: track.id,
          indexVersionId: iv.id,
          name: 'Batch 2024',
          startYear: 2024,
        },
      });
    })
  );

  // ─── 5. Employers ─────────────────────────────────────────────────────────
  const EMPLOYER_CONFIGS = [
    { name: 'TechCorp Product Lab', archetype: 'Product' as Archetype },
    { name: 'Infosys Services Ltd', archetype: 'Service' as Archetype },
    { name: 'Wipro Delivery Hub', archetype: 'Service' as Archetype },
    { name: 'Campus Hire Co', archetype: 'MassRecruiter' as Archetype },
    { name: 'BuildIt Startup', archetype: 'Product' as Archetype },
  ];

  const employers = await Promise.all(
    EMPLOYER_CONFIGS.map((cfg) =>
      prisma.employer.upsert({
        where: { name: cfg.name },
        update: {},
        create: {
          name: cfg.name,
          archetype: cfg.archetype,
          kycStatus: 'Verified',
          plan: 'growth',
        },
      })
    )
  );
  console.log(`  Created ${employers.length} employers`);

  // ─── 6. Learners (1500 spread across 3 institutions) ──────────────────────
  const LEARNERS_PER_INST = [500, 500, 500];
  const learnerRows: {
    id: string;
    institutionId: string;
    trackId: string;
    cohortId: string;
    name: string;
    email: string;
    enrolledAt: Date;
  }[] = [];

  for (let instIdx = 0; instIdx < 3; instIdx++) {
    const inst = institutions[instIdx];
    const track = tracks[instIdx];
    const cohort = cohorts[instIdx];
    const count = LEARNERS_PER_INST[instIdx];

    for (let j = 0; j < count; j++) {
      const globalIdx = instIdx * 500 + j;
      const id = deterministicId('learner', globalIdx);
      learnerRows.push({
        id,
        institutionId: inst.id,
        trackId: track.id,
        cohortId: cohort.id,
        name: `Learner ${globalIdx + 1}`,
        email: `learner.load${globalIdx + 1}@test.gradium.io`,
        enrolledAt: new Date(Date.now() - Math.floor(rng() * 365 * 24 * 60 * 60 * 1000)),
      });
    }
  }

  await batchCreate(learnerRows, (batch) =>
    prisma.learner.createMany({ data: batch, skipDuplicates: true })
  );
  console.log(`  Created ${learnerRows.length} learners`);

  // ─── 7. Assessments (8, one per cluster) ──────────────────────────────────
  const assessments = await Promise.all(
    CLUSTER_CODES.map(async (code) => {
      const existing = await prisma.assessment.findFirst({
        where: { clusterCode: code, title: { startsWith: 'Load Test Assessment' } },
      });
      if (existing) return existing;
      return prisma.assessment.create({
        data: {
          clusterCode: code,
          kind: 'baseline',
          title: `Load Test Assessment — ${code}`,
          maxScore: 100,
          timeLimitSecs: 3600,
        },
      });
    })
  );

  // ─── 8. Attempts (~70 per learner × 8 clusters ≈ 105K) ───────────────────
  // Build in memory, flush in batches of 500
  type AttemptRow = {
    id: string;
    learnerId: string;
    assessmentId: string;
    clusterCode: ClusterCode;
    kind: string;
    scoreRaw: number;
    maxScore: number;
    scoreNorm: number;
    timeSecs: number;
    takenAt: Date;
  };

  let totalAttempts = 0;
  const ATTEMPTS_PER_CLUSTER = 70;
  // Use 9 batches across all learners × clusters
  const attemptBuf: AttemptRow[] = [];

  for (let li = 0; li < learnerRows.length; li++) {
    const learner = learnerRows[li];
    for (let ci = 0; ci < CLUSTER_CODES.length; ci++) {
      const code = CLUSTER_CODES[ci];
      const assessment = assessments[ci];
      // Each learner gets ATTEMPTS_PER_CLUSTER attempts spread over this cluster
      for (let ai = 0; ai < ATTEMPTS_PER_CLUSTER; ai++) {
        // Normally distributed score: base 40-95 + small noise
        const base = 40 + rng() * 55;
        const noise = (rng() - 0.5) * 10;
        const scoreRaw = Math.max(0, Math.min(100, base + noise));
        const attemptIdx = li * CLUSTER_CODES.length * ATTEMPTS_PER_CLUSTER + ci * ATTEMPTS_PER_CLUSTER + ai;
        const attemptId = deterministicId('attempt', attemptIdx);
        const daysAgo = Math.floor(rng() * 365);
        attemptBuf.push({
          id: attemptId,
          learnerId: learner.id,
          assessmentId: assessment.id,
          clusterCode: code,
          kind: ASSESSMENT_KINDS[Math.floor(rng() * ASSESSMENT_KINDS.length)],
          scoreRaw: Math.round(scoreRaw * 10) / 10,
          maxScore: 100,
          scoreNorm: Math.round((scoreRaw / 100) * 1000) / 1000,
          timeSecs: 600 + Math.floor(rng() * 3000),
          takenAt: new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000),
        });
        totalAttempts++;

        // Flush at batch size to avoid memory blow-up
        if (attemptBuf.length >= BATCH_SIZE) {
          await prisma.attempt.createMany({ data: attemptBuf, skipDuplicates: true });
          attemptBuf.length = 0;
        }
      }
    }
    if (li % 100 === 0 && li > 0) {
      process.stdout.write(`    Learner ${li}/${learnerRows.length} processed...\r`);
    }
  }

  // Flush remainder
  if (attemptBuf.length > 0) {
    await prisma.attempt.createMany({ data: attemptBuf, skipDuplicates: true });
  }

  console.log(`\n  Created ~${totalAttempts} assessment attempts`);
  console.log(`\nDone. Created ${institutions.length} institutions, ${employers.length} employers, ${learnerRows.length} learners, ${totalAttempts} attempts.`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
