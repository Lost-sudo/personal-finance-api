import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomUUID } from 'node:crypto';
import { PrismaService } from '../../database/prisma.service.js';
import { UsersService } from '../users/users.service.js';

interface RefreshPayload {
  sub: string;
  jti: string;
  type: 'refresh';
  iat?: number;
  exp?: number;
}

// Generic: never reveal why a refresh token failed.
const GENERIC_REFRESH_ERROR = 'Invalid or expired refresh token';

// Parses narrow JWT durations (30s/15m/12h/7d) into milliseconds.
export function parseDurationMs(value: string): number {
  const match = /^(\d+)([smhd])$/.exec(value.trim());

  if (!match) {
    throw new Error(`Invalid duration: ${value}`);
  }

  const amount = Number(match[1]);
  const multipliers: Record<string, number> = {
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
  };

  return amount * (multipliers[match[2]] ?? 0);
}

@Injectable()
export class RefreshTokenService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly usersService: UsersService,
  ) {}

  hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  // Issues a refresh JWT, persisting only its SHA-256 hash.
  async issue(
    userId: string,
  ): Promise<{ refreshToken: string; expiresAt: Date }> {
    const refreshSecret =
      this.configService.getOrThrow<string>('jwt.refreshSecret');
    const refreshExpiresIn =
      this.configService.get<string>('jwt.refreshExpiresIn') ?? '7d';

    const jti = randomUUID();
    const refreshToken = await this.jwtService.signAsync(
      { sub: userId, jti, type: 'refresh' },
      { secret: refreshSecret, expiresIn: refreshExpiresIn as never },
    );

    const expiresAt = new Date(Date.now() + parseDurationMs(refreshExpiresIn));

    // Prune the user's expired rows; failures must not block login.
    await this.prisma.refreshToken
      .deleteMany({ where: { userId, expiresAt: { lt: new Date() } } })
      .catch(() => undefined);

    await this.prisma.refreshToken.create({
      data: { userId, tokenHash: this.hashToken(refreshToken), expiresAt },
    });

    return { refreshToken, expiresAt };
  }

  // Validates and revokes the token (rotation); reuse revokes all sessions.
  async rotate(rawToken: string): Promise<{ userId: string }> {
    const refreshSecret =
      this.configService.getOrThrow<string>('jwt.refreshSecret');

    let payload: RefreshPayload;

    try {
      payload = await this.jwtService.verifyAsync<RefreshPayload>(rawToken, {
        secret: refreshSecret,
      });
    } catch {
      throw new UnauthorizedException(GENERIC_REFRESH_ERROR);
    }

    if (!payload?.sub || payload.type !== 'refresh' || !payload.jti) {
      throw new UnauthorizedException(GENERIC_REFRESH_ERROR);
    }

    const tokenHash = this.hashToken(rawToken);
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
    });

    if (
      !stored ||
      stored.revokedAt ||
      stored.expiresAt.getTime() <= Date.now() ||
      stored.userId !== payload.sub
    ) {
      // Rotated-token reuse signals theft: revoke every session.
      if (stored?.revokedAt && stored.userId === payload.sub) {
        await this.revokeAll(payload.sub);
      }

      throw new UnauthorizedException(GENERIC_REFRESH_ERROR);
    }

    const user = await this.usersService.findById(payload.sub);

    if (!user || !user.isActive) {
      throw new UnauthorizedException(GENERIC_REFRESH_ERROR);
    }

    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    });

    return { userId: user.id };
  }

  /** Best-effort single-session revocation; never throws for logout paths. */
  async revoke(rawToken: string): Promise<void> {
    const tokenHash = this.hashToken(rawToken);

    await this.prisma.refreshToken.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async revokeAll(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}
