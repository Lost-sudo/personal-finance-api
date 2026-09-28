import { z } from 'zod';

export const updateCategorySchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, 'Category name is required')
      .max(100, 'Category name must not exceed 100 characters')
      .optional(),
    type: z.enum(['INCOME', 'EXPENSE']).optional(),
    color: z
      .string()
      .trim()
      .max(20, 'Color must not exceed 20 characters')
      .optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field must be provided',
  });

export type UpdateCategoryDto = z.infer<typeof updateCategorySchema>;
