/**
 * Verify Signal — thin wrapper over existing tokenSigner.verifyToken.
 */
import { verifyToken as verifySignal } from '../signal/tokenSigner.js';

export function verifyToken(token: string): { ok: boolean; payload?: unknown; error?: string } {
  const raw = (token ?? '').trim();
  if (!raw) return { ok: false, error: 'empty token' };
  const payload = verifySignal(raw);
  if (!payload) return { ok: false, error: 'invalid signature or expired' };
  return {
    ok: true,
    payload: {
      learnerId: payload.sub,
      cluster: payload.cluster,
      score: payload.score,
      confidence: payload.confidence,
      freshness: payload.freshness,
      versionTag: payload.versionTag,
      issuedAt: new Date(payload.iat * 1000).toISOString(),
      expiresAt: new Date(payload.exp * 1000).toISOString(),
    },
  };
}
