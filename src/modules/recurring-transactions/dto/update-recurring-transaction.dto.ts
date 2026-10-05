import { z } from 'zod';

export const updateRecurringTransactionSchema = z
  .strictObject({
    amount: z
      .number()
      .positive('Amount must be positive')
      .refine(
        (value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-9,
        'Amount must have at most 2 decimal places',
      )
      .optional(),
    description: z
      .string()
      .trim()
      .max(255, 'Description must not exceed 255 characters')
      .optional(),
    accountId: z.uuid('accountId must be a valid UUID').optional(),
    categoryId: z.uuid('categoryId must be a valid UUID').optional(),
    fromAccountId: z.uuid('fromAccountId must be a valid UUID').optional(),
    toAccountId: z.uuid('toAccountId must be a valid UUID').optional(),
    frequency: z.enum(['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY']).optional(),
    nextRunAt: z.iso.datetime('nextRunAt must be a valid DateTime').optional(),
    isActive: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field must be provided',
  });

export type UpdateRecurringTransactionDto = z.infer<
  typeof updateRecurringTransactionSchema
>;
