import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service.js';
import { registerSchema, type RegisterDto } from './dto/register.dto.js';
import { loginSchema, type LoginDto } from './dto/login.dto.js';
import { refreshSchema, type RefreshDto } from './dto/refresh.dto.js';
import {
  REFRESH_COOKIE_NAME,
  clearRefreshCookieOptions,
  refreshCookieOptions,
} from './refresh-cookie.js';
import { ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { successResponse } from '../../common/utils/api-response.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';

// Auth routes are the brute-force target: strict 10/min budget.
const AuthThrottle = () => Throttle({ auth: { limit: 10, ttl: 60000 } });

@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
  ) {}

  private isProduction(): boolean {
    return (
      this.configService.get<string>('app.nodeEnvironment') === 'production' ||
      this.configService.get<string>('app.environment') === 'production'
    );
  }

  private setRefreshCookie(res: Response, refreshToken: string): void {
    const refreshExpiresIn =
      this.configService.get<string>('jwt.refreshExpiresIn') ?? '7d';

    res.cookie(
      REFRESH_COOKIE_NAME,
      refreshToken,
      refreshCookieOptions(this.isProduction(), refreshExpiresIn),
    );
  }

  private clearRefreshCookie(res: Response): void {
    res.clearCookie(
      REFRESH_COOKIE_NAME,
      clearRefreshCookieOptions(this.isProduction()),
    );
  }

  private readPresentedRefreshToken(
    req: Request,
    body: RefreshDto,
  ): string | undefined {
    const fromCookie: unknown = req.cookies?.[REFRESH_COOKIE_NAME];

    if (typeof fromCookie === 'string' && fromCookie.length > 0) {
      return fromCookie;
    }

    return body.refreshToken;
  }

  @ApiOperation({
    summary: 'Register a new user',
    description:
      'Creates a new personal finance account and returns an access/refresh token pair. The refresh token is also set as an httpOnly cookie.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['email', 'password', 'firstName', 'lastName'],
      properties: {
        email: {
          type: 'string',
          format: 'email',
          example: 'johndoe@example.com',
          description: 'Email',
        },
        password: {
          type: 'string',
          format: 'password',
          example: 'password',
          description: 'Password',
        },
        firstName: {
          type: 'string',
          example: 'John',
          description: 'First Name',
        },
        lastName: {
          type: 'string',
          example: 'Doe',
          description: 'Last Name',
        },
      },
    },
  })
  @ApiResponse({
    status: 201,
    description: 'User registered successfully.',
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid registration data.',
  })
  @ApiResponse({
    status: 409,
    description: 'Unable to create account with the provided email.',
  })
  @Post('register')
  @AuthThrottle()
  async register(
    @Body(new ZodValidationPipe(registerSchema)) dto: RegisterDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.register(dto);

    this.setRefreshCookie(res, result.refreshToken);

    return successResponse(result);
  }

  @ApiOperation({
    summary: 'Authenticate a user',
    description:
      'Authenticates the user and returns an access/refresh token pair. The refresh token is also set as an httpOnly cookie.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['email', 'password'],
      properties: {
        email: {
          type: 'string',
          format: 'email',
          example: 'johndoe@example.com',
          description: 'Email',
        },
        password: {
          type: 'string',
          format: 'password',
          example: 'password',
          description: 'Password',
        },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'User authenticated successfully.',
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid authentication data.',
  })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @AuthThrottle()
  async login(
    @Body(new ZodValidationPipe(loginSchema)) dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.login(dto);

    this.setRefreshCookie(res, result.refreshToken);

    return successResponse(result);
  }

  @ApiOperation({
    summary: 'Rotate a refresh token',
    description:
      'Presents the refresh token (httpOnly cookie or body) and returns a fresh access/refresh pair. The presented token is revoked; reuse triggers whole-session revocation.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        refreshToken: {
          type: 'string',
          description:
            'Refresh token. Optional when the httpOnly cookie is sent.',
        },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Tokens rotated successfully.',
  })
  @ApiResponse({
    status: 401,
    description: 'Invalid or expired refresh token.',
  })
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @AuthThrottle()
  async refresh(
    @Req() req: Request,
    @Body(new ZodValidationPipe(refreshSchema)) body: RefreshDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.refresh(
      this.readPresentedRefreshToken(req, body),
    );

    this.setRefreshCookie(res, result.refreshToken);

    return successResponse(result);
  }

  @ApiOperation({
    summary: 'Log out',
    description:
      'Revokes the presented refresh token and clears its cookie. Always succeeds so logout never reveals token validity.',
  })
  @ApiResponse({
    status: 204,
    description: 'Logged out. No response body.',
  })
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @AuthThrottle()
  async logout(
    @Req() req: Request,
    @Body(new ZodValidationPipe(refreshSchema)) body: RefreshDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.authService.logout(
      this.readPresentedRefreshToken(req, body),
    );

    this.clearRefreshCookie(res);
  }
}
