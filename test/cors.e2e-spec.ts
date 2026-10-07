import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import request from 'supertest';

const ALLOWED_A = 'http://app.example.com';
const ALLOWED_B = 'http://admin.example.com';
const DISALLOWED = 'https://evil.example.com';

/**
 * CORS behavior coverage: explicit allowlist with credentials, rejection of
 * unlisted origins, and the safe empty default. Boots real app instances
 * with per-boot CORS_ORIGIN values (saved/restored around init).
 */
describe('CORS E2E', () => {
  async function bootWithOrigins(
    origins: string | undefined,
  ): Promise<INestApplication> {
    const saved = process.env.CORS_ORIGIN;

    if (origins === undefined) {
      delete process.env.CORS_ORIGIN;
    } else {
      process.env.CORS_ORIGIN = origins;
    }

    try {
      const moduleFixture: TestingModule = await Test.createTestingModule({
        imports: [AppModule],
      }).compile();

      const app = moduleFixture.createNestApplication();
      configureApp(app);
      await app.init();

      return app;
    } finally {
      if (saved === undefined) {
        delete process.env.CORS_ORIGIN;
      } else {
        process.env.CORS_ORIGIN = saved;
      }
    }
  }

  function preflight(server: unknown, origin: string) {
    return request(server as never)
      .options('/api/v1/auth/login')
      .set('Origin', origin)
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'Content-Type, Authorization');
  }

  describe('with a configured allowlist', () => {
    let app: INestApplication;

    beforeAll(async () => {
      app = await bootWithOrigins(`${ALLOWED_A},${ALLOWED_B}`);
    });

    afterAll(async () => {
      await app.close();
    });

    it('echoes an allowed origin on preflight', async () => {
      const response = await preflight(app.getHttpServer(), ALLOWED_A).expect(
        204,
      );

      expect(response.headers['access-control-allow-origin']).toBe(ALLOWED_A);
    });

    it('echoes each of multiple configured origins', async () => {
      const response = await preflight(app.getHttpServer(), ALLOWED_B).expect(
        204,
      );

      expect(response.headers['access-control-allow-origin']).toBe(ALLOWED_B);
    });

    it('allows credentials for trusted origins (cookie transport)', async () => {
      const response = await preflight(app.getHttpServer(), ALLOWED_A).expect(
        204,
      );

      expect(response.headers['access-control-allow-credentials']).toBe(
        'true',
      );
    });

    it('emits no allow-origin header for a disallowed origin', async () => {
      // Without ACAO the browser blocks the response; a lone credentials
      // header grants nothing on its own.
      const response = await preflight(app.getHttpServer(), DISALLOWED);

      expect(
        response.headers['access-control-allow-origin'],
      ).toBeUndefined();
    });
  });

  describe('with no configured origins', () => {
    let app: INestApplication;

    beforeAll(async () => {
      app = await bootWithOrigins(undefined);
    });

    afterAll(async () => {
      await app.close();
    });

    it('serves requests without CORS headers (safe default)', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1')
        .set('Origin', ALLOWED_A)
        .expect(200);

      expect(
        response.headers['access-control-allow-origin'],
      ).toBeUndefined();
    });
  });
});
