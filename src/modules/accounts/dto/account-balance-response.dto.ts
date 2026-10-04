import { ApiProperty } from '@nestjs/swagger';

export class AccountBalanceResponseDto {
  @ApiProperty({
    example: '550e8400-e29b-41d4-a716-446655440000',
    format: 'uuid',
  })
  accountId: string;

  @ApiProperty({
    example: '15000.00',
    description: 'Decimal serializes as a string in JSON responses.',
  })
  initialBalance: string;

  @ApiProperty({
    example: '5000.00',
    description: 'Total income transactions for the account.',
  })
  income: string;

  @ApiProperty({
    example: '2500.00',
    description: 'Total expense transactions for the account.',
  })
  expenses: string;

  @ApiProperty({
    example: '1000.00',
    description: 'Total incoming transfers for the account.',
  })
  incomingTransfers: string;

  @ApiProperty({
    example: '500.00',
    description: 'Total outgoing transfers for the account.',
  })
  outgoingTransfers: string;

  @ApiProperty({
    example: '18000.00',
    description:
      'Derived balance: initialBalance + income - expenses + incomingTransfers - outgoingTransfers.',
  })
  balance: string;
}
