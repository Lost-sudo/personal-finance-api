import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from './auth.service.js';
import { UsersService } from '../users/users.service.js';
import { PasswordService } from './password.service.js';
import { RefreshTokenService } from './refresh-token.service.js';
import { JwtService } from '@nestjs/jwt';
import { ConflictException, UnauthorizedException } from '@nestjs/common';

describe('AuthService', () => {
  let service: AuthService;

  const userServiceMock = {
    findByEmail: vi.fn(),
    findById: vi.fn(),
    create: vi.fn(),
  };

  const passwordServiceMock = {
    hash: vi.fn(),
    verify: vi.fn(),
  };

  const jwtServiceMock = {
    signAsync: vi.fn(),
  };

  const refreshTokenServiceMock = {
    issue: vi.fn(),
    rotate: vi.fn(),
    revoke: vi.fn(),
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: UsersService,
          useValue: userServiceMock,
        },
        {
          provide: PasswordService,
          useValue: passwordServiceMock,
        },
        {
          provide: JwtService,
          useValue: jwtServiceMock,
        },
        {
          provide: RefreshTokenService,
          useValue: refreshTokenServiceMock,
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('register', () => {
    it('should register a new user', async () => {
      const dto = {
        email: 'John@Example.com',
        password: 'Password123!',
        firstName: 'John',
        lastName: 'Doe',
      };

      const createdAt = new Date('2026-01-01T00:00:00.000Z');
      const updatedAt = new Date('2026-01-01T00:00:00.000Z');

      const user = {
        id: 'user-123',
        email: 'john@example.com',
        passwordHash: 'hashed-password',
        firstName: 'John',
        lastName: 'Doe',
        isActive: true,
        emailVerifiedAt: null,
        createdAt,
        updatedAt,
      };

      userServiceMock.findByEmail.mockResolvedValue(null);

      passwordServiceMock.hash.mockResolvedValue('hashed-password');

      userServiceMock.create.mockResolvedValue(user);

      jwtServiceMock.signAsync.mockResolvedValue('access-token');

      refreshTokenServiceMock.issue.mockResolvedValue({
        refreshToken: 'refresh-token',
        expiresAt: new Date('2026-01-08T00:00:00.000Z'),
      });

      const result = await service.register(dto);

      expect(result).toEqual({
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        user: {
          id: 'user-123',
          email: 'john@example.com',
          firstName: 'John',
          lastName: 'Doe',
          isActive: true,
          emailVerifiedAt: null,
          createdAt,
          updatedAt,
        },
      });

      expect(userServiceMock.findByEmail).toHaveBeenCalledWith(
        'john@example.com',
      );

      expect(passwordServiceMock.hash).toHaveBeenCalledWith('Password123!');

      expect(userServiceMock.create).toHaveBeenCalledWith({
        email: 'john@example.com',
        passwordHash: 'hashed-password',
        firstName: 'John',
        lastName: 'Doe',
      });

      expect(jwtServiceMock.signAsync).toHaveBeenCalledWith({
        sub: 'user-123',
      });
    });

    it('should throw ConflictException when the email already exists', async () => {
      const dto = {
        email: 'john@example.com',
        password: 'Password123!',
        firstName: 'John',
        lastName: 'Doe',
      };

      userServiceMock.findByEmail.mockResolvedValue({
        id: 'existing-user',
        email: 'john@example.com',
      });

      await expect(service.register(dto)).rejects.toBeInstanceOf(
        ConflictException,
      );

      expect(passwordServiceMock.hash).not.toHaveBeenCalled();

      expect(userServiceMock.create).not.toHaveBeenCalled();

      expect(jwtServiceMock.signAsync).not.toHaveBeenCalled();
    });
  });

  describe('login', () => {
    it('should login an existing user', async () => {
      const dto = {
        email: 'John@Example.com',
        password: 'Password123!',
      };

      const createdAt = new Date('2026-01-01T00:00:00.000Z');
      const updatedAt = new Date('2026-01-01T00:00:00.000Z');

      const user = {
        id: 'user-123',
        email: 'john@example.com',
        passwordHash: 'hashed-password',
        firstName: 'John',
        lastName: 'Doe',
        isActive: true,
        emailVerifiedAt: null,
        createdAt,
        updatedAt,
      };

      userServiceMock.findByEmail.mockResolvedValue(user);

      passwordServiceMock.verify.mockResolvedValue(true);

      jwtServiceMock.signAsync.mockResolvedValue('access-token');

      refreshTokenServiceMock.issue.mockResolvedValue({
        refreshToken: 'refresh-token',
        expiresAt: new Date('2026-01-08T00:00:00.000Z'),
      });

      const result = await service.login(dto);

      expect(result).toEqual({
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        user: {
          id: 'user-123',
          email: 'john@example.com',
          firstName: 'John',
          lastName: 'Doe',
          isActive: true,
          emailVerifiedAt: null,
          createdAt,
          updatedAt,
        },
      });

      expect(userServiceMock.findByEmail).toHaveBeenCalledWith(
        'john@example.com',
      );

      expect(passwordServiceMock.verify).toHaveBeenCalledWith(
        'hashed-password',
        'Password123!',
      );

      expect(jwtServiceMock.signAsync).toHaveBeenCalledWith({
        sub: 'user-123',
      });
    });

    it('should throw UnauthorizedException when the user is not found', async () => {
      const dto = {
        email: 'john@example.com',
        password: 'Password123!',
      };

      userServiceMock.findByEmail.mockResolvedValue(null);

      // Unknown emails and wrong passwords must be indistinguishable.
      await expect(service.login(dto)).rejects.toThrow(
        'Invalid email or password',
      );

      expect(passwordServiceMock.verify).not.toHaveBeenCalled();

      expect(jwtServiceMock.signAsync).not.toHaveBeenCalled();
    });

    it('should throw UnauthorizedException when the password is incorrect', async () => {
      const dto = {
        email: 'john@example.com',
        password: 'Password123!',
      };

      const user = {
        id: 'user-123',
        email: 'john@example.com',
        passwordHash: 'hashed-password',
        firstName: 'John',
        lastName: 'Doe',
        isActive: true,
        emailVerifiedAt: null,
      };

      userServiceMock.findByEmail.mockResolvedValue(user);

      passwordServiceMock.verify.mockResolvedValue(false);

      await expect(service.login(dto)).rejects.toThrow(
        'Invalid email or password',
      );

      expect(jwtServiceMock.signAsync).not.toHaveBeenCalled();
    });

    it('should throw UnauthorizedException when the user is inactive', async () => {
      const dto = {
        email: 'john@example.com',
        password: 'Password123!',
      };

      const user = {
        id: 'user-123',
        email: 'john@example.com',
        passwordHash: 'hashed-password',
        firstName: 'John',
        lastName: 'Doe',
        isActive: false,
        emailVerifiedAt: null,
      };

      userServiceMock.findByEmail.mockResolvedValue(user);

      passwordServiceMock.verify.mockResolvedValue(true);

      await expect(service.login(dto)).rejects.toThrow(UnauthorizedException);

      expect(jwtServiceMock.signAsync).not.toHaveBeenCalled();
    });
  });

  describe('refresh', () => {
    const createdAt = new Date('2026-01-01T00:00:00.000Z');
    const updatedAt = new Date('2026-01-01T00:00:00.000Z');

    const user = {
      id: 'user-123',
      email: 'john@example.com',
      passwordHash: 'hashed-password',
      firstName: 'John',
      lastName: 'Doe',
      isActive: true,
      emailVerifiedAt: null,
      createdAt,
      updatedAt,
    };

    it('should rotate into a fresh pair', async () => {
      refreshTokenServiceMock.rotate.mockResolvedValue({ userId: 'user-123' });
      userServiceMock.findById.mockResolvedValue(user);
      jwtServiceMock.signAsync.mockResolvedValue('new-access-token');
      refreshTokenServiceMock.issue.mockResolvedValue({
        refreshToken: 'new-refresh-token',
        expiresAt: new Date('2026-01-08T00:00:00.000Z'),
      });

      const result = await service.refresh('old-refresh-token');

      expect(refreshTokenServiceMock.rotate).toHaveBeenCalledWith(
        'old-refresh-token',
      );
      expect(jwtServiceMock.signAsync).toHaveBeenCalledWith({
        sub: 'user-123',
      });
      expect(result).toEqual({
        accessToken: 'new-access-token',
        refreshToken: 'new-refresh-token',
        user: {
          id: 'user-123',
          email: 'john@example.com',
          firstName: 'John',
          lastName: 'Doe',
          isActive: true,
          emailVerifiedAt: null,
          createdAt,
          updatedAt,
        },
      });
    });

    it('should reject a missing token with the generic error', async () => {
      await expect(service.refresh(undefined)).rejects.toThrow(
        'Invalid or expired refresh token',
      );

      expect(refreshTokenServiceMock.rotate).not.toHaveBeenCalled();
    });

    it('should reject when the rotated user is inactive', async () => {
      refreshTokenServiceMock.rotate.mockResolvedValue({ userId: 'user-123' });
      userServiceMock.findById.mockResolvedValue({
        ...user,
        isActive: false,
      });

      await expect(service.refresh('old-refresh-token')).rejects.toThrow(
        UnauthorizedException,
      );

      expect(jwtServiceMock.signAsync).not.toHaveBeenCalled();
      expect(refreshTokenServiceMock.issue).not.toHaveBeenCalled();
    });

    it('should reject when the rotated user no longer exists', async () => {
      refreshTokenServiceMock.rotate.mockResolvedValue({ userId: 'user-123' });
      userServiceMock.findById.mockResolvedValue(null);

      await expect(service.refresh('old-refresh-token')).rejects.toThrow(
        UnauthorizedException,
      );

      expect(jwtServiceMock.signAsync).not.toHaveBeenCalled();
    });
  });

  describe('logout', () => {
    it('should revoke the presented token', async () => {
      refreshTokenServiceMock.revoke.mockResolvedValue(undefined);

      await service.logout('raw-refresh-token');

      expect(refreshTokenServiceMock.revoke).toHaveBeenCalledWith(
        'raw-refresh-token',
      );
    });

    it('should resolve silently without a token', async () => {
      await expect(service.logout(undefined)).resolves.toBeUndefined();

      expect(refreshTokenServiceMock.revoke).not.toHaveBeenCalled();
    });
  });
});
