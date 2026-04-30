/**
 * DPDP Compliance — Consent gate (BC 13–14, BC 20)
 *
 * Tests that:
 *   - requireConsent throws ConsentMissingError when no record exists
 *   - requireConsent throws ConsentMissingError when granted = false
 *   - requireConsent resolves when granted = true
 *   - Most-recent record wins (last write wins on revoke/re-grant)
 *   - CONSENT_PURPOSES exports all 4 required purposes
 *   - ConsentMissingError carries the purpose field
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';

// ─── Mock prisma before importing consentService ─────────────────────────────

const mockFindFirst = vi.fn();

vi.mock('../../src/config/db.js', () => ({
  prisma: {
    consentRecord: {
      findFirst: (...args: unknown[]) => mockFindFirst(...args),
      createMany: vi.fn().mockResolvedValue({ count: 4 }),
    },
  },
}));

const { requireConsent, ConsentMissingError, CONSENT_PURPOSES, seedDefaultConsent } =
  await import('../../src/services/consent/consentService.js');

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('DPDP consent gate (BC 13–14)', () => {
  it('CONSENT_PURPOSES contains all 4 required purposes', () => {
    const expected = ['assessment-grading', 'tutor-AI', 'opportunity-matching', 'analytics'];
    for (const p of expected) {
      expect(CONSENT_PURPOSES).toContain(p);
    }
    expect(CONSENT_PURPOSES).toHaveLength(4);
  });

  it('requireConsent throws ConsentMissingError when no record exists', async () => {
    mockFindFirst.mockResolvedValueOnce(null);
    await expect(
      requireConsent('user-1', 'assessment-grading'),
    ).rejects.toBeInstanceOf(ConsentMissingError);
  });

  it('requireConsent throws ConsentMissingError when granted = false (revoked)', async () => {
    mockFindFirst.mockResolvedValueOnce({ userId: 'user-1', purpose: 'tutor-AI', granted: false });
    await expect(
      requireConsent('user-1', 'tutor-AI'),
    ).rejects.toBeInstanceOf(ConsentMissingError);
  });

  it('requireConsent resolves when granted = true', async () => {
    mockFindFirst.mockResolvedValueOnce({ userId: 'user-1', purpose: 'analytics', granted: true });
    await expect(requireConsent('user-1', 'analytics')).resolves.toBeUndefined();
  });

  it('ConsentMissingError carries the purpose field', async () => {
    mockFindFirst.mockResolvedValueOnce(null);
    try {
      await requireConsent('user-2', 'opportunity-matching');
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ConsentMissingError);
      expect((err as ConsentMissingError).purpose).toBe('opportunity-matching');
    }
  });

  it('ConsentMissingError has name ConsentMissingError', async () => {
    mockFindFirst.mockResolvedValueOnce(null);
    try {
      await requireConsent('user-3', 'tutor-AI');
    } catch (err) {
      expect((err as Error).name).toBe('ConsentMissingError');
    }
  });

  it('most-recent record wins: revoked after grant throws', async () => {
    // findFirst with orderBy grantedAt desc returns the most recent: granted=false
    mockFindFirst.mockResolvedValueOnce({ userId: 'user-4', purpose: 'analytics', granted: false });
    await expect(requireConsent('user-4', 'analytics')).rejects.toBeInstanceOf(ConsentMissingError);
  });

  it('most-recent record wins: re-granted after revoke resolves', async () => {
    // Most recent record: granted=true
    mockFindFirst.mockResolvedValueOnce({ userId: 'user-4', purpose: 'analytics', granted: true });
    await expect(requireConsent('user-4', 'analytics')).resolves.toBeUndefined();
  });
});

describe('seedDefaultConsent (BC 13)', () => {
  it('createMany is called with 4 purposes on signup', async () => {
    const { prisma } = await import('../../src/config/db.js');
    const spy = vi.spyOn(prisma.consentRecord, 'createMany');
    await seedDefaultConsent('user-new', '127.0.0.1');
    expect(spy).toHaveBeenCalledOnce();
    const callArg = spy.mock.calls[0]![0] as { data: Array<{ purpose: string; granted: boolean }> };
    expect(callArg.data).toHaveLength(4);
    // All four default to granted = true
    for (const row of callArg.data) {
      expect(row.granted).toBe(true);
    }
    spy.mockRestore();
  });

  it('seedDefaultConsent seeds all 4 purposes', async () => {
    const { prisma } = await import('../../src/config/db.js');
    const spy = vi.spyOn(prisma.consentRecord, 'createMany');
    await seedDefaultConsent('user-x', '10.0.0.1');
    const callArg = spy.mock.calls[0]![0] as { data: Array<{ purpose: string }> };
    const seededPurposes = callArg.data.map((r) => r.purpose).sort();
    expect(seededPurposes).toEqual(
      ['analytics', 'assessment-grading', 'opportunity-matching', 'tutor-AI'],
    );
    spy.mockRestore();
  });
});
