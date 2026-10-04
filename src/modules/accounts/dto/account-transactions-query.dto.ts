import { z } from 'zod';

export const accountTransactionsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  type: z.enum(['INCOME', 'EXPENSE', 'TRANSFER']).optional(),
  dateFrom: z.iso.datetime('dateFrom must be a valid DateTime').optional(),
  dateTo: z.iso.datetime('dateTo must be a valid DateTime').optional(),
});

export type AccountTransactionsQueryDto = z.infer<
  typeof accountTransactionsQuerySchema
>;
