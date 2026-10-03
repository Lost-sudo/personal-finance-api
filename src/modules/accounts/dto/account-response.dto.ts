import { ApiProperty } from '@nestjs/swagger';

export class AccountResponseDto {
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
    example: 'BDO Savings',
    maxLength: 100,
  })
  name: string;

  @ApiProperty({
    enum: ['CASH', 'BANK', 'E_WALLET', 'CREDIT_CARD', 'INVESTMENT', 'OTHER'],
    example: 'BANK',
  })
  type: string;

  @ApiProperty({
    example: 'PHP',
    maxLength: 3,
  })
  currency: string;

  @ApiProperty({
    example: '15000.00',
    description: 'Decimal serializes as a string in JSON responses.',
  })
  initialBalance: string;

  @ApiProperty({
    example: false,
  })
  isArchived: boolean;

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
