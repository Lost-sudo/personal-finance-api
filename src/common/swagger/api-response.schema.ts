import type { SchemaObject } from '@nestjs/swagger';

export const categorySchema: SchemaObject = {
  type: 'object',
  properties: {
    id: {
      type: 'string',
      format: 'uuid',
      example: '550e8400-e29b-41d4-a716-446655440000',
    },
    userId: {
      type: 'string',
      format: 'uuid',
      example: '550e8400-e29b-41d4-a716-446655440000',
    },
    name: {
      type: 'string',
      example: 'Food',
      maxLength: 100,
    },
    type: {
      type: 'string',
      enum: ['INCOME', 'EXPENSE'],
      example: 'EXPENSE',
    },
    color: {
      type: 'string',
      nullable: true,
      maxLength: 20,
      example: '#FF9800',
    },
    isArchived: {
      type: 'boolean',
      example: false,
    },
    createdAt: {
      type: 'string',
      format: 'date-time',
      example: '2026-01-15T08:30:00.000Z',
    },
    updatedAt: {
      type: 'string',
      format: 'date-time',
      example: '2026-01-15T08:30:00.000Z',
    },
  },
};

export const accountSchema: SchemaObject = {
  type: 'object',
  properties: {
    id: {
      type: 'string',
      format: 'uuid',
      example: '550e8400-e29b-41d4-a716-446655440000',
    },
    userId: {
      type: 'string',
      format: 'uuid',
      example: '550e8400-e29b-41d4-a716-446655440000',
    },
    name: {
      type: 'string',
      example: 'BDO Savings',
      maxLength: 100,
    },
    type: {
      type: 'string',
      enum: ['CASH', 'BANK', 'E_WALLET', 'CREDIT_CARD', 'INVESTMENT', 'OTHER'],
      example: 'BANK',
    },
    currency: {
      type: 'string',
      maxLength: 3,
      example: 'PHP',
    },
    initialBalance: {
      type: 'string',
      example: '15000.00',
    },
    isArchived: {
      type: 'boolean',
      example: false,
    },
    createdAt: {
      type: 'string',
      format: 'date-time',
      example: '2026-01-15T08:30:00.000Z',
    },
    updatedAt: {
      type: 'string',
      format: 'date-time',
      example: '2026-01-15T08:30:00.000Z',
    },
  },
};

export const transactionSchema: SchemaObject = {
  type: 'object',
  properties: {
    id: {
      type: 'string',
      format: 'uuid',
      example: '550e8400-e29b-41d4-a716-446655440000',
    },
    userId: {
      type: 'string',
      format: 'uuid',
      example: '550e8400-e29b-41d4-a716-446655440000',
    },
    accountId: {
      type: 'string',
      format: 'uuid',
      example: '550e8400-e29b-41d4-a716-446655440000',
    },
    categoryId: {
      type: 'string',
      format: 'uuid',
      nullable: true,
      example: '550e8400-e29b-41d4-a716-446655440000',
    },
    type: {
      type: 'string',
      enum: ['INCOME', 'EXPENSE', 'TRANSFER'],
      example: 'EXPENSE',
    },
    amount: {
      type: 'string',
      example: '2500.00',
    },
    description: {
      type: 'string',
      nullable: true,
      maxLength: 500,
      example: 'Grocery run',
    },
    transactionDate: {
      type: 'string',
      format: 'date-time',
      example: '2026-01-15T08:30:00.000Z',
    },
    transferGroupId: {
      type: 'string',
      format: 'uuid',
      nullable: true,
      example: '550e8400-e29b-41d4-a716-446655440000',
    },
    fromAccountId: {
      type: 'string',
      format: 'uuid',
      nullable: true,
      example: '550e8400-e29b-41d4-a716-446655440000',
    },
    toAccountId: {
      type: 'string',
      format: 'uuid',
      nullable: true,
      example: '550e8400-e29b-41d4-a716-446655440000',
    },
    deletedAt: {
      type: 'string',
      format: 'date-time',
      nullable: true,
      example: '2026-01-15T08:30:00.000Z',
    },
    createdAt: {
      type: 'string',
      format: 'date-time',
      example: '2026-01-15T08:30:00.000Z',
    },
    updatedAt: {
      type: 'string',
      format: 'date-time',
      example: '2026-01-15T08:30:00.000Z',
    },
  },
};

export const accountBalanceSchema: SchemaObject = {
  type: 'object',
  properties: {
    accountId: {
      type: 'string',
      format: 'uuid',
      example: '550e8400-e29b-41d4-a716-446655440000',
    },
    initialBalance: {
      type: 'string',
      example: '15000.00',
    },
    income: {
      type: 'string',
      example: '5000.00',
    },
    expenses: {
      type: 'string',
      example: '2500.00',
    },
    incomingTransfers: {
      type: 'string',
      example: '1000.00',
    },
    outgoingTransfers: {
      type: 'string',
      example: '500.00',
    },
    balance: {
      type: 'string',
      example: '18000.00',
    },
  },
};

export const financialSummarySchema: SchemaObject = {
  type: 'object',
  properties: {
    fromDate: {
      type: 'string',
      format: 'date-time',
      nullable: true,
      example: '2026-01-01T00:00:00.000Z',
    },
    toDate: {
      type: 'string',
      format: 'date-time',
      nullable: true,
      example: '2026-01-31T23:59:59.000Z',
    },
    income: {
      type: 'string',
      example: '5000.00',
    },
    expenses: {
      type: 'string',
      example: '2500.00',
    },
    netCashFlow: {
      type: 'string',
      example: '2500.00',
    },
    spendingByCategory: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          categoryId: {
            type: 'string',
            format: 'uuid',
            example: '550e8400-e29b-41d4-a716-446655440000',
          },
          categoryName: {
            type: 'string',
            example: 'Food',
          },
          amount: {
            type: 'string',
            example: '800.00',
          },
        },
      },
    },
  },
};

export const recurringTransactionSchema: SchemaObject = {
  type: 'object',
  properties: {
    id: {
      type: 'string',
      format: 'uuid',
      example: '550e8400-e29b-41d4-a716-446655440000',
    },
    userId: {
      type: 'string',
      format: 'uuid',
      example: '550e8400-e29b-41d4-a716-446655440000',
    },
    type: {
      type: 'string',
      enum: ['INCOME', 'EXPENSE', 'TRANSFER'],
      example: 'EXPENSE',
    },
    amount: {
      type: 'string',
      example: '2500.00',
    },
    description: {
      type: 'string',
      nullable: true,
      maxLength: 255,
      example: 'Monthly rent',
    },
    accountId: {
      type: 'string',
      format: 'uuid',
      nullable: true,
      example: '550e8400-e29b-41d4-a716-446655440000',
    },
    categoryId: {
      type: 'string',
      format: 'uuid',
      nullable: true,
      example: '550e8400-e29b-41d4-a716-446655440000',
    },
    fromAccountId: {
      type: 'string',
      format: 'uuid',
      nullable: true,
      example: '550e8400-e29b-41d4-a716-446655440000',
    },
    toAccountId: {
      type: 'string',
      format: 'uuid',
      nullable: true,
      example: '550e8400-e29b-41d4-a716-446655440000',
    },
    frequency: {
      type: 'string',
      enum: ['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'],
      example: 'MONTHLY',
    },
    nextRunAt: {
      type: 'string',
      format: 'date-time',
      example: '2026-11-01T09:00:00.000Z',
    },
    isActive: {
      type: 'boolean',
      example: true,
    },
    createdAt: {
      type: 'string',
      format: 'date-time',
      example: '2026-01-15T08:30:00.000Z',
    },
    updatedAt: {
      type: 'string',
      format: 'date-time',
      example: '2026-01-15T08:30:00.000Z',
    },
  },
};

export const budgetSchema: SchemaObject = {
  type: 'object',
  properties: {
    id: {
      type: 'string',
      format: 'uuid',
      example: '550e8400-e29b-41d4-a716-446655440000',
    },
    userId: {
      type: 'string',
      format: 'uuid',
      example: '550e8400-e29b-41d4-a716-446655440000',
    },
    categoryId: {
      type: 'string',
      format: 'uuid',
      example: '550e8400-e29b-41d4-a716-446655440000',
    },
    name: {
      type: 'string',
      example: 'January groceries',
      maxLength: 100,
    },
    amount: {
      type: 'string',
      example: '15000.00',
    },
    period: {
      type: 'string',
      enum: ['WEEKLY', 'MONTHLY', 'YEARLY', 'CUSTOM'],
      example: 'MONTHLY',
    },
    startDate: {
      type: 'string',
      format: 'date-time',
      example: '2026-01-01T00:00:00.000Z',
    },
    endDate: {
      type: 'string',
      format: 'date-time',
      example: '2026-01-31T23:59:59.000Z',
    },
    createdAt: {
      type: 'string',
      format: 'date-time',
      example: '2026-01-15T08:30:00.000Z',
    },
    updatedAt: {
      type: 'string',
      format: 'date-time',
      example: '2026-01-15T08:30:00.000Z',
    },
  },
};

export const budgetProgressSchema: SchemaObject = {
  type: 'object',
  properties: {
    id: {
      type: 'string',
      format: 'uuid',
      example: '550e8400-e29b-41d4-a716-446655440000',
    },
    name: {
      type: 'string',
      example: 'October Food Budget',
      maxLength: 100,
    },
    categoryId: {
      type: 'string',
      format: 'uuid',
      example: '550e8400-e29b-41d4-a716-446655440000',
    },
    budgetAmount: {
      type: 'string',
      example: '10000.00',
    },
    spentAmount: {
      type: 'string',
      example: '6750.00',
    },
    remainingAmount: {
      type: 'string',
      example: '3250.00',
    },
    percentageUsed: {
      type: 'number',
      example: 67.5,
    },
    status: {
      type: 'string',
      enum: ['ON_TRACK', 'NEAR_LIMIT', 'EXCEEDED'],
      example: 'ON_TRACK',
    },
    period: {
      type: 'object',
      properties: {
        startDate: {
          type: 'string',
          format: 'date-time',
          example: '2026-10-01T00:00:00.000Z',
        },
        endDate: {
          type: 'string',
          format: 'date-time',
          example: '2026-10-31T23:59:59.000Z',
        },
      },
    },
  },
};

export function apiResponseSchema(data: SchemaObject): SchemaObject {  return {
    type: 'object',
    required: ['success', 'data'],
    properties: {
      success: { type: 'boolean', example: true },
      data,
    },
  };
}

export function paginatedResponseSchema(data: SchemaObject): SchemaObject {
  return {
    type: 'object',
    required: ['success', 'data', 'meta'],
    properties: {
      success: { type: 'boolean', example: true },
      data: { type: 'array', items: data },
      meta: {
        type: 'object',
        required: ['page', 'limit', 'total', 'totalPages'],
        properties: {
          page: { type: 'integer', example: 1 },
          limit: { type: 'integer', example: 20 },
          total: { type: 'integer', example: 42 },
          totalPages: { type: 'integer', example: 3 },
        },
      },
    },
  };
}

export function httpErrorSchema(
  status: number,
  message: string,
  error: string,
): SchemaObject {
  return {
    type: 'object',
    required: ['statusCode', 'message', 'error'],
    properties: {
      statusCode: { type: 'integer', example: status },
      message: { type: 'string', example: message },
      error: { type: 'string', example: error },
    },
  };
}

export const notFoundErrorSchema: SchemaObject = httpErrorSchema(
  404,
  'Category not found',
  'Not Found',
);

export const conflictErrorSchema: SchemaObject = httpErrorSchema(
  409,
  'A category with this name and type already exists',
  'Conflict',
);

export const validationErrorSchema: SchemaObject = {
  type: 'object',
  required: ['statusCode', 'message', 'errors'],
  properties: {
    statusCode: { type: 'integer', example: 400 },
    message: { type: 'string', example: 'Validation failed' },
    errors: {
      type: 'array',
      example: [
        {
          code: 'too_small',
          path: ['name'],
          message: 'Category name is required',
        },
      ],
      items: {
        type: 'object',
        properties: {
          code: { type: 'string', example: 'too_small' },
          path: { type: 'array', items: { type: 'string' } },
          message: {
            type: 'string',
            example: 'Category name is required',
          },
        },
      },
    },
  },
};
