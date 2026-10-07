import { z } from 'zod';

export const recurringTransactionQuerySchema = z.strictObject({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  type: z.enum(['INCOME', 'EXPENSE', 'TRANSFER']).optional(),
  frequency: z.enum(['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY']).optional(),
  accountId: z.uuid('accountId must be a valid UUID').optional(),
  isActive: z.stringbool().optional(),
  search: z.string().trim().min(1).max(100).optional(),
  sortBy: z.enum(['nextRunAt', 'amount', 'createdAt']).default('nextRunAt'),
  sortOrder: z.enum(['asc', 'desc']).default('asc'),
});

export type RecurringTransactionQueryDto = z.infer<
  typeof recurringTransactionQuerySchema
>;
