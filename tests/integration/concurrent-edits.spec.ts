/**
 * BC 160 — Concurrent-edit / optimistic-concurrency integration test.
 *
 * Skipped by default — requires a seeded DB and a running backend.
 * Run with: ENABLE_CONCURRENT_TESTS=1 vitest run tests/integration/concurrent-edits.spec.ts
 *
 * Expected scenario:
 *   Two TA_LEAD sessions fetch the same EmployerRole at version=N.
 *   Both submit PATCH /api/v1/workforce/roles/:id/targets with their own changes.
 *   The first update succeeds (version increments to N+1).
 *   The second update should return 409 STALE_VERSION because version is now N+1.
 */
import { describe, it } from 'vitest';

describe.skip('Concurrent edits (requires DB)', () => {
  it.todo(
    'first TA_LEAD update succeeds and increments role version to N+1',
  );

  it.todo(
    'second TA_LEAD update (still on version=N) returns 409 STALE_VERSION',
  );

  it.todo(
    'after conflict, re-fetching the role returns version N+1 with first update applied',
  );

  it.todo(
    'AuditLog has exactly one targets_overridden entry for the role after the conflict',
  );
});
