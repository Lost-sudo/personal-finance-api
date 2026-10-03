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

describe('Accounts E2E', () => {
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
    userA = await registerUser(`acct-owner-a-${suffix}@example.com`);
    userB = await registerUser(`acct-owner-b-${suffix}@example.com`);
  });

  beforeEach(async () => {
    await prisma.account.deleteMany({
      where: {
        userId: { in: [userA.id, userB.id] },
      },
    });
  });

  afterAll(async () => {
    await prisma.account
      .deleteMany({
        where: {
          userId: { in: [userA.id, userB.id] },
        },
      })
      .catch(() => undefined);

    await prisma.user
      .deleteMany({
        where: {
          email: { in: [userA.email, userB.email] },
        },
      })
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

  describe('POST /api/v1/accounts', () => {
    it('should create a bank account for the authenticated user', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/accounts')
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .send({
          name: 'BDO Savings',
          type: 'BANK',
          currency: 'PHP',
          initialBalance: 15000,
        })
        .expect(201);

      expect(response.body).toMatchObject({
        success: true,
        data: {
          name: 'BDO Savings',
          type: 'BANK',
          currency: 'PHP',
          userId: userA.id,
          isArchived: false,
        },
      });

      expect(response.body.data.id).toBeDefined();
      expect(response.body.data.initialBalance).toBeDefined();
      expect(response.body.data.createdAt).toBeDefined();
      expect(response.body.data.updatedAt).toBeDefined();
    });

    it('should apply defaults for currency and initial balance', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/accounts')
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .send({
          name: 'Cash Wallet',
          type: 'CASH',
        })
        .expect(201);

      expect(response.body).toMatchObject({
        success: true,
        data: {
          name: 'Cash Wallet',
          type: 'CASH',
          currency: 'PHP',
          userId: userA.id,
          isArchived: false,
        },
      });
    });

    it('should reject duplicate account names', async () => {
      const account = {
        name: 'BDO Savings',
        type: 'BANK',
      };

      await request(app.getHttpServer())
        .post('/api/v1/accounts')
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .send(account)
        .expect(201);

      const response = await request(app.getHttpServer())
        .post('/api/v1/accounts')
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .send(account)
        .expect(409);

      expect(response.body.message).toBe(
        'An account with this name already exists',
      );
    });

    it('should reject duplicate names across different types', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/accounts')
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .send({ name: 'Reserve', type: 'BANK' })
        .expect(201);

      await request(app.getHttpServer())
        .post('/api/v1/accounts')
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .send({ name: 'Reserve', type: 'CASH' })
        .expect(409);
    });

    it('should allow different users to use the same account name', async () => {
      await createAccount(userA.accessToken, {
        name: 'BDO Savings',
        type: 'BANK',
      });

      const response = await request(app.getHttpServer())
        .post('/api/v1/accounts')
        .set('Authorization', `Bearer ${userB.accessToken}`)
        .send({ name: 'BDO Savings', type: 'BANK' })
        .expect(201);

      expect(response.body.data).toMatchObject({ userId: userB.id });
    });

    it('should reject invalid account data', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/accounts')
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .send({
          name: '',
          type: 'INVALID',
        })
        .expect(400);

      expect(response.body.message).toBe('Validation failed');
      expect(response.body.errors).toBeDefined();
    });

    it('should reject unauthenticated account creation with 401', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/accounts')
        .send({ name: 'BDO Savings', type: 'BANK' })
        .expect(401);

      await request(app.getHttpServer())
        .post('/api/v1/accounts')
        .set('Authorization', 'Bearer invalid-token')
        .send({ name: 'BDO Savings', type: 'BANK' })
        .expect(401);
    });
  });

  describe('GET /api/v1/accounts', () => {
    it('should return paginated user accounts', async () => {
      await createAccount(userA.accessToken, {
        name: 'BDO Savings',
        type: 'BANK',
      });
      await createAccount(userA.accessToken, {
        name: 'Cash Wallet',
        type: 'CASH',
      });

      const response = await request(app.getHttpServer())
        .get('/api/v1/accounts')
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .expect(200);

      expect(response.body).toMatchObject({
        success: true,
        meta: {
          page: 1,
          limit: 20,
          total: 2,
          totalPages: 1,
        },
      });

      expect(response.body.data).toHaveLength(2);

      expect(response.body.data).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: 'BDO Savings',
            type: 'BANK',
          }),
          expect.objectContaining({
            name: 'Cash Wallet',
            type: 'CASH',
          }),
        ]),
      );
    });

    it('should not return archived accounts', async () => {
      const account = await createAccount(userA.accessToken, {
        name: 'BDO Savings',
        type: 'BANK',
      });

      await request(app.getHttpServer())
        .delete(`/api/v1/accounts/${account.id}`)
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .expect(204);

      const response = await request(app.getHttpServer())
        .get('/api/v1/accounts')
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .expect(200);

      expect(response.body.data).toHaveLength(0);
      expect(response.body.meta).toMatchObject({
        total: 0,
        totalPages: 0,
      });
    });

    it('should filter accounts by type', async () => {
      await createAccount(userA.accessToken, {
        name: 'BDO Savings',
        type: 'BANK',
      });
      await createAccount(userA.accessToken, {
        name: 'Cash Wallet',
        type: 'CASH',
      });

      const response = await request(app.getHttpServer())
        .get('/api/v1/accounts')
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .query({ type: 'BANK' })
        .expect(200);

      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0]).toMatchObject({
        name: 'BDO Savings',
        type: 'BANK',
      });
      expect(response.body.meta).toMatchObject({ total: 1 });
    });

    it('should filter accounts by search term (case-insensitive)', async () => {
      await createAccount(userA.accessToken, {
        name: 'BDO Savings',
        type: 'BANK',
      });
      await createAccount(userA.accessToken, {
        name: 'Cash Wallet',
        type: 'CASH',
      });

      const response = await request(app.getHttpServer())
        .get('/api/v1/accounts')
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .query({ search: 'bdo' })
        .expect(200);

      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0]).toMatchObject({ name: 'BDO Savings' });
      expect(response.body.meta).toMatchObject({ total: 1 });
    });

    it('should paginate accounts', async () => {
      await createAccount(userA.accessToken, {
        name: 'Alpha',
        type: 'BANK',
      });
      await createAccount(userA.accessToken, {
        name: 'Beta',
        type: 'BANK',
      });
      await createAccount(userA.accessToken, {
        name: 'Gamma',
        type: 'BANK',
      });

      const response = await request(app.getHttpServer())
        .get('/api/v1/accounts')
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .query({ page: 2, limit: 1 })
        .expect(200);

      expect(response.body.meta).toMatchObject({
        page: 2,
        limit: 1,
        total: 3,
        totalPages: 3,
      });
      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0]).toMatchObject({ name: 'Beta' });
    });

    it('should sort accounts', async () => {
      await createAccount(userA.accessToken, {
        name: 'Alpha',
        type: 'BANK',
      });
      await createAccount(userA.accessToken, {
        name: 'Beta',
        type: 'BANK',
      });

      const response = await request(app.getHttpServer())
        .get('/api/v1/accounts')
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .query({ sortBy: 'name', sortOrder: 'desc' })
        .expect(200);

      expect(response.body.data).toHaveLength(2);
      expect(response.body.data[0].name).toBe('Beta');
      expect(response.body.data[1].name).toBe('Alpha');
    });

    it('should reject invalid query parameters', async () => {
      const pageResponse = await request(app.getHttpServer())
        .get('/api/v1/accounts')
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .query({ page: 0 })
        .expect(400);

      expect(pageResponse.body.message).toBe('Validation failed');

      const typeResponse = await request(app.getHttpServer())
        .get('/api/v1/accounts')
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .query({ type: 'INVALID' })
        .expect(400);

      expect(typeResponse.body.message).toBe('Validation failed');
    });

    it('should reject unauthenticated list requests with 401', async () => {
      await request(app.getHttpServer()).get('/api/v1/accounts').expect(401);
    });

    it('should isolate accounts between users', async () => {
      await createAccount(userA.accessToken, {
        name: 'BDO Savings',
        type: 'BANK',
      });

      const responseB = await request(app.getHttpServer())
        .get('/api/v1/accounts')
        .set('Authorization', `Bearer ${userB.accessToken}`)
        .expect(200);

      expect(responseB.body.data).toHaveLength(0);
      expect(responseB.body.meta).toMatchObject({ total: 0 });

      const responseA = await request(app.getHttpServer())
        .get('/api/v1/accounts')
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .expect(200);

      expect(responseA.body.data).toHaveLength(1);
    });
  });

  describe('GET /api/v1/accounts/:id', () => {
    it('should return an account', async () => {
      const account = await createAccount(userA.accessToken, {
        name: 'BDO Savings',
        type: 'BANK',
        currency: 'PHP',
        initialBalance: 15000,
      });

      const response = await request(app.getHttpServer())
        .get(`/api/v1/accounts/${account.id}`)
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .expect(200);

      expect(response.body).toMatchObject({
        success: true,
        data: {
          id: account.id,
          name: 'BDO Savings',
          type: 'BANK',
          currency: 'PHP',
          userId: userA.id,
          isArchived: false,
        },
      });
    });

    it('should return 404 for a nonexistent account', async () => {
      const nonexistentId = '00000000-0000-0000-0000-000000000000';

      await request(app.getHttpServer())
        .get(`/api/v1/accounts/${nonexistentId}`)
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .expect(404);
    });

    it('should return 400 for a malformed account id', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/accounts/123')
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .expect(400);
    });

    it('should return 404 when accessing another user account', async () => {
      const account = await createAccount(userA.accessToken, {
        name: 'BDO Savings',
        type: 'BANK',
      });

      await request(app.getHttpServer())
        .get(`/api/v1/accounts/${account.id}`)
        .set('Authorization', `Bearer ${userB.accessToken}`)
        .expect(404);
    });

    it('should reject unauthenticated get-by-id requests with 401', async () => {
      const account = await createAccount(userA.accessToken, {
        name: 'BDO Savings',
        type: 'BANK',
      });

      await request(app.getHttpServer())
        .get(`/api/v1/accounts/${account.id}`)
        .expect(401);
    });
  });

  describe('PATCH /api/v1/accounts/:id', () => {
    it('should update an account', async () => {
      const account = await createAccount(userA.accessToken, {
        name: 'BDO Savings',
        type: 'BANK',
      });

      const response = await request(app.getHttpServer())
        .patch(`/api/v1/accounts/${account.id}`)
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .send({
          name: 'BDO Checking',
          currency: 'USD',
        })
        .expect(200);

      expect(response.body).toMatchObject({
        success: true,
        data: {
          id: account.id,
          name: 'BDO Checking',
          type: 'BANK',
          currency: 'USD',
          isArchived: false,
        },
      });
    });

    it('should reject an empty update', async () => {
      const account = await createAccount(userA.accessToken, {
        name: 'BDO Savings',
        type: 'BANK',
      });

      const response = await request(app.getHttpServer())
        .patch(`/api/v1/accounts/${account.id}`)
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .send({})
        .expect(400);

      expect(response.body.message).toBe('Validation failed');
    });

    it('should return 404 when updating a nonexistent account', async () => {
      const nonexistentId = '00000000-0000-0000-0000-000000000000';

      await request(app.getHttpServer())
        .patch(`/api/v1/accounts/${nonexistentId}`)
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .send({
          name: 'Updated',
        })
        .expect(404);
    });

    it('should return 400 when updating with a malformed account id', async () => {
      await request(app.getHttpServer())
        .patch('/api/v1/accounts/123')
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .send({
          name: 'Updated',
        })
        .expect(400);
    });

    it('should return 409 when updating to a duplicate name', async () => {
      await createAccount(userA.accessToken, {
        name: 'BDO Checking',
        type: 'BANK',
      });
      const account = await createAccount(userA.accessToken, {
        name: 'BDO Savings',
        type: 'BANK',
      });

      await request(app.getHttpServer())
        .patch(`/api/v1/accounts/${account.id}`)
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .send({ name: 'BDO Checking' })
        .expect(409);
    });

    it('should return 404 when updating another user account', async () => {
      const account = await createAccount(userA.accessToken, {
        name: 'BDO Savings',
        type: 'BANK',
      });

      await request(app.getHttpServer())
        .patch(`/api/v1/accounts/${account.id}`)
        .set('Authorization', `Bearer ${userB.accessToken}`)
        .send({ name: 'Hacked' })
        .expect(404);
    });

    it('should reject unauthenticated update requests with 401', async () => {
      const account = await createAccount(userA.accessToken, {
        name: 'BDO Savings',
        type: 'BANK',
      });

      await request(app.getHttpServer())
        .patch(`/api/v1/accounts/${account.id}`)
        .send({ name: 'Hacked' })
        .expect(401);
    });
  });

  describe('DELETE /api/v1/accounts/:id', () => {
    it('should archive an account', async () => {
      const account = await createAccount(userA.accessToken, {
        name: 'BDO Savings',
        type: 'BANK',
      });

      await request(app.getHttpServer())
        .delete(`/api/v1/accounts/${account.id}`)
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .expect(204);

      const archived = await prisma.account.findFirst({
        where: { id: account.id },
      });

      expect(archived).toMatchObject({
        id: account.id,
        isArchived: true,
      });
    });

    it('should return 404 when archiving a nonexistent account', async () => {
      const nonexistentId = '00000000-0000-0000-0000-000000000000';

      await request(app.getHttpServer())
        .delete(`/api/v1/accounts/${nonexistentId}`)
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .expect(404);
    });

    it('should return 400 when archiving with a malformed account id', async () => {
      await request(app.getHttpServer())
        .delete('/api/v1/accounts/123')
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .expect(400);
    });

    it('should not allow an archived account to be retrieved', async () => {
      const account = await createAccount(userA.accessToken, {
        name: 'BDO Savings',
        type: 'BANK',
      });

      await request(app.getHttpServer())
        .delete(`/api/v1/accounts/${account.id}`)
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .expect(204);

      await request(app.getHttpServer())
        .get(`/api/v1/accounts/${account.id}`)
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .expect(404);
    });

    it('should return 404 when archiving another user account', async () => {
      const account = await createAccount(userA.accessToken, {
        name: 'BDO Savings',
        type: 'BANK',
      });

      await request(app.getHttpServer())
        .delete(`/api/v1/accounts/${account.id}`)
        .set('Authorization', `Bearer ${userB.accessToken}`)
        .expect(404);
    });

    it('should reject unauthenticated archive requests with 401', async () => {
      const account = await createAccount(userA.accessToken, {
        name: 'BDO Savings',
        type: 'BANK',
      });

      await request(app.getHttpServer())
        .delete(`/api/v1/accounts/${account.id}`)
        .expect(401);
    });
  });
});
