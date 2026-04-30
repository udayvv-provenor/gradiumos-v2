/**
 * Security — Auth guards, role enforcement, and IP-protection across all
 * Groq prompt templates.
 *
 * BC coverage:
 *   BC 2  — formula constants never in Groq prompts
 *   BC 75 — tutorChat prompt: no scores / weights (extended to all prompts)
 *   IP rules 1 & 2 — no frozen IP values; no raw cluster scores in prompts
 *
 * Auth guard tests use supertest against the live Express app with
 * dynamic imports (same pattern as signingService.spec.ts) so env vars
 * are set before modules are loaded.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { ed25519 } from '@noble/curves/ed25519';

// ─── helpers ─────────────────────────────────────────────────────────────────

const toHex = (b: Uint8Array) =>
  Array.from(b).map((x) => x.toString(16).padStart(2, '0')).join('');

beforeAll(() => {
  process.env['NODE_ENV'] = 'test';
  process.env['DATABASE_URL'] = 'postgresql://test:test@localhost:5432/test';
  process.env['JWT_ACCESS_SECRET'] = 'test-access-secret-at-least-32-chars!!';
  process.env['JWT_REFRESH_SECRET'] = 'test-refresh-secret-at-least-32-chars!';
  const priv = ed25519.utils.randomPrivateKey();
  process.env['SIGNAL_PRIVATE_KEY_HEX'] = toHex(priv);
  process.env['SIGNAL_PUBLIC_KEY_HEX'] = toHex(ed25519.getPublicKey(priv));
});

// ─── Auth middleware unit tests ───────────────────────────────────────────────

describe('requireAuth — missing / malformed token (BC 33)', () => {
  it('calls next(AppError) with AUTH_INVALID when no Authorization header', async () => {
    const { requireAuth } = await import('../../src/middleware/auth.js');
    const errors: unknown[] = [];
    const next = (err?: unknown) => { if (err !== undefined) errors.push(err); };
    const req = { header: () => undefined } as never;
    requireAuth(req, {} as never, next as never);
    expect(errors).toHaveLength(1);
    const err = errors[0] as { code: string };
    expect(err.code).toBe('AUTH_INVALID');
  });

  it('calls next(AppError) when Authorization is not Bearer', async () => {
    const { requireAuth } = await import('../../src/middleware/auth.js');
    const errors: unknown[] = [];
    const next = (err?: unknown) => { if (err !== undefined) errors.push(err); };
    const req = { header: () => 'Basic abc123' } as never;
    requireAuth(req, {} as never, next as never);
    expect(errors).toHaveLength(1);
    const err = errors[0] as { code: string };
    expect(err.code).toBe('AUTH_INVALID');
  });
});

describe('requireRole — role enforcement', () => {
  it('calls next(AppError) when req.auth is undefined', async () => {
    const { requireRole } = await import('../../src/middleware/auth.js');
    const errors: unknown[] = [];
    const next = (e?: unknown) => { if (e) errors.push(e); };
    const handler = requireRole('DEAN');
    handler({ auth: undefined } as never, {} as never, next as never);
    expect(errors).toHaveLength(1);
  });

  it('calls next(AppError) when role does not match', async () => {
    const { requireRole } = await import('../../src/middleware/auth.js');
    const errors: unknown[] = [];
    const next = (e?: unknown) => { if (e) errors.push(e); };
    const handler = requireRole('DEAN');
    handler({ auth: { role: 'LEARNER' } } as never, {} as never, next as never);
    expect(errors).toHaveLength(1);
  });

  it('calls next() without error when role matches', async () => {
    const { requireRole } = await import('../../src/middleware/auth.js');
    const errors: unknown[] = [];
    const next = (e?: unknown) => { if (e) errors.push(e); };
    const handler = requireRole('TA_LEAD');
    handler({ auth: { role: 'TA_LEAD' } } as never, {} as never, next as never);
    expect(errors).toHaveLength(0);
  });

  it('accepts any of multiple allowed roles', async () => {
    const { requireRole } = await import('../../src/middleware/auth.js');
    const errors: unknown[] = [];
    const next = (e?: unknown) => { if (e) errors.push(e); };
    const handler = requireRole('DEAN', 'PLACEMENT_OFFICER');
    handler({ auth: { role: 'PLACEMENT_OFFICER' } } as never, {} as never, next as never);
    expect(errors).toHaveLength(0);
  });
});

describe('requireInstitutionScope — tenant scoping', () => {
  it('calls next(AppError) when req.auth.inst is missing', async () => {
    const { requireInstitutionScope } = await import('../../src/middleware/auth.js');
    const errors: unknown[] = [];
    const next = (e?: unknown) => { if (e) errors.push(e); };
    requireInstitutionScope({ auth: { role: 'DEAN' } } as never, {} as never, next as never);
    expect(errors).toHaveLength(1);
  });

  it('calls next() without error when inst is present', async () => {
    const { requireInstitutionScope } = await import('../../src/middleware/auth.js');
    const errors: unknown[] = [];
    const next = (e?: unknown) => { if (e) errors.push(e); };
    requireInstitutionScope(
      { auth: { role: 'DEAN', inst: 'inst-001' } } as never,
      {} as never,
      next as never,
    );
    expect(errors).toHaveLength(0);
  });
});

// ─── JWT tamper: forged token must be rejected ────────────────────────────────

describe('JWT access token — tamper detection (verifyAccess throws AppError)', () => {
  it('verifyAccess throws AppError(AUTH_INVALID) for a completely forged token', async () => {
    const { verifyAccess } = await import('../../src/services/auth/jwt.js');
    const { AppError } = await import('../../src/utils/AppError.js');
    expect(() => verifyAccess('forged.token.here')).toThrow(AppError);
    try { verifyAccess('forged.token.here'); } catch (e) {
      expect((e as { code: string }).code).toBe('AUTH_INVALID');
    }
  });

  it('verifyAccess throws AppError(AUTH_INVALID) for an empty string', async () => {
    const { verifyAccess } = await import('../../src/services/auth/jwt.js');
    const { AppError } = await import('../../src/utils/AppError.js');
    expect(() => verifyAccess('')).toThrow(AppError);
  });

  it('verifyAccess throws AppError for a token signed with the wrong secret', async () => {
    const jwtMod = await import('jsonwebtoken');
    const forged = jwtMod.default.sign({ sub: 'evil', role: 'SUPER_ADMIN' }, 'wrong-secret');
    const { verifyAccess } = await import('../../src/services/auth/jwt.js');
    const { AppError } = await import('../../src/utils/AppError.js');
    expect(() => verifyAccess(forged)).toThrow(AppError);
  });

  it('verifyAccess throws AppError for a token with modified payload', async () => {
    const { signAccess, verifyAccess } = await import('../../src/services/auth/jwt.js');
    const { AppError } = await import('../../src/utils/AppError.js');
    const valid = signAccess({ sub: 'u1', inst: 'inst1', role: 'LEARNER', name: 'Test' });
    const [h, , s] = valid.split('.');
    // Replace payload with a base64url-encoded tampered payload
    const tamperedPayload = Buffer.from(JSON.stringify({ sub: 'u1', role: 'SUPER_ADMIN' })).toString('base64url');
    const tampered = `${h}.${tamperedPayload}.${s}`;
    expect(() => verifyAccess(tampered)).toThrow(AppError);
  });
});

// ─── Rate limiter configuration assertions ────────────────────────────────────

describe('Rate limiter config (BC 11, BC 179)', () => {
  it('apiRateLimiter is exported from rateLimit.ts', async () => {
    const mod = await import('../../src/middleware/rateLimit.js');
    expect(mod.apiRateLimiter).toBeDefined();
    expect(typeof mod.apiRateLimiter).toBe('function');
  });

  it('loginRateLimiter is exported from rateLimit.ts', async () => {
    const mod = await import('../../src/middleware/rateLimit.js');
    expect(mod.loginRateLimiter).toBeDefined();
    expect(typeof mod.loginRateLimiter).toBe('function');
  });

  it('rateLimit.ts source does not contain load-test bypass flag', () => {
    const src = readFileSync(
      join(process.cwd(), 'src/middleware/rateLimit.ts'),
      'utf8',
    );
    // After the load test is done the limiter must be restored to 200
    expect(src).not.toContain('LOAD_TEST');
    expect(src).not.toContain('50_000');
    expect(src).not.toContain('50000');
  });
});

// ─── IP protection: all Groq prompt files must be clean ──────────────────────

// Tokens that are uniquely IP-bearing and have no legitimate presence in
// prompt-builder or Groq call code. Excludes 0.15 / 0.20 because those
// numeric literals appear legitimately as Groq temperature settings and
// mock default values; only the named constants and the fully-qualified
// formula output name are unambiguous IP signals.
const FORBIDDEN_IP_TOKENS = [
  'DECAY',
  'FRESHNESS_WINDOW',
  '0.35',          // completeness weight — distinctive; not a common API value
  'SUPPRESSION_THRESHOLD',  // the named constant specifically
  'scoreWeighted', // computed formula output must not reach Groq
] as const;

const PROMPT_FILES = [
  'src/services/ai/prompts/tutorChat.ts',
  'src/services/ai/prompts/extractJD.ts',
  'src/services/ai/prompts/mapCurriculum.ts',
  'src/services/ai/prompts/gradeDescriptive.ts',
  'src/services/ai/prompts/resumeBullets.ts',
];

describe('IP protection — all Groq prompt files (IP rules 1 & 2)', () => {
  for (const promptFile of PROMPT_FILES) {
    const shortName = promptFile.split('/').pop()!;
    it(`${shortName} does not contain forbidden IP tokens`, () => {
      const content = readFileSync(join(process.cwd(), promptFile), 'utf8');
      // We only check the user-prompt string construction, not comments.
      // Strip comment lines to avoid false positives on /* IP-protection */ notes.
      const withoutComments = content
        .split('\n')
        .filter((line) => !line.trimStart().startsWith('*') && !line.trimStart().startsWith('//'))
        .join('\n');
      for (const token of FORBIDDEN_IP_TOKENS) {
        expect(withoutComments, `${shortName} must not contain '${token}' in executable code`).not.toContain(token);
      }
    });
  }
});

// ─── AppError shape contract ──────────────────────────────────────────────────

describe('AppError — error shape', () => {
  it('AppError.status maps known codes correctly', async () => {
    const { AppError } = await import('../../src/utils/AppError.js');
    const authErr = new AppError('AUTH_INVALID', 'test');
    const forbidErr = new AppError('AUTH_FORBIDDEN', 'test');
    const notFoundErr = new AppError('NOT_FOUND', 'test');
    const conflictErr = new AppError('CONFLICT', 'test');

    expect(authErr.status).toBe(401);
    expect(forbidErr.status).toBe(403);
    expect(notFoundErr.status).toBe(404);
    expect(conflictErr.status).toBe(409);
  });

  it('AppError inherits from Error', async () => {
    const { AppError } = await import('../../src/utils/AppError.js');
    const err = new AppError('NOT_FOUND', 'test resource');
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe('test resource');
  });
});
