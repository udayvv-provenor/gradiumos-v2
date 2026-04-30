/**
 * Unit test for resumeService.generateResume Signal gate.
 * Mocks all DB / network dependencies so the test is pure logic.
 * Verifies: score < 65 → SIGNAL_BELOW_THRESHOLD; score ≥ 65 → gate passes.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock heavy dependencies before any import of resumeService ─────────────
vi.mock('../../../src/config/db.js', () => ({
  prisma: {
    careerTrack: {
      findUnique: vi.fn().mockResolvedValue({
        id: 'ct-mock',
        name: 'Software Engineering',
        code: 'SWE',
        clusterWeights: '{}',
        clusterTargets: '{}',
      }),
    },
    competencyScore: { findMany: vi.fn().mockResolvedValue([]) },
    assessmentAttemptV2: { findMany: vi.fn().mockResolvedValue([]) },
    augmentationAssignment: { findMany: vi.fn().mockResolvedValue([]) },
    gradiumSignal: { findMany: vi.fn().mockResolvedValue([]) },
    competencyCluster: { findMany: vi.fn().mockResolvedValue([]) },
    cohort: { findUnique: vi.fn().mockResolvedValue({ id: 'cohort-1', name: 'Test Cohort' }) },
    resume: {
      create: vi.fn().mockResolvedValue({
        id: 'resume-1',
        learnerId: 'l-1',
        careerTrackId: 'ct-mock',
        variant: 'general',
        matchedRoleId: null,
        jdText: null,
        headline: 'Test headline',
        summary: 'Test summary',
        sections: [],
        signalScoreAtGen: 70,
        signalConfAtGen: 0.9,
        createdAt: new Date(),
      }),
    },
  },
}));

vi.mock('../../../src/services/talent/learnerContext.js', () => ({
  getLearnerWithScope: vi.fn().mockResolvedValue({
    learner: {
      id: 'l-1',
      name: 'Test Learner',
      institutionId: 'inst-1',
      cohortId: 'cohort-1',
      institution: { name: 'Test University' },
    },
  }),
  requireTrackEnrollment: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../src/services/talent/signalTalentService.js', () => ({
  computeSignalScore: vi.fn(),
}));

vi.mock('../../../src/services/talent/helpers.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/services/talent/helpers.js')>();
  return {
    ...actual,
    loadResumeBlurbs: vi.fn().mockReturnValue({ perCluster: {}, perTrack: {} }),
    parseWeights: vi.fn().mockReturnValue({}),
  };
});

vi.mock('../../../src/services/talent/resumePdf.js', () => ({
  renderResumeHtml: vi.fn().mockReturnValue('<html></html>'),
}));

// ── Import under test (after mocks) ────────────────────────────────────────
import { generateResume } from '../../../src/services/talent/resumeService.js';
import { computeSignalScore } from '../../../src/services/talent/signalTalentService.js';

const mockComputeSignal = computeSignalScore as ReturnType<typeof vi.fn>;

describe('resumeService — gateRejectsBelow65', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws SIGNAL_BELOW_THRESHOLD when signal score is 55', async () => {
    mockComputeSignal.mockResolvedValue({ score: 55, confidence: 0.8 });
    await expect(
      generateResume('user-1', { variant: 'general', careerTrackId: 'ct-mock' }),
    ).rejects.toMatchObject({ code: 'SIGNAL_BELOW_THRESHOLD' });
  });

  it('throws SIGNAL_BELOW_THRESHOLD when signal score is 64 (boundary − 1)', async () => {
    mockComputeSignal.mockResolvedValue({ score: 64, confidence: 0.9 });
    await expect(
      generateResume('user-1', { variant: 'general', careerTrackId: 'ct-mock' }),
    ).rejects.toMatchObject({ code: 'SIGNAL_BELOW_THRESHOLD' });
  });

  it('does NOT throw gate error when signal score is exactly 65 (boundary)', async () => {
    mockComputeSignal.mockResolvedValue({ score: 65, confidence: 0.9 });
    // Gate passes; the rest of the function runs and calls prisma.resume.create
    await expect(
      generateResume('user-1', { variant: 'general', careerTrackId: 'ct-mock' }),
    ).resolves.toMatchObject({ id: 'resume-1', variant: 'general' });
  });

  it('does NOT throw gate error when signal score is 80', async () => {
    mockComputeSignal.mockResolvedValue({ score: 80, confidence: 0.95 });
    await expect(
      generateResume('user-1', { variant: 'general', careerTrackId: 'ct-mock' }),
    ).resolves.toMatchObject({ id: 'resume-1' });
  });

  it('error detail includes actual score and threshold', async () => {
    mockComputeSignal.mockResolvedValue({ score: 50, confidence: 0.7 });
    try {
      await generateResume('user-1', { variant: 'general', careerTrackId: 'ct-mock' });
      expect.fail('Expected error not thrown');
    } catch (err: unknown) {
      const e = err as { code: string; details?: { score: number; threshold: number } };
      expect(e.code).toBe('SIGNAL_BELOW_THRESHOLD');
      expect(e.details?.score).toBe(50);
      expect(e.details?.threshold).toBe(65);
    }
  });
});
