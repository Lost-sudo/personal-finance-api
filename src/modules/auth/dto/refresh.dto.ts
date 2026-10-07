import { z } from 'zod';

// Token via httpOnly cookie (primary) or body; body optional, strict.
export const refreshSchema = z
  .strictObject({
    refreshToken: z.string().trim().min(1).max(4096).optional(),
  })
  .optional()
  .default({});

export type RefreshDto = z.infer<typeof refreshSchema>;
