import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ReportsService } from './reports.service.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import {
  type ReportQueryDto,
  reportQuerySchema,
} from './dto/report-query.dto.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import type { AuthenticatedUser } from '../auth/types/authenticated-user.type.js';

import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  apiResponseSchema,
  financialSummarySchema,
  validationErrorSchema,
} from '../../common/swagger/api-response.schema.js';
import { successResponse } from '../../common/utils/api-response.js';

@ApiTags('Reports')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('reports')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @ApiOperation({
    summary: 'Get a financial summary',
    description:
      'Returns income, expenses, net cash flow, and spending by category derived from the transaction history of the current user. Transfers are excluded from all totals.',
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
    description: 'Financial summary successfully retrieved.',
    schema: apiResponseSchema(financialSummarySchema),
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid query parameters.',
    schema: validationErrorSchema,
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized.',
  })
  @Get('summary')
  async getFinancialSummary(
    @Query(new ZodValidationPipe(reportQuerySchema)) query: ReportQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const result = await this.reportsService.getFinancialSummary(
      user.id,
      query,
    );

    return successResponse(result);
  }
}
