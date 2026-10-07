import { z } from 'zod';

export const createTransactionSchema = z.strictObject({
  type: z.enum(['INCOME', 'EXPENSE', 'TRANSFER']),
  amount: z
    .number({ message: 'Amount is required' })
    .positive('Amount must be positive')
    .refine(
      (value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-9,
      'Amount must have at most 2 decimal places',
    ),
  transactionDate: z.iso.datetime(
    'transactionDate must be a valid DateTime',
  ),
  description: z
    .string()
    .trim()
    .max(500, 'Description must not exceed 500 characters')
    .optional(),
  accountId: z.uuid('accountId must be a valid UUID'),
  categoryId: z.uuid('categoryId must be a valid UUID').optional(),
  toAccountId: z.uuid('toAccountId must be a valid UUID').optional(),
});

export type CreateTransactionDto = z.infer<typeof createTransactionSchema>;
