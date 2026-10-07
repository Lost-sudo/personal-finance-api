import { ApiProperty } from '@nestjs/swagger';

export class AuthUserDto {
  @ApiProperty({
    example: 'cmj8abc123xyz',
  })
  id: string;

  @ApiProperty({
    example: 'john@example.com',
  })
  email: string;

  @ApiProperty({
    example: 'John',
    nullable: true,
  })
  firstName: string | null;

  @ApiProperty({
    example: 'Doe',
    nullable: true,
  })
  lastName: string | null;

  @ApiProperty({
    example: true,
  })
  isActive: boolean;

  @ApiProperty({
    example: null,
    nullable: true,
    description: 'Timestamp when the user verified their email.',
  })
  emailVerifiedAt: Date | null;

  @ApiProperty({
    example: '2026-01-01T00:00:00.000Z',
    format: 'date-time',
  })
  createdAt: Date;

  @ApiProperty({
    example: '2026-01-01T00:00:00.000Z',
    format: 'date-time',
  })
  updatedAt: Date;
}

export class AuthResponseDto {
  @ApiProperty({
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
    description: 'Short-lived JWT access token.',
  })
  accessToken: string;

  @ApiProperty({
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
    description:
      'Long-lived JWT refresh token. Also set as an httpOnly cookie; non-browser clients may persist it in secure storage instead.',
  })
  refreshToken: string;

  @ApiProperty({
    type: AuthUserDto,
  })
  user: AuthUserDto;
}
