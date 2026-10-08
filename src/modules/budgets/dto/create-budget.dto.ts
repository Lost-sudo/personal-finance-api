import { z } from 'zod';

export const createBudgetSchema = z
  .strictObject({
    name: z
      .string()
      .trim()
      .min(1, 'Budget name is required')
      .max(100, 'Budget name must not exceed 100 characters'),
    categoryId: z.uuid('categoryId must be a valid UUID'),
    amount: z
      .number({ message: 'Amount is required' })
      .positive('Amount must be positive')
      .refine(
        (value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-9,
        'Amount must have at most 2 decimal places',
      ),
    period: z.enum(['WEEKLY', 'MONTHLY', 'YEARLY', 'CUSTOM']),
    startDate: z.iso.datetime('startDate must be a valid DateTime'),
    endDate: z.iso.datetime('endDate must be a valid DateTime'),
  })
  .refine((value) => new Date(value.startDate) < new Date(value.endDate), {
    message: 'startDate must be before endDate',
    path: ['startDate'],
  });

export type CreateBudgetDto = z.infer<typeof createBudgetSchema>;
