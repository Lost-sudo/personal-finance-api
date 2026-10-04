import { ApiProperty } from '@nestjs/swagger';

export class TransactionResponseDto {
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
    example: '550e8400-e29b-41d4-a716-446655440000',
    format: 'uuid',
  })
  accountId: string;

  @ApiProperty({
    example: '550e8400-e29b-41d4-a716-446655440000',
    format: 'uuid',
    nullable: true,
  })
  categoryId: string | null;

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
    example: 'Grocery run',
    maxLength: 500,
    nullable: true,
  })
  description: string | null;

  @ApiProperty({
    example: '2026-01-15T08:30:00.000Z',
    format: 'date-time',
  })
  transactionDate: Date;

  @ApiProperty({
    example: '550e8400-e29b-41d4-a716-446655440000',
    format: 'uuid',
    nullable: true,
    description:
      'Shared identifier linking the paired rows of a transfer.',
  })
  transferGroupId: string | null;

  @ApiProperty({
    example: null,
    format: 'date-time',
    nullable: true,
  })
  deletedAt: Date | null;

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
