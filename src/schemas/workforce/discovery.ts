import { z } from 'zod';
import { Band } from '../common.js';

export const DiscoveryQuery = z.object({
  roleId: z.string().min(1),
  institutionId: z.string().min(1).optional(),
  band: Band.optional(),
  q: z.string().min(1).max(100).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

export type DiscoveryQuery = z.infer<typeof DiscoveryQuery>;
