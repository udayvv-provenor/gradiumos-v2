/**
 * Curriculum upload service — accepts a normalised UploadedDoc + careerTrackId,
 * runs Groq mapCurriculum, persists the Curriculum row, returns it.
 */
import { createHash } from 'crypto';
import { prisma } from '../../config/db.js';
import { AppError } from '../../utils/AppError.js';
import { mapCurriculum } from '../ai/prompts/mapCurriculum.js';
import type { UploadedDoc } from '../upload/uploadMiddleware.js';

export async function uploadCurriculum(args: {
  institutionId: string;
  careerTrackId: string;
  uploadedById: string;
  doc: UploadedDoc;
}) {
  // Accept either a global CareerTrack id or an institution-scoped Track id
  // (Campus portal exposes Track ids; legacy callers may pass CareerTrack ids).
  let track = await prisma.careerTrack.findUnique({ where: { id: args.careerTrackId } });
  let resolvedCareerTrackId = args.careerTrackId;
  if (!track) {
    const t = await prisma.track.findUnique({
      where: { id: args.careerTrackId },
      select: { careerTrackId: true, careerTrack: true },
    });
    if (t?.careerTrack) {
      track = t.careerTrack;
      resolvedCareerTrackId = t.careerTrackId!;
    }
  }
  if (!track) throw new AppError('NOT_FOUND', 'Career track not found');

  // v3.1.8 — input-hash dedup. Re-uploading the same curriculum text for the
  // same track returns the cached mapping instead of paying Groq again.
  const curHash = createHash('sha256')
    .update(`mapCurriculum:${resolvedCareerTrackId}:${args.doc.rawText}:v1`)
    .digest('hex')
    .slice(0, 16);
  let mapping: Awaited<ReturnType<typeof mapCurriculum>>['mapping'];
  let meta:    Awaited<ReturnType<typeof mapCurriculum>>['meta'];
  const cached = await prisma.publicDataCache.findFirst({
    where: { stakeholderKind: 'campus', stakeholderId: args.institutionId, slot: 'curriculum-mapping', contextHash: curHash },
  });
  if (cached && cached.expiresAt > new Date() && cached.payload) {
    mapping = cached.payload as typeof mapping;
    meta    = { latencyMs: 0, tokens: 0, model: 'db-cache' };
  } else {
    ({ mapping, meta } = await mapCurriculum(args.doc.rawText, track.name));
    if (!meta.model.startsWith('mock-')) {
      try {
        await prisma.publicDataCache.upsert({
          where:  { stakeholderKind_stakeholderId_slot_contextHash: { stakeholderKind: 'campus', stakeholderId: args.institutionId, slot: 'curriculum-mapping', contextHash: curHash } },
          update: { payload: mapping as unknown as object, retrievedAt: new Date(), expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000), fromFixture: false },
          create: { stakeholderKind: 'campus', stakeholderId: args.institutionId, slot: 'curriculum-mapping', contextHash: curHash, payload: mapping as unknown as object, fromFixture: false, expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000) },
        });
      } catch { /* non-fatal */ }
    }
  }

  // Persist (always against the resolved global CareerTrack id)
  const curriculum = await prisma.curriculum.create({
    data: {
      institutionId:   args.institutionId,
      careerTrackId:   resolvedCareerTrackId,
      rawText:         args.doc.rawText.slice(0, 200000),
      clusterCoverage: mapping.clusterCoverage,
      subjects:        mapping.subjects,
      source:          args.doc.source === 'pdf' ? 'pdf' : 'paste',
      fileName:        args.doc.fileName,
      uploadedById:    args.uploadedById,
    },
  });

  return {
    curriculum,
    extraction: mapping,
    meta,
  };
}

export async function listCurricula(institutionId: string, careerTrackId?: string) {
  return prisma.curriculum.findMany({
    where: { institutionId, ...(careerTrackId ? { careerTrackId } : {}) },
    orderBy: { uploadedAt: 'desc' },
    take: 50,
    select: {
      id: true, careerTrackId: true, source: true, fileName: true,
      clusterCoverage: true, subjects: true, uploadedAt: true,
    },
  });
}
