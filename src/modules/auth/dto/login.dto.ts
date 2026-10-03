import { z } from "zod";

export const loginSchema = z.object({
    email: z.string().trim().pipe(z.email()).transform((value) => value.toLowerCase()),
    password: z.string().min(1).max(128),
})

export type LoginDto = z.infer<typeof loginSchema>;