import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { PrismaService } from '../src/database/prisma.service.js';
import request from 'supertest';

/** Real-budget regression suite (no guard bypass). Auth calls numbered per the 10/min budget; login/register also feel the strict 5/min budget. */
describe('Security hardening E2E', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  let testEmail: string;
  const testPassword = 'Password123!';
  let accessToken: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();

    configureApp(app);

    await app.init();

    prisma = app.get(PrismaService);

    testEmail = `sec-e2e-${Date.now()}@example.com`;
  });

  afterAll(async () => {
    await prisma.user
      .deleteMany({ where: { email: testEmail } })
      .catch(() => undefined);

    await app.close();
  });

  it('registers with a token pair, httpOnly cookie, and security headers', async () => {
    // auth #1
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        email: testEmail,
        password: testPassword,
        firstName: 'Sec',
        lastName: 'E2E',
      })
      .expect(201);

    expect(response.body.data.accessToken).toEqual(expect.any(String));
    expect(response.body.data.refreshToken).toEqual(expect.any(String));
    expect(JSON.stringify(response.body)).not.toContain('passwordHash');

    accessToken = response.body.data.accessToken as string;

    const cookies: string[] = [response.headers['set-cookie'] ?? []].flat();
    const refreshCookie = cookies.find((c) => c.startsWith('refresh_token='));
    expect(refreshCookie).toBeDefined();
    expect(refreshCookie?.toLowerCase()).toContain('httponly');
    expect(refreshCookie?.toLowerCase()).toContain('samesite=strict');
    expect(refreshCookie).toContain('Path=/api/v1/auth');

    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(response.headers['x-dns-prefetch-control']).toBe('off');
    expect(response.headers['x-powered-by']).toBeUndefined();
    expect(response.headers['x-ratelimit-limit']).toBeDefined();
  });

  it('rejects unexpected fields (strict schemas)', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/transactions')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        type: 'EXPENSE',
        amount: 10,
        transactionDate: new Date().toISOString(),
        accountId: '550e8400-e29b-41d4-a716-446655440000',
        userId: 'attacker-chosen-id',
      })
      .expect(400);
  });

  it('rejects oversized JSON bodies with the global error format', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/transactions')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ type: 'EXPENSE', amount: 1, filler: 'x'.repeat(200_000) })
      .expect(413);

    expect(response.body).toMatchObject({
      success: false,
      statusCode: 413,
      message: 'Request entity too large',
    });
    expect(response.body.timestamp).toEqual(expect.any(String));
    expect(response.body.path).toBe('/api/v1/transactions');
  });

  it('rotates refresh tokens and rejects reuse with a generic error', async () => {
    const agent = request.agent(app.getHttpServer());

    // auth #2
    const login = await agent
      .post('/api/v1/auth/login')
      .send({ email: testEmail, password: testPassword })
      .expect(200);

    const firstRefresh = login.body.data.refreshToken as string;
    expect(firstRefresh).toEqual(expect.any(String));

    // auth #3 — presented via the httpOnly cookie the agent jar holds.
    const rotated = await agent.post('/api/v1/auth/refresh').send({}).expect(200);

    expect(rotated.body.data.accessToken).toEqual(expect.any(String));
    expect(rotated.body.data.refreshToken).toEqual(expect.any(String));
    expect(rotated.body.data.refreshToken).not.toBe(firstRefresh);

    // auth #4 — the rotated-out token must now be dead.
    const reuse = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: firstRefresh })
      .expect(401);

    expect(reuse.body.message).toMatch(/invalid or expired/i);
  });

  it('logs out (revokes + clears cookie) and rejects further refresh', async () => {
    const agent = request.agent(app.getHttpServer());

    // auth #5
    const login = await agent
      .post('/api/v1/auth/login')
      .send({ email: testEmail, password: testPassword })
      .expect(200);

    // auth #6 (logout itself is an auth route).
    const logout = await agent.post('/api/v1/auth/logout').send({}).expect(204);

    const cleared: string[] = [logout.headers['set-cookie'] ?? []].flat();
    const clearedCookie = cleared.find((c) =>
      c.startsWith('refresh_token='),
    );
    expect(clearedCookie).toBeDefined();
    // The cookie must actually expire (Max-Age=0 or a past Expires),
    // not just be overwritten.
    expect(clearedCookie).toMatch(/max-age=0|expires=thu, 01 jan 1970/i);

    // Separate client presenting the revoked token body-side.
    await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: login.body.data.refreshToken as string })
      .expect(401);
  });

  it('throttles authentication endpoints', async () => {
    // Fresh app instance: deterministic burst against its own storage.
    const burstModule: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    const burstApp = burstModule.createNestApplication();
    configureApp(burstApp);
    await burstApp.init();

    try {
      const burstEmail = `sec-burst-${Date.now()}@example.com`;
      await request(burstApp.getHttpServer())
        .post('/api/v1/auth/register')
        .send({
          email: burstEmail,
          password: testPassword,
          firstName: 'Burst',
          lastName: 'Test',
        })
        .expect(201);

      // Strict budget is 5/min per login endpoint (buckets are per route,
      // so register does not consume it): 5 logins pass.
      for (let i = 0; i < 5; i++) {
        await request(burstApp.getHttpServer())
          .post('/api/v1/auth/login')
          .send({ email: burstEmail, password: testPassword })
          .expect(200);
      }

      // The 6th login exceeds the strict budget.
      const throttled = await request(burstApp.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: burstEmail, password: testPassword })
        .expect(429);

      expect(
        throttled.headers['retry-after'] ??
          throttled.headers['retry-after-auth'] ??
          throttled.headers['retry-after-authstrict'],
      ).toBeDefined();

      // Throttling reveals nothing about account existence: an unknown
      // email gets the same 429 instead of a 401.
      await request(burstApp.getHttpServer())
        .post('/api/v1/auth/login')
        .send({
          email: `unknown-${Date.now()}@example.com`,
          password: testPassword,
        })
        .expect(429);

      const prismaInner = burstApp.get(PrismaService);
      await prismaInner.user
        .deleteMany({ where: { email: burstEmail } })
        .catch(() => undefined);
    } finally {
      await burstApp.close();
    }
  }, 60000);
});
