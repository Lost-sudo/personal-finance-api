import { ApiProperty } from '@nestjs/swagger';

export class CategorySpendingDto {
  @ApiProperty({
    example: '550e8400-e29b-41d4-a716-446655440000',
    format: 'uuid',
  })
  categoryId: string;

  @ApiProperty({
    example: 'Food',
    maxLength: 100,
  })
  categoryName: string;

  @ApiProperty({
    example: '800.00',
    description: 'Decimal serializes as a string in JSON responses.',
  })
  amount: string;
}

export class FinancialSummaryResponseDto {
  @ApiProperty({
    example: '2026-01-01T00:00:00.000Z',
    format: 'date-time',
    nullable: true,
    description: 'Start of the reporting period, if supplied.',
  })
  fromDate: string | null;

  @ApiProperty({
    example: '2026-01-31T23:59:59.000Z',
    format: 'date-time',
    nullable: true,
    description: 'End of the reporting period, if supplied.',
  })
  toDate: string | null;

  @ApiProperty({
    example: '5000.00',
    description: 'Total income transactions in the period.',
  })
  income: string;

  @ApiProperty({
    example: '2500.00',
    description: 'Total expense transactions in the period.',
  })
  expenses: string;

  @ApiProperty({
    example: '2500.00',
    description: 'Net cash flow: income minus expenses.',
  })
  netCashFlow: string;

  @ApiProperty({
    type: [CategorySpendingDto],
    description: 'Expense totals grouped by category, sorted descending.',
  })
  spendingByCategory: CategorySpendingDto[];
}
