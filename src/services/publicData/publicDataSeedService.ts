/**
 * BC 22–24 — Cold-start public data seed service.
 *
 * Reads the bundled JSON fixtures and upserts:
 *   - MarketDemandSignal rows (keyed by careerTrackId + city + archetype)
 *   - NIRF/NAAC/AISHE fields on matching Institution rows
 *
 * Exported so it can be called from:
 *   1. scripts/seed-public-data.ts (standalone CLI)
 *   2. POST /api/v1/admin/public-data/refresh (admin endpoint)
 */

import { prisma } from '../../config/db.js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);

// Resolve data files relative to this service's location (src/services/publicData/ → data/public/)
const DATA_DIR = resolve(__dirname, '../../../data/public');

interface DemandSignalRow {
  careerTrackCode:   string;
  city:              string;
  archetype:         string;
  jobPostingVolume:  number;
  p50ClusterTargets: Record<string, number>;
}

interface NirfInstitutionRow {
  name:      string;
  nirfRank:  number;
  naacGrade: string;
  aisheCode: string;
}

export interface PublicDataSeedResult {
  demandSignals: number;
  institutions:  number;
}

/**
 * Idempotent seeder — safe to run multiple times.
 *
 * MarketDemandSignal rows are matched by (careerTrackId, city, archetype).
 * Institution rows are matched by exact name.
 */
export async function runPublicDataSeed(): Promise<PublicDataSeedResult> {
  // ── 1. Load JSON fixtures ───────────────────────────────────────────────────
  const demandSignalsRaw: DemandSignalRow[] = JSON.parse(
    readFileSync(resolve(DATA_DIR, 'demand-signal.json'), 'utf-8'),
  );
  const nirfRows: NirfInstitutionRow[] = JSON.parse(
    readFileSync(resolve(DATA_DIR, 'nirf-institutions.json'), 'utf-8'),
  );

  let seededDemandSignals = 0;
  let updatedInstitutions = 0;

  // ── 2. Seed MarketDemandSignal rows ─────────────────────────────────────────
  for (const row of demandSignalsRaw) {
    const track = await prisma.careerTrack.findUnique({ where: { code: row.careerTrackCode } });
    if (!track) {
      // CareerTrack not seeded yet — skip, caller should run seed-career-tracks first.
      continue;
    }

    // Create-if-not-exists keyed by (careerTrackId, city, archetype).
    // MarketDemandSignal has no @unique compound index, so we use findFirst + create.
    const existing = await prisma.marketDemandSignal.findFirst({
      where: {
        careerTrackId: track.id,
        city:          row.city,
        archetype:     row.archetype,
      },
    });

    if (!existing) {
      await prisma.marketDemandSignal.create({
        data: {
          careerTrackId:     track.id,
          city:              row.city,
          archetype:         row.archetype,
          jobPostingVolume:  row.jobPostingVolume,
          p50ClusterTargets: row.p50ClusterTargets,
          source:            'cold-start-public',
        },
      });
      seededDemandSignals++;
    }
    // If already exists, leave untouched (don't overwrite live-aggregate data).
  }

  // ── 3. Patch NIRF/NAAC/AISHE on matching institutions ──────────────────────
  for (const row of nirfRows) {
    const inst = await prisma.institution.findFirst({ where: { name: row.name } });
    if (!inst) continue; // Institution hasn't signed up yet — nothing to update.
    await prisma.institution.update({
      where: { id: inst.id },
      data: {
        nirfRank:  row.nirfRank,
        naacGrade: row.naacGrade,
        aisheCode: row.aisheCode,
      },
    });
    updatedInstitutions++;
  }

  return { demandSignals: seededDemandSignals, institutions: updatedInstitutions };
}
