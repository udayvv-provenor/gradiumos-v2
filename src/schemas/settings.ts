import { z } from 'zod';
import { Role } from './common.js';

export const SettingsResponse = z.object({
  institution: z.object({
    id: z.string(),
    name: z.string(),
    type: z.string(),
    enrolledLearners: z.number().int(),
    tracks: z.array(z.object({ id: z.string(), name: z.string() })),
    cohorts: z.array(z.object({ id: z.string(), name: z.string(), trackName: z.string() })),
  }),
  plan: z.object({
    name: z.string(),
    validUntil: z.string(),
    features: z.array(z.string()),
  }),
  users: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      email: z.string(),
      role: Role,
    }),
  ),
  indexVersion: z.object({
    id: z.string(),
    versionTag: z.string(),
    effectiveFrom: z.string(),
    locked: z.boolean(),
  }),
});

export type SettingsResponse = z.infer<typeof SettingsResponse>;
