/**
 * BC 22–24 — Cold-start public data seeder (CLI entry point).
 *
 * Delegates to src/services/publicData/publicDataSeedService.ts which contains
 * the shared logic also called by POST /api/v1/admin/public-data/refresh.
 *
 * Idempotent: running twice produces no duplicate rows.
 *
 * Usage:
 *   npx tsx scripts/seed-public-data.ts
 */

import { prisma } from '../src/config/db.js';
import { runPublicDataSeed } from '../src/services/publicData/publicDataSeedService.js';

async function main() {
  console.log('seed-public-data — cold-start market signals + NIRF institution data');
  const { demandSignals, institutions } = await runPublicDataSeed();
  console.log(`  Seeded ${demandSignals} DemandSignals, updated ${institutions} institutions`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
