import { INestApplication } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { RecurringTransactionGenerationService } from '../src/modules/recurring-transactions/recurring-transaction-generation.service.js';

// Full lifecycle verification against real Postgres: API-created schedules
// flow through the real generation service (real transactions, real unique
// constraint, real Decimals) and back to API-visible state. Fixed sweep
// timestamps keep every run deterministic; the background cron job is
// stopped so only these tests mutate schedules.

interface TestUser {
  id: string;
  email: string;
  accessToken: string;
}

const SCHEDULED_START = '2026-01-01T09:00:00.000Z';

describe('RecurringTransactions lifecycle E2E', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let generation: RecurringTransactionGenerationService;
  let userA: TestUser;
  let userB: TestUser;
  const testPassword = 'Password123!';

  async function registerUser(email: string): Promise<TestUser> {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        email,
        password: testPassword,
        firstName: 'E2E',
        lastName: 'Test',
      })
      .expect(201);

    return {
      id: response.body.data.user.id as string,
      email,
      accessToken: response.body.data.accessToken as string,
    };
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();

    configureApp(app);

    await app.init();

    prisma = app.get(PrismaService);
    generation = app.get(RecurringTransactionGenerationService);

    // Determinism: stop the background sweep so only this spec's explicit
    // generation calls can create occurrences during the run.
    const registry = app.get(SchedulerRegistry);
    await Promise.all(
      [...registry.getCronJobs().values()].map(async (job) => {
        await job.stop();
      }),
    );

    const suffix = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
    userA = await registerUser(`rcl-owner-a-${suffix}@example.com`);
    userB = await registerUser(`rcl-owner-b-${suffix}@example.com`);
  });

  beforeEach(async () => {
    const userIds = [userA.id, userB.id];
    await prisma.transaction.deleteMany({
      where: { userId: { in: userIds } },
    });
    await prisma.recurringTransaction.deleteMany({
      where: { userId: { in: userIds } },
    });
    await prisma.account.deleteMany({
      where: { userId: { in: userIds } },
    });
    await prisma.category.deleteMany({
      where: { userId: { in: userIds } },
    });
  });

  afterAll(async () => {
    const userIds = [userA.id, userB.id];
    const emails = [userA.email, userB.email];

    await prisma.transaction
      .deleteMany({ where: { userId: { in: userIds } } })
      .catch(() => undefined);
    await prisma.recurringTransaction
      .deleteMany({ where: { userId: { in: userIds } } })
      .catch(() => undefined);
    await prisma.account
      .deleteMany({ where: { userId: { in: userIds } } })
      .catch(() => undefined);
    await prisma.category
      .deleteMany({ where: { userId: { in: userIds } } })
      .catch(() => undefined);
    await prisma.user
      .deleteMany({ where: { email: { in: emails } } })
      .catch(() => undefined);

    await app.close();
  });

  async function seedScheduleOwner() {
    const account = await request(app.getHttpServer())
      .post('/api/v1/accounts')
      .set('Authorization', `Bearer ${userA.accessToken}`)
      .send({ name: 'Primary Checking', type: 'BANK', initialBalance: 10000 })
      .expect(201)
      .then((response) => response.body.data);

    const category = await request(app.getHttpServer())
      .post('/api/v1/categories')
      .set('Authorization', `Bearer ${userA.accessToken}`)
      .send({ name: 'Food', type: 'EXPENSE' })
      .expect(201)
      .then((response) => response.body.data);

    const schedule = await request(app.getHttpServer())
      .post('/api/v1/recurring-transactions')
      .set('Authorization', `Bearer ${userA.accessToken}`)
      .send({
        type: 'EXPENSE',
        amount: 2500,
        description: 'Monthly rent',
        accountId: account.id,
        categoryId: category.id,
        frequency: 'MONTHLY',
        nextRunAt: SCHEDULED_START,
      })
      .expect(201)
      .then((response) => response.body.data);

    return { account, category, schedule };
  }

  it('should generate a linked transaction and advance nextRunAt', async () => {
    const { account, category, schedule } = await seedScheduleOwner();

    const outcomes = await generation.generateDueOccurrences(
      schedule.id,
      new Date('2026-01-15T09:00:00.000Z'),
      10,
    );

    expect(outcomes.map((outcome) => outcome.status)).toEqual([
      'generated',
      'not-due',
    ]);

    const stored = await prisma.transaction.findMany({
      where: { recurringTransactionId: schedule.id },
    });
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      userId: userA.id,
      type: 'EXPENSE',
      description: 'Monthly rent',
      accountId: account.id,
      categoryId: category.id,
      recurringTransactionId: schedule.id,
    });
    expect(Number(stored[0]?.amount)).toBe(2500);
    expect(stored[0]?.transactionDate).toEqual(new Date(SCHEDULED_START));
    expect(stored[0]?.scheduledFor).toEqual(new Date(SCHEDULED_START));

    const advanced = await prisma.recurringTransaction.findFirst({
      where: { id: schedule.id },
    });
    expect(advanced?.nextRunAt).toEqual(new Date('2026-02-01T09:00:00.000Z'));

    // The generated row is visible through the normal transaction API.
    const history = await request(app.getHttpServer())
      .get('/api/v1/transactions')
      .set('Authorization', `Bearer ${userA.accessToken}`)
      .expect(200);
    expect(history.body.meta).toMatchObject({ total: 1 });
    expect(history.body.data[0]).toMatchObject({
      id: stored[0]?.id,
      description: 'Monthly rent',
    });
  });

  it('should not duplicate an occurrence on repeat runs, then generate the next one', async () => {
    const { schedule } = await seedScheduleOwner();
    const sweep = new Date('2026-01-15T09:00:00.000Z');

    await generation.generateDueOccurrences(schedule.id, sweep, 10);
    const repeat = await generation.generateDueOccurrences(
      schedule.id,
      sweep,
      10,
    );

    expect(repeat).toEqual([{ status: 'not-due' }]);
    await expect(
      prisma.transaction.count({
        where: { recurringTransactionId: schedule.id },
      }),
    ).resolves.toBe(1);

    const next = await generation.generateDueOccurrences(
      schedule.id,
      new Date('2026-02-15T09:00:00.000Z'),
      10,
    );

    expect(next.map((outcome) => outcome.status)).toEqual([
      'generated',
      'not-due',
    ]);
    await expect(
      prisma.transaction.count({
        where: { recurringTransactionId: schedule.id },
      }),
    ).resolves.toBe(2);
  });

  it('should create exactly one row under real concurrent attempts', async () => {
    const { schedule } = await seedScheduleOwner();
    const sweep = new Date('2026-01-15T09:00:00.000Z');

    const [first, second] = await Promise.all([
      generation.generateDueOccurrences(schedule.id, sweep, 10),
      generation.generateDueOccurrences(schedule.id, sweep, 10),
    ]);

    const statuses = [...first, ...second]
      .map((outcome) => outcome.status)
      .sort();
    // One worker wins per occurrence; the interleaving decides which run
    // sees what, but the row count is always exact.
    expect(statuses).toContain('generated');
    expect(statuses).not.toContain('inactive');

    const rows = await prisma.transaction.findMany({
      where: { recurringTransactionId: schedule.id },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.scheduledFor).toEqual(new Date(SCHEDULED_START));
  });

  it('should reflect generated transactions in account balances', async () => {
    const { account } = await seedScheduleOwner();

    const due = await prisma.recurringTransaction.findFirstOrThrow({
      where: { userId: userA.id },
    });

    await generation.generateDueOccurrences(
      due.id,
      new Date('2026-01-15T09:00:00.000Z'),
      10,
    );

    const balance = await request(app.getHttpServer())
      .get(`/api/v1/accounts/${account.id}/balance`)
      .set('Authorization', `Bearer ${userA.accessToken}`)
      .expect(200);

    expect(balance.body).toMatchObject({
      success: true,
      data: {
        accountId: account.id,
        expenses: '2500.00',
        balance: '7500.00',
      },
    });
  });

  it('should keep other users out of the lifecycle', async () => {
    const { schedule } = await seedScheduleOwner();

    await request(app.getHttpServer())
      .get(`/api/v1/recurring-transactions/${schedule.id}`)
      .set('Authorization', `Bearer ${userB.accessToken}`)
      .expect(404);

    await request(app.getHttpServer())
      .patch(`/api/v1/recurring-transactions/${schedule.id}`)
      .set('Authorization', `Bearer ${userB.accessToken}`)
      .send({ description: 'Hacked' })
      .expect(404);

    await request(app.getHttpServer())
      .delete(`/api/v1/recurring-transactions/${schedule.id}`)
      .set('Authorization', `Bearer ${userB.accessToken}`)
      .expect(404);

    const list = await request(app.getHttpServer())
      .get('/api/v1/recurring-transactions')
      .set('Authorization', `Bearer ${userB.accessToken}`)
      .expect(200);
    expect(list.body.meta).toMatchObject({ total: 0 });

    // Generation is system-level (no user-facing trigger exists), so the
    // schedule still generates for its owner only.
    const outcomes = await generation.generateDueOccurrences(
      schedule.id,
      new Date('2026-01-15T09:00:00.000Z'),
      10,
    );
    expect(outcomes[0]?.status).toBe('generated');
    const row = await prisma.transaction.findFirstOrThrow({
      where: { recurringTransactionId: schedule.id },
    });
    expect(row.userId).toBe(userA.id);
  });

  it('should apply schedule edits to future occurrences only', async () => {
    const { schedule } = await seedScheduleOwner();

    await generation.generateDueOccurrences(
      schedule.id,
      new Date('2026-01-15T09:00:00.000Z'),
      1,
    );

    await request(app.getHttpServer())
      .patch(`/api/v1/recurring-transactions/${schedule.id}`)
      .set('Authorization', `Bearer ${userA.accessToken}`)
      .send({ amount: 3000, description: 'New rent' })
      .expect(200);

    await generation.generateDueOccurrences(
      schedule.id,
      new Date('2026-02-15T09:00:00.000Z'),
      10,
    );

    const rows = await prisma.transaction.findMany({
      where: { recurringTransactionId: schedule.id },
      orderBy: { scheduledFor: 'asc' },
    });

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ description: 'Monthly rent' });
    expect(Number(rows[0]?.amount)).toBe(2500);
    expect(rows[1]).toMatchObject({ description: 'New rent' });
    expect(Number(rows[1]?.amount)).toBe(3000);
  });

  it('should pause generation and resume with catch-up', async () => {
    const { schedule } = await seedScheduleOwner();

    await generation.generateDueOccurrences(
      schedule.id,
      new Date('2026-01-15T09:00:00.000Z'),
      1,
    );

    await request(app.getHttpServer())
      .patch(`/api/v1/recurring-transactions/${schedule.id}`)
      .set('Authorization', `Bearer ${userA.accessToken}`)
      .send({ isActive: false })
      .expect(200);

    const paused = await generation.generateDueOccurrences(
      schedule.id,
      new Date('2026-03-15T09:00:00.000Z'),
      10,
    );
    expect(paused).toEqual([{ status: 'inactive' }]);
    await expect(
      prisma.transaction.count({
        where: { recurringTransactionId: schedule.id },
      }),
    ).resolves.toBe(1);

    await request(app.getHttpServer())
      .patch(`/api/v1/recurring-transactions/${schedule.id}`)
      .set('Authorization', `Bearer ${userA.accessToken}`)
      .send({ isActive: true })
      .expect(200);

    const resumed = await generation.generateDueOccurrences(
      schedule.id,
      new Date('2026-03-15T09:00:00.000Z'),
      10,
    );

    expect(resumed.map((outcome) => outcome.status)).toEqual([
      'generated',
      'generated',
      'not-due',
    ]);
    await expect(
      prisma.transaction.count({
        where: { recurringTransactionId: schedule.id },
      }),
    ).resolves.toBe(3);
  });

  it('should cap catch-up per run and continue on later runs', async () => {
    const { schedule } = await seedScheduleOwner();
    const sweep = new Date('2026-06-15T09:00:00.000Z');

    const first = await generation.generateDueOccurrences(
      schedule.id,
      sweep,
      2,
    );
    expect(first.map((outcome) => outcome.status)).toEqual([
      'generated',
      'generated',
    ]);

    const second = await generation.generateDueOccurrences(
      schedule.id,
      sweep,
      10,
    );
    expect(second.map((outcome) => outcome.status)).toEqual([
      'generated',
      'generated',
      'generated',
      'generated',
      'not-due',
    ]);

    const rows = await prisma.transaction.findMany({
      where: { recurringTransactionId: schedule.id },
      orderBy: { scheduledFor: 'asc' },
    });
    expect(
      rows.map((row) => (row.scheduledFor as Date).toISOString()),
    ).toEqual([
      '2026-01-01T09:00:00.000Z',
      '2026-02-01T09:00:00.000Z',
      '2026-03-01T09:00:00.000Z',
      '2026-04-01T09:00:00.000Z',
      '2026-05-01T09:00:00.000Z',
      '2026-06-01T09:00:00.000Z',
    ]);
  });

  it('should preserve history when the schedule is deleted', async () => {
    const { schedule } = await seedScheduleOwner();

    await generation.generateDueOccurrences(
      schedule.id,
      new Date('2026-01-15T09:00:00.000Z'),
      10,
    );

    await request(app.getHttpServer())
      .delete(`/api/v1/recurring-transactions/${schedule.id}`)
      .set('Authorization', `Bearer ${userA.accessToken}`)
      .expect(204);

    const history = await prisma.transaction.findMany({
      where: { description: 'Monthly rent' },
    });
    expect(history).toHaveLength(1);
    expect(history[0]?.recurringTransactionId).toBeNull();
    expect(Number(history[0]?.amount)).toBe(2500);
  });

  it('should expose the full CRUD contract during the lifecycle', async () => {
    const { schedule } = await seedScheduleOwner();

    const created = await request(app.getHttpServer())
      .post('/api/v1/recurring-transactions')
      .set('Authorization', `Bearer ${userA.accessToken}`)
      .send({
        type: 'INCOME',
        amount: 50000,
        accountId: schedule.accountId,
        frequency: 'MONTHLY',
        nextRunAt: '2026-02-01T09:00:00.000Z',
      })
      .expect(201);
    expect(created.body).toMatchObject({ success: true });

    const list = await request(app.getHttpServer())
      .get('/api/v1/recurring-transactions')
      .set('Authorization', `Bearer ${userA.accessToken}`)
      .expect(200);
    expect(list.body.meta).toMatchObject({ total: 2 });

    await request(app.getHttpServer())
      .get(`/api/v1/recurring-transactions/${schedule.id}`)
      .set('Authorization', `Bearer ${userA.accessToken}`)
      .expect(200);

    await request(app.getHttpServer())
      .patch(`/api/v1/recurring-transactions/${schedule.id}`)
      .set('Authorization', `Bearer ${userA.accessToken}`)
      .send({ description: 'Lifecycle rent' })
      .expect(200)
      .then((response) => {
        expect(response.body.data).toMatchObject({
          description: 'Lifecycle rent',
        });
      });

    await request(app.getHttpServer())
      .delete(`/api/v1/recurring-transactions/${created.body.data.id}`)
      .set('Authorization', `Bearer ${userA.accessToken}`)
      .expect(204);
  });
});
