import type { Request, Response } from 'express';
import { ok } from '../utils/response.js';
import { AppError } from '../utils/AppError.js';
import * as curriculumService from '../services/v3/curriculumService.js';
import * as jdService from '../services/v3/jdUploadService.js';

export async function postCurriculum(req: Request, res: Response) {
  if (!req.uploadedDoc) throw new AppError('UPLOAD_REQUIRED', 'No document received');
  if (!req.auth?.inst)  throw new AppError('AUTH_FORBIDDEN', 'Institution scope required');
  // The portal calls /api/campus/career-tracks/:id/curriculum where :id is the
  // institution-scoped Track id (not the global CareerTrack id). Resolve to the
  // CareerTrack the Track points at.
  const trackOrCareerId = (req.params.id || (req.body as { careerTrackId?: string })?.careerTrackId || '').trim();
  if (!trackOrCareerId) throw new AppError('VALIDATION', 'track id required in URL');

  // Try as a Track first; if found, use its careerTrackId. Else assume direct CareerTrack id.
  let careerTrackId = trackOrCareerId;
  const { prisma } = await import('../config/db.js');
  const t = await prisma.track.findFirst({ where: { id: trackOrCareerId, institutionId: req.auth.inst } });
  if (t?.careerTrackId) careerTrackId = t.careerTrackId;

  const result = await curriculumService.uploadCurriculum({
    institutionId: req.auth.inst,
    careerTrackId,
    uploadedById:  req.auth.sub,
    doc:           req.uploadedDoc,
  });
  // Flatten the response to match the portal's CurriculumResult shape.
  // Scale coverage from 0..1 (zod schema) → 0..100 (what ClusterBars and the
  // subjects table render directly as percentages).
  const cov = result.extraction.clusterCoverage;
  const clusterCoverage = Object.fromEntries(
    Object.entries(cov).map(([k, v]) => [k, Math.round((v as number) * 100)]),
  );
  const subjects = result.extraction.subjects.map((s) => ({
    ...s,
    coverage: Math.round(s.coverage * 100),
  }));

  // BC 60 — Compute gap vs MarketDemandSignal P50
  const signals = await prisma.marketDemandSignal.findMany({
    where: { careerTrackId },
    orderBy: { capturedAt: 'desc' },
    take: 10,
  });

  const keys = ['C1','C2','C3','C4','C5','C6','C7','C8'];
  let employerP50: Record<string, number> | null = null;
  if (signals.length > 0) {
    employerP50 = Object.fromEntries(keys.map(k => {
      const avg = signals.reduce((sum, s) => sum + ((s.p50ClusterTargets as Record<string,number>)[k] ?? 0), 0) / signals.length;
      return [k, Math.round(avg)];
    }));
  }

  // clusterCoverage is already scaled to 0..100 in the response (see existing scaling code)
  const gap: Record<string, number | null> = {};
  if (employerP50) {
    for (const k of keys) {
      const cv = clusterCoverage[k] ?? 0; // already 0..100 at this point
      gap[k] = Math.round((employerP50[k] ?? 0) - cv);
    }
  }

  ok(res, {
    subjects,
    clusterCoverage,
    summary:         result.extraction.summary,
    curriculumId:    result.curriculum.id,
    gap,
    employerP50,
  });
}

export async function getCurricula(req: Request, res: Response) {
  if (!req.auth?.inst) throw new AppError('AUTH_FORBIDDEN', 'Institution scope required');
  const careerTrackId = (req.query.careerTrackId as string | undefined)?.trim();
  const list = await curriculumService.listCurricula(req.auth.inst, careerTrackId || undefined);
  ok(res, list);
}

export async function postJD(req: Request, res: Response) {
  if (!req.uploadedDoc) throw new AppError('UPLOAD_REQUIRED', 'No document received');
  if (!req.auth?.emp)   throw new AppError('AUTH_FORBIDDEN', 'Employer scope required');
  const roleId = (req.params.id || '').trim();
  if (!roleId) throw new AppError('VALIDATION', 'roleId required');

  const result = await jdService.uploadJD({
    employerId: req.auth.emp,
    roleId,
    doc: req.uploadedDoc,
  });
  // Flatten so the portal's RoleDetail "JD" tab can read fields directly.
  ok(res, {
    id:                    result.role.id,
    title:                 result.role.title,
    jdText:                result.role.jdText,
    clusterTargets:        result.role.clusterTargets,
    extractedRequirements: result.extraction.extractedRequirements,
    archetype:             result.extraction.archetype,
    seniority:             result.extraction.seniority,
    domain:                result.extraction.domain ?? null,
    // BC 54 — peer benchmark
    peerP50:               result.peerP50,
    peerP50Source:         result.peerP50Source,
  });
}
