import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { TransactionsService } from './transactions.service.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import {
  type CreateTransactionDto,
  createTransactionSchema,
} from './dto/create-transaction.dto.js';
import {
  type UpdateTransactionDto,
  updateTransactionSchema,
} from './dto/update-transaction.dto.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import type { AuthenticatedUser } from '../auth/types/authenticated-user.type.js';

import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  type TransactionQueryDto,
  transactionQuerySchema,
} from './dto/transaction-query.dto.js';
import {
  paginatedResponse,
  successResponse,
} from '../../common/utils/api-response.js';
import {
  apiResponseSchema,
  notFoundErrorSchema,
  paginatedResponseSchema,
  transactionSchema,
  validationErrorSchema,
} from '../../common/swagger/api-response.schema.js';

@ApiTags('Transactions')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('transactions')
export class TransactionsController {
  constructor(private readonly transactionsService: TransactionsService) {}

  @ApiOperation({
    summary: 'Create a transaction',
    description:
      'Creates an income, expense, or transfer transaction for the current user. Transfers create a pair of rows sharing a group id.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['type', 'amount', 'transactionDate', 'accountId'],
      properties: {
        type: {
          type: 'string',
          enum: ['INCOME', 'EXPENSE', 'TRANSFER'],
          example: 'EXPENSE',
        },
        amount: {
          type: 'number',
          example: 2500,
          description: 'Positive amount with at most 2 decimal places.',
        },
        transactionDate: {
          type: 'string',
          format: 'date-time',
          example: '2026-01-15T08:30:00.000Z',
        },
        description: {
          type: 'string',
          example: 'Grocery run',
          description: 'Optional description.',
          maxLength: 500,
        },
        accountId: {
          type: 'string',
          format: 'uuid',
          example: '550e8400-e29b-41d4-a716-446655440000',
        },
        categoryId: {
          type: 'string',
          format: 'uuid',
          example: '550e8400-e29b-41d4-a716-446655440000',
          description: 'Optional category.',
        },
        toAccountId: {
          type: 'string',
          format: 'uuid',
          example: '550e8400-e29b-41d4-a716-446655440000',
          description: 'Destination account. Required for transfers.',
        },
      },
    },
  })
  @ApiResponse({
    status: 201,
    description: 'Transaction successfully created.',
    schema: apiResponseSchema(transactionSchema),
  })
  @ApiResponse({
    status: 400,
    description:
      'Invalid transaction data, or transfer accounts missing or identical.',
    schema: validationErrorSchema,
  })
  @ApiResponse({
    status: 404,
    description: 'Account or category not found.',
    schema: notFoundErrorSchema,
  })
  @Post()
  async create(
    @Body(new ZodValidationPipe(createTransactionSchema))
    dto: CreateTransactionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const transaction = await this.transactionsService.create(user.id, dto);

    return successResponse(transaction);
  }

  @ApiOperation({
    summary: 'List transactions',
    description:
      'Returns paginated transactions belonging to the current user with support for filtering by type, account, category, and date range, and deterministic sorting.',
  })
  @ApiQuery({
    name: 'page',
    description: 'Page number to retrieve.',
    type: Number,
    minimum: 1,
    default: 1,
    example: 1,
  })
  @ApiQuery({
    name: 'limit',
    description: 'Number of transactions per page.',
    type: Number,
    minimum: 1,
    maximum: 100,
    default: 20,
    example: 20,
  })
  @ApiQuery({
    name: 'type',
    description: 'Filter transactions by type.',
    enum: ['INCOME', 'EXPENSE', 'TRANSFER'],
    required: false,
    example: 'EXPENSE',
  })
  @ApiQuery({
    name: 'accountId',
    description:
      'Filter transactions involving the account, including outgoing and incoming transfer legs.',
    type: String,
    format: 'uuid',
    required: false,
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @ApiQuery({
    name: 'categoryId',
    description: 'Filter transactions by category.',
    type: String,
    format: 'uuid',
    required: false,
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @ApiQuery({
    name: 'dateFrom',
    description: 'Only transactions on or after this date-time.',
    type: String,
    format: 'date-time',
    required: false,
    example: '2026-01-01T00:00:00.000Z',
  })
  @ApiQuery({
    name: 'dateTo',
    description: 'Only transactions on or before this date-time.',
    type: String,
    format: 'date-time',
    required: false,
    example: '2026-01-31T23:59:59.000Z',
  })
  @ApiQuery({
    name: 'search',
    description: 'Case-insensitive partial match on the description.',
    type: String,
    minLength: 1,
    maxLength: 100,
    required: false,
    example: 'Grocery',
  })
  @ApiQuery({
    name: 'sortBy',
    description: 'Field used to order the results.',
    enum: ['transactionDate', 'amount', 'createdAt'],
    default: 'transactionDate',
    example: 'transactionDate',
  })
  @ApiQuery({
    name: 'sortOrder',
    description: 'Sort direction.',
    enum: ['asc', 'desc'],
    default: 'desc',
    example: 'desc',
  })
  @ApiResponse({
    status: 200,
    description: 'Transactions successfully retrieved.',
    schema: paginatedResponseSchema(transactionSchema),
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid query parameters.',
    schema: validationErrorSchema,
  })
  @Get()
  async findAll(
    @Query(new ZodValidationPipe(transactionQuerySchema))
    query: TransactionQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const result = await this.transactionsService.findAll(user.id, query);

    const totalPages = Math.ceil(result.total / query.limit);

    return paginatedResponse(result.transactions, {
      page: query.page,
      limit: query.limit,
      total: result.total,
      totalPages,
    });
  }

  @ApiOperation({
    summary: 'Get a transaction',
    description:
      'Returns one active transaction belonging to the current user.',
  })
  @ApiParam({
    name: 'id',
    description: 'Transaction UUID.',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @ApiResponse({
    status: 200,
    description: 'Transaction successfully retrieved.',
    schema: apiResponseSchema(transactionSchema),
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid transaction id.',
    schema: validationErrorSchema,
  })
  @ApiResponse({
    status: 404,
    description: 'Transaction not found.',
    schema: notFoundErrorSchema,
  })
  @Get(':id')
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const result = await this.transactionsService.findOne(user.id, id);

    return successResponse(result);
  }

  @ApiOperation({
    summary: 'Update a transaction',
    description:
      'Updates an existing active income or expense transaction belonging to the current user. Transfer transactions cannot be updated.',
  })
  @ApiParam({
    name: 'id',
    description: 'Transaction UUID.',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        amount: {
          type: 'number',
          example: 3000,
          description: 'Positive amount with at most 2 decimal places.',
        },
        transactionDate: {
          type: 'string',
          format: 'date-time',
          example: '2026-01-16T08:30:00.000Z',
        },
        description: {
          type: 'string',
          example: 'Updated grocery run',
          maxLength: 500,
        },
        accountId: {
          type: 'string',
          format: 'uuid',
          example: '550e8400-e29b-41d4-a716-446655440000',
        },
        categoryId: {
          type: 'string',
          format: 'uuid',
          example: '550e8400-e29b-41d4-a716-446655440000',
        },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Transaction successfully updated.',
    schema: apiResponseSchema(transactionSchema),
  })
  @ApiResponse({
    status: 400,
    description:
      'Invalid transaction data, or the transaction is part of a transfer.',
    schema: validationErrorSchema,
  })
  @ApiResponse({
    status: 404,
    description: 'Transaction, account, or category not found.',
    schema: notFoundErrorSchema,
  })
  @Patch(':id')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateTransactionSchema))
    dto: UpdateTransactionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const result = await this.transactionsService.update(user.id, id, dto);

    return successResponse(result);
  }

  @ApiOperation({
    summary: 'Archive a transaction',
    description:
      'Archives a transaction instead of permanently deleting it. For transfers, both paired rows are archived.',
  })
  @ApiParam({
    name: 'id',
    description: 'Transaction UUID.',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @ApiResponse({
    status: 204,
    description: 'Transaction successfully archived. No response body.',
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid transaction id.',
    schema: validationErrorSchema,
  })
  @ApiResponse({
    status: 404,
    description: 'Transaction not found.',
    schema: notFoundErrorSchema,
  })
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async archive(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.transactionsService.archive(user.id, id);
  }
}
