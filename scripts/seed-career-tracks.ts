/**
 * BC 25–26 — Career track seeder (15 canonical tracks).
 *
 * Seeds the locked GradiumOS v3 taxonomy of 15 CareerTrack rows.
 * Uses upsert by `code` (unique constraint) — safe to run multiple times.
 *
 * Tier defaults:
 *   Tier 1 — SWE, DATA, MLAI, FULLSTACK, DEVOPS
 *   Tier 2 — CLOUD, CYBER, PROD, MOBILE, QA
 *   Tier 3 — EMBED, BA, UX, QUANT, WEB3
 *
 * After seeding, the script asserts the total count of seeded-canonical tracks
 * equals exactly 15 (BC 26 verification).
 *
 * Usage:
 *   npx tsx scripts/seed-career-tracks.ts
 */

import { prisma } from '../src/config/db.js';

// Equal-weight defaults across all 8 clusters. Tier-specific variants applied
// below where the domain naturally leans (e.g. C6 Domain Specialisation higher
// for Tier 2+ niche tracks).
const EQUAL_WEIGHTS = {
  C1: 0.125, C2: 0.125, C3: 0.125, C4: 0.125,
  C5: 0.125, C6: 0.125, C7: 0.125, C8: 0.125,
};

// Tier-1 targets (high-volume generalist engineering roles)
const TIER1_TARGETS = {
  C1: 70, C2: 68, C3: 72, C4: 65, C5: 58, C6: 60, C7: 62, C8: 58,
};

// Tier-2 targets (specialist / platform roles)
const TIER2_TARGETS = {
  C1: 65, C2: 65, C3: 70, C4: 68, C5: 60, C6: 68, C7: 62, C8: 60,
};

// Tier-3 targets (niche / emerging roles)
const TIER3_TARGETS = {
  C1: 60, C2: 65, C3: 65, C4: 65, C5: 62, C6: 70, C7: 60, C8: 65,
};

const CANONICAL_TRACKS: {
  code:         string;
  name:         string;
  tier:         number;
}[] = [
  // ── Tier 1 ────────────────────────────────────────────────────────────────
  { code: 'SWE',       name: 'Software Engineering',              tier: 1 },
  { code: 'DATA',      name: 'Data Science & Analytics',          tier: 1 },
  { code: 'MLAI',      name: 'Machine Learning / AI Engineering', tier: 1 },
  { code: 'FULLSTACK', name: 'Full Stack Development',            tier: 1 },
  { code: 'DEVOPS',    name: 'DevOps & Platform Engineering',     tier: 1 },
  // ── Tier 2 ────────────────────────────────────────────────────────────────
  { code: 'CLOUD',     name: 'Cloud Engineering',                 tier: 2 },
  { code: 'CYBER',     name: 'Cybersecurity',                     tier: 2 },
  { code: 'PROD',      name: 'Product Management',                tier: 2 },
  { code: 'MOBILE',    name: 'Mobile Development',                tier: 2 },
  { code: 'QA',        name: 'Quality Assurance / SDET',          tier: 2 },
  // ── Tier 3 ────────────────────────────────────────────────────────────────
  { code: 'EMBED',     name: 'Embedded Systems & IoT',            tier: 3 },
  { code: 'BA',        name: 'Business Analyst / IT Consulting',  tier: 3 },
  { code: 'UX',        name: 'UI/UX Design',                      tier: 3 },
  { code: 'QUANT',     name: 'Quantitative Analyst / FinTech',    tier: 3 },
  { code: 'WEB3',      name: 'Blockchain / Web3',                 tier: 3 },
];

/**
 * Core seeding logic, callable standalone or from prisma/seed.ts.
 */
export async function runCareerTrackSeed(): Promise<void> {
  for (const track of CANONICAL_TRACKS) {
    const targets = track.tier === 1 ? TIER1_TARGETS
                  : track.tier === 2 ? TIER2_TARGETS
                  : TIER3_TARGETS;

    await prisma.careerTrack.upsert({
      where: { code: track.code },
      update: {
        // On re-run: refresh metadata but leave any user-customised weights alone
        tier:        track.tier,
        seedVersion: '1.0.0',
        createdBy:   'veranox-seed',
      },
      create: {
        code:           track.code,
        name:           track.name,
        tier:           track.tier,
        seedVersion:    '1.0.0',
        createdBy:      'veranox-seed',
        archetype:      null,          // derived from roles; null on creation
        clusterWeights: EQUAL_WEIGHTS,
        clusterTargets: targets,
      },
    });
  }

  // BC 26 verification — assert exactly 15 canonical (veranox-seed) tracks exist
  const canonicalCount = await prisma.careerTrack.count({
    where: { createdBy: 'veranox-seed' },
  });
  if (canonicalCount !== 15) {
    throw new Error(
      `BC 26 assertion failed: expected 15 canonical CareerTrack rows, found ${canonicalCount}`,
    );
  }
}

// ── Standalone entry point ────────────────────────────────────────────────────
async function main() {
  console.log('seed-career-tracks — 15 canonical tracks (v3 taxonomy)');
  await runCareerTrackSeed();
  console.log('  ✓ 15 canonical CareerTrack rows (BC 26 assertion passed)');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
