import { z } from 'zod';

export const budgetQuerySchema = z.strictObject({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  categoryId: z.uuid('categoryId must be a valid UUID').optional(),
  period: z.enum(['WEEKLY', 'MONTHLY', 'YEARLY', 'CUSTOM']).optional(),
  startDate: z.iso.datetime('startDate must be a valid DateTime').optional(),
  endDate: z.iso.datetime('endDate must be a valid DateTime').optional(),
  sortBy: z.enum(['startDate', 'amount', 'createdAt']).default('startDate'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

export type BudgetQueryDto = z.infer<typeof budgetQuerySchema>;
