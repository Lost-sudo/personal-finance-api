import { z } from 'zod';

export const updateTransactionSchema = z
  .strictObject({
    amount: z
      .number()
      .positive('Amount must be positive')
      .refine(
        (value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-9,
        'Amount must have at most 2 decimal places',
      )
      .optional(),
    transactionDate: z.iso
      .datetime('transactionDate must be a valid DateTime')
      .optional(),
    description: z
      .string()
      .trim()
      .max(500, 'Description must not exceed 500 characters')
      .optional(),
    accountId: z.uuid('accountId must be a valid UUID').optional(),
    categoryId: z.uuid('categoryId must be a valid UUID').optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field must be provided',
  });

export type UpdateTransactionDto = z.infer<typeof updateTransactionSchema>;
