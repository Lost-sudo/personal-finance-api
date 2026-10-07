import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/database/prisma.service.js';
import { Test, TestingModule } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import request from 'supertest';

describe('Auth E2E', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  let testEmail: string;
  const testPassword = 'Password123!';

  beforeAll(async () => {
    // Throttling bypassed for determinism; see security.e2e-spec.ts.
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideGuard(ThrottlerGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleFixture.createNestApplication();

    configureApp(app);

    await app.init();

    prisma = app.get(PrismaService);

    testEmail = `e2e-test-${Date.now()}@example.com`;
  });

  afterAll(async () => {
    await prisma.user
      .deleteMany({
        where: {
          email: testEmail,
        },
      })
      .catch(() => undefined);

    await app.close();
  });

  describe('POST /api/v1/auth/register', () => {
    it('should register a new user', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({
          email: testEmail,
          password: testPassword,
          firstName: 'E2E',
          lastName: 'Test',
        })
        .expect(201);

      expect(response.body).toBeDefined();

      expect(response.body).toMatchObject({
        success: true,
      });

      expect(response.body.data).toBeDefined();

      expect(response.body.data.accessToken).toEqual(expect.any(String));

      expect(response.body.data.user).toMatchObject({
        email: testEmail,
        firstName: 'E2E',
        lastName: 'Test',
        isActive: true,
        emailVerifiedAt: null,
      });
    });

    it('should reject an invalid payload with 400', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({
          email: 'not-an-email',
          password: 'short',
          firstName: 'E2E',
          lastName: 'Test',
        })
        .expect(400);
    });

    it('should not reveal account existence on duplicate registration', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({
          email: testEmail,
          password: testPassword,
          firstName: 'E2E',
          lastName: 'Test',
        })
        .expect(409);

      const message = String(response.body.message ?? '');
      expect(message).toBe(
        'Unable to create account with the provided email.',
      );
      expect(message.toLowerCase()).not.toContain(testEmail.toLowerCase());
      for (const hint of ['exists', 'taken', 'duplicate', 'already']) {
        expect(message.toLowerCase()).not.toContain(hint);
      }
    });
  });

  describe('POST /api/v1/auth/login', () => {
    it('should login with the registered credentials (case-insensitive email)', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({
          email: testEmail.toUpperCase(),
          password: testPassword,
        })
        .expect(200);

      expect(response.body).toMatchObject({
        success: true,
      });

      expect(response.body.data.accessToken).toEqual(expect.any(String));

      expect(response.body.data.user).toMatchObject({
        email: testEmail,
        firstName: 'E2E',
        lastName: 'Test',
        isActive: true,
      });
    });

    it('should reject an incorrect password', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({
          email: testEmail,
          password: 'WrongPassword123!',
        })
        .expect(401);
    });

    it('should return the identical failure for unknown emails', async () => {
      const wrongPassword = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({
          email: testEmail,
          password: 'WrongPassword123!',
        })
        .expect(401);

      const unknownEmail = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({
          email: `unknown-${Date.now()}@example.com`,
          password: 'WrongPassword123!',
        })
        .expect(401);

      expect(unknownEmail.body.message).toBe(wrongPassword.body.message);
      expect(unknownEmail.body.message).toBe('Invalid email or password');
    });

    it('should not leak sensitive details in login failures', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({
          email: testEmail,
          password: 'WrongPassword123!',
        })
        .expect(401);

      const serialized = JSON.stringify(response.body).toLowerCase();
      for (const leak of [
        'passwordhash',
        'stack',
        'prisma',
        'accesstoken',
        'refreshtoken',
      ]) {
        expect(serialized).not.toContain(leak);
      }
    });
  });
});
