/**
 * AuditLog middleware helpers (BC 15–16)
 *
 * withAudit  — wraps any write operation; captures before/after
 * auditCreate — convenience wrapper where before=null (BC 16: creates have no prior state)
 *
 * BC 16 rules:
 *   create  → before: null,  after: <result>
 *   update  → before: <snapshot>, after: <result>
 *   delete  → before: <snapshot>, after: null  (caller passes after:null explicitly)
 */
import { Prisma } from '@prisma/client';
import { prisma } from '../config/db.js';

// For Json? (nullable) columns in Prisma 5, Prisma.DbNull = SQL NULL.
// Prisma.JsonNull would store a JSON-literal null value inside the column instead.
function toJson(value: object | null | undefined): Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput {
  if (value == null) return Prisma.DbNull;
  return value as Prisma.InputJsonValue;
}

export async function withAudit<T>(opts: {
  userId?: string;
  action: string;
  entityType: string;
  entityId: string;
  before?: object | null;
  /** Override the logged `after` value. Pass null for hard-deletes (BC 16). */
  after?: object | null;
  fn: () => Promise<T>;
}): Promise<T> {
  const result = await opts.fn();
  const afterValue = 'after' in opts ? opts.after : (result as object | null | undefined);
  await prisma.auditLog.create({
    data: {
      userId: opts.userId ?? null,
      action: opts.action,
      entityType: opts.entityType,
      entityId: opts.entityId,
      before: toJson(opts.before),
      after: toJson(afterValue),
      createdAt: new Date(),
    },
  });
  return result;
}

/** Convenience helper: before is always null (create scenario). */
export async function auditCreate<T>(opts: {
  userId?: string;
  action: string;
  entityType: string;
  entityId: string;
  fn: () => Promise<T>;
}): Promise<T> {
  return withAudit({ ...opts, before: null });
}
