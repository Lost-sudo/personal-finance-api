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
import { RecurringTransactionsService } from './recurring-transactions.service.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import {
  type CreateRecurringTransactionDto,
  createRecurringTransactionSchema,
} from './dto/create-recurring-transaction.dto.js';
import {
  type UpdateRecurringTransactionDto,
  updateRecurringTransactionSchema,
} from './dto/update-recurring-transaction.dto.js';
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
  type RecurringTransactionQueryDto,
  recurringTransactionQuerySchema,
} from './dto/recurring-transaction-query.dto.js';
import {
  paginatedResponse,
  successResponse,
} from '../../common/utils/api-response.js';
import {
  apiResponseSchema,
  notFoundErrorSchema,
  paginatedResponseSchema,
  recurringTransactionSchema,
  validationErrorSchema,
} from '../../common/swagger/api-response.schema.js';

@ApiTags('Recurring Transactions')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('recurring-transactions')
export class RecurringTransactionsController {
  constructor(
    private readonly recurringTransactionsService: RecurringTransactionsService,
  ) {}

  @ApiOperation({
    summary: 'Create a recurring transaction',
    description:
      'Creates an income, expense, or transfer schedule for the current user. Income and expense schedules use an account, while transfers use source and destination accounts.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['type', 'amount', 'frequency', 'nextRunAt'],
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
        description: {
          type: 'string',
          example: 'Monthly rent',
          description: 'Optional description.',
          maxLength: 255,
        },
        accountId: {
          type: 'string',
          format: 'uuid',
          example: '550e8400-e29b-41d4-a716-446655440000',
          description:
            'Account for income and expense schedules. Required unless the type is TRANSFER.',
        },
        categoryId: {
          type: 'string',
          format: 'uuid',
          example: '550e8400-e29b-41d4-a716-446655440000',
          description: 'Optional category.',
        },
        fromAccountId: {
          type: 'string',
          format: 'uuid',
          example: '550e8400-e29b-41d4-a716-446655440000',
          description: 'Source account. Required for transfer schedules.',
        },
        toAccountId: {
          type: 'string',
          format: 'uuid',
          example: '550e8400-e29b-41d4-a716-446655440000',
          description:
            'Destination account. Required for transfer schedules.',
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
      },
    },
  })
  @ApiResponse({
    status: 201,
    description: 'Recurring transaction successfully created.',
    schema: apiResponseSchema(recurringTransactionSchema),
  })
  @ApiResponse({
    status: 400,
    description:
      'Invalid schedule data, or required accounts missing or identical.',
    schema: validationErrorSchema,
  })
  @ApiResponse({
    status: 404,
    description: 'Account or category not found.',
    schema: notFoundErrorSchema,
  })
  @Post()
  async create(
    @Body(new ZodValidationPipe(createRecurringTransactionSchema))
    dto: CreateRecurringTransactionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const schedule = await this.recurringTransactionsService.create(
      user.id,
      dto,
    );

    return successResponse(schedule);
  }

  @ApiOperation({
    summary: 'List recurring transactions',
    description:
      'Returns paginated recurring schedules belonging to the current user.',
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
    description: 'Number of schedules per page.',
    type: Number,
    minimum: 1,
    maximum: 100,
    default: 20,
    example: 20,
  })
  @ApiQuery({
    name: 'type',
    description: 'Filter schedules by type.',
    enum: ['INCOME', 'EXPENSE', 'TRANSFER'],
    required: false,
    example: 'EXPENSE',
  })
  @ApiQuery({
    name: 'frequency',
    description: 'Filter schedules by frequency.',
    enum: ['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'],
    required: false,
    example: 'MONTHLY',
  })
  @ApiQuery({
    name: 'accountId',
    description:
      'Filter schedules involving the account, including both sides of transfer schedules.',
    type: String,
    format: 'uuid',
    required: false,
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @ApiQuery({
    name: 'isActive',
    description: 'Filter schedules by active status.',
    type: Boolean,
    required: false,
    example: true,
  })
  @ApiQuery({
    name: 'search',
    description: 'Case-insensitive partial match on the description.',
    type: String,
    minLength: 1,
    maxLength: 100,
    required: false,
    example: 'Rent',
  })
  @ApiQuery({
    name: 'sortBy',
    description: 'Field used to order the results.',
    enum: ['nextRunAt', 'amount', 'createdAt'],
    default: 'nextRunAt',
    example: 'nextRunAt',
  })
  @ApiQuery({
    name: 'sortOrder',
    description: 'Sort direction.',
    enum: ['asc', 'desc'],
    default: 'asc',
    example: 'asc',
  })
  @ApiResponse({
    status: 200,
    description: 'Recurring transactions successfully retrieved.',
    schema: paginatedResponseSchema(recurringTransactionSchema),
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid query parameters.',
    schema: validationErrorSchema,
  })
  @Get()
  async findAll(
    @Query(new ZodValidationPipe(recurringTransactionQuerySchema))
    query: RecurringTransactionQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const result = await this.recurringTransactionsService.findAll(
      user.id,
      query,
    );

    const totalPages = Math.ceil(result.total / query.limit);

    return paginatedResponse(result.recurringTransactions, {
      page: query.page,
      limit: query.limit,
      total: result.total,
      totalPages,
    });
  }

  @ApiOperation({
    summary: 'Get a recurring transaction',
    description:
      'Returns one recurring schedule belonging to the current user.',
  })
  @ApiParam({
    name: 'id',
    description: 'Recurring transaction UUID.',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @ApiResponse({
    status: 200,
    description: 'Recurring transaction successfully retrieved.',
    schema: apiResponseSchema(recurringTransactionSchema),
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid recurring transaction id.',
    schema: validationErrorSchema,
  })
  @ApiResponse({
    status: 404,
    description: 'Recurring transaction not found.',
    schema: notFoundErrorSchema,
  })
  @Get(':id')
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const result = await this.recurringTransactionsService.findOne(
      user.id,
      id,
    );

    return successResponse(result);
  }

  @ApiOperation({
    summary: 'Update a recurring transaction',
    description:
      'Updates an existing recurring schedule belonging to the current user. The schedule type cannot be changed. Setting isActive to false pauses the schedule.',
  })
  @ApiParam({
    name: 'id',
    description: 'Recurring transaction UUID.',
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
        description: {
          type: 'string',
          example: 'Updated rent',
          maxLength: 255,
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
        fromAccountId: {
          type: 'string',
          format: 'uuid',
          example: '550e8400-e29b-41d4-a716-446655440000',
        },
        toAccountId: {
          type: 'string',
          format: 'uuid',
          example: '550e8400-e29b-41d4-a716-446655440000',
        },
        frequency: {
          type: 'string',
          enum: ['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'],
          example: 'WEEKLY',
        },
        nextRunAt: {
          type: 'string',
          format: 'date-time',
          example: '2026-12-01T09:00:00.000Z',
        },
        isActive: {
          type: 'boolean',
          example: false,
          description: 'Set to false to pause the schedule.',
        },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Recurring transaction successfully updated.',
    schema: apiResponseSchema(recurringTransactionSchema),
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid schedule data.',
    schema: validationErrorSchema,
  })
  @ApiResponse({
    status: 404,
    description: 'Recurring transaction, account, or category not found.',
    schema: notFoundErrorSchema,
  })
  @Patch(':id')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateRecurringTransactionSchema))
    dto: UpdateRecurringTransactionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const result = await this.recurringTransactionsService.update(
      user.id,
      id,
      dto,
    );

    return successResponse(result);
  }

  @ApiOperation({
    summary: 'Delete a recurring transaction',
    description:
      'Deletes a recurring schedule instead of archiving it. Previously generated transactions are preserved as financial history.',
  })
  @ApiParam({
    name: 'id',
    description: 'Recurring transaction UUID.',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @ApiResponse({
    status: 204,
    description: 'Recurring transaction successfully deleted. No response body.',
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid recurring transaction id.',
    schema: validationErrorSchema,
  })
  @ApiResponse({
    status: 404,
    description: 'Recurring transaction not found.',
    schema: notFoundErrorSchema,
  })
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.recurringTransactionsService.remove(user.id, id);
  }
}
