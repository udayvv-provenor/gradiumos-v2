import jwt, { type SignOptions } from 'jsonwebtoken';
import crypto from 'node:crypto';
import { env } from '../../config/env.js';
import { AppError } from '../../utils/AppError.js';

export interface AccessClaims {
  sub: string;        // userId
  inst: string;       // institutionId (may be empty string for TA_LEAD)
  role: 'DEAN' | 'PLACEMENT_OFFICER' | 'FACULTY_ADMIN' | 'STUDENT' | 'TA_LEAD' | 'LEARNER' | 'SUPER_ADMIN';
  name: string;
  emp?: string;       // employerId (TA_LEAD only)
}

export interface RefreshClaims {
  sub: string;        // userId
  jti: string;        // token id — matches RefreshToken.id
}

export function signAccess(claims: AccessClaims): string {
  const opts: SignOptions = { expiresIn: env.JWT_ACCESS_TTL as SignOptions['expiresIn'], algorithm: 'HS256' };
  return jwt.sign(claims, env.JWT_ACCESS_SECRET, opts);
}

export function verifyAccess(token: string): AccessClaims {
  try {
    return jwt.verify(token, env.JWT_ACCESS_SECRET, { algorithms: ['HS256'] }) as AccessClaims;
  } catch {
    throw new AppError('AUTH_INVALID', 'Invalid or expired access token');
  }
}

export function signRefresh(claims: RefreshClaims): string {
  const opts: SignOptions = { expiresIn: `${env.JWT_REFRESH_TTL_DAYS}d`, algorithm: 'HS256' };
  return jwt.sign(claims, env.JWT_REFRESH_SECRET, opts);
}

export function verifyRefresh(token: string): RefreshClaims {
  try {
    return jwt.verify(token, env.JWT_REFRESH_SECRET, { algorithms: ['HS256'] }) as RefreshClaims;
  } catch {
    throw new AppError('AUTH_INVALID', 'Invalid or expired refresh token');
  }
}

export function hashToken(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex');
}
