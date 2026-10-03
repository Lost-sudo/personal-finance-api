import { z } from 'zod';

export const updateAccountSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, 'Account name is required')
      .max(100, 'Account name must not exceed 100 characters')
      .optional(),
    type: z
      .enum([
        'CASH',
        'BANK',
        'E_WALLET',
        'CREDIT_CARD',
        'INVESTMENT',
        'OTHER',
      ])
      .optional(),
    currency: z
      .string()
      .trim()
      .length(3, 'Currency must be a 3-letter code')
      .optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field must be provided',
  });

export type UpdateAccountDto = z.infer<typeof updateAccountSchema>;
