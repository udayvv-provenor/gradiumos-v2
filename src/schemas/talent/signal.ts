import { z } from 'zod';

export const GenerateSignalBody = z.object({
  careerTrackId: z.string().min(1),
});
export type GenerateSignalBody = z.infer<typeof GenerateSignalBody>;
