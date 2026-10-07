import { APP_GUARD } from '@nestjs/core';
import { Controller, Get, INestApplication, Module } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import request from 'supertest';

@Controller('ping')
class PingController {
  @Get()
  ping() {
    return { ok: true };
  }
}

@Module({
  imports: [
    ThrottlerModule.forRoot({
      throttlers: [{ name: 'default', limit: 2, ttl: 60000 }],
    }),
  ],
  controllers: [PingController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
class ThrottlingTestModule {}

/** Proves guard enforcement + 429; functional suites bypass the guard. */
describe('Throttling (security)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [ThrottlingTestModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('allows requests within budget, then returns 429 with rate-limit headers', async () => {
    const first = await request(app.getHttpServer()).get('/ping').expect(200);

    expect(first.headers['x-ratelimit-limit']).toBe('2');
    expect(first.headers['x-ratelimit-remaining']).toBeDefined();

    await request(app.getHttpServer()).get('/ping').expect(200);

    const blocked = await request(app.getHttpServer()).get('/ping').expect(429);

    expect(blocked.headers['retry-after']).toBeDefined();
  });
});
