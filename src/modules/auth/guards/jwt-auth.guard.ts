import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { UsersService } from '../../users/users.service.js';
import type { AuthenticatedUser } from '../types/authenticated-user.type.js';
import type { JwtPayload } from '../types/jwt-payload.type.js';

interface AuthenticatedRequest {
  headers: {
    authorization?: string;
  };
  user?: AuthenticatedUser;
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly usersService: UsersService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();

    const token = this.extractBearerToken(request.headers.authorization);

    if (!token) {
      throw new UnauthorizedException('Missing or invalid access token');
    }

    let payload: JwtPayload;

    try {
      payload = await this.jwtService.verifyAsync<JwtPayload>(token, {
        secret: this.configService.getOrThrow<string>('jwt.secret'),
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired access token');
    }

    if (!payload.sub || typeof payload.sub !== 'string') {
      throw new UnauthorizedException('Invalid or expired access token');
    }

    const user = await this.usersService.findById(payload.sub);

    if (!user || !user.isActive) {
      throw new UnauthorizedException('Invalid or expired access token');
    }

    request.user = { id: user.id };

    return true;
  }

  private extractBearerToken(header: string | undefined): string | undefined {
    if (!header) {
      return undefined;
    }

    const [scheme, token] = header.split(' ');

    if (scheme !== 'Bearer' || !token) {
      return undefined;
    }

    return token;
  }
}
