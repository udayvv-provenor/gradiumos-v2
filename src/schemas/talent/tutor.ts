import { z } from 'zod';

export const StartSessionBody = z.object({
  clusterCode: z.enum(['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8']),
  subtopicCode: z.string().min(1),
});
export type StartSessionBody = z.infer<typeof StartSessionBody>;

export const SessionTurnBody = z.object({
  content: z.string().min(1).max(4000),
});
export type SessionTurnBody = z.infer<typeof SessionTurnBody>;
