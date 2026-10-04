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
import { AccountsService } from './accounts.service.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import {
  type CreateAccountDto,
  createAccountSchema,
} from './dto/create-account.dto.js';
import {
  type UpdateAccountDto,
  updateAccountSchema,
} from './dto/update-account.dto.js';
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
  type AccountQueryDto,
  accountQuerySchema,
} from './dto/account-query.dto.js';
import {
  type AccountTransactionsQueryDto,
  accountTransactionsQuerySchema,
} from './dto/account-transactions-query.dto.js';
import {
  paginatedResponse,
  successResponse,
} from '../../common/utils/api-response.js';
import {
  accountBalanceSchema,
  accountSchema,
  apiResponseSchema,
  conflictErrorSchema,
  notFoundErrorSchema,
  paginatedResponseSchema,
  transactionSchema,
  validationErrorSchema,
} from '../../common/swagger/api-response.schema.js';

@ApiTags('Accounts')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('accounts')
export class AccountsController {
  constructor(private readonly accountsService: AccountsService) {}

  @ApiOperation({
    summary: 'Create an account',
    description:
      'Creates a new financial account for the current user.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['name', 'type'],
      properties: {
        name: {
          type: 'string',
          example: 'BDO Savings',
          description: 'Account name.',
          minLength: 1,
          maxLength: 100,
        },
        type: {
          type: 'string',
          enum: [
            'CASH',
            'BANK',
            'E_WALLET',
            'CREDIT_CARD',
            'INVESTMENT',
            'OTHER',
          ],
          example: 'BANK',
        },
        currency: {
          type: 'string',
          example: 'PHP',
          description: 'Optional 3-letter currency code.',
          minLength: 3,
          maxLength: 3,
        },
        initialBalance: {
          type: 'number',
          example: 15000,
          description: 'Optional opening balance.',
        },
      },
    },
  })
  @ApiResponse({
    status: 201,
    description: 'Account successfully created.',
    schema: apiResponseSchema(accountSchema),
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid account data.',
    schema: validationErrorSchema,
  })
  @ApiResponse({
    status: 409,
    description: 'An account with the same name already exists.',
    schema: conflictErrorSchema,
  })
  @Post()
  async create(
    @Body(new ZodValidationPipe(createAccountSchema))
    dto: CreateAccountDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const account = await this.accountsService.create(user.id, dto);

    return successResponse(account);
  }

  @ApiOperation({
    summary: 'List accounts',
    description: 'Returns all active accounts belonging to the current user.',
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
    description: 'Number of accounts per page.',
    type: Number,
    minimum: 1,
    maximum: 100,
    default: 20,
    example: 20,
  })
  @ApiQuery({
    name: 'type',
    description: 'Filter accounts by type.',
    enum: ['CASH', 'BANK', 'E_WALLET', 'CREDIT_CARD', 'INVESTMENT', 'OTHER'],
    required: false,
    example: 'BANK',
  })
  @ApiQuery({
    name: 'search',
    description: 'Case-insensitive partial match on the account name.',
    type: String,
    minLength: 1,
    maxLength: 100,
    required: false,
    example: 'BDO',
  })
  @ApiQuery({
    name: 'sortBy',
    description: 'Field used to order the results.',
    enum: ['name', 'createdAt'],
    default: 'name',
    example: 'name',
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
    description: 'Accounts successfully retrieved.',
    schema: paginatedResponseSchema(accountSchema),
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid query parameters.',
    schema: validationErrorSchema,
  })
  @Get()
  async findAll(
    @Query(new ZodValidationPipe(accountQuerySchema)) query: AccountQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const result = await this.accountsService.findAll(user.id, query);

    const totalPages = Math.ceil(result.total / query.limit);

    return paginatedResponse(result.accounts, {
      page: query.page,
      limit: query.limit,
      total: result.total,
      totalPages,
    });
  }

  @ApiOperation({
    summary: 'Get an account balance',
    description:
      'Returns the derived balance of an account belonging to the current user. The balance is computed from the initial balance plus income and incoming transfers minus expenses and outgoing transfers.',
  })
  @ApiParam({
    name: 'id',
    description: 'Account UUID.',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @ApiResponse({
    status: 200,
    description: 'Account balance successfully retrieved.',
    schema: apiResponseSchema(accountBalanceSchema),
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid account id.',
    schema: validationErrorSchema,
  })
  @ApiResponse({
    status: 404,
    description: 'Account not found.',
    schema: notFoundErrorSchema,
  })
  @Get(':id/balance')
  async getBalance(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const result = await this.accountsService.getBalance(user.id, id);

    return successResponse(result);
  }

  @ApiOperation({
    summary: 'List account transactions',
    description:
      'Returns paginated transactions involving an account belonging to the current user.',
  })
  @ApiParam({
    name: 'id',
    description: 'Account UUID.',
    example: '550e8400-e29b-41d4-a716-446655440000',
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
  @ApiResponse({
    status: 200,
    description: 'Account transactions successfully retrieved.',
    schema: paginatedResponseSchema(transactionSchema),
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid account id or query parameters.',
    schema: validationErrorSchema,
  })
  @ApiResponse({
    status: 404,
    description: 'Account not found.',
    schema: notFoundErrorSchema,
  })
  @Get(':id/transactions')
  async findTransactions(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodValidationPipe(accountTransactionsQuerySchema))
    query: AccountTransactionsQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const result = await this.accountsService.findTransactions(
      user.id,
      id,
      query,
    );

    const totalPages = Math.ceil(result.total / query.limit);

    return paginatedResponse(result.transactions, {
      page: query.page,
      limit: query.limit,
      total: result.total,
      totalPages,
    });
  }

  @ApiOperation({
    summary: 'Get an account',
    description: 'Returns one active account belonging to the current user.',
  })
  @ApiParam({
    name: 'id',
    description: 'Account UUID.',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @ApiResponse({
    status: 200,
    description: 'Account successfully retrieved.',
    schema: apiResponseSchema(accountSchema),
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid account id.',
    schema: validationErrorSchema,
  })
  @ApiResponse({
    status: 404,
    description: 'Account not found.',
    schema: notFoundErrorSchema,
  })
  @Get(':id')
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const result = await this.accountsService.findOne(user.id, id);

    return successResponse(result);
  }

  @ApiOperation({
    summary: 'Update an account',
    description:
      'Updates an existing active account belonging to the current user.',
  })
  @ApiParam({
    name: 'id',
    description: 'Account UUID.',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          example: 'BDO Checking',
          minLength: 1,
          maxLength: 100,
        },
        type: {
          type: 'string',
          enum: [
            'CASH',
            'BANK',
            'E_WALLET',
            'CREDIT_CARD',
            'INVESTMENT',
            'OTHER',
          ],
          example: 'BANK',
        },
        currency: {
          type: 'string',
          example: 'USD',
          minLength: 3,
          maxLength: 3,
        },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Account successfully updated.',
    schema: apiResponseSchema(accountSchema),
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid account data.',
    schema: validationErrorSchema,
  })
  @ApiResponse({
    status: 404,
    description: 'Account not found.',
    schema: notFoundErrorSchema,
  })
  @ApiResponse({
    status: 409,
    description: 'An account with the same name already exists.',
    schema: conflictErrorSchema,
  })
  @Patch(':id')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateAccountSchema))
    dto: UpdateAccountDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const result = await this.accountsService.update(user.id, id, dto);

    return successResponse(result);
  }

  @ApiOperation({
    summary: 'Archive an account',
    description: 'Archives an account instead of permanently deleting it.',
  })
  @ApiParam({
    name: 'id',
    description: 'Account UUID.',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @ApiResponse({
    status: 204,
    description: 'Account successfully archived. No response body.',
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid account id.',
    schema: validationErrorSchema,
  })
  @ApiResponse({
    status: 404,
    description: 'Account not found.',
    schema: notFoundErrorSchema,
  })
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async archive(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.accountsService.archive(user.id, id);
  }
}
