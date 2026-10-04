import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { PrismaService } from '../src/database/prisma.service.js';

interface TestUser {
  id: string;
  email: string;
  accessToken: string;
}

const TRANSACTION_DATE = '2026-01-15T08:30:00.000Z';

describe('Reports E2E', () => {
  let app: INestApplication;
  let prisma: PrismaService;
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

    const suffix = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
    userA = await registerUser(`rpt-owner-a-${suffix}@example.com`);
    userB = await registerUser(`rpt-owner-b-${suffix}@example.com`);
  });

  beforeEach(async () => {
    const userIds = [userA.id, userB.id];
    await prisma.transaction.deleteMany({
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

  function createAccount(token: string, payload: Record<string, unknown>) {
    return request(app.getHttpServer())
      .post('/api/v1/accounts')
      .set('Authorization', `Bearer ${token}`)
      .send(payload)
      .expect(201)
      .then((response) => response.body.data);
  }

  function createCategory(token: string, payload: Record<string, unknown>) {
    return request(app.getHttpServer())
      .post('/api/v1/categories')
      .set('Authorization', `Bearer ${token}`)
      .send(payload)
      .expect(201)
      .then((response) => response.body.data);
  }

  function createTransaction(token: string, payload: Record<string, unknown>) {
    return request(app.getHttpServer())
      .post('/api/v1/transactions')
      .set('Authorization', `Bearer ${token}`)
      .send(payload)
      .expect(201)
      .then((response) => response.body.data);
  }

  function getSummary(token: string, query: Record<string, unknown> = {}) {
    return request(app.getHttpServer())
      .get('/api/v1/reports/summary')
      .set('Authorization', `Bearer ${token}`)
      .query(query)
      .expect(200)
      .then((response) => response.body);
  }

  async function seedReportFixtures(user: TestUser) {
    const account = await createAccount(user.accessToken, {
      name: 'BDO Savings',
      type: 'BANK',
    });
    const secondary = await createAccount(user.accessToken, {
      name: 'Cash Wallet',
      type: 'CASH',
    });
    const food = await createCategory(user.accessToken, {
      name: 'Food',
      type: 'EXPENSE',
    });
    return { account, secondary, food };
  }

  describe('GET /api/v1/reports/summary', () => {
    it('should return a financial summary derived from transactions', async () => {
      const { account, secondary, food } = await seedReportFixtures(userA);

      await createTransaction(userA.accessToken, {
        type: 'INCOME',
        amount: 5000,
        transactionDate: TRANSACTION_DATE,
        accountId: account.id,
      });
      await createTransaction(userA.accessToken, {
        type: 'EXPENSE',
        amount: 2500,
        transactionDate: TRANSACTION_DATE,
        accountId: account.id,
        categoryId: food.id,
      });
      await createTransaction(userA.accessToken, {
        type: 'TRANSFER',
        amount: 2000,
        transactionDate: TRANSACTION_DATE,
        accountId: account.id,
        toAccountId: secondary.id,
      });

      const body = await getSummary(userA.accessToken);

      expect(body).toMatchObject({
        success: true,
        data: {
          fromDate: null,
          toDate: null,
          income: '5000.00',
          expenses: '2500.00',
          netCashFlow: '2500.00',
          spendingByCategory: [
            {
              categoryId: food.id,
              categoryName: 'Food',
              amount: '2500.00',
            },
          ],
        },
      });
    });

    it('should exclude transfers from all financial totals', async () => {
      const { account, secondary } = await seedReportFixtures(userA);

      await createTransaction(userA.accessToken, {
        type: 'TRANSFER',
        amount: 5000,
        transactionDate: TRANSACTION_DATE,
        accountId: account.id,
        toAccountId: secondary.id,
      });

      const body = await getSummary(userA.accessToken);

      expect(body.data).toMatchObject({
        income: '0.00',
        expenses: '0.00',
        netCashFlow: '0.00',
        spendingByCategory: [],
      });
    });

    it('should return zeros when there are no transactions', async () => {
      await seedReportFixtures(userA);

      const body = await getSummary(userA.accessToken);

      expect(body.data).toMatchObject({
        income: '0.00',
        expenses: '0.00',
        netCashFlow: '0.00',
        spendingByCategory: [],
      });
    });

    it('should filter the summary by date range', async () => {
      const { account, food } = await seedReportFixtures(userA);

      await createTransaction(userA.accessToken, {
        type: 'INCOME',
        amount: 1000,
        transactionDate: '2026-01-05T08:30:00.000Z',
        accountId: account.id,
      });
      await createTransaction(userA.accessToken, {
        type: 'EXPENSE',
        amount: 400,
        transactionDate: '2026-01-20T08:30:00.000Z',
        accountId: account.id,
        categoryId: food.id,
      });

      const filtered = await getSummary(userA.accessToken, {
        dateFrom: '2026-01-10T00:00:00.000Z',
        dateTo: '2026-01-31T23:59:59.000Z',
      });

      expect(filtered.data).toMatchObject({
        fromDate: '2026-01-10T00:00:00.000Z',
        toDate: '2026-01-31T23:59:59.000Z',
        income: '0.00',
        expenses: '400.00',
        netCashFlow: '-400.00',
      });

      const unfiltered = await getSummary(userA.accessToken);

      expect(unfiltered.data).toMatchObject({
        income: '1000.00',
        expenses: '400.00',
        netCashFlow: '600.00',
      });
    });

    it('should count uncategorized expenses without listing them by category', async () => {
      const { account } = await seedReportFixtures(userA);

      await createTransaction(userA.accessToken, {
        type: 'EXPENSE',
        amount: 750,
        transactionDate: TRANSACTION_DATE,
        accountId: account.id,
      });

      const body = await getSummary(userA.accessToken);

      expect(body.data).toMatchObject({
        expenses: '750.00',
        spendingByCategory: [],
      });
    });

    it('should group expenses by category sorted descending', async () => {
      const { account, food } = await seedReportFixtures(userA);
      const transport = await createCategory(userA.accessToken, {
        name: 'Transportation',
        type: 'EXPENSE',
      });

      await createTransaction(userA.accessToken, {
        type: 'EXPENSE',
        amount: 500,
        transactionDate: TRANSACTION_DATE,
        accountId: account.id,
        categoryId: food.id,
      });
      await createTransaction(userA.accessToken, {
        type: 'EXPENSE',
        amount: 300,
        transactionDate: TRANSACTION_DATE,
        accountId: account.id,
        categoryId: food.id,
      });
      await createTransaction(userA.accessToken, {
        type: 'EXPENSE',
        amount: 200,
        transactionDate: TRANSACTION_DATE,
        accountId: account.id,
        categoryId: transport.id,
      });

      const body = await getSummary(userA.accessToken);

      expect(body.data).toMatchObject({ expenses: '1000.00' });
      expect(body.data.spendingByCategory).toEqual([
        { categoryId: food.id, categoryName: 'Food', amount: '800.00' },
        {
          categoryId: transport.id,
          categoryName: 'Transportation',
          amount: '200.00',
        },
      ]);
    });

    it('should not include another user transactions', async () => {
      const fixturesA = await seedReportFixtures(userA);
      const fixturesB = await seedReportFixtures(userB);

      await createTransaction(userA.accessToken, {
        type: 'INCOME',
        amount: 1000,
        transactionDate: TRANSACTION_DATE,
        accountId: fixturesA.account.id,
      });
      await createTransaction(userB.accessToken, {
        type: 'INCOME',
        amount: 99999,
        transactionDate: TRANSACTION_DATE,
        accountId: fixturesB.account.id,
      });

      const body = await getSummary(userA.accessToken);

      expect(body.data).toMatchObject({
        income: '1000.00',
        netCashFlow: '1000.00',
      });
    });

    it('should reject invalid query parameters with 400', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/reports/summary')
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .query({ dateFrom: 'not-a-date' })
        .expect(400);

      expect(response.body.message).toBe('Validation failed');
    });

    it('should return 401 for unauthenticated summary requests', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/reports/summary')
        .expect(401);

      await request(app.getHttpServer())
        .get('/api/v1/reports/summary')
        .set('Authorization', 'Bearer invalid-token')
        .expect(401);
    });
  });
});
