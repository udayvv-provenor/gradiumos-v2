/**
 * Ed25519 signer for GradiumOS Signal portable tokens.
 * Key material lives in env (SIGNAL_PRIVATE_KEY_HEX, SIGNAL_PUBLIC_KEY_HEX) or is
 * generated once at startup and persisted to `backend/.keys/ed25519.*`.
 *
 * Token shape (base64url(JSON header).base64url(JSON payload).base64url(sig)).
 *   header  : { "alg": "Ed25519", "typ": "GRADIUM-SIGNAL", "kid": <first 8 of pub hex> }
 *   payload : { sub, cluster, iat, exp, score, confidence, freshness, versionTag }
 */

import { ed25519 } from '@noble/curves/ed25519';
import fs from 'node:fs';
import path from 'node:path';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';

const KEY_DIR = path.resolve(process.cwd(), '.keys');
const PRIV_PATH = path.join(KEY_DIR, 'ed25519.priv');
const PUB_PATH  = path.join(KEY_DIR, 'ed25519.pub');

let cachedPriv: Uint8Array | null = null;
let cachedPub: Uint8Array | null = null;

function ensureKeys(): { priv: Uint8Array; pub: Uint8Array } {
  if (cachedPriv && cachedPub) return { priv: cachedPriv, pub: cachedPub };

  if (env.SIGNAL_PRIVATE_KEY_HEX && env.SIGNAL_PUBLIC_KEY_HEX) {
    cachedPriv = hexToBytes(env.SIGNAL_PRIVATE_KEY_HEX);
    cachedPub  = hexToBytes(env.SIGNAL_PUBLIC_KEY_HEX);
    return { priv: cachedPriv, pub: cachedPub };
  }

  if (fs.existsSync(PRIV_PATH) && fs.existsSync(PUB_PATH)) {
    cachedPriv = hexToBytes(fs.readFileSync(PRIV_PATH, 'utf8').trim());
    cachedPub  = hexToBytes(fs.readFileSync(PUB_PATH, 'utf8').trim());
    return { priv: cachedPriv, pub: cachedPub };
  }

  // Generate, persist (dev only).
  if (!fs.existsSync(KEY_DIR)) fs.mkdirSync(KEY_DIR, { recursive: true });
  const priv = ed25519.utils.randomPrivateKey();
  const pub  = ed25519.getPublicKey(priv);
  fs.writeFileSync(PRIV_PATH, bytesToHex(priv), { mode: 0o600 });
  fs.writeFileSync(PUB_PATH,  bytesToHex(pub),  { mode: 0o644 });
  logger.warn({ keyDir: KEY_DIR }, 'Ed25519 signal keypair generated and persisted (dev mode).');
  cachedPriv = priv; cachedPub = pub;
  return { priv, pub };
}

export function publicKeyHex(): string {
  return bytesToHex(ensureKeys().pub);
}

export function publicKeyKid(): string {
  return publicKeyHex().slice(0, 8);
}

export interface SignalPayload {
  sub: string;          // learnerId
  cluster: string;      // C1..C8
  score: number;        // scoreWeighted 0..100
  confidence: number;   // 0..1
  freshness: number;    // 0..1
  versionTag: string;   // IndexVersion.versionTag
  iat: number;          // unix seconds
  exp: number;          // unix seconds (iat + 2y by default)
}

export function signPayload(payload: Omit<SignalPayload, 'iat' | 'exp'>, ttlSeconds = 60 * 60 * 24 * 365 * 2): string {
  const { priv } = ensureKeys();
  const iat = Math.floor(Date.now() / 1000);
  const full: SignalPayload = { ...payload, iat, exp: iat + ttlSeconds };
  const header = { alg: 'Ed25519', typ: 'GRADIUM-SIGNAL', kid: publicKeyKid() };
  const h = b64url(Buffer.from(JSON.stringify(header)));
  const p = b64url(Buffer.from(JSON.stringify(full)));
  const signingInput = `${h}.${p}`;
  const sig = ed25519.sign(new TextEncoder().encode(signingInput), priv);
  return `${signingInput}.${b64url(Buffer.from(sig))}`;
}

/**
 * Sign an arbitrary JSON payload with the Ed25519 key pair.
 * The `typ` field in the header differentiates token types:
 *   'signal'       — portable cluster export (BC 89)
 *   'board-brief'  — board-facing summary (BC 90)
 * Returns a header.payload.signature token (same format as signPayload).
 */
export function signCustomPayload(
  headerTyp: string,
  payloadObj: Record<string, unknown>,
  ttlSeconds = 60 * 60 * 24 * 365 * 2,
): { token: string; iat: number; exp: number } {
  const { priv } = ensureKeys();
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + ttlSeconds;
  const header = { alg: 'Ed25519', typ: headerTyp, kid: publicKeyKid() };
  const full = { ...payloadObj, iat, exp };
  const h = b64url(Buffer.from(JSON.stringify(header)));
  const p = b64url(Buffer.from(JSON.stringify(full)));
  const signingInput = `${h}.${p}`;
  const sig = ed25519.sign(new TextEncoder().encode(signingInput), priv);
  const token = `${signingInput}.${b64url(Buffer.from(sig))}`;
  return { token, iat, exp };
}

export function verifyToken(token: string): SignalPayload | null {
  try {
    const [h, p, s] = token.split('.');
    if (!h || !p || !s) return null;
    const { pub } = ensureKeys();
    const signingInput = `${h}.${p}`;
    const sig = Buffer.from(s, 'base64url');
    const ok = ed25519.verify(sig, new TextEncoder().encode(signingInput), pub);
    if (!ok) return null;
    const payload = JSON.parse(Buffer.from(p, 'base64url').toString('utf8')) as SignalPayload;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

function b64url(buf: Buffer): string {
  return buf.toString('base64url');
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.replace(/^0x/i, '');
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function bytesToHex(b: Uint8Array): string {
  return Array.from(b).map((x) => x.toString(16).padStart(2, '0')).join('');
}
