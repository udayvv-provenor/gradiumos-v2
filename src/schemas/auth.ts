import { z } from 'zod';
import { Role } from './common.js';

export const LoginBody = z.object({
  email: z.string().email().toLowerCase(),
  password: z.string().min(8).max(200),
});

export const RefreshBody = z.object({
  refreshToken: z.string().min(10),
});

export const LogoutBody = RefreshBody;

/**
 * HandoffBody — used by the Demo/Honest toggle to mint a fresh token pair
 * on this backend without forcing the user to re-enter credentials.
 */
export const HandoffBody = z.object({
  accessToken: z.string().min(10),
});

export const PublicUser = z.object({
  id: z.string(),
  email: z.string().email(),
  name: z.string(),
  role: Role,
  institutionId: z.string(),
});

export const LoginResponse = z.object({
  user: PublicUser,
  accessToken: z.string(),
  refreshToken: z.string(),
});

export const RefreshResponse = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
});

export const MeResponse = z.object({
  user: PublicUser,
  institution: z.object({
    id: z.string(),
    name: z.string(),
    type: z.string(),
    plan: z.string(),
  }),
  indexVersion: z.object({
    id: z.string(),
    versionTag: z.string(),
    effectiveFrom: z.string(),
  }),
});

export type PublicUser = z.infer<typeof PublicUser>;
export type LoginResponse = z.infer<typeof LoginResponse>;
export type MeResponse = z.infer<typeof MeResponse>;
