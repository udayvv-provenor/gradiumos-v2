/**
 * BC 16 — AuditLog before/after null rules
 *
 * create  → before: null,  after: <result>
 * update  → before: <snap>, after: <result>
 * delete  → before: <snap>, after: null
 */
import { describe, it, expect, vi, type Mock } from 'vitest';
import { Prisma } from '@prisma/client';

// ── Mock prisma before importing the module under test ────────────────────────
const mockCreate = vi.fn().mockResolvedValue({});

vi.mock('../../src/config/db.js', () => ({
  prisma: {
    auditLog: { create: (...args: unknown[]) => mockCreate(...args) },
  },
}));

const { withAudit, auditCreate } = await import('../../src/middleware/audit.js');

// ── Helpers ───────────────────────────────────────────────────────────────────

function capturedData(): Record<string, unknown> {
  return (mockCreate as Mock).mock.calls[0][0].data as Record<string, unknown>;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('AuditLog before/after rules (BC 16)', () => {
  it('create — before is null, after is the created entity', async () => {
    mockCreate.mockClear();
    const entity = { id: 'ent-1', name: 'Test' };

    await auditCreate({
      action: 'entity_created',
      entityType: 'Widget',
      entityId: 'ent-1',
      fn: async () => entity,
    });

    const data = capturedData();
    expect(data.before).toBe(Prisma.DbNull);
    expect(data.after).toEqual(entity);
  });

  it('update — both before and after are populated', async () => {
    mockCreate.mockClear();
    const before = { id: 'ent-2', status: 'Draft' };
    const after  = { id: 'ent-2', status: 'Active' };

    await withAudit({
      action: 'entity_updated',
      entityType: 'Widget',
      entityId: 'ent-2',
      before,
      fn: async () => after,
    });

    const data = capturedData();
    expect(data.before).toEqual(before);
    expect(data.after).toEqual(after);
  });

  it('hard-delete — before is the snapshot, after is null', async () => {
    mockCreate.mockClear();
    const snapshot = { id: 'ent-3', name: 'ToDelete' };

    await withAudit({
      action: 'entity_deleted',
      entityType: 'Widget',
      entityId: 'ent-3',
      before: snapshot,
      after: null,           // caller explicitly passes null for hard-delete
      fn: async () => snapshot,
    });

    const data = capturedData();
    expect(data.before).toEqual(snapshot);
    expect(data.after).toBe(Prisma.DbNull);
  });
});
