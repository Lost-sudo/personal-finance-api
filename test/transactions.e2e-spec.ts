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

const TRANSACTION_DATE = '2026-01-15T08:30:00.000Z';
const NONEXISTENT_ID = '00000000-0000-0000-0000-000000000000';

describe('Transactions E2E', () => {
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
    userA = await registerUser(`txn-owner-a-${suffix}@example.com`);
    userB = await registerUser(`txn-owner-b-${suffix}@example.com`);
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

  function createTransaction(
    token: string,
    payload: Record<string, unknown>,
    expectedStatus = 201,
  ) {
    return request(app.getHttpServer())
      .post('/api/v1/transactions')
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

  describe('POST /api/v1/transactions', () => {
    it('should create an EXPENSE transaction', async () => {
      const { account, category } = await seedUserResources(userA, {
        account: 'Primary Checking',
        category: 'Food',
      });

      const body = await createTransaction(userA.accessToken, {
        type: 'EXPENSE',
        amount: 2500,
        transactionDate: TRANSACTION_DATE,
        description: 'Grocery run',
        accountId: account.id,
        categoryId: category.id,
      });

      expect(body).toMatchObject({
        success: true,
        data: {
          type: 'EXPENSE',
          description: 'Grocery run',
          accountId: account.id,
          categoryId: category.id,
          userId: userA.id,
        },
      });
      expect(Number(body.data.amount)).toBe(2500);
      expect(body.data.id).toBeDefined();
    });

    it('should create an INCOME transaction without a category', async () => {
      const { account } = await seedUserResources(userA, {
        account: 'Primary Checking',
        category: 'Food',
      });

      const body = await createTransaction(userA.accessToken, {
        type: 'INCOME',
        amount: 50000,
        transactionDate: TRANSACTION_DATE,
        accountId: account.id,
      });

      expect(body).toMatchObject({
        success: true,
        data: {
          type: 'INCOME',
          accountId: account.id,
          categoryId: null,
          userId: userA.id,
        },
      });
      expect(Number(body.data.amount)).toBe(50000);
    });

    it('should create a TRANSFER between two accounts owned by User A', async () => {
      const { account, secondaryAccount } = await seedUserResources(userA, {
        account: 'Primary Checking',
        secondaryAccount: 'Savings Vault',
        category: 'Food',
      });

      const body = await createTransaction(userA.accessToken, {
        type: 'TRANSFER',
        amount: 5000,
        transactionDate: TRANSACTION_DATE,
        description: 'Move to savings',
        accountId: account.id,
        toAccountId: secondaryAccount.id,
      });

      expect(body.success).toBe(true);
      expect(Array.isArray(body.data)).toBe(true);
      expect(body.data).toHaveLength(2);

      const [outgoing, incoming] = body.data;
      expect(outgoing.transferGroupId).toBeDefined();
      expect(incoming.transferGroupId).toBe(outgoing.transferGroupId);
      expect(outgoing.categoryId).toBeNull();
      expect(incoming.categoryId).toBeNull();
      expect([outgoing.accountId, incoming.accountId].sort((a, b) => a.localeCompare(b))).toEqual(
        [account.id, secondaryAccount.id].sort((a, b) => a.localeCompare(b)),
      );
    });

    it('should reject a transfer using User B account as destination', async () => {
      const fixturesA = await seedUserResources(userA, {
        account: 'Primary Checking',
        category: 'Food',
      });
      const fixturesB = await seedUserResources(userB, {
        account: 'User B Checking',
        category: 'Food',
      });

      await request(app.getHttpServer())
        .post('/api/v1/transactions')
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .send({
          type: 'TRANSFER',
          amount: 5000,
          transactionDate: TRANSACTION_DATE,
          accountId: fixturesA.account.id,
          toAccountId: fixturesB.account.id,
        })
        .expect(404);
    });

    it('should reject a transfer where source and destination are the same', async () => {
      const { account } = await seedUserResources(userA, {
        account: 'Primary Checking',
        category: 'Food',
      });

      await request(app.getHttpServer())
        .post('/api/v1/transactions')
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .send({
          type: 'TRANSFER',
          amount: 5000,
          transactionDate: TRANSACTION_DATE,
          accountId: account.id,
          toAccountId: account.id,
        })
        .expect(400);
    });

    it('should reject a transfer without toAccountId', async () => {
      const { account } = await seedUserResources(userA, {
        account: 'Primary Checking',
        category: 'Food',
      });

      await request(app.getHttpServer())
        .post('/api/v1/transactions')
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .send({
          type: 'TRANSFER',
          amount: 5000,
          transactionDate: TRANSACTION_DATE,
          accountId: account.id,
        })
        .expect(400);
    });
  });

  describe('POST /api/v1/transactions validation', () => {
    it('should reject an invalid transaction type', async () => {
      const { account } = await seedUserResources(userA, {
        account: 'Primary Checking',
        category: 'Food',
      });

      const response = await request(app.getHttpServer())
        .post('/api/v1/transactions')
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .send({
          type: 'INVALID',
          amount: 100,
          transactionDate: TRANSACTION_DATE,
          accountId: account.id,
        })
        .expect(400);

      expect(response.body.message).toBe('Validation failed');
      expect(response.body.errors).toBeDefined();
    });

    it('should reject a negative amount', async () => {
      const { account } = await seedUserResources(userA, {
        account: 'Primary Checking',
        category: 'Food',
      });

      const response = await request(app.getHttpServer())
        .post('/api/v1/transactions')
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .send({
          type: 'EXPENSE',
          amount: -100,
          transactionDate: TRANSACTION_DATE,
          accountId: account.id,
        })
        .expect(400);

      expect(response.body.message).toBe('Validation failed');
    });

    it('should reject an amount with more than 2 decimal places', async () => {
      const { account } = await seedUserResources(userA, {
        account: 'Primary Checking',
        category: 'Food',
      });

      const response = await request(app.getHttpServer())
        .post('/api/v1/transactions')
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .send({
          type: 'EXPENSE',
          amount: 10.123,
          transactionDate: TRANSACTION_DATE,
          accountId: account.id,
        })
        .expect(400);

      expect(response.body.message).toBe('Validation failed');
    });

    it('should reject missing/invalid required fields', async () => {
      const { account } = await seedUserResources(userA, {
        account: 'Primary Checking',
        category: 'Food',
      });

      const missingAccount = await request(app.getHttpServer())
        .post('/api/v1/transactions')
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .send({
          type: 'EXPENSE',
          amount: 100,
          transactionDate: TRANSACTION_DATE,
        })
        .expect(400);
      expect(missingAccount.body.message).toBe('Validation failed');

      const missingAmount = await request(app.getHttpServer())
        .post('/api/v1/transactions')
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .send({
          type: 'EXPENSE',
          transactionDate: TRANSACTION_DATE,
          accountId: account.id,
        })
        .expect(400);
      expect(missingAmount.body.message).toBe('Validation failed');

      const invalidAccountId = await request(app.getHttpServer())
        .post('/api/v1/transactions')
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .send({
          type: 'EXPENSE',
          amount: 100,
          transactionDate: TRANSACTION_DATE,
          accountId: 'not-a-uuid',
        })
        .expect(400);
      expect(invalidAccountId.body.message).toBe('Validation failed');
    });
  });

  describe('ownership', () => {
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
        .post('/api/v1/transactions')
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .send({
          type: 'EXPENSE',
          amount: 100,
          transactionDate: TRANSACTION_DATE,
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
        .post('/api/v1/transactions')
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .send({
          type: 'EXPENSE',
          amount: 100,
          transactionDate: TRANSACTION_DATE,
          accountId: fixturesA.account.id,
          categoryId: fixturesB.category.id,
        })
        .expect(404);
    });

    it('should return 404 when accessing another user transaction', async () => {
      const fixturesB = await seedUserResources(userB, {
        account: 'User B Checking',
        category: 'Food',
      });
      const created = await createTransaction(userB.accessToken, {
        type: 'EXPENSE',
        amount: 100,
        transactionDate: TRANSACTION_DATE,
        accountId: fixturesB.account.id,
        categoryId: fixturesB.category.id,
      });

      await request(app.getHttpServer())
        .get(`/api/v1/transactions/${created.data.id}`)
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .expect(404);
    });

    it('should list only the authenticated user transactions', async () => {
      const fixturesA = await seedUserResources(userA, {
        account: 'Primary Checking',
        category: 'Food',
      });
      const fixturesB = await seedUserResources(userB, {
        account: 'User B Checking',
        category: 'Food',
      });

      await createTransaction(userA.accessToken, {
        type: 'EXPENSE',
        amount: 100,
        transactionDate: TRANSACTION_DATE,
        description: 'User A grocery',
        accountId: fixturesA.account.id,
        categoryId: fixturesA.category.id,
      });
      await createTransaction(userB.accessToken, {
        type: 'EXPENSE',
        amount: 999,
        transactionDate: TRANSACTION_DATE,
        description: 'User B grocery',
        accountId: fixturesB.account.id,
        categoryId: fixturesB.category.id,
      });

      const response = await request(app.getHttpServer())
        .get('/api/v1/transactions')
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .expect(200);

      expect(response.body.meta).toMatchObject({ total: 1 });
      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0]).toMatchObject({
        description: 'User A grocery',
        userId: userA.id,
      });
    });
  });

  describe('GET /api/v1/transactions', () => {
    it('should retrieve own transactions with pagination envelope', async () => {
      const { account, category } = await seedUserResources(userA, {
        account: 'Primary Checking',
        category: 'Food',
      });
      await createTransaction(userA.accessToken, {
        type: 'EXPENSE',
        amount: 100,
        transactionDate: TRANSACTION_DATE,
        accountId: account.id,
        categoryId: category.id,
      });

      const response = await request(app.getHttpServer())
        .get('/api/v1/transactions')
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .expect(200);

      expect(response.body).toMatchObject({
        success: true,
        meta: { page: 1, limit: 20, total: 1, totalPages: 1 },
      });
      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0]).toMatchObject({ userId: userA.id });
    });

    it('should return 401 for unauthenticated list requests', async () => {
      await request(app.getHttpServer()).get('/api/v1/transactions').expect(401);
    });
  });

  describe('GET /api/v1/transactions filtering, sorting, and pagination', () => {
    async function seedCollectionFixtures() {
      const { account, secondaryAccount, category } = await seedUserResources(
        userA,
        {
          account: 'Primary Checking',
          secondaryAccount: 'Savings Vault',
          category: 'Food',
        },
      );
      const salaryCategory = await createCategory(userA.accessToken, {
        name: 'Salary',
        type: 'INCOME',
      });
      return { account, secondaryAccount, category, salaryCategory };
    }

    it('should paginate the transaction collection', async () => {
      const { account } = await seedCollectionFixtures();

      for (let index = 1; index <= 3; index += 1) {
        await createTransaction(userA.accessToken, {
          type: 'EXPENSE',
          amount: 100 * index,
          transactionDate: `2026-01-0${index}T08:30:00.000Z`,
          accountId: account.id,
        });
      }

      const firstPage = await request(app.getHttpServer())
        .get('/api/v1/transactions')
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .query({ page: 1, limit: 2 })
        .expect(200);

      expect(firstPage.body.meta).toMatchObject({
        page: 1,
        limit: 2,
        total: 3,
        totalPages: 2,
      });
      expect(firstPage.body.data).toHaveLength(2);

      const secondPage = await request(app.getHttpServer())
        .get('/api/v1/transactions')
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .query({ page: 2, limit: 2 })
        .expect(200);

      expect(secondPage.body.meta).toMatchObject({
        page: 2,
        limit: 2,
        total: 3,
        totalPages: 2,
      });
      expect(secondPage.body.data).toHaveLength(1);
    });

    it('should filter by transaction type', async () => {
      const { account } = await seedCollectionFixtures();

      await createTransaction(userA.accessToken, {
        type: 'EXPENSE',
        amount: 100,
        transactionDate: TRANSACTION_DATE,
        accountId: account.id,
      });
      await createTransaction(userA.accessToken, {
        type: 'INCOME',
        amount: 1000,
        transactionDate: TRANSACTION_DATE,
        accountId: account.id,
      });

      const response = await request(app.getHttpServer())
        .get('/api/v1/transactions')
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .query({ type: 'EXPENSE' })
        .expect(200);

      expect(response.body.meta).toMatchObject({ total: 1 });
      expect(response.body.data).toHaveLength(1);
      for (const transaction of response.body.data) {
        expect(transaction.type).toBe('EXPENSE');
      }
    });

    it('should filter by account including both transfer legs', async () => {
      const { account, secondaryAccount, category } =
        await seedCollectionFixtures();

      await createTransaction(userA.accessToken, {
        type: 'EXPENSE',
        amount: 100,
        transactionDate: TRANSACTION_DATE,
        accountId: account.id,
        categoryId: category.id,
      });
      await createTransaction(userA.accessToken, {
        type: 'TRANSFER',
        amount: 500,
        transactionDate: TRANSACTION_DATE,
        accountId: account.id,
        toAccountId: secondaryAccount.id,
      });

      const destinationResponse = await request(app.getHttpServer())
        .get('/api/v1/transactions')
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .query({ accountId: secondaryAccount.id })
        .expect(200);

      // Both legs of the transfer involve the destination account while the
      // unrelated expense does not.
      expect(destinationResponse.body.meta).toMatchObject({ total: 2 });
      expect(destinationResponse.body.data).toHaveLength(2);
      for (const transaction of destinationResponse.body.data) {
        expect(transaction.type).toBe('TRANSFER');
        expect(
          [
            transaction.accountId,
            transaction.fromAccountId,
            transaction.toAccountId,
          ].includes(secondaryAccount.id),
        ).toBe(true);
      }
      expect(destinationResponse.body.data[0].transferGroupId).toBe(
        destinationResponse.body.data[1].transferGroupId,
      );

      const sourceResponse = await request(app.getHttpServer())
        .get('/api/v1/transactions')
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .query({ accountId: account.id })
        .expect(200);

      expect(sourceResponse.body.meta).toMatchObject({ total: 3 });
    });

    it('should filter by category', async () => {
      const { account, category, salaryCategory } =
        await seedCollectionFixtures();

      await createTransaction(userA.accessToken, {
        type: 'EXPENSE',
        amount: 100,
        transactionDate: TRANSACTION_DATE,
        accountId: account.id,
        categoryId: category.id,
      });
      await createTransaction(userA.accessToken, {
        type: 'INCOME',
        amount: 1000,
        transactionDate: TRANSACTION_DATE,
        accountId: account.id,
        categoryId: salaryCategory.id,
      });

      const response = await request(app.getHttpServer())
        .get('/api/v1/transactions')
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .query({ categoryId: salaryCategory.id })
        .expect(200);

      expect(response.body.meta).toMatchObject({ total: 1 });
      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0]).toMatchObject({
        categoryId: salaryCategory.id,
      });
    });

    it('should filter by date range', async () => {
      const { account } = await seedCollectionFixtures();

      await createTransaction(userA.accessToken, {
        type: 'EXPENSE',
        amount: 100,
        transactionDate: '2026-01-05T08:30:00.000Z',
        accountId: account.id,
      });
      await createTransaction(userA.accessToken, {
        type: 'EXPENSE',
        amount: 200,
        transactionDate: '2026-01-15T08:30:00.000Z',
        accountId: account.id,
      });
      await createTransaction(userA.accessToken, {
        type: 'EXPENSE',
        amount: 300,
        transactionDate: '2026-01-25T08:30:00.000Z',
        accountId: account.id,
      });

      const fromResponse = await request(app.getHttpServer())
        .get('/api/v1/transactions')
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .query({ dateFrom: '2026-01-10T00:00:00.000Z' })
        .expect(200);

      expect(fromResponse.body.meta).toMatchObject({ total: 2 });

      const toResponse = await request(app.getHttpServer())
        .get('/api/v1/transactions')
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .query({ dateTo: '2026-01-10T00:00:00.000Z' })
        .expect(200);

      expect(toResponse.body.meta).toMatchObject({ total: 1 });

      const rangeResponse = await request(app.getHttpServer())
        .get('/api/v1/transactions')
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .query({
          dateFrom: '2026-01-10T00:00:00.000Z',
          dateTo: '2026-01-20T00:00:00.000Z',
        })
        .expect(200);

      expect(rangeResponse.body.meta).toMatchObject({ total: 1 });
      expect(Number(rangeResponse.body.data[0].amount)).toBe(200);
    });

    it('should sort by transactionDate ascending and descending', async () => {
      const { account } = await seedCollectionFixtures();

      await createTransaction(userA.accessToken, {
        type: 'EXPENSE',
        amount: 100,
        transactionDate: '2026-01-20T08:30:00.000Z',
        accountId: account.id,
      });
      await createTransaction(userA.accessToken, {
        type: 'EXPENSE',
        amount: 200,
        transactionDate: '2026-01-10T08:30:00.000Z',
        accountId: account.id,
      });

      const ascending = await request(app.getHttpServer())
        .get('/api/v1/transactions')
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .query({ sortBy: 'transactionDate', sortOrder: 'asc' })
        .expect(200);

      expect(ascending.body.data).toHaveLength(2);
      expect(
        new Date(ascending.body.data[0].transactionDate).getTime(),
      ).toBeLessThan(
        new Date(ascending.body.data[1].transactionDate).getTime(),
      );

      const descending = await request(app.getHttpServer())
        .get('/api/v1/transactions')
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .query({ sortBy: 'transactionDate', sortOrder: 'desc' })
        .expect(200);

      expect(descending.body.data).toHaveLength(2);
      expect(
        new Date(descending.body.data[0].transactionDate).getTime(),
      ).toBeGreaterThan(
        new Date(descending.body.data[1].transactionDate).getTime(),
      );
    });

    it('should sort by amount descending', async () => {
      const { account } = await seedCollectionFixtures();

      for (const amount of [100, 300, 200]) {
        await createTransaction(userA.accessToken, {
          type: 'EXPENSE',
          amount,
          transactionDate: TRANSACTION_DATE,
          accountId: account.id,
        });
      }

      const response = await request(app.getHttpServer())
        .get('/api/v1/transactions')
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .query({ sortBy: 'amount', sortOrder: 'desc' })
        .expect(200);

      expect(
        response.body.data.map((transaction: { amount: string }) =>
          Number(transaction.amount),
        ),
      ).toEqual([300, 200, 100]);
    });

    it('should reject invalid query parameters with 400', async () => {
      const cases: Record<string, unknown>[] = [
        { limit: 500 },
        { page: 0 },
        { type: 'INVALID' },
        { sortBy: 'password' },
        { sortOrder: 'random' },
        { accountId: 'not-a-uuid' },
        { categoryId: 'not-a-uuid' },
      ];

      for (const query of cases) {
        const response = await request(app.getHttpServer())
          .get('/api/v1/transactions')
          .set('Authorization', `Bearer ${userA.accessToken}`)
          .query(query)
          .expect(400);

        expect(response.body.message).toBe('Validation failed');
      }
    });
  });

  describe('GET /api/v1/transactions/:id', () => {
    it('should retrieve an own transaction', async () => {
      const { account, category } = await seedUserResources(userA, {
        account: 'Primary Checking',
        category: 'Food',
      });
      const created = await createTransaction(userA.accessToken, {
        type: 'EXPENSE',
        amount: 2500,
        transactionDate: TRANSACTION_DATE,
        accountId: account.id,
        categoryId: category.id,
      });

      const response = await request(app.getHttpServer())
        .get(`/api/v1/transactions/${created.data.id}`)
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .expect(200);

      expect(response.body).toMatchObject({
        success: true,
        data: { id: created.data.id, userId: userA.id },
      });
    });

    it('should return 404 for another user transaction', async () => {
      const fixturesB = await seedUserResources(userB, {
        account: 'User B Checking',
        category: 'Food',
      });
      const created = await createTransaction(userB.accessToken, {
        type: 'EXPENSE',
        amount: 100,
        transactionDate: TRANSACTION_DATE,
        accountId: fixturesB.account.id,
      });

      await request(app.getHttpServer())
        .get(`/api/v1/transactions/${created.data.id}`)
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .expect(404);
    });

    it('should return 404 for a nonexistent transaction', async () => {
      await request(app.getHttpServer())
        .get(`/api/v1/transactions/${NONEXISTENT_ID}`)
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .expect(404);
    });

    it('should return 400 for a malformed transaction id', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/transactions/123')
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .expect(400);
    });

    it('should return 401 for unauthenticated get-by-id requests', async () => {
      const { account } = await seedUserResources(userA, {
        account: 'Primary Checking',
        category: 'Food',
      });
      const created = await createTransaction(userA.accessToken, {
        type: 'EXPENSE',
        amount: 100,
        transactionDate: TRANSACTION_DATE,
        accountId: account.id,
      });

      await request(app.getHttpServer())
        .get(`/api/v1/transactions/${created.data.id}`)
        .expect(401);
    });
  });

  describe('PATCH /api/v1/transactions/:id', () => {
    it('should update amount and description of an own transaction', async () => {
      const { account, category } = await seedUserResources(userA, {
        account: 'Primary Checking',
        category: 'Food',
      });
      const created = await createTransaction(userA.accessToken, {
        type: 'EXPENSE',
        amount: 2500,
        transactionDate: TRANSACTION_DATE,
        description: 'Grocery run',
        accountId: account.id,
        categoryId: category.id,
      });

      const response = await request(app.getHttpServer())
        .patch(`/api/v1/transactions/${created.data.id}`)
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .send({ amount: 3000, description: 'Updated grocery run' })
        .expect(200);

      expect(response.body).toMatchObject({
        success: true,
        data: {
          id: created.data.id,
          description: 'Updated grocery run',
        },
      });
      expect(Number(response.body.data.amount)).toBe(3000);
    });

    it('should return 404 when updating another user transaction', async () => {
      const fixturesB = await seedUserResources(userB, {
        account: 'User B Checking',
        category: 'Food',
      });
      const created = await createTransaction(userB.accessToken, {
        type: 'EXPENSE',
        amount: 100,
        transactionDate: TRANSACTION_DATE,
        accountId: fixturesB.account.id,
      });

      await request(app.getHttpServer())
        .patch(`/api/v1/transactions/${created.data.id}`)
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .send({ description: 'Hacked' })
        .expect(404);
    });

    it('should reject an empty update', async () => {
      const { account } = await seedUserResources(userA, {
        account: 'Primary Checking',
        category: 'Food',
      });
      const created = await createTransaction(userA.accessToken, {
        type: 'EXPENSE',
        amount: 100,
        transactionDate: TRANSACTION_DATE,
        accountId: account.id,
      });

      const response = await request(app.getHttpServer())
        .patch(`/api/v1/transactions/${created.data.id}`)
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .send({})
        .expect(400);

      expect(response.body.message).toBe('Validation failed');
    });

    it('should reject transaction-type fields on update', async () => {
      const { account } = await seedUserResources(userA, {
        account: 'Primary Checking',
        category: 'Food',
      });
      const created = await createTransaction(userA.accessToken, {
        type: 'EXPENSE',
        amount: 100,
        transactionDate: TRANSACTION_DATE,
        accountId: account.id,
      });

      const response = await request(app.getHttpServer())
        .patch(`/api/v1/transactions/${created.data.id}`)
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .send({ type: 'INCOME' })
        .expect(400);

      expect(response.body.message).toBe('Validation failed');
    });

    it('should reject transfer-specific fields on INCOME/EXPENSE updates', async () => {
      const { account, secondaryAccount } = await seedUserResources(userA, {
        account: 'Primary Checking',
        secondaryAccount: 'Savings Vault',
        category: 'Food',
      });
      const created = await createTransaction(userA.accessToken, {
        type: 'EXPENSE',
        amount: 100,
        transactionDate: TRANSACTION_DATE,
        accountId: account.id,
      });

      const response = await request(app.getHttpServer())
        .patch(`/api/v1/transactions/${created.data.id}`)
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .send({ amount: 200, toAccountId: secondaryAccount.id })
        .expect(400);

      expect(response.body.message).toBe('Validation failed');
    });

    it('should enforce account ownership during updates', async () => {
      const fixturesA = await seedUserResources(userA, {
        account: 'Primary Checking',
        category: 'Food',
      });
      const fixturesB = await seedUserResources(userB, {
        account: 'User B Checking',
        category: 'Food',
      });
      const created = await createTransaction(userA.accessToken, {
        type: 'EXPENSE',
        amount: 100,
        transactionDate: TRANSACTION_DATE,
        accountId: fixturesA.account.id,
      });

      await request(app.getHttpServer())
        .patch(`/api/v1/transactions/${created.data.id}`)
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .send({ accountId: fixturesB.account.id })
        .expect(404);
    });

    it('should enforce category ownership during updates', async () => {
      const fixturesA = await seedUserResources(userA, {
        account: 'Primary Checking',
        category: 'Food',
      });
      const fixturesB = await seedUserResources(userB, {
        account: 'User B Checking',
        category: 'Transport',
      });
      const created = await createTransaction(userA.accessToken, {
        type: 'EXPENSE',
        amount: 100,
        transactionDate: TRANSACTION_DATE,
        accountId: fixturesA.account.id,
        categoryId: fixturesA.category.id,
      });

      await request(app.getHttpServer())
        .patch(`/api/v1/transactions/${created.data.id}`)
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .send({ categoryId: fixturesB.category.id })
        .expect(404);
    });

    it('should reject updates to a transfer transaction', async () => {
      const { account, secondaryAccount } = await seedUserResources(userA, {
        account: 'Primary Checking',
        secondaryAccount: 'Savings Vault',
        category: 'Food',
      });
      const transfer = await createTransaction(userA.accessToken, {
        type: 'TRANSFER',
        amount: 5000,
        transactionDate: TRANSACTION_DATE,
        accountId: account.id,
        toAccountId: secondaryAccount.id,
      });
      const transferId = transfer.data[0].id as string;

      await request(app.getHttpServer())
        .patch(`/api/v1/transactions/${transferId}`)
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .send({ amount: 6000 })
        .expect(400);
    });
  });

  describe('archived accounts', () => {
    it('should return 404 when creating a transaction on an archived account', async () => {
      const { account, category } = await seedUserResources(userA, {
        account: 'Primary Checking',
        category: 'Food',
      });

      await request(app.getHttpServer())
        .delete(`/api/v1/accounts/${account.id}`)
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .expect(204);

      await request(app.getHttpServer())
        .post('/api/v1/transactions')
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .send({
          type: 'EXPENSE',
          amount: 100,
          transactionDate: TRANSACTION_DATE,
          accountId: account.id,
          categoryId: category.id,
        })
        .expect(404);
    });
  });

  describe('authentication protection', () => {
    it('should return 401 for unauthenticated transaction requests', async () => {
      const { account } = await seedUserResources(userA, {
        account: 'Primary Checking',
        category: 'Food',
      });
      const created = await createTransaction(userA.accessToken, {
        type: 'EXPENSE',
        amount: 100,
        transactionDate: TRANSACTION_DATE,
        accountId: account.id,
      });
      const transactionId = created.data.id as string;

      await request(app.getHttpServer()).get('/api/v1/transactions').expect(401);

      await request(app.getHttpServer())
        .post('/api/v1/transactions')
        .send({
          type: 'EXPENSE',
          amount: 100,
          transactionDate: TRANSACTION_DATE,
          accountId: account.id,
        })
        .expect(401);

      await request(app.getHttpServer())
        .get(`/api/v1/transactions/${transactionId}`)
        .expect(401);

      await request(app.getHttpServer())
        .patch(`/api/v1/transactions/${transactionId}`)
        .send({ description: 'Hacked' })
        .expect(401);
    });
  });
});
