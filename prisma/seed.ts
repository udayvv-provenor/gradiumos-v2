/**
 * v3 seed — CONFIG ONLY (no demo people, no demo data).
 *
 * After this runs the platform contains:
 *   - 8 CompetencyCluster rows (the GradiumOS taxonomy)
 *   - 8 canonical CareerTrack rows (SWE, DATA, etc.)
 *
 * No institutions. No employers. No learners. No curricula. No scores.
 * No attempts. No tutor sessions. No roles. No demo accounts.
 *
 * The first real user signs up via:
 *   POST /api/auth/signup/institution   (creates institution + first DEAN)
 *   POST /api/auth/signup/employer      (creates employer + first TA_LEAD)
 *   POST /api/auth/signup/learner       (joins via institution invite code)
 *
 * That is the truth state. The platform is empty until customers populate it.
 */
import { PrismaClient, ClusterCode, Archetype } from '@prisma/client';

const prisma = new PrismaClient();

const CLUSTERS: { code: ClusterCode; name: string; shortName: string; description: string }[] = [
  { code: 'C1', name: 'Core Technical Foundations',  shortName: 'Core Tech',       description: 'Data structures, algorithms, computational thinking.' },
  { code: 'C2', name: 'Applied Problem Solving',     shortName: 'Problem Solving', description: 'Translating ambiguous problems into structured solutions.' },
  { code: 'C3', name: 'Engineering Execution',       shortName: 'Execution',       description: 'Production code, debugging, delivery discipline.' },
  { code: 'C4', name: 'System & Product Thinking',   shortName: 'Systems',         description: 'Architecture, trade-offs, product reasoning.' },
  { code: 'C5', name: 'Communication & Collaboration', shortName: 'Communication', description: 'Verbal, written, cross-team clarity.' },
  { code: 'C6', name: 'Domain Specialisation',       shortName: 'Domain',          description: 'Specialist depth (ML, security, fintech, etc.).' },
  { code: 'C7', name: 'Ownership & Judgment',        shortName: 'Ownership',       description: 'Initiative, reliability, decision quality.' },
  { code: 'C8', name: 'Learning Agility',            shortName: 'Agility',         description: 'Speed picking up new tools/domains.' },
];

const ARCHETYPE_WEIGHTS = {
  C1: { Product: 0.18, Service: 0.15, MassRecruiter: 0.20 },
  C2: { Product: 0.16, Service: 0.14, MassRecruiter: 0.18 },
  C3: { Product: 0.15, Service: 0.16, MassRecruiter: 0.16 },
  C4: { Product: 0.16, Service: 0.10, MassRecruiter: 0.08 },
  C5: { Product: 0.10, Service: 0.16, MassRecruiter: 0.12 },
  C6: { Product: 0.10, Service: 0.12, MassRecruiter: 0.10 },
  C7: { Product: 0.10, Service: 0.09, MassRecruiter: 0.08 },
  C8: { Product: 0.05, Service: 0.08, MassRecruiter: 0.08 },
} as const;

/* v3.1.2 — Career tracks are now DYNAMIC. Users (Deans + TAs) create them
 * inline; AI maps each new track to the locked 8-cluster vocabulary.
 *
 * For demo convenience, we pre-seed a small set of COMMON tracks so the
 * typeahead has something to suggest on a fresh install. These are NOT
 * IP — users can create unlimited new tracks alongside them. To start
 * truly empty, simply remove this array. */
const CAREER_TRACKS: { code: string; name: string; archetype: Archetype | null }[] = [
  { code: 'SWE',         name: 'Software Engineering',     archetype: null },
  { code: 'DATA',        name: 'Data Science & Analytics', archetype: null },
  { code: 'MLAI',        name: 'Machine Learning Engineer', archetype: null },
  { code: 'PRODUCT',     name: 'Product Management',       archetype: null },
  { code: 'DESIGN',      name: 'Product Design',           archetype: null },
];

const DEFAULT_WEIGHTS: Record<ClusterCode, number> = {
  C1: 0.18, C2: 0.16, C3: 0.15, C4: 0.16, C5: 0.10, C6: 0.10, C7: 0.10, C8: 0.05,
};
const DEFAULT_TARGETS: Record<ClusterCode, number> = {
  C1: 70, C2: 70, C3: 65, C4: 60, C5: 55, C6: 60, C7: 60, C8: 55,
};

async function main() {
  console.log('v3 seed — CONFIG ONLY (clusters + career tracks)');

  for (const c of CLUSTERS) {
    await prisma.competencyCluster.upsert({
      where: { code: c.code }, update: {},
      create: { ...c, archetypeWeights: ARCHETYPE_WEIGHTS },
    });
  }
  console.log('  ✓ 8 CompetencyCluster rows');

  for (const t of CAREER_TRACKS) {
    await prisma.careerTrack.upsert({
      where: { code: t.code }, update: {},
      create: {
        code: t.code,
        name: t.name,
        archetype: t.archetype,
        clusterWeights: DEFAULT_WEIGHTS,
        clusterTargets: DEFAULT_TARGETS,
      },
    });
  }
  console.log(`  ✓ ${CAREER_TRACKS.length} CareerTrack rows (suggestions — users can create unlimited new ones)`);

  // BC 35-36 — Feature flags
  await prisma.featureFlag.createMany({
    data: [
      { name: 'TUTOR_ENABLED',               enabled: true },
      { name: 'SPONSORED_PATHWAYS_ENABLED',   enabled: true },
      { name: 'VERIFIER_WIDGET_ENABLED',      enabled: true },
      { name: 'PROCTORING_ENABLED',           enabled: true },
    ],
    skipDuplicates: true,
  });
  console.log('  ✓ 4 FeatureFlag rows');

  console.log('\nSeed complete. Platform is EMPTY (no institutions, employers, learners).');
  console.log('First real user signs up via:');
  console.log('  POST /api/auth/signup/institution');
  console.log('  POST /api/auth/signup/employer');
  console.log('  POST /api/auth/signup/learner  (with institution invite code)');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
