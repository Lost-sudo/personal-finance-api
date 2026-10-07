import { z } from 'zod';

export const createCategorySchema = z.strictObject({
  name: z
    .string()
    .trim()
    .min(1, 'Category name is required')
    .max(100, 'Category name must not exceed 100 characters'),
  type: z.enum(['INCOME', 'EXPENSE']),
  color: z
    .string()
    .trim()
    .max(20, 'Color must not exceed 20 characters')
    .optional(),
});

export type CreateCategoryDto = z.infer<typeof createCategorySchema>;
