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

const NEXT_RUN_AT = '2026-11-01T09:00:00.000Z';
const UPDATED_NEXT_RUN_AT = '2026-12-01T09:00:00.000Z';
const TRANSACTION_DATE = '2026-01-15T08:30:00.000Z';
const NONEXISTENT_ID = '00000000-0000-0000-0000-000000000000';

describe('RecurringTransactions E2E', () => {
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
    userA = await registerUser(`rcr-owner-a-${suffix}@example.com`);
    userB = await registerUser(`rcr-owner-b-${suffix}@example.com`);
  });

  beforeEach(async () => {
    const userIds = [userA.id, userB.id];
    // Order matters: transactions reference schedules (SetNull) and
    // schedules reference accounts/categories (Restrict).
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

  function createRecurring(
    token: string,
    payload: Record<string, unknown>,
    expectedStatus = 201,
  ) {
    return request(app.getHttpServer())
      .post('/api/v1/recurring-transactions')
      .set('Authorization', `Bearer ${token}`)
      .send(payload)
      .expect(expectedStatus)
      .then((response) => response.body);
  }

  async function seedUserResources(
    user: TestUser,
    names: { account: string; secondaryAccount?: string; category: string },
  ) {
    const account = await createAccount(user.accessToken, {
      name: names.account,
      type: 'BANK',
    });
    let secondaryAccount: any = null;
    if (names.secondaryAccount) {
      secondaryAccount = await createAccount(user.accessToken, {
        name: names.secondaryAccount,
        type: 'CASH',
      });
    }
    const category = await createCategory(user.accessToken, {
      name: names.category,
      type: 'EXPENSE',
    });
    return { account, secondaryAccount, category };
  }

  describe('POST /api/v1/recurring-transactions', () => {
    it('should create an EXPENSE recurrence', async () => {
      const { account, category } = await seedUserResources(userA, {
        account: 'Primary Checking',
        category: 'Food',
      });

      const body = await createRecurring(userA.accessToken, {
        type: 'EXPENSE',
        amount: 2500,
        description: 'Monthly rent',
        accountId: account.id,
        categoryId: category.id,
        frequency: 'MONTHLY',
        nextRunAt: NEXT_RUN_AT,
      });

      expect(body).toMatchObject({
        success: true,
        data: {
          type: 'EXPENSE',
          description: 'Monthly rent',
          accountId: account.id,
          categoryId: category.id,
          frequency: 'MONTHLY',
          isActive: true,
          userId: userA.id,
        },
      });
      expect(Number(body.data.amount)).toBe(2500);
      expect(body.data.id).toBeDefined();

      const stored = await prisma.recurringTransaction.findFirst({
        where: { id: body.data.id },
      });
      expect(stored).toMatchObject({
        id: body.data.id,
        userId: userA.id,
        type: 'EXPENSE',
      });
    });

    it('should create a TRANSFER recurrence between two owned accounts', async () => {
      const { account, secondaryAccount } = await seedUserResources(userA, {
        account: 'Primary Checking',
        secondaryAccount: 'Savings Vault',
        category: 'Food',
      });

      const body = await createRecurring(userA.accessToken, {
        type: 'TRANSFER',
        amount: 5000,
        description: 'Move to savings',
        fromAccountId: account.id,
        toAccountId: secondaryAccount.id,
        frequency: 'WEEKLY',
        nextRunAt: NEXT_RUN_AT,
      });

      expect(body).toMatchObject({
        success: true,
        data: {
          type: 'TRANSFER',
          fromAccountId: account.id,
          toAccountId: secondaryAccount.id,
          frequency: 'WEEKLY',
          userId: userA.id,
        },
      });
      expect(Number(body.data.amount)).toBe(5000);
    });

    it('should return 404 when using another user account', async () => {
      await seedUserResources(userA, {
        account: 'Primary Checking',
        category: 'Food',
      });
      const fixturesB = await seedUserResources(userB, {
        account: 'User B Checking',
        category: 'Food',
      });

      await request(app.getHttpServer())
        .post('/api/v1/recurring-transactions')
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .send({
          type: 'EXPENSE',
          amount: 100,
          frequency: 'MONTHLY',
          nextRunAt: NEXT_RUN_AT,
          accountId: fixturesB.account.id,
        })
        .expect(404);
    });

    it('should return 404 when using another user category', async () => {
      const fixturesA = await seedUserResources(userA, {
        account: 'Primary Checking',
        category: 'Food',
      });
      const fixturesB = await seedUserResources(userB, {
        account: 'User B Checking',
        category: 'Transport',
      });

      await request(app.getHttpServer())
        .post('/api/v1/recurring-transactions')
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .send({
          type: 'EXPENSE',
          amount: 100,
          frequency: 'MONTHLY',
          nextRunAt: NEXT_RUN_AT,
          accountId: fixturesA.account.id,
          categoryId: fixturesB.category.id,
        })
        .expect(404);
    });

    it('should return 404 when creating a recurrence on an archived account', async () => {
      const { account, category } = await seedUserResources(userA, {
        account: 'Primary Checking',
        category: 'Food',
      });

      await request(app.getHttpServer())
        .delete(`/api/v1/accounts/${account.id}`)
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .expect(204);

      await request(app.getHttpServer())
        .post('/api/v1/recurring-transactions')
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .send({
          type: 'EXPENSE',
          amount: 100,
          frequency: 'MONTHLY',
          nextRunAt: NEXT_RUN_AT,
          accountId: account.id,
          categoryId: category.id,
        })
        .expect(404);
    });

    it('should reject a transfer where source and destination are the same', async () => {
      const { account } = await seedUserResources(userA, {
        account: 'Primary Checking',
        category: 'Food',
      });

      await request(app.getHttpServer())
        .post('/api/v1/recurring-transactions')
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .send({
          type: 'TRANSFER',
          amount: 5000,
          frequency: 'WEEKLY',
          nextRunAt: NEXT_RUN_AT,
          fromAccountId: account.id,
          toAccountId: account.id,
        })
        .expect(400);
    });

    it('should reject a transfer without a destination leg', async () => {
      const { account } = await seedUserResources(userA, {
        account: 'Primary Checking',
        category: 'Food',
      });

      await request(app.getHttpServer())
        .post('/api/v1/recurring-transactions')
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .send({
          type: 'TRANSFER',
          amount: 5000,
          frequency: 'WEEKLY',
          nextRunAt: NEXT_RUN_AT,
          fromAccountId: account.id,
        })
        .expect(400);
    });

    it('should reject an invalid recurrence payload', async () => {
      const { account } = await seedUserResources(userA, {
        account: 'Primary Checking',
        category: 'Food',
      });

      const response = await request(app.getHttpServer())
        .post('/api/v1/recurring-transactions')
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .send({
          type: 'INVALID',
          amount: 100,
          frequency: 'MONTHLY',
          nextRunAt: NEXT_RUN_AT,
          accountId: account.id,
        })
        .expect(400);

      expect(response.body.message).toBe('Validation failed');
      expect(response.body.errors).toBeDefined();
    });
  });

  describe('GET /api/v1/recurring-transactions', () => {
    it('should list only the authenticated user schedules', async () => {
      const fixturesA = await seedUserResources(userA, {
        account: 'Primary Checking',
        category: 'Food',
      });
      const fixturesB = await seedUserResources(userB, {
        account: 'User B Checking',
        category: 'Food',
      });

      await createRecurring(userA.accessToken, {
        type: 'EXPENSE',
        amount: 100,
        description: 'User A rent',
        accountId: fixturesA.account.id,
        categoryId: fixturesA.category.id,
        frequency: 'MONTHLY',
        nextRunAt: NEXT_RUN_AT,
      });
      await createRecurring(userB.accessToken, {
        type: 'EXPENSE',
        amount: 999,
        description: 'User B rent',
        accountId: fixturesB.account.id,
        categoryId: fixturesB.category.id,
        frequency: 'MONTHLY',
        nextRunAt: NEXT_RUN_AT,
      });

      const response = await request(app.getHttpServer())
        .get('/api/v1/recurring-transactions')
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .expect(200);

      expect(response.body).toMatchObject({
        success: true,
        meta: { page: 1, limit: 20, total: 1, totalPages: 1 },
      });
      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0]).toMatchObject({
        description: 'User A rent',
        userId: userA.id,
      });
    });

    it('should not return another user schedules', async () => {
      const fixturesB = await seedUserResources(userB, {
        account: 'User B Checking',
        category: 'Food',
      });

      await createRecurring(userB.accessToken, {
        type: 'EXPENSE',
        amount: 999,
        description: 'User B rent',
        accountId: fixturesB.account.id,
        frequency: 'MONTHLY',
        nextRunAt: NEXT_RUN_AT,
      });

      const response = await request(app.getHttpServer())
        .get('/api/v1/recurring-transactions')
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .expect(200);

      expect(response.body.meta).toMatchObject({ total: 0 });
      expect(response.body.data).toHaveLength(0);
    });

    it('should return 401 for unauthenticated list requests', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/recurring-transactions')
        .expect(401);
    });
  });

  describe('GET /api/v1/recurring-transactions/:id', () => {
    it('should retrieve an own schedule', async () => {
      const { account, category } = await seedUserResources(userA, {
        account: 'Primary Checking',
        category: 'Food',
      });
      const created = await createRecurring(userA.accessToken, {
        type: 'EXPENSE',
        amount: 2500,
        description: 'Monthly rent',
        accountId: account.id,
        categoryId: category.id,
        frequency: 'MONTHLY',
        nextRunAt: NEXT_RUN_AT,
      });

      const response = await request(app.getHttpServer())
        .get(`/api/v1/recurring-transactions/${created.data.id}`)
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .expect(200);

      expect(response.body).toMatchObject({
        success: true,
        data: { id: created.data.id, userId: userA.id },
      });
    });

    it('should return the expected not-found response for another user schedule', async () => {
      const fixturesB = await seedUserResources(userB, {
        account: 'User B Checking',
        category: 'Food',
      });
      const created = await createRecurring(userB.accessToken, {
        type: 'EXPENSE',
        amount: 100,
        accountId: fixturesB.account.id,
        frequency: 'MONTHLY',
        nextRunAt: NEXT_RUN_AT,
      });

      const response = await request(app.getHttpServer())
        .get(`/api/v1/recurring-transactions/${created.data.id}`)
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .expect(404);

      // E2E apps register no global filter, so not-found uses Nest's
      // default envelope: { statusCode, message, error }.
      expect(response.body).toMatchObject({
        statusCode: 404,
        message: 'Recurring transaction not found',
      });
    });

    it('should return 404 for a nonexistent schedule', async () => {
      await request(app.getHttpServer())
        .get(`/api/v1/recurring-transactions/${NONEXISTENT_ID}`)
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .expect(404);
    });

    it('should return 400 for a malformed schedule id', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/recurring-transactions/123')
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .expect(400);
    });

    it('should return 401 for unauthenticated get-by-id requests', async () => {
      const { account } = await seedUserResources(userA, {
        account: 'Primary Checking',
        category: 'Food',
      });
      const created = await createRecurring(userA.accessToken, {
        type: 'EXPENSE',
        amount: 100,
        accountId: account.id,
        frequency: 'MONTHLY',
        nextRunAt: NEXT_RUN_AT,
      });

      await request(app.getHttpServer())
        .get(`/api/v1/recurring-transactions/${created.data.id}`)
        .expect(401);
    });
  });

  describe('PATCH /api/v1/recurring-transactions/:id', () => {
    it('should update allowed fields of an own schedule', async () => {
      const { account } = await seedUserResources(userA, {
        account: 'Primary Checking',
        category: 'Food',
      });
      const created = await createRecurring(userA.accessToken, {
        type: 'EXPENSE',
        amount: 2500,
        description: 'Monthly rent',
        accountId: account.id,
        frequency: 'MONTHLY',
        nextRunAt: NEXT_RUN_AT,
      });

      const response = await request(app.getHttpServer())
        .patch(`/api/v1/recurring-transactions/${created.data.id}`)
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .send({
          amount: 3000,
          description: 'Updated rent',
          frequency: 'WEEKLY',
          nextRunAt: UPDATED_NEXT_RUN_AT,
        })
        .expect(200);

      expect(response.body).toMatchObject({
        success: true,
        data: {
          id: created.data.id,
          description: 'Updated rent',
          frequency: 'WEEKLY',
        },
      });
      expect(Number(response.body.data.amount)).toBe(3000);

      const stored = await prisma.recurringTransaction.findFirst({
        where: { id: created.data.id },
      });
      expect(stored).toMatchObject({
        description: 'Updated rent',
        frequency: 'WEEKLY',
        isActive: true,
      });
      expect(Number(stored?.amount)).toBe(3000);
    });

    it('should reject changing the transaction type', async () => {
      const { account } = await seedUserResources(userA, {
        account: 'Primary Checking',
        category: 'Food',
      });
      const created = await createRecurring(userA.accessToken, {
        type: 'EXPENSE',
        amount: 100,
        accountId: account.id,
        frequency: 'MONTHLY',
        nextRunAt: NEXT_RUN_AT,
      });

      const response = await request(app.getHttpServer())
        .patch(`/api/v1/recurring-transactions/${created.data.id}`)
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .send({ type: 'INCOME' })
        .expect(400);

      expect(response.body.message).toBe('Validation failed');
    });

    it('should pause a schedule', async () => {
      const { account } = await seedUserResources(userA, {
        account: 'Primary Checking',
        category: 'Food',
      });
      const created = await createRecurring(userA.accessToken, {
        type: 'EXPENSE',
        amount: 100,
        accountId: account.id,
        frequency: 'MONTHLY',
        nextRunAt: NEXT_RUN_AT,
      });

      const response = await request(app.getHttpServer())
        .patch(`/api/v1/recurring-transactions/${created.data.id}`)
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .send({ isActive: false })
        .expect(200);

      expect(response.body).toMatchObject({
        success: true,
        data: { id: created.data.id, isActive: false },
      });

      const stored = await prisma.recurringTransaction.findFirst({
        where: { id: created.data.id },
      });
      expect(stored?.isActive).toBe(false);
    });

    it('should resume a paused schedule', async () => {
      const { account } = await seedUserResources(userA, {
        account: 'Primary Checking',
        category: 'Food',
      });
      const created = await createRecurring(userA.accessToken, {
        type: 'EXPENSE',
        amount: 100,
        accountId: account.id,
        frequency: 'MONTHLY',
        nextRunAt: NEXT_RUN_AT,
      });

      await request(app.getHttpServer())
        .patch(`/api/v1/recurring-transactions/${created.data.id}`)
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .send({ isActive: false })
        .expect(200);

      const response = await request(app.getHttpServer())
        .patch(`/api/v1/recurring-transactions/${created.data.id}`)
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .send({ isActive: true })
        .expect(200);

      expect(response.body).toMatchObject({
        success: true,
        data: { id: created.data.id, isActive: true },
      });

      const stored = await prisma.recurringTransaction.findFirst({
        where: { id: created.data.id },
      });
      expect(stored?.isActive).toBe(true);
    });

    it('should return 404 when updating another user schedule', async () => {
      const fixturesB = await seedUserResources(userB, {
        account: 'User B Checking',
        category: 'Food',
      });
      const created = await createRecurring(userB.accessToken, {
        type: 'EXPENSE',
        amount: 100,
        accountId: fixturesB.account.id,
        frequency: 'MONTHLY',
        nextRunAt: NEXT_RUN_AT,
      });

      await request(app.getHttpServer())
        .patch(`/api/v1/recurring-transactions/${created.data.id}`)
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .send({ description: 'Hacked' })
        .expect(404);
    });

    it('should reject an empty update', async () => {
      const { account } = await seedUserResources(userA, {
        account: 'Primary Checking',
        category: 'Food',
      });
      const created = await createRecurring(userA.accessToken, {
        type: 'EXPENSE',
        amount: 100,
        accountId: account.id,
        frequency: 'MONTHLY',
        nextRunAt: NEXT_RUN_AT,
      });

      const response = await request(app.getHttpServer())
        .patch(`/api/v1/recurring-transactions/${created.data.id}`)
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .send({})
        .expect(400);

      expect(response.body.message).toBe('Validation failed');
    });
  });

  describe('DELETE /api/v1/recurring-transactions/:id', () => {
    it('should delete an own schedule', async () => {
      const { account } = await seedUserResources(userA, {
        account: 'Primary Checking',
        category: 'Food',
      });
      const created = await createRecurring(userA.accessToken, {
        type: 'EXPENSE',
        amount: 100,
        accountId: account.id,
        frequency: 'MONTHLY',
        nextRunAt: NEXT_RUN_AT,
      });

      await request(app.getHttpServer())
        .delete(`/api/v1/recurring-transactions/${created.data.id}`)
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .expect(204);

      const stored = await prisma.recurringTransaction.findFirst({
        where: { id: created.data.id },
      });
      expect(stored).toBeNull();

      await request(app.getHttpServer())
        .get(`/api/v1/recurring-transactions/${created.data.id}`)
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .expect(404);
    });

    it('should return 404 when deleting another user schedule', async () => {
      const fixturesB = await seedUserResources(userB, {
        account: 'User B Checking',
        category: 'Food',
      });
      const created = await createRecurring(userB.accessToken, {
        type: 'EXPENSE',
        amount: 100,
        accountId: fixturesB.account.id,
        frequency: 'MONTHLY',
        nextRunAt: NEXT_RUN_AT,
      });

      await request(app.getHttpServer())
        .delete(`/api/v1/recurring-transactions/${created.data.id}`)
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .expect(404);
    });

    it('should keep generated transaction history after deleting the schedule', async () => {
      const { account, category } = await seedUserResources(userA, {
        account: 'Primary Checking',
        category: 'Food',
      });
      const created = await createRecurring(userA.accessToken, {
        type: 'EXPENSE',
        amount: 2500,
        description: 'Monthly rent',
        accountId: account.id,
        categoryId: category.id,
        frequency: 'MONTHLY',
        nextRunAt: NEXT_RUN_AT,
      });

      const generated = await prisma.transaction.create({
        data: {
          userId: userA.id,
          accountId: account.id,
          categoryId: category.id,
          type: 'EXPENSE',
          amount: 2500,
          description: 'Monthly rent',
          transactionDate: TRANSACTION_DATE,
          recurringTransactionId: created.data.id,
          scheduledFor: NEXT_RUN_AT,
        },
      });

      await request(app.getHttpServer())
        .delete(`/api/v1/recurring-transactions/${created.data.id}`)
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .expect(204);

      // The schedule row is gone but the financial history row survives with
      // its schedule link nulled (onDelete: SetNull).
      expect(
        await prisma.recurringTransaction.findFirst({
          where: { id: created.data.id },
        }),
      ).toBeNull();

      const history = await prisma.transaction.findFirst({
        where: { id: generated.id },
      });
      expect(history).not.toBeNull();
      expect(history).toMatchObject({
        id: generated.id,
        description: 'Monthly rent',
        recurringTransactionId: null,
      });
      expect(Number(history?.amount)).toBe(2500);
    });
  });

  describe('authentication protection', () => {
    it('should return 401 for unauthenticated recurring transaction requests', async () => {
      const { account } = await seedUserResources(userA, {
        account: 'Primary Checking',
        category: 'Food',
      });
      const created = await createRecurring(userA.accessToken, {
        type: 'EXPENSE',
        amount: 100,
        accountId: account.id,
        frequency: 'MONTHLY',
        nextRunAt: NEXT_RUN_AT,
      });
      const scheduleId = created.data.id as string;

      await request(app.getHttpServer())
        .get('/api/v1/recurring-transactions')
        .expect(401);

      await request(app.getHttpServer())
        .post('/api/v1/recurring-transactions')
        .send({
          type: 'EXPENSE',
          amount: 100,
          frequency: 'MONTHLY',
          nextRunAt: NEXT_RUN_AT,
          accountId: account.id,
        })
        .expect(401);

      await request(app.getHttpServer())
        .get(`/api/v1/recurring-transactions/${scheduleId}`)
        .expect(401);

      await request(app.getHttpServer())
        .patch(`/api/v1/recurring-transactions/${scheduleId}`)
        .send({ description: 'Hacked' })
        .expect(401);

      await request(app.getHttpServer())
        .delete(`/api/v1/recurring-transactions/${scheduleId}`)
        .expect(401);
    });
  });
});
