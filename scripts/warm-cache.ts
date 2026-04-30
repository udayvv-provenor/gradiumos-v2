/**
 * warm-cache — runs each AI/Serper surface once for the existing demo learner,
 * so a clean install has the publicDataCache populated from REAL live calls
 * (not seeded JSON). This is the canonical "first user triggers live → DB
 * lands → all later users pull from DB" pattern Uday locked in v3.1.6.
 *
 * Usage: `npx tsx scripts/warm-cache.ts`
 *
 * Output: per-surface status + final cache row counts.
 */
import { PrismaClient } from '@prisma/client';
import { signAccess } from '../src/services/auth/jwt.js';

const BASE = process.env.BASE_URL ?? 'http://localhost:4002';
const prisma = new PrismaClient();

async function main() {
  console.log('warm-cache — populating publicDataCache by triggering live AI surfaces');

  // Find the first learner + dean in the DB
  const learnerUser = await prisma.user.findFirst({ where: { role: 'LEARNER' } });
  const deanUser    = await prisma.user.findFirst({ where: { role: 'DEAN' } });
  if (!learnerUser) { console.error('No LEARNER user — nothing to warm'); process.exit(1); }

  const learnerToken = signAccess({ sub: learnerUser.id, role: 'LEARNER', inst: learnerUser.institutionId ?? '', name: learnerUser.name });
  const deanToken    = deanUser ? signAccess({ sub: deanUser.id, role: 'DEAN', inst: deanUser.institutionId ?? '', name: deanUser.name }) : null;

  async function hit(label: string, path: string, token: string, opts: RequestInit = {}) {
    const t0 = Date.now();
    try {
      const res = await fetch(`${BASE}${path}`, {
        ...opts,
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json', ...(opts.headers ?? {}) },
      });
      const json = await res.json().catch(() => ({}));
      const ms = Date.now() - t0;
      if (res.ok) {
        const src = (json as any)?.data?.source ?? 'n/a';
        console.log(`  ✓ ${label} (${ms}ms, source=${src})`);
      } else {
        console.log(`  ⚠ ${label} (${ms}ms, http=${res.status}) — ${(json as any)?.error?.message ?? 'unknown'}`);
      }
    } catch (e) {
      console.log(`  ✗ ${label} (network) — ${(e as Error).message.slice(0, 80)}`);
    }
  }

  console.log('\n[Talent surfaces]');
  await hit('shift scenario',          '/api/talent/me/shift', learnerToken);
  // Apply scenario for any subtopic (synthesised if not in catalog)
  await hit('apply scenario C1.BIG-O', '/api/talent/me/learn/C1.BIG-O/apply', learnerToken);
  await hit('apply scenario C5.TECH-WRITING', '/api/talent/me/learn/C5.TECH-WRITING/apply', learnerToken);
  await hit('opportunities (Bangalore live Serper)', '/api/talent/me/opportunities?city=Bangalore', learnerToken);
  await hit('opportunities (Hyderabad live Serper)', '/api/talent/me/opportunities?city=Hyderabad', learnerToken);

  console.log('\n[Campus surfaces]');
  if (deanToken) {
    await hit('institution public profile (Serper × 3 + Groq extraction)', '/api/campus/me/institution/public-profile', deanToken);
  } else {
    console.log('  (skip — no DEAN user)');
  }

  console.log('\n[Cache final state]');
  const slots = await prisma.publicDataCache.groupBy({ by: ['slot'], _count: true });
  for (const s of slots.sort((a, b) => (b._count as number) - (a._count as number))) {
    console.log(`  ${(s._count as any).toString().padStart(4)}  ${s.slot}`);
  }

  await prisma.$disconnect();
  console.log('\nwarm-cache done.');
}
main().catch((e) => { console.error(e); process.exit(1); });
