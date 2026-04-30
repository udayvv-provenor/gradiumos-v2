import { z } from 'zod';

export const VerifyBody = z.object({
  token: z.string().min(10).max(8192),
});

export type VerifyBody = z.infer<typeof VerifyBody>;
