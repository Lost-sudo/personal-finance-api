import { ApiProperty } from '@nestjs/swagger';

export class RecurringTransactionResponseDto {
  @ApiProperty({
    example: '550e8400-e29b-41d4-a716-446655440000',
    format: 'uuid',
  })
  id: string;

  @ApiProperty({
    example: '550e8400-e29b-41d4-a716-446655440000',
    format: 'uuid',
  })
  userId: string;

  @ApiProperty({
    enum: ['INCOME', 'EXPENSE', 'TRANSFER'],
    example: 'EXPENSE',
  })
  type: string;

  @ApiProperty({
    example: '2500.00',
    description: 'Decimal serializes as a string in JSON responses.',
  })
  amount: string;

  @ApiProperty({
    example: 'Monthly rent',
    maxLength: 255,
    nullable: true,
  })
  description: string | null;

  @ApiProperty({
    example: '550e8400-e29b-41d4-a716-446655440000',
    format: 'uuid',
    nullable: true,
  })
  accountId: string | null;

  @ApiProperty({
    example: '550e8400-e29b-41d4-a716-446655440000',
    format: 'uuid',
    nullable: true,
  })
  categoryId: string | null;

  @ApiProperty({
    example: '550e8400-e29b-41d4-a716-446655440000',
    format: 'uuid',
    nullable: true,
    description: 'Source account of a transfer schedule.',
  })
  fromAccountId: string | null;

  @ApiProperty({
    example: '550e8400-e29b-41d4-a716-446655440000',
    format: 'uuid',
    nullable: true,
    description: 'Destination account of a transfer schedule.',
  })
  toAccountId: string | null;

  @ApiProperty({
    enum: ['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'],
    example: 'MONTHLY',
  })
  frequency: string;

  @ApiProperty({
    example: '2026-11-01T09:00:00.000Z',
    format: 'date-time',
  })
  nextRunAt: Date;

  @ApiProperty({
    example: true,
  })
  isActive: boolean;

  @ApiProperty({
    example: '2026-01-15T08:30:00.000Z',
    format: 'date-time',
  })
  createdAt: Date;

  @ApiProperty({
    example: '2026-01-15T08:30:00.000Z',
    format: 'date-time',
  })
  updatedAt: Date;
}
