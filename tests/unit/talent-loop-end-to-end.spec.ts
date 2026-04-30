/**
 * BC 114 — Talent Loop End-to-End Spec
 *
 * Session-continuity unit tests for the assessment → pathway → reassessment loop.
 * Uses the same vi.mock pattern as audit.spec.ts — no Docker or HTTP required.
 *
 * Covered state-machine transitions:
 *   1. attempt → CompetencyScore upserted
 *   2. score >= SUPPRESSION_THRESHOLD → GradiumSignal issued
 *   3. score drops < SUPPRESSION_THRESHOLD → GradiumSignal revoked
 *   4. idempotent: same score/confidence → no re-issue
 *   5. full loop: attempt → recompute → signal → token changes on second attempt
 */

import { describe, it, expect, vi, type Mock } from 'vitest';

// ── Prisma mock ───────────────────────────────────────────────────────────────
// Must be declared before importing the module under test (hoisted by Vitest).

const mockFindMany = vi.fn();
const mockFindUnique = vi.fn();
const mockUpsert = vi.fn().mockResolvedValue({});
const mockUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
const mockUpdate = vi.fn().mockResolvedValue({});
const mockCreate = vi.fn().mockResolvedValue({});
const mockFindFirst = vi.fn();

vi.mock('../../src/config/db.js', () => ({
  prisma: {
    assessmentAttemptV2: {
      findMany: (...args: unknown[]) => mockFindMany(...args),
    },
    competencyScore: {
      findUnique: (...args: unknown[]) => mockFindUnique(...args),
      upsert: (...args: unknown[]) => mockUpsert(...args),
    },
    gradiumSignal: {
      findFirst: (...args: unknown[]) => mockFindFirst(...args),
      updateMany: (...args: unknown[]) => mockUpdateMany(...args),
      update: (...args: unknown[]) => mockUpdate(...args),
      upsert: (...args: unknown[]) => mockUpsert(...args),
    },
    auditLog: {
      create: (...args: unknown[]) => mockCreate(...args),
    },
  },
}));

// Import service functions after mock is in place
const { recomputeCompetencyScore, maybeRegenerateSignal } =
  await import('../../src/services/talent/assessmentService.js');

// ── Test helpers ──────────────────────────────────────────────────────────────

/** Returns the data object passed to the most recent competencyScore.upsert call. */
function lastUpsertData(): Record<string, unknown> {
  const calls = (mockUpsert as Mock).mock.calls;
  return calls[calls.length - 1]?.[0] as Record<string, unknown>;
}

/** Builds a fake AssessmentAttemptV2 row. */
function fakeAttempt(score: number) {
  return {
    id: `att-${Math.random()}`,
    learnerId: 'learner-1',
    clusterCode: 'C1',
    score,
    suspicious: false,
    submittedAt: new Date(),
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('talent loop end-to-end (BC 114) — session continuity', () => {
  it('assessment attempt creates CompetencyScore row', async () => {
    // Arrange: two completed attempts with known scores
    mockFindMany.mockResolvedValueOnce([fakeAttempt(80), fakeAttempt(60)]);
    mockFindUnique.mockResolvedValueOnce(null); // no prior CompetencyScore
    mockUpsert.mockClear();
    mockCreate.mockClear();

    // Act
    const result = await recomputeCompetencyScore('learner-1', 'C1');

    // Assert: upsert was called once and the returned scoreWeighted is sensible
    expect(mockUpsert).toHaveBeenCalledTimes(1);
    const upsertArg = lastUpsertData();
    expect(upsertArg).toHaveProperty('where');
    expect(upsertArg).toHaveProperty('create');
    expect(upsertArg).toHaveProperty('update');

    // scoreWeighted must be in 0..100 (formulas normalise to this range)
    expect(result.scoreWeighted).toBeGreaterThanOrEqual(0);
    expect(result.scoreWeighted).toBeLessThanOrEqual(100);

    // AuditLog must be written
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it('score above suppression threshold triggers signal issuance', async () => {
    mockFindFirst.mockResolvedValueOnce(null); // no existing signal
    mockUpsert.mockClear();

    // confidence >= 0.30 means suppression threshold is met
    await maybeRegenerateSignal(
      'learner-1',
      'C1',
      { scoreWeighted: 65, confidence: 0.45, freshness: 0.9 },
      null, // previousConfidence = null (first time)
    );

    // GradiumSignal.upsert must have been called to issue the token
    expect(mockUpsert).toHaveBeenCalledTimes(1);
    const call = (mockUpsert as Mock).mock.calls[0][0] as {
      create: { state: string };
    };
    expect(call.create.state).toBe('issued');
  });

  it('score drop below suppression threshold revokes signal', async () => {
    mockUpdateMany.mockClear();
    mockUpsert.mockClear();

    // wasActive = true (previousConfidence was 0.40, above threshold)
    // isNowActive = false (newScore.confidence is 0.15, below threshold)
    await maybeRegenerateSignal(
      'learner-1',
      'C1',
      { scoreWeighted: 20, confidence: 0.15, freshness: 0.5 },
      0.40, // previous confidence was above threshold → wasActive = true
    );

    // updateMany must be called to revoke the existing signal
    expect(mockUpdateMany).toHaveBeenCalledTimes(1);
    const updateArg = (mockUpdateMany as Mock).mock.calls[0][0] as {
      data: { state: string };
    };
    expect(updateArg.data.state).toBe('revoked');

    // No new signal should be issued
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it('idempotent: same score does not reissue signal', async () => {
    // Build a token whose payload encodes score=65, confidence=0.45
    const { signPayload } = await import(
      '../../src/services/signal/tokenSigner.js'
    );
    const existingToken = signPayload({
      sub: 'learner-1',
      cluster: 'C1',
      score: 65,
      confidence: 0.45,
      freshness: 0.9,
      versionTag: '1.2',
    });

    mockFindFirst.mockResolvedValueOnce({
      id: 'sig-1',
      portableToken: existingToken,
      state: 'issued',
    });
    mockUpsert.mockClear();
    mockUpdate.mockClear();

    // Call with identical score + confidence — no change
    await maybeRegenerateSignal(
      'learner-1',
      'C1',
      { scoreWeighted: 65, confidence: 0.45, freshness: 0.9 },
      0.45, // previousConfidence matches
    );

    // Neither upsert nor update should be called — token unchanged
    expect(mockUpsert).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('loop completes: attempt → recompute → signal → token changes on second attempt', async () => {
    // ── First attempt ────────────────────────────────────────────────────────

    // Round 1: single attempt, score=70
    mockFindMany.mockResolvedValueOnce([fakeAttempt(70)]);
    mockFindUnique.mockResolvedValueOnce(null); // no prior score
    mockCreate.mockClear();
    mockUpsert.mockClear();

    const result1 = await recomputeCompetencyScore('learner-2', 'C1');
    expect(result1.scoreWeighted).toBeGreaterThan(0);

    // Signal: no existing signal → issue one
    mockFindFirst.mockResolvedValueOnce(null);
    await maybeRegenerateSignal(
      'learner-2',
      'C1',
      { scoreWeighted: result1.scoreWeighted, confidence: result1.confidence, freshness: result1.freshness },
      null,
    );
    const firstUpsertCall = (mockUpsert as Mock).mock.calls.length;
    expect(firstUpsertCall).toBeGreaterThanOrEqual(1);

    // Capture what the first token payload looked like
    const firstSignalUpsertArg = (mockUpsert as Mock).mock.calls[firstUpsertCall - 1][0] as {
      create: { portableToken: string };
    };
    const firstToken = firstSignalUpsertArg.create.portableToken;
    expect(typeof firstToken).toBe('string');

    // ── Second attempt (higher score) ────────────────────────────────────────

    mockUpsert.mockClear();
    mockFindMany.mockResolvedValueOnce([fakeAttempt(70), fakeAttempt(90)]);
    mockFindUnique.mockResolvedValueOnce({
      scoreWeighted: result1.scoreWeighted,
      confidence: result1.confidence,
    });

    const result2 = await recomputeCompetencyScore('learner-2', 'C1');
    // With two attempts where second is 90, weighted score should be >= result1
    expect(result2.scoreWeighted).toBeGreaterThanOrEqual(result1.scoreWeighted - 1); // allow minor float diff

    // Signal: existing issued signal with the old token — should revoke + reissue
    const { signPayload: sp } = await import(
      '../../src/services/signal/tokenSigner.js'
    );
    const oldToken = sp({
      sub: 'learner-2',
      cluster: 'C1',
      score: result1.scoreWeighted,
      confidence: result1.confidence - 0.01, // slightly different to force reissue
      freshness: result1.freshness,
      versionTag: '1.2',
    });

    mockFindFirst.mockResolvedValueOnce({
      id: 'sig-2',
      portableToken: oldToken,
      state: 'issued',
    });
    mockUpdate.mockClear();
    mockUpsert.mockClear();

    await maybeRegenerateSignal(
      'learner-2',
      'C1',
      { scoreWeighted: result2.scoreWeighted, confidence: result2.confidence, freshness: result2.freshness },
      result1.confidence,
    );

    // Old signal revoked + new signal upserted → token changed
    expect(mockUpdate).toHaveBeenCalledTimes(1); // revoke old
    expect(mockUpsert).toHaveBeenCalledTimes(1); // issue new

    const secondSignalArg = (mockUpsert as Mock).mock.calls[0][0] as {
      create: { portableToken: string };
    };
    const secondToken = secondSignalArg.create.portableToken;
    expect(secondToken).not.toBe(firstToken);
  });
});
