import { z } from 'zod';

export const createAccountSchema = z.strictObject({
  name: z
    .string()
    .trim()
    .min(1, 'Account name is required')
    .max(100, 'Account name must not exceed 100 characters'),
  type: z.enum([
    'CASH',
    'BANK',
    'E_WALLET',
    'CREDIT_CARD',
    'INVESTMENT',
    'OTHER',
  ]),
  currency: z
    .string()
    .trim()
    .length(3, 'Currency must be a 3-letter code')
    .default('PHP'),
  initialBalance: z.number().finite().default(0),
});

export type CreateAccountDto = z.infer<typeof createAccountSchema>;
