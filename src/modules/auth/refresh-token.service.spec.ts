import { createHash } from 'node:crypto';
import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../database/prisma.service.js';
import { UsersService } from '../users/users.service.js';
import { RefreshTokenService } from './refresh-token.service.js';

const REFRESH_SECRET = 'refresh-spec-secret-key-32-chars!!!';
const USER_ID = 'user-123';

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function activeUser() {
  return {
    id: USER_ID,
    email: 'john@example.com',
    passwordHash: 'hashed-password',
    firstName: 'John',
    lastName: 'Doe',
    isActive: true,
    emailVerifiedAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  };
}

function storedRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'rt-1',
    userId: USER_ID,
    tokenHash: sha256('raw-refresh-token'),
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    revokedAt: null,
    createdAt: new Date(),
    ...overrides,
  };
}

describe('RefreshTokenService', () => {
  const prismaMock = {
    refreshToken: {
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
    },
  };

  const jwtServiceMock = {
    signAsync: vi.fn(),
    verifyAsync: vi.fn(),
  };

  const configServiceMock = {
    get: vi.fn(),
    getOrThrow: vi.fn(),
  };

  const usersServiceMock = {
    findById: vi.fn(),
  };

  let service: RefreshTokenService;

  beforeEach(() => {
    vi.clearAllMocks();

    configServiceMock.getOrThrow.mockReturnValue(REFRESH_SECRET);
    configServiceMock.get.mockReturnValue('7d');
    prismaMock.refreshToken.deleteMany.mockResolvedValue({ count: 0 });

    service = new RefreshTokenService(
      prismaMock as unknown as PrismaService,
      jwtServiceMock as unknown as JwtService,
      configServiceMock as unknown as ConfigService,
      usersServiceMock as unknown as UsersService,
    );
  });

  describe('issue', () => {
    it('signs with the refresh secret and persists only the hash', async () => {
      jwtServiceMock.signAsync.mockResolvedValue('raw-refresh-token');
      prismaMock.refreshToken.create.mockResolvedValue(storedRow());

      const before = Date.now();
      const result = await service.issue(USER_ID);

      expect(result.refreshToken).toBe('raw-refresh-token');
      expect(result.expiresAt.getTime()).toBeGreaterThan(before);
      expect(result.expiresAt.getTime()).toBeLessThanOrEqual(
        before + 7 * 24 * 60 * 60 * 1000 + 5000,
      );

      expect(jwtServiceMock.signAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          sub: USER_ID,
          type: 'refresh',
          jti: expect.any(String),
        }),
        expect.objectContaining({ secret: REFRESH_SECRET }),
      );

      expect(prismaMock.refreshToken.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: USER_ID,
          tokenHash: sha256('raw-refresh-token'),
        }),
      });
      expect(
        prismaMock.refreshToken.create.mock.calls[0][0].data.tokenHash,
      ).not.toBe('raw-refresh-token');
    });

    it('rejects when refresh configuration is missing', async () => {
      configServiceMock.getOrThrow.mockImplementation(() => {
        throw new Error('missing jwt.refreshSecret');
      });

      await expect(service.issue(USER_ID)).rejects.toThrow(
        'missing jwt.refreshSecret',
      );
      expect(prismaMock.refreshToken.create).not.toHaveBeenCalled();
    });
  });

  describe('rotate', () => {
    it('revokes the presented token and returns the owner', async () => {
      jwtServiceMock.verifyAsync.mockResolvedValue({
        sub: USER_ID,
        jti: 'jti-1',
        type: 'refresh',
      });
      prismaMock.refreshToken.findUnique.mockResolvedValue(storedRow());
      usersServiceMock.findById.mockResolvedValue(activeUser());
      prismaMock.refreshToken.update.mockResolvedValue(storedRow());

      const result = await service.rotate('raw-refresh-token');

      expect(result).toEqual({ userId: USER_ID });
      expect(prismaMock.refreshToken.update).toHaveBeenCalledWith({
        where: { id: 'rt-1' },
        data: { revokedAt: expect.any(Date) },
      });
    });

    it('rejects expired refresh tokens without touching the family', async () => {
      jwtServiceMock.verifyAsync.mockResolvedValue({
        sub: USER_ID,
        jti: 'jti-1',
        type: 'refresh',
      });
      prismaMock.refreshToken.findUnique.mockResolvedValue(
        storedRow({ expiresAt: new Date(Date.now() - 1000) }),
      );

      await expect(service.rotate('raw-refresh-token')).rejects.toThrow(
        'Invalid or expired refresh token',
      );
      expect(prismaMock.refreshToken.update).not.toHaveBeenCalled();
      expect(prismaMock.refreshToken.updateMany).not.toHaveBeenCalled();
    });

    it('revokes every session when a rotated token is reused', async () => {
      jwtServiceMock.verifyAsync.mockResolvedValue({
        sub: USER_ID,
        jti: 'jti-1',
        type: 'refresh',
      });
      prismaMock.refreshToken.findUnique.mockResolvedValue(
        storedRow({ revokedAt: new Date() }),
      );
      prismaMock.refreshToken.updateMany.mockResolvedValue({ count: 3 });

      await expect(service.rotate('raw-refresh-token')).rejects.toThrow(
        UnauthorizedException,
      );
      expect(prismaMock.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { userId: USER_ID, revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
    });

    it('rejects unknown tokens without family revocation', async () => {
      jwtServiceMock.verifyAsync.mockResolvedValue({
        sub: USER_ID,
        jti: 'jti-unknown',
        type: 'refresh',
      });
      prismaMock.refreshToken.findUnique.mockResolvedValue(null);

      await expect(service.rotate('raw-refresh-token')).rejects.toThrow(
        'Invalid or expired refresh token',
      );
      expect(prismaMock.refreshToken.updateMany).not.toHaveBeenCalled();
    });

    it('rejects tokens that fail signature verification', async () => {
      jwtServiceMock.verifyAsync.mockRejectedValue(new Error('bad signature'));

      await expect(service.rotate('forged-token')).rejects.toThrow(
        'Invalid or expired refresh token',
      );
      expect(prismaMock.refreshToken.findUnique).not.toHaveBeenCalled();
    });

    it('rejects access tokens presented as refresh tokens', async () => {
      jwtServiceMock.verifyAsync.mockResolvedValue({ sub: USER_ID });

      await expect(service.rotate('access-token')).rejects.toThrow(
        'Invalid or expired refresh token',
      );
      expect(prismaMock.refreshToken.findUnique).not.toHaveBeenCalled();
    });

    it('rejects refresh tokens for inactive users', async () => {
      jwtServiceMock.verifyAsync.mockResolvedValue({
        sub: USER_ID,
        jti: 'jti-1',
        type: 'refresh',
      });
      prismaMock.refreshToken.findUnique.mockResolvedValue(storedRow());
      usersServiceMock.findById.mockResolvedValue({
        ...activeUser(),
        isActive: false,
      });

      await expect(service.rotate('raw-refresh-token')).rejects.toThrow(
        'Invalid or expired refresh token',
      );
    });
  });

  describe('revoke', () => {
    it('revokes by token hash without throwing', async () => {
      prismaMock.refreshToken.updateMany.mockResolvedValue({ count: 1 });

      await expect(service.revoke('raw-refresh-token')).resolves.toBeUndefined();
      expect(prismaMock.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { tokenHash: sha256('raw-refresh-token'), revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
    });
  });
});
