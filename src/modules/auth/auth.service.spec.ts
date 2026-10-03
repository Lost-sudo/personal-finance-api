import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from './auth.service.js';
import { UsersService } from '../users/users.service.js';
import { PasswordService } from './password.service.js';
import { JwtService } from '@nestjs/jwt';
import { ConflictException, UnauthorizedException } from '@nestjs/common';

describe('AuthService', () => {
  let service: AuthService;

  const userServiceMock = {
    findByEmail: vi.fn(),
    create: vi.fn(),
  };

  const passwordServiceMock = {
    hash: vi.fn(),
    verify: vi.fn(),
  };

  const jwtServiceMock = {
    signAsync: vi.fn(),
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

      const result = await service.register(dto);

      expect(result).toEqual({
        accessToken: 'access-token',
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

      expect(userServiceMock.findByEmail).toHaveBeenCalledWith('john@example.com');

      expect(passwordServiceMock.hash).toHaveBeenCalledWith('Password123!');

      expect(userServiceMock.create).toHaveBeenCalledWith(
        {
          email: 'john@example.com',
          passwordHash: 'hashed-password',
          firstName: 'John',
          lastName: 'Doe',
        }
      );

      expect(jwtServiceMock.signAsync).toHaveBeenCalledWith({ sub: 'user-123' });
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

      await expect(service.register(dto)).rejects.toBeInstanceOf(ConflictException);

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

      const result = await service.login(dto);

      expect(result).toEqual({
        accessToken: 'access-token',
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

      expect(userServiceMock.findByEmail).toHaveBeenCalledWith('john@example.com');

      expect(passwordServiceMock.verify).toHaveBeenCalledWith('hashed-password', 'Password123!');

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

      await expect(service.login(dto)).rejects.toThrow(UnauthorizedException);

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

      await expect(service.login(dto)).rejects.toThrow(UnauthorizedException);

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
});
