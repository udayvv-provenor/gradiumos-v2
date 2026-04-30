/**
 * BC 6-9 — Ed25519 signing round-trip, tamper detection, expiry, and key
 * rotation concept tests.
 *
 * We use dynamic imports so that env vars are set in process.env BEFORE
 * tokenSigner (and its transitive dep env.ts) are evaluated.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { ed25519 } from '@noble/curves/ed25519';

// ─── helpers ────────────────────────────────────────────────────────────────

const toHex = (b: Uint8Array) =>
  Array.from(b).map(x => x.toString(16).padStart(2, '0')).join('');

function samplePayload() {
  return {
    sub:        'learner-test-001',
    cluster:    'C1',
    score:      75,
    confidence: 0.82,
    freshness:  0.9,
    versionTag: 'v1.2',
  } as const;
}

// ─── dynamically-loaded module refs ─────────────────────────────────────────

type SignFn    = typeof import('../../src/services/signal/tokenSigner.js').signPayload;
type VerifyFn  = typeof import('../../src/services/signal/tokenSigner.js').verifyToken;
type KidFn     = typeof import('../../src/services/signal/tokenSigner.js').publicKeyKid;

let signPayload:   SignFn;
let verifyToken:   VerifyFn;
let publicKeyKid:  KidFn;
let pubHex: string;

// ─── test key material ──────────────────────────────────────────────────────

const testPrivBytes = ed25519.utils.randomPrivateKey();
const testPubBytes  = ed25519.getPublicKey(testPrivBytes);
const testPrivHex   = toHex(testPrivBytes);
const testPubHex    = toHex(testPubBytes);

// ─── setup ──────────────────────────────────────────────────────────────────

beforeAll(async () => {
  // Set ALL required env vars before the first dynamic import so that
  // env.ts (which calls process.exit on invalid env) parses cleanly.
  process.env['NODE_ENV']               = 'test';
  process.env['DATABASE_URL']           = 'postgresql://test:test@localhost:5432/test';
  process.env['JWT_ACCESS_SECRET']      = 'test-access-secret-at-least-32-chars!!';
  process.env['JWT_REFRESH_SECRET']     = 'test-refresh-secret-at-least-32-chars!';
  process.env['SIGNAL_PRIVATE_KEY_HEX'] = testPrivHex;
  process.env['SIGNAL_PUBLIC_KEY_HEX']  = testPubHex;

  // Dynamic import: modules are evaluated AFTER the env vars above are set.
  const mod = await import('../../src/services/signal/tokenSigner.js');
  signPayload  = mod.signPayload;
  verifyToken  = mod.verifyToken;
  publicKeyKid = mod.publicKeyKid;
  pubHex       = testPubHex;
});

// ─────────────────────────────────────────────────────────────────────────────
// BC 6 — Round-trip
// ─────────────────────────────────────────────────────────────────────────────

describe('Ed25519 signing (BC 6-9)', () => {

  describe('BC 6 — round-trip', () => {
    it('signPayload → verifyToken returns identical payload fields', () => {
      const token   = signPayload(samplePayload());
      const payload = verifyToken(token);
      expect(payload).not.toBeNull();
      expect(payload!.sub).toBe('learner-test-001');
      expect(payload!.cluster).toBe('C1');
      expect(payload!.score).toBe(75);
      expect(payload!.confidence).toBe(0.82);
      expect(payload!.freshness).toBe(0.9);
      expect(payload!.versionTag).toBe('v1.2');
    });

    it('token has three dot-separated segments', () => {
      const token = signPayload(samplePayload());
      expect(token.split('.').length).toBe(3);
    });

    it('iat is recent (within 5 seconds)', () => {
      const before  = Math.floor(Date.now() / 1000);
      const token   = signPayload(samplePayload());
      const after   = Math.floor(Date.now() / 1000);
      const payload = verifyToken(token)!;
      expect(payload.iat).toBeGreaterThanOrEqual(before);
      expect(payload.iat).toBeLessThanOrEqual(after);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // BC 7 — Tamper detection
  // ─────────────────────────────────────────────────────────────────────────

  describe('BC 7 — tamper detection', () => {
    function flipChar(s: string, idx: number): string {
      const chars = s.split('');
      chars[idx] = chars[idx] === 'A' ? 'B' : 'A';
      return chars.join('');
    }

    it('tampered header returns null', () => {
      const token = signPayload(samplePayload());
      const [h, p, s] = token.split('.');
      expect(verifyToken(`${flipChar(h!, 4)}.${p}.${s}`)).toBeNull();
    });

    it('tampered payload returns null', () => {
      const token = signPayload(samplePayload());
      const [h, p, s] = token.split('.');
      expect(verifyToken(`${h}.${flipChar(p!, 4)}.${s}`)).toBeNull();
    });

    it('tampered signature returns null', () => {
      const token = signPayload(samplePayload());
      const [h, p, s] = token.split('.');
      expect(verifyToken(`${h}.${p}.${flipChar(s!, 4)}`)).toBeNull();
    });

    it('completely invalid token returns null', () => {
      expect(verifyToken('not.a.token')).toBeNull();
      expect(verifyToken('')).toBeNull();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // BC 8 — Expiry
  // ─────────────────────────────────────────────────────────────────────────

  describe('BC 8 — expiry', () => {
    it('expired token (ttlSeconds = -1) returns null', () => {
      const token = signPayload(samplePayload(), -1);
      expect(verifyToken(token)).toBeNull();
    });

    it('pre-expiry token (ttlSeconds = 60) returns payload', () => {
      const token = signPayload(samplePayload(), 60);
      expect(verifyToken(token)).not.toBeNull();
    });

    it('default TTL token verifies and exp is ~2 years out', () => {
      const token   = signPayload(samplePayload());
      const payload = verifyToken(token);
      expect(payload).not.toBeNull();
      const twoYears = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 365 * 2;
      expect(payload!.exp).toBeGreaterThan(Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 300);
      expect(payload!.exp).toBeLessThanOrEqual(twoYears + 10);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // BC 9 — Key rotation concept
  // ─────────────────────────────────────────────────────────────────────────

  describe('BC 9 — key rotation concept', () => {
    it('kid is first 8 hex chars of the configured public key', () => {
      const kid = publicKeyKid();
      expect(kid).toBe(pubHex.slice(0, 8));
    });

    it('token header embeds the correct kid', () => {
      const token     = signPayload(samplePayload());
      const kid       = publicKeyKid();
      const headerRaw = token.split('.')[0]!;
      const header    = JSON.parse(Buffer.from(headerRaw, 'base64url').toString('utf8'));
      expect(header.kid).toBe(kid);
    });

    it('multiple tokens signed with same key all verify', () => {
      const tokens = Array.from({ length: 5 }, (_, i) =>
        signPayload({ ...samplePayload(), sub: `learner-${i}` }),
      );
      for (const t of tokens) {
        expect(verifyToken(t)).not.toBeNull();
      }
    });
  });
});
