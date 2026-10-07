import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { PrismaService } from '../src/database/prisma.service.js';
import request from 'supertest';

/**
 * Global rate-limit coverage (100 req/min `default` budget). Uses real app
 * instances with fresh throttle storage and sequential requests. Auth-route
 * burst behavior lives in security.e2e-spec.ts; functional suites bypass
 * the guard for determinism.
 */
describe('Global rate limiting E2E', () => {
  async function bootApp(): Promise<INestApplication> {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    const app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();

    return app;
  }

  it('throttles authenticated endpoints once the global budget is spent', async () => {
    const app = await bootApp();
    const email = `rate-limit-${Date.now()}@example.com`;

    try {
      const register = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({
          email,
          password: 'Password123!',
          firstName: 'Rate',
          lastName: 'Limit',
        })
        .expect(201);

      const token = register.body.data.accessToken as string;
      const server = app.getHttpServer();

      let succeeded = 0;
      let throttled: request.Response | undefined;

      // Register consumed 1 hit of the shared 100-budget.
      for (let i = 0; i < 105; i++) {
        const response = await request(server)
          .get('/api/v1/transactions?page=1&limit=1')
          .set('Authorization', `Bearer ${token}`);

        if (response.status === 429) {
          throttled = response;
          break;
        }

        expect(response.status).toBe(200);
        succeeded += 1;
      }

      expect(succeeded).toBeGreaterThanOrEqual(95);
      expect(throttled?.status).toBe(429);
      // NOTE: e2e apps boot via configureApp, which does not register the
      // production GlobalExceptionFilter (main.ts only), so throttler
      // rejections surface in Nest's default shape here, not the envelope.
      expect(throttled?.body).toMatchObject({ statusCode: 429 });
    } finally {
      const prisma = app.get(PrismaService);
      await prisma.user
        .deleteMany({ where: { email } })
        .catch(() => undefined);
      await app.close();
    }
  }, 60000);

  it('throttles unauthenticated endpoints under the same budget', async () => {
    const app = await bootApp();

    try {
      const server = app.getHttpServer();

      let succeeded = 0;
      let throttled: request.Response | undefined;

      for (let i = 0; i < 105; i++) {
        const response = await request(server).get('/api/v1');

        if (response.status === 429) {
          throttled = response;
          break;
        }

        expect(response.status).toBe(200);
        succeeded += 1;
      }

      expect(succeeded).toBeGreaterThanOrEqual(95);
      expect(throttled?.status).toBe(429);
      expect(throttled?.body).toMatchObject({ statusCode: 429 });
    } finally {
      await app.close();
    }
  }, 60000);
});
