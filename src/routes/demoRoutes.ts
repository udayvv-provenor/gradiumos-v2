import { Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { prisma } from '../config/db.js';

const router = Router();

// Unauthenticated — powers the public demo landing page (port 5170).
router.get(
  '/counts',
  asyncHandler(async (_req, res) => {
    const [learners, employers, institutions, signalsIssued, latestIndex] = await Promise.all([
      prisma.learner.count(),
      prisma.employer.count(),
      prisma.institution.count(),
      prisma.gradiumSignal.count(),
      prisma.indexVersion.findFirst({ orderBy: { createdAt: 'desc' }, select: { createdAt: true } }),
    ]);

    res.json({
      learners,
      employers,
      institutions,
      signalsIssued,
      lastReseededAt: latestIndex?.createdAt.toISOString() ?? null,
    });
  }),
);

export default router;
