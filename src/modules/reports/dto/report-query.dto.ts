import { z } from 'zod';

export const reportQuerySchema = z.object({
  dateFrom: z.iso.datetime('dateFrom must be a valid DateTime').optional(),
  dateTo: z.iso.datetime('dateTo must be a valid DateTime').optional(),
});

export type ReportQueryDto = z.infer<typeof reportQuerySchema>;
