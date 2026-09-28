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

export function apiResponseSchema(data: SchemaObject): SchemaObject {
  return {
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
