import { z } from 'zod';

export const transactionQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  type: z.enum(['INCOME', 'EXPENSE', 'TRANSFER']).optional(),
  accountId: z.uuid('accountId must be a valid UUID').optional(),
  categoryId: z.uuid('categoryId must be a valid UUID').optional(),
  dateFrom: z.iso.datetime('dateFrom must be a valid DateTime').optional(),
  dateTo: z.iso.datetime('dateTo must be a valid DateTime').optional(),
  search: z.string().trim().min(1).max(100).optional(),
  sortBy: z.enum(['transactionDate', 'amount', 'createdAt']).default(
    'transactionDate',
  ),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

export type TransactionQueryDto = z.infer<typeof transactionQuerySchema>;
