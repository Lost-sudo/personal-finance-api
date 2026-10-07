import { z } from 'zod';

export const registerSchema = z.strictObject({
  // Trim before the format check so padded emails are accepted.
  email: z
    .string()
    .trim()
    .pipe(z.email())
    .transform((value) => value.toLowerCase()),
  password: z.string().min(8).max(128),
  firstName: z.string().trim().min(1).max(50),
  lastName: z.string().trim().min(1).max(50),
});

export type RegisterDto = z.infer<typeof registerSchema>;
