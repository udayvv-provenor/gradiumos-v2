/**
 * JD upload service — accepts a normalised UploadedDoc for an EmployerRole,
 * runs Groq extractJD, persists clusterTargets + jdText + extraction,
 * returns the updated role.
 */
import { createHash } from 'crypto';
import { prisma } from '../../config/db.js';
import { AppError } from '../../utils/AppError.js';
import { extractJD } from '../ai/prompts/extractJD.js';
import type { UploadedDoc } from '../upload/uploadMiddleware.js';

/* v3.1.1 — recomputeEmployerArchetype call REMOVED. Per Uday's call: archetype
 * is a per-ROLE property, not per-company. Each role's archetype is stored in
 * jdExtraction.archetype on JD upload (below) and surfaced on the role detail
 * page. There is no aggregated company-level label. */

export async function uploadJD(args: {
  employerId: string;
  roleId:     string;
  doc:        UploadedDoc;
}) {
  const role = await prisma.employerRole.findFirst({
    where: { id: args.roleId, employerId: args.employerId },
  });
  if (!role) throw new AppError('NOT_FOUND', 'Role not found or you don\'t own it');

  // v3.1.8 — input-hash dedup. If the same JD text was extracted before
  // (e.g. user re-uploaded the same PDF, or two roles share an identical
  // boilerplate), skip Groq + return the cached extraction.
  const jdHash = createHash('sha256').update(`extractJD:${args.doc.rawText}:v1`).digest('hex').slice(0, 16);
  let extracted: Awaited<ReturnType<typeof extractJD>>['extracted'];
  let meta:      Awaited<ReturnType<typeof extractJD>>['meta'];
  const cached = await prisma.publicDataCache.findFirst({
    where: { stakeholderKind: 'workforce', stakeholderId: args.roleId, slot: 'jd-extraction', contextHash: jdHash },
  });
  if (cached && cached.expiresAt > new Date() && cached.payload) {
    extracted = cached.payload as typeof extracted;
    meta      = { latencyMs: 0, tokens: 0, model: 'db-cache' };
  } else {
    ({ extracted, meta } = await extractJD(args.doc.rawText));
    if (!meta.model.startsWith('mock-')) {
      try {
        await prisma.publicDataCache.upsert({
          where:  { stakeholderKind_stakeholderId_slot_contextHash: { stakeholderKind: 'workforce', stakeholderId: args.roleId, slot: 'jd-extraction', contextHash: jdHash } },
          update: { payload: extracted as unknown as object, retrievedAt: new Date(), expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000), fromFixture: false },
          create: { stakeholderKind: 'workforce', stakeholderId: args.roleId, slot: 'jd-extraction', contextHash: jdHash, payload: extracted as unknown as object, fromFixture: false, expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000) },
        });
      } catch { /* non-fatal */ }
    }
  }

  // BC 52 — atomic write: wrap role update in a Prisma transaction.
  // Fields added: status, jdVersion increment, version increment.
  const jdText    = args.doc.rawText.slice(0, 200000);
  const jdSource  = args.doc.source === 'pdf' ? 'pdf' : 'paste';
  const jdFileName = args.doc.fileName;
  const { clusterTargets, archetype, seniority, extractedTitle, extractedRequirements } = extracted;

  let updated: Awaited<ReturnType<typeof prisma.employerRole.update>>;
  await prisma.$transaction(async (tx) => {
    updated = await tx.employerRole.update({
      where: { id: args.roleId },
      data: {
        title:          extractedTitle || role.title,
        clusterTargets,
        jdText,
        jdSource,
        jdFileName,
        jdUploadedAt:  new Date(),
        jdExtractedAt: new Date(),
        jdVersion:     { increment: 1 },
        version:       { increment: 1 },
        status:        'active',
        jdExtraction:  {
          extractedTitle,
          archetype,
          seniority,
          extractedRequirements,
          domain: extracted.domain ?? null,
        },
      },
    });
  });
  // TypeScript narrowing: transaction guarantees this is assigned.
  const updatedRole = updated!;

  // BC 53 — upsert HiringBarProfile for this employer+careerTrack.
  const existing = await prisma.hiringBarProfile.findFirst({
    where: { employerId: args.employerId, careerTrackId: role.careerTrackId },
  });
  if (existing) {
    await prisma.hiringBarProfile.update({
      where: { id: existing.id },
      data: { clusterTargets, seniority, archetype, version: { increment: 1 }, publishedAt: new Date() },
    });
  } else {
    await prisma.hiringBarProfile.create({
      data: { employerId: args.employerId, careerTrackId: role.careerTrackId, clusterTargets, seniority, archetype, version: 1 },
    });
  }

  // BC 54 — fetch peer P50 from MarketDemandSignal for this careerTrack.
  const signals = await prisma.marketDemandSignal.findMany({
    where:   { careerTrackId: role.careerTrackId },
    orderBy: { capturedAt: 'desc' },
    take:    20,
  });

  let peerP50: Record<string, number> | null = null;
  const peerP50Source = signals.length >= 5 ? 'live-aggregate' : 'cold-start-public';

  if (signals.length > 0) {
    const keys = ['C1','C2','C3','C4','C5','C6','C7','C8'];
    peerP50 = Object.fromEntries(keys.map(k => {
      const avg = signals.reduce(
        (sum, s) => sum + (((s.p50ClusterTargets as Record<string, number>)[k]) ?? 0), 0,
      ) / signals.length;
      return [k, Math.round(avg)];
    }));
  }

  // v3.1.1 — no company-level archetype recompute. The role's own archetype
  // is in updatedRole.jdExtraction.archetype above; that's the single source.
  return { role: updatedRole, extraction: extracted, meta, peerP50, peerP50Source };
}
