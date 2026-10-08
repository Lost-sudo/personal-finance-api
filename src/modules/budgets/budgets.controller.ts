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
import { BudgetsService } from './budgets.service.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import {
  type CreateBudgetDto,
  createBudgetSchema,
} from './dto/create-budget.dto.js';
import {
  type UpdateBudgetDto,
  updateBudgetSchema,
} from './dto/update-budget.dto.js';
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
  type BudgetQueryDto,
  budgetQuerySchema,
} from './dto/budget-query.dto.js';
import {
  paginatedResponse,
  successResponse,
} from '../../common/utils/api-response.js';
import {
  apiResponseSchema,
  budgetProgressSchema,
  budgetSchema,
  conflictErrorSchema,
  notFoundErrorSchema,
  paginatedResponseSchema,
  validationErrorSchema,
} from '../../common/swagger/api-response.schema.js';

@ApiTags('Budgets')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('budgets')
export class BudgetsController {
  constructor(private readonly budgetsService: BudgetsService) {}

  @ApiOperation({
    summary: 'Create a budget',
    description:
      'Creates a spending budget for one of the current user’s expense categories. Overlapping budgets for the same category and date range are rejected.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: [
        'name',
        'categoryId',
        'amount',
        'period',
        'startDate',
        'endDate',
      ],
      properties: {
        name: {
          type: 'string',
          example: 'January groceries',
          description: 'Budget name.',
          minLength: 1,
          maxLength: 100,
        },
        categoryId: {
          type: 'string',
          format: 'uuid',
          example: '550e8400-e29b-41d4-a716-446655440000',
          description: 'Expense category the budget applies to.',
        },
        amount: {
          type: 'number',
          example: 15000,
          description: 'Positive budget amount with at most 2 decimal places.',
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
          description: 'Start of the budget period. Must be before endDate.',
        },
        endDate: {
          type: 'string',
          format: 'date-time',
          example: '2026-01-31T23:59:59.000Z',
          description: 'End of the budget period. Must be after startDate.',
        },
      },
    },
  })
  @ApiResponse({
    status: 201,
    description: 'Budget successfully created.',
    schema: apiResponseSchema(budgetSchema),
  })
  @ApiResponse({
    status: 400,
    description:
      'Invalid budget data, or the category is not an expense category.',
    schema: validationErrorSchema,
  })
  @ApiResponse({
    status: 404,
    description: 'Category not found.',
    schema: notFoundErrorSchema,
  })
  @ApiResponse({
    status: 409,
    description:
      'A budget for this category already exists in the given date range.',
    schema: conflictErrorSchema,
  })
  @Post()
  async create(
    @Body(new ZodValidationPipe(createBudgetSchema))
    dto: CreateBudgetDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const budget = await this.budgetsService.create(user.id, dto);

    return successResponse(budget);
  }

  @ApiOperation({
    summary: 'List budgets',
    description:
      'Returns paginated budgets belonging to the current user with support for filtering by category, period, and date range, and deterministic sorting.',
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
    description: 'Number of budgets per page.',
    type: Number,
    minimum: 1,
    maximum: 100,
    default: 20,
    example: 20,
  })
  @ApiQuery({
    name: 'categoryId',
    description: 'Filter budgets by category.',
    type: String,
    format: 'uuid',
    required: false,
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @ApiQuery({
    name: 'period',
    description: 'Filter budgets by period.',
    enum: ['WEEKLY', 'MONTHLY', 'YEARLY', 'CUSTOM'],
    required: false,
    example: 'MONTHLY',
  })
  @ApiQuery({
    name: 'startDate',
    description: 'Only budgets ending on or after this date-time.',
    type: String,
    format: 'date-time',
    required: false,
    example: '2026-01-01T00:00:00.000Z',
  })
  @ApiQuery({
    name: 'endDate',
    description: 'Only budgets starting on or before this date-time.',
    type: String,
    format: 'date-time',
    required: false,
    example: '2026-01-31T23:59:59.000Z',
  })
  @ApiQuery({
    name: 'sortBy',
    description: 'Field used to order the results.',
    enum: ['startDate', 'amount', 'createdAt'],
    default: 'startDate',
    example: 'startDate',
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
    description: 'Budgets successfully retrieved.',
    schema: paginatedResponseSchema(budgetSchema),
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid query parameters.',
    schema: validationErrorSchema,
  })
  @Get()
  async findAll(
    @Query(new ZodValidationPipe(budgetQuerySchema)) query: BudgetQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const result = await this.budgetsService.findAll(user.id, query);

    const totalPages = Math.ceil(result.total / query.limit);

    return paginatedResponse(result.budgets, {
      page: query.page,
      limit: query.limit,
      total: result.total,
      totalPages,
    });
  }

  @ApiOperation({
    summary: 'Get budget progress',
    description:
      'Returns a budget belonging to the current user together with its calculated spending progress.',
  })
  @ApiParam({
    name: 'id',
    description: 'Budget UUID.',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @ApiResponse({
    status: 200,
    description: 'Budget progress successfully retrieved.',
    schema: apiResponseSchema(budgetProgressSchema),
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid budget id.',
    schema: validationErrorSchema,
  })
  @ApiResponse({
    status: 404,
    description: 'Budget not found.',
    schema: notFoundErrorSchema,
  })
  @Get(':id/progress')
  async getProgress(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const result = await this.budgetsService.getProgress(user.id, id);

    return successResponse(result);
  }

  @ApiOperation({
    summary: 'Get a budget',
    description: 'Returns one budget belonging to the current user.',
  })
  @ApiParam({
    name: 'id',
    description: 'Budget UUID.',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @ApiResponse({
    status: 200,
    description: 'Budget successfully retrieved.',
    schema: apiResponseSchema(budgetSchema),
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid budget id.',
    schema: validationErrorSchema,
  })
  @ApiResponse({
    status: 404,
    description: 'Budget not found.',
    schema: notFoundErrorSchema,
  })
  @Get(':id')
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const result = await this.budgetsService.findOne(user.id, id);

    return successResponse(result);
  }

  @ApiOperation({
    summary: 'Update a budget',
    description:
      'Updates an existing budget belonging to the current user. Changing the category, amount, period, or dates re-runs all affected business rules.',
  })
  @ApiParam({
    name: 'id',
    description: 'Budget UUID.',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          example: 'January groceries',
          minLength: 1,
          maxLength: 100,
        },
        categoryId: {
          type: 'string',
          format: 'uuid',
          example: '550e8400-e29b-41d4-a716-446655440000',
        },
        amount: {
          type: 'number',
          example: 12000,
          description: 'Positive amount with at most 2 decimal places.',
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
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Budget successfully updated.',
    schema: apiResponseSchema(budgetSchema),
  })
  @ApiResponse({
    status: 400,
    description:
      'Invalid budget data, the category is not an expense category, or the date range is invalid.',
    schema: validationErrorSchema,
  })
  @ApiResponse({
    status: 404,
    description: 'Budget or category not found.',
    schema: notFoundErrorSchema,
  })
  @ApiResponse({
    status: 409,
    description:
      'A budget for this category already exists in the given date range.',
    schema: conflictErrorSchema,
  })
  @Patch(':id')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateBudgetSchema))
    dto: UpdateBudgetDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const result = await this.budgetsService.update(user.id, id, dto);

    return successResponse(result);
  }

  @ApiOperation({
    summary: 'Delete a budget',
    description:
      'Deletes a budget belonging to the current user. Transactions are never affected.',
  })
  @ApiParam({
    name: 'id',
    description: 'Budget UUID.',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @ApiResponse({
    status: 204,
    description: 'Budget successfully deleted. No response body.',
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid budget id.',
    schema: validationErrorSchema,
  })
  @ApiResponse({
    status: 404,
    description: 'Budget not found.',
    schema: notFoundErrorSchema,
  })
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.budgetsService.remove(user.id, id);
  }
}
