import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import request from 'supertest';

import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { PrismaService } from '../src/database/prisma.service.js';

interface TestUser {
  id: string;
  email: string;
  accessToken: string;
}

const START = '2026-10-01T00:00:00.000Z';
const END = '2026-10-31T23:59:59.000Z';

describe('Budgets E2E', () => {
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

    const suffix = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
    userA = await registerUser(`bud-owner-a-${suffix}@example.com`);
    userB = await registerUser(`bud-owner-b-${suffix}@example.com`);
  });

  beforeEach(async () => {
    const userIds = [userA.id, userB.id];
    await prisma.transaction.deleteMany({
      where: { userId: { in: userIds } },
    });
    await prisma.budget.deleteMany({
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
    await prisma.budget
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

  function createBudget(token: string, payload: Record<string, unknown>) {
    return request(app.getHttpServer())
      .post('/api/v1/budgets')
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

  async function expenseSetup() {
    const account = await createAccount(userA.accessToken, {
      name: 'Cash',
      type: 'CASH',
    });
    const category = await createCategory(userA.accessToken, {
      name: 'Food',
      type: 'EXPENSE',
    });
    const budget = await createBudget(userA.accessToken, {
      name: 'October Food Budget',
      categoryId: category.id,
      amount: 10000,
      period: 'MONTHLY',
      startDate: START,
      endDate: END,
    });

    return { account, category, budget };
  }

  describe('unauthenticated access', () => {
    it.each([
      ['POST', '/api/v1/budgets'],
      ['GET', '/api/v1/budgets'],
      ['GET', '/api/v1/budgets/550e8400-e29b-41d4-a716-446655440000'],
      ['PATCH', '/api/v1/budgets/550e8400-e29b-41d4-a716-446655440000'],
      ['DELETE', '/api/v1/budgets/550e8400-e29b-41d4-a716-446655440000'],
      [
        'GET',
        '/api/v1/budgets/550e8400-e29b-41d4-a716-446655440000/progress',
      ],
    ])('%s %s should return 401 without a token', async (method, url) => {
      const req = request(app.getHttpServer());
      const sender =
        method === 'POST'
          ? req.post(url).send({})
          : method === 'PATCH'
            ? req.patch(url).send({})
            : method === 'DELETE'
              ? req.delete(url)
              : req.get(url);

      await sender.expect(401);
    });
  });

  describe('POST /api/v1/budgets', () => {
    it('should create a budget for the authenticated user', async () => {
      const category = await createCategory(userA.accessToken, {
        name: 'Food',
        type: 'EXPENSE',
      });

      const response = await request(app.getHttpServer())
        .post('/api/v1/budgets')
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .send({
          name: 'October Food Budget',
          categoryId: category.id,
          amount: 10000,
          period: 'MONTHLY',
          startDate: START,
          endDate: END,
        })
        .expect(201);

      expect(response.body).toMatchObject({
        success: true,
        data: {
          name: 'October Food Budget',
          categoryId: category.id,
          userId: userA.id,
          period: 'MONTHLY',
        },
      });
    });

    it('should reject a budget for another user’s category', async () => {
      const category = await createCategory(userB.accessToken, {
        name: 'Food',
        type: 'EXPENSE',
      });

      await request(app.getHttpServer())
        .post('/api/v1/budgets')
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .send({
          name: 'October Food Budget',
          categoryId: category.id,
          amount: 10000,
          period: 'MONTHLY',
          startDate: START,
          endDate: END,
        })
        .expect(404);
    });

    it('should reject an income category', async () => {
      const category = await createCategory(userA.accessToken, {
        name: 'Salary',
        type: 'INCOME',
      });

      await request(app.getHttpServer())
        .post('/api/v1/budgets')
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .send({
          name: 'October Salary Budget',
          categoryId: category.id,
          amount: 10000,
          period: 'MONTHLY',
          startDate: START,
          endDate: END,
        })
        .expect(400);
    });

    it.each([
      ['zero amount', { amount: 0 }],
      ['negative amount', { amount: -50 }],
      ['three-decimal amount', { amount: 10.123 }],
      ['unknown period', { period: 'QUARTERLY' }],
      ['empty name', { name: '' }],
      ['startDate after endDate', { startDate: END, endDate: START }],
      ['malformed categoryId', { categoryId: 'not-a-uuid' }],
      ['smuggled userId', { userId: '550e8400-e29b-41d4-a716-446655440000' }],
    ])('should reject %s', async (_label, override) => {
      const category = await createCategory(userA.accessToken, {
        name: `Food-${Math.random()}`,
        type: 'EXPENSE',
      });

      await request(app.getHttpServer())
        .post('/api/v1/budgets')
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .send({
          name: 'October Food Budget',
          categoryId: category.id,
          amount: 10000,
          period: 'MONTHLY',
          startDate: START,
          endDate: END,
          ...override,
        })
        .expect(400);
    });

    it('should reject overlapping budgets for the same category', async () => {
      const { category } = await expenseSetup();

      await request(app.getHttpServer())
        .post('/api/v1/budgets')
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .send({
          name: 'Overlapping budget',
          categoryId: category.id,
          amount: 5000,
          period: 'CUSTOM',
          startDate: '2026-10-15T00:00:00.000Z',
          endDate: '2026-11-15T23:59:59.000Z',
        })
        .expect(409);
    });

    it('should allow non-overlapping budgets for the same category', async () => {
      const { category } = await expenseSetup();

      await request(app.getHttpServer())
        .post('/api/v1/budgets')
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .send({
          name: 'November Food Budget',
          categoryId: category.id,
          amount: 5000,
          period: 'MONTHLY',
          startDate: '2026-11-01T00:00:00.000Z',
          endDate: '2026-11-30T23:59:59.000Z',
        })
        .expect(201);
    });
  });

  describe('GET /api/v1/budgets', () => {
    it('should list only the authenticated user’s budgets', async () => {
      const { category } = await expenseSetup();
      const otherCategory = await createCategory(userB.accessToken, {
        name: 'Food',
        type: 'EXPENSE',
      });

      await createBudget(userB.accessToken, {
        name: 'Other budget',
        categoryId: otherCategory.id,
        amount: 100,
        period: 'MONTHLY',
        startDate: START,
        endDate: END,
      });

      const response = await request(app.getHttpServer())
        .get('/api/v1/budgets')
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.meta.total).toBe(1);
      expect(response.body.data[0]).toMatchObject({
        userId: userA.id,
        categoryId: category.id,
      });
    });
  });

  describe('GET /api/v1/budgets/:id', () => {
    it('should return the owned budget', async () => {
      const { budget } = await expenseSetup();

      const response = await request(app.getHttpServer())
        .get(`/api/v1/budgets/${budget.id}`)
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .expect(200);

      expect(response.body.data).toMatchObject({ id: budget.id });
    });

    it('should return 404 for another user’s budget', async () => {
      const { budget } = await expenseSetup();

      await request(app.getHttpServer())
        .get(`/api/v1/budgets/${budget.id}`)
        .set('Authorization', `Bearer ${userB.accessToken}`)
        .expect(404);
    });
  });

  describe('PATCH /api/v1/budgets/:id', () => {
    it('should update the owned budget', async () => {
      const { budget } = await expenseSetup();

      const response = await request(app.getHttpServer())
        .patch(`/api/v1/budgets/${budget.id}`)
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .send({ name: 'Renamed budget', amount: 8000 })
        .expect(200);

      expect(response.body.data).toMatchObject({
        name: 'Renamed budget',
      });
    });

    it('should return 404 for another user’s budget', async () => {
      const { budget } = await expenseSetup();

      await request(app.getHttpServer())
        .patch(`/api/v1/budgets/${budget.id}`)
        .set('Authorization', `Bearer ${userB.accessToken}`)
        .send({ name: 'Hijacked' })
        .expect(404);
    });

    it('should reject updates overlapping another budget', async () => {
      const { category } = await expenseSetup();
      const second = await createBudget(userA.accessToken, {
        name: 'November Food Budget',
        categoryId: category.id,
        amount: 5000,
        period: 'MONTHLY',
        startDate: '2026-11-01T00:00:00.000Z',
        endDate: '2026-11-30T23:59:59.000Z',
      });

      await request(app.getHttpServer())
        .patch(`/api/v1/budgets/${second.id}`)
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .send({ startDate: '2026-10-15T00:00:00.000Z' })
        .expect(409);
    });
  });

  describe('DELETE /api/v1/budgets/:id', () => {
    it('should delete the owned budget without touching transactions', async () => {
      const { account, category, budget } = await expenseSetup();

      await createTransaction(userA.accessToken, {
        type: 'EXPENSE',
        amount: 100,
        transactionDate: '2026-10-15T08:30:00.000Z',
        accountId: account.id,
        categoryId: category.id,
      });

      await request(app.getHttpServer())
        .delete(`/api/v1/budgets/${budget.id}`)
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .expect(204);

      await request(app.getHttpServer())
        .get(`/api/v1/budgets/${budget.id}`)
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .expect(404);

      const transactions = await request(app.getHttpServer())
        .get('/api/v1/transactions')
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .expect(200);

      expect(transactions.body.meta.total).toBe(1);
    });

    it('should return 404 for another user’s budget', async () => {
      const { budget } = await expenseSetup();

      await request(app.getHttpServer())
        .delete(`/api/v1/budgets/${budget.id}`)
        .set('Authorization', `Bearer ${userB.accessToken}`)
        .expect(404);
    });
  });

  describe('GET /api/v1/budgets/:id/progress', () => {
    it('should calculate progress from expense transactions', async () => {
      const { account, category, budget } = await expenseSetup();

      await createTransaction(userA.accessToken, {
        type: 'EXPENSE',
        amount: 6000,
        transactionDate: '2026-10-10T08:30:00.000Z',
        accountId: account.id,
        categoryId: category.id,
      });
      await createTransaction(userA.accessToken, {
        type: 'EXPENSE',
        amount: 750,
        transactionDate: '2026-10-20T08:30:00.000Z',
        accountId: account.id,
        categoryId: category.id,
      });

      const response = await request(app.getHttpServer())
        .get(`/api/v1/budgets/${budget.id}/progress`)
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .expect(200);

      expect(response.body).toMatchObject({
        success: true,
        data: {
          id: budget.id,
          name: 'October Food Budget',
          categoryId: category.id,
          budgetAmount: '10000.00',
          spentAmount: '6750.00',
          remainingAmount: '3250.00',
          percentageUsed: 67.5,
          status: 'ON_TRACK',
          period: {
            startDate: START,
            endDate: END,
          },
        },
      });
    });

    it('should count transactions exactly on the boundary dates', async () => {
      const { account, category, budget } = await expenseSetup();

      await createTransaction(userA.accessToken, {
        type: 'EXPENSE',
        amount: 100,
        transactionDate: START,
        accountId: account.id,
        categoryId: category.id,
      });
      await createTransaction(userA.accessToken, {
        type: 'EXPENSE',
        amount: 200,
        transactionDate: END,
        accountId: account.id,
        categoryId: category.id,
      });

      const response = await request(app.getHttpServer())
        .get(`/api/v1/budgets/${budget.id}/progress`)
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .expect(200);

      expect(response.body.data.spentAmount).toBe('300.00');
    });

    it('should exclude income, transfers, other categories, and other users', async () => {
      const { account, category, budget } = await expenseSetup();
      const destination = await createAccount(userA.accessToken, {
        name: 'Savings',
        type: 'BANK',
      });
      const otherCategory = await createCategory(userA.accessToken, {
        name: 'Transport',
        type: 'EXPENSE',
      });
      const userBAccount = await createAccount(userB.accessToken, {
        name: 'Cash',
        type: 'CASH',
      });
      const userBCategory = await createCategory(userB.accessToken, {
        name: 'Food',
        type: 'EXPENSE',
      });

      // Income in the same category is not spending.
      await createTransaction(userA.accessToken, {
        type: 'INCOME',
        amount: 50000,
        transactionDate: '2026-10-15T08:30:00.000Z',
        accountId: account.id,
        categoryId: category.id,
      });

      // Transfers only move money between accounts.
      await createTransaction(userA.accessToken, {
        type: 'TRANSFER',
        amount: 9000,
        transactionDate: '2026-10-15T08:30:00.000Z',
        accountId: account.id,
        toAccountId: destination.id,
      });

      // Same user, different category.
      await createTransaction(userA.accessToken, {
        type: 'EXPENSE',
        amount: 4000,
        transactionDate: '2026-10-15T08:30:00.000Z',
        accountId: account.id,
        categoryId: otherCategory.id,
      });

      // Different user.
      await createTransaction(userB.accessToken, {
        type: 'EXPENSE',
        amount: 3000,
        transactionDate: '2026-10-15T08:30:00.000Z',
        accountId: userBAccount.id,
        categoryId: userBCategory.id,
      });

      // Outside the budget window.
      await createTransaction(userA.accessToken, {
        type: 'EXPENSE',
        amount: 2500,
        transactionDate: '2026-09-15T08:30:00.000Z',
        accountId: account.id,
        categoryId: category.id,
      });

      const response = await request(app.getHttpServer())
        .get(`/api/v1/budgets/${budget.id}/progress`)
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .expect(200);

      expect(response.body.data).toMatchObject({
        spentAmount: '0.00',
        remainingAmount: '10000.00',
        percentageUsed: 0,
        status: 'ON_TRACK',
      });
    });

    it('should return 404 for another user’s budget', async () => {
      const { budget } = await expenseSetup();

      await request(app.getHttpServer())
        .get(`/api/v1/budgets/${budget.id}/progress`)
        .set('Authorization', `Bearer ${userB.accessToken}`)
        .expect(404);
    });
  });
});
