import { BadRequestException } from '@nestjs/common';
import { ZodType } from 'zod';
import { ZodValidationPipe } from '../pipes/zod-validation.pipe.js';
import { createTransactionSchema } from '../../modules/transactions/dto/create-transaction.dto.js';
import { updateTransactionSchema } from '../../modules/transactions/dto/update-transaction.dto.js';
import { createAccountSchema } from '../../modules/accounts/dto/create-account.dto.js';
import { createCategorySchema } from '../../modules/categories/dto/create-category.dto.js';
import { createRecurringTransactionSchema } from '../../modules/recurring-transactions/dto/create-recurring-transaction.dto.js';
import { registerSchema } from '../../modules/auth/dto/register.dto.js';
import { loginSchema } from '../../modules/auth/dto/login.dto.js';

const UUID = '550e8400-e29b-41d4-a716-446655440000';
const DATE_TIME = '2026-01-15T08:30:00.000Z';
const BODY = { type: 'body' } as const;

function accepts(schema: ZodType) {
  return (value: unknown) =>
    new ZodValidationPipe(schema).transform(value, BODY);
}

function rejects(schema: ZodType) {
  return (value: unknown) =>
    expect(() => accepts(schema)(value)).toThrow(BadRequestException);
}

const validTransaction = {
  type: 'EXPENSE',
  amount: 2500,
  transactionDate: DATE_TIME,
  accountId: UUID,
};

/**
 * Boundary audit: untrusted HTTP input must survive Zod before reaching
 * controllers. String money and unknown fields must never slip through.
 */
describe('input validation boundary', () => {
  describe('strictness (unknown properties rejected)', () => {
    it.each([
      ['createTransaction', createTransactionSchema, validTransaction],
      ['updateTransaction', updateTransactionSchema, { amount: 3000 }],
      [
        'createAccount',
        createAccountSchema,
        { name: 'BDO Savings', type: 'BANK' },
      ],
      [
        'createCategory',
        createCategorySchema,
        { name: 'Food', type: 'EXPENSE' },
      ],
      [
        'createRecurringTransaction',
        createRecurringTransactionSchema,
        { type: 'EXPENSE', amount: 2500, frequency: 'MONTHLY', nextRunAt: DATE_TIME },
      ],
      [
        'register',
        registerSchema,
        {
          email: 'john@example.com',
          password: 'Password123!',
          firstName: 'John',
          lastName: 'Doe',
        },
      ],
      [
        'login',
        loginSchema,
        { email: 'john@example.com', password: 'Password123!' },
      ],
    ])('%s rejects unexpectedField', (_name, schema, base) => {
      rejects(schema)({ ...base, unexpectedField: 'malicious input' });
    });
  });

  describe('monetary amounts', () => {
    it('rejects the brief payload: string amount plus unknown field', () => {
      rejects(createTransactionSchema)({
        ...validTransaction,
        amount: '25000.00',
        unexpectedField: 'malicious input',
      });
    });

    it.each([2500, 0.01, 25000.0])(
      'accepts numeric amount %s',
      (amount: number) => {
        const result = accepts(createTransactionSchema)({
          ...validTransaction,
          amount,
        }) as { amount: number };

        expect(result.amount).toBe(amount);
      },
    );

    it.each(['25000.00', '', '  ', 'abc', null, true, [2500], { value: 1 }])(
      'rejects non-numeric amount %p',
      (amount: unknown) => {
        rejects(createTransactionSchema)({ ...validTransaction, amount });
      },
    );

    it.each([-1, 10.123, Number.NaN, Number.POSITIVE_INFINITY])(
      'rejects non-positive or imprecise amount %p',
      (amount: unknown) => {
        rejects(createTransactionSchema)({ ...validTransaction, amount });
      },
    );
  });

  describe('identifiers, enums, and datetimes', () => {
    it('rejects malformed UUIDs', () => {
      rejects(createTransactionSchema)({
        ...validTransaction,
        accountId: 'not-a-uuid',
      });
    });

    it('rejects unknown enum values', () => {
      rejects(createTransactionSchema)({
        ...validTransaction,
        type: 'GIFT',
      });
    });

    it('rejects invalid datetimes', () => {
      rejects(createTransactionSchema)({
        ...validTransaction,
        transactionDate: 'tomorrow at noon',
      });
    });

    it('rejects empty updates', () => {
      rejects(updateTransactionSchema)({});
    });

    it('accepts omitted optional fields', () => {
      const result = accepts(createTransactionSchema)(
        validTransaction,
      ) as Record<string, unknown>;

      expect(result.description).toBeUndefined();
      expect(result.categoryId).toBeUndefined();
    });
  });
});
