import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { registerSchema } from './dto/register.dto.js';
import { loginSchema } from './dto/login.dto.js';

describe('AuthController', () => {
  let controller: AuthController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        {
          provide: AuthService,
          useValue: {
            register: vi.fn(),
            login: vi.fn(),
            refresh: vi.fn(),
            logout: vi.fn(),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: vi.fn().mockReturnValue('development'),
          },
        },
      ],
    }).compile();

    controller = module.get<AuthController>(AuthController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('request validation', () => {
    it('should accept and normalize a valid registration payload', () => {
      const result = new ZodValidationPipe(registerSchema).transform(
        {
          email: '  John@Example.com ',
          password: 'Password123!',
          firstName: 'John',
          lastName: 'Doe',
        },
        { type: 'body' },
      ) as { email: string };

      expect(result.email).toBe('john@example.com');
    });

    it('should reject an invalid email on register', () => {
      expect(() =>
        new ZodValidationPipe(registerSchema).transform(
          {
            email: 'not-an-email',
            password: 'Password123!',
            firstName: 'John',
            lastName: 'Doe',
          },
          { type: 'body' },
        ),
      ).toThrow(BadRequestException);
    });

    it('should reject a short password on register', () => {
      expect(() =>
        new ZodValidationPipe(registerSchema).transform(
          {
            email: 'john@example.com',
            password: 'short',
            firstName: 'John',
            lastName: 'Doe',
          },
          { type: 'body' },
        ),
      ).toThrow(BadRequestException);
    });

    it('should reject an invalid email on login', () => {
      expect(() =>
        new ZodValidationPipe(loginSchema).transform(
          { email: 'not-an-email', password: 'Password123!' },
          { type: 'body' },
        ),
      ).toThrow(BadRequestException);
    });
  });
});
