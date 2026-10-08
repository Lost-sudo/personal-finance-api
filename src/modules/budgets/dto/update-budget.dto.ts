import { z } from 'zod';

export const updateBudgetSchema = z
  .strictObject({
    name: z
      .string()
      .trim()
      .min(1, 'Budget name is required')
      .max(100, 'Budget name must not exceed 100 characters')
      .optional(),
    categoryId: z.uuid('categoryId must be a valid UUID').optional(),
    amount: z
      .number()
      .positive('Amount must be positive')
      .refine(
        (value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-9,
        'Amount must have at most 2 decimal places',
      )
      .optional(),
    period: z.enum(['WEEKLY', 'MONTHLY', 'YEARLY', 'CUSTOM']).optional(),
    startDate: z.iso.datetime('startDate must be a valid DateTime').optional(),
    endDate: z.iso.datetime('endDate must be a valid DateTime').optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field must be provided',
  })
  .refine(
    (value) =>
      value.startDate === undefined ||
      value.endDate === undefined ||
      new Date(value.startDate) < new Date(value.endDate),
    {
      message: 'startDate must be before endDate',
      path: ['startDate'],
    },
  );

export type UpdateBudgetDto = z.infer<typeof updateBudgetSchema>;
