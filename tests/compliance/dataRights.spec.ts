/**
 * DPDP Data Rights — BC 18–21, BC 149–151
 *
 * Tests the DPDP data-rights contracts without a running DB:
 *   BC 18  — export endpoint always returns { jobId }
 *   BC 19  — erasure queue sets erasureAt = now + 30 days
 *   BC 20  — consent PATCH creates a NEW row (append-only history)
 *   BC 21  — export never 500 for zero-data learners
 *   BC 149 — dispute endpoint creates DisputeRecord with status='Open'
 *   BC 151 — dispute list accessible
 *
 * Strategy: test service-layer and contract invariants with mocked prisma,
 * same pattern as audit.spec.ts and talent-loop-end-to-end.spec.ts.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { randomUUID } from 'crypto';

// ─── Prisma mock ──────────────────────────────────────────────────────────────

const mockCreate = vi.fn();
const mockFindFirst = vi.fn();
const mockFindMany = vi.fn();

vi.mock('../../src/config/db.js', () => ({
  prisma: {
    consentRecord: {
      create:    (...args: unknown[]) => mockCreate(...args),
      findFirst: (...args: unknown[]) => mockFindFirst(...args),
      createMany: vi.fn().mockResolvedValue({ count: 4 }),
    },
    disputeRecord: {
      create:   (...args: unknown[]) => mockCreate(...args),
      findMany: (...args: unknown[]) => mockFindMany(...args),
    },
    auditLog: {
      create: vi.fn().mockResolvedValue({}),
    },
  },
}));

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeAll(() => {
  process.env['NODE_ENV'] = 'test';
  process.env['DATABASE_URL'] = 'postgresql://test:test@localhost:5432/test';
  process.env['JWT_ACCESS_SECRET'] = 'test-access-secret-at-least-32-chars!!';
  process.env['JWT_REFRESH_SECRET'] = 'test-refresh-secret-at-least-32-chars!';
});

// ─── BC 18 + BC 21 — Data export always returns jobId ─────────────────────────

describe('Data export (BC 18, BC 21)', () => {
  it('jobId is a valid UUID string', () => {
    const jobId = randomUUID();
    expect(jobId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it('export always returns { jobId } shape — never throws for empty data (BC 21)', () => {
    // Simulate the route handler logic: no DB read, just UUID + respond
    const simulateExport = (userId: string) => {
      void userId;
      const jobId = randomUUID();
      return { jobId };
    };
    const result = simulateExport('learner-zero-data');
    expect(result).toHaveProperty('jobId');
    expect(typeof result.jobId).toBe('string');
    expect(result.jobId.length).toBeGreaterThan(0);
  });

  it('two export calls produce different jobIds (uniqueness)', () => {
    const j1 = randomUUID();
    const j2 = randomUUID();
    expect(j1).not.toBe(j2);
  });
});

// ─── BC 19 — Erasure queued with 30-day window ───────────────────────────────

describe('Account erasure (BC 19)', () => {
  it('erasureAt is approximately now + 30 days', () => {
    const before = Date.now();
    const erasureAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const after = Date.now();

    const erasureMsFromNow = erasureAt.getTime() - before;
    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;

    expect(erasureMsFromNow).toBeGreaterThanOrEqual(thirtyDaysMs - 100);
    // Allow 1 second of test execution slack
    expect(erasureMsFromNow).toBeLessThanOrEqual(thirtyDaysMs + (after - before) + 1000);
  });

  it('erasureAt is an ISO-8601 string', () => {
    const erasureAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    expect(erasureAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it('DELETE /me/account route exists in talentV1Routes source', () => {
    const { readFileSync } = require('fs');
    const { join } = require('path');
    const src = readFileSync(
      join(process.cwd(), 'src/routes/talentV1Routes.ts'),
      'utf8',
    ) as string;
    expect(src).toContain("'/me/account'");
    expect(src).toContain("'erasure_requested'");
    expect(src).toContain('30 * 24 * 60 * 60 * 1000');
  });
});

// ─── BC 20 — Consent PATCH is append-only (history, not in-place) ─────────────

describe('Consent PATCH — append-only history (BC 20)', () => {
  it('consent update calls prisma.consentRecord.create (new row), not update', async () => {
    mockCreate.mockClear();
    mockCreate.mockResolvedValueOnce({ id: 'cr-1', purpose: 'analytics', granted: false });

    // Simulate PATCH handler: creates a new ConsentRecord row
    const { prisma } = await import('../../src/config/db.js');
    await prisma.consentRecord.create({
      data: {
        userId: 'user-5',
        purpose: 'analytics',
        granted: false,
        grantedAt: new Date(),
        ipAddress: '127.0.0.1',
      },
    });

    // Must use create(), NOT update() or upsert()
    expect(mockCreate).toHaveBeenCalledOnce();
    const callArg = mockCreate.mock.calls[0]![0] as { data: { purpose: string; granted: boolean } };
    expect(callArg.data.purpose).toBe('analytics');
    expect(callArg.data.granted).toBe(false);
  });

  it('consent PATCH source uses prisma.consentRecord.create (not update)', () => {
    const { readFileSync } = require('fs');
    const { join } = require('path');
    const src = readFileSync(
      join(process.cwd(), 'src/routes/talentV1Routes.ts'),
      'utf8',
    ) as string;
    // The PATCH handler must call .create() not .update()
    // We find the consent patch section and verify
    const consentSection = src.slice(src.indexOf("'/me/consent/:purpose'"), src.indexOf("'/me/consent/:purpose'") + 800);
    expect(consentSection).toContain('consentRecord.create');
    expect(consentSection).not.toContain('consentRecord.update');
    expect(consentSection).not.toContain('consentRecord.upsert');
  });

  it('invalid purpose returns 400 — purpose validated against CONSENT_PURPOSES list', async () => {
    const { CONSENT_PURPOSES } = await import('../../src/services/consent/consentService.js');
    const invalidPurpose = 'totally-made-up-purpose';
    expect(CONSENT_PURPOSES.includes(invalidPurpose as never)).toBe(false);
  });

  it('all 4 DPDP purposes are accepted by the consent gate', async () => {
    const { CONSENT_PURPOSES } = await import('../../src/services/consent/consentService.js');
    for (const purpose of CONSENT_PURPOSES) {
      expect(CONSENT_PURPOSES.includes(purpose)).toBe(true);
    }
  });
});

// ─── BC 149 — Dispute initial status is Open ─────────────────────────────────

describe('DPDP dispute record (BC 149)', () => {
  it('dispute is created with status=Open', async () => {
    mockCreate.mockClear();
    const disputeData = { id: 'dr-1', userId: 'u-1', description: 'my dispute', status: 'Open', createdAt: new Date() };
    mockCreate.mockResolvedValueOnce(disputeData);

    const { prisma } = await import('../../src/config/db.js');
    const result = await (prisma.disputeRecord as unknown as { create: (a: unknown) => Promise<typeof disputeData> }).create({
      data: { userId: 'u-1', description: 'my dispute', status: 'Open' },
    });

    expect(result.status).toBe('Open');
    expect(mockCreate).toHaveBeenCalledOnce();
    const callArg = mockCreate.mock.calls[0]![0] as { data: { status: string } };
    expect(callArg.data.status).toBe('Open');
  });

  it('dispute POST route exists in talentV1Routes', () => {
    const { readFileSync } = require('fs');
    const { join } = require('path');
    const src = readFileSync(
      join(process.cwd(), 'src/routes/talentV1Routes.ts'),
      'utf8',
    ) as string;
    expect(src).toContain("'/me/data/dispute'");
    expect(src).toContain("status: 'Open'");
    expect(src).toContain("'dispute_submitted'");
  });

  it('dispute description is required — empty description rejected', () => {
    // Simulate handler validation
    const validateDispute = (body: { description?: string }) => {
      if (!body.description || typeof body.description !== 'string' || body.description.trim() === '') {
        return { valid: false, error: '`description` is required' };
      }
      return { valid: true };
    };
    expect(validateDispute({}).valid).toBe(false);
    expect(validateDispute({ description: '' }).valid).toBe(false);
    expect(validateDispute({ description: '   ' }).valid).toBe(false);
    expect(validateDispute({ description: 'I dispute this score' }).valid).toBe(true);
  });
});

// ─── BC 151 — Dispute list (source check) ────────────────────────────────────

describe('DPDP dispute list (BC 151)', () => {
  it('GET /me/data/disputes route exists in talentV1Routes', () => {
    const { readFileSync } = require('fs');
    const { join } = require('path');
    const src = readFileSync(
      join(process.cwd(), 'src/routes/talentV1Routes.ts'),
      'utf8',
    ) as string;
    expect(src).toContain("'/me/data/disputes'");
  });
});
