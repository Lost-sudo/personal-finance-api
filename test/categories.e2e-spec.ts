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

describe('Categories E2E', () => {
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
    userA = await registerUser(`cat-owner-a-${suffix}@example.com`);
    userB = await registerUser(`cat-owner-b-${suffix}@example.com`);
  });

  beforeEach(async () => {
    await prisma.category.deleteMany({
      where: {
        userId: { in: [userA.id, userB.id] },
      },
    });
  });

  afterAll(async () => {
    await prisma.category
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

  function createCategory(token: string, payload: Record<string, unknown>) {
    return request(app.getHttpServer())
      .post('/api/v1/categories')
      .set('Authorization', `Bearer ${token}`)
      .send(payload)
      .expect(201)
      .then((response) => response.body.data);
  }

  describe('POST /api/v1/categories', () => {
    it('should create an expense category for the authenticated user', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/categories')
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .send({
          name: 'Food',
          type: 'EXPENSE',
          color: '#FF9800',
        })
        .expect(201);

      expect(response.body).toMatchObject({
        success: true,
        data: {
          name: 'Food',
          type: 'EXPENSE',
          color: '#FF9800',
          userId: userA.id,
          isArchived: false,
        },
      });

      expect(response.body.data.id).toBeDefined();
      expect(response.body.data.createdAt).toBeDefined();
      expect(response.body.data.updatedAt).toBeDefined();
    });

    it('should create an income category', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/categories')
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .send({
          name: 'Salary',
          type: 'INCOME',
        })
        .expect(201);

      expect(response.body).toMatchObject({
        success: true,
        data: {
          name: 'Salary',
          type: 'INCOME',
          userId: userA.id,
          isArchived: false,
        },
      });
    });

    it('should reject duplicate categories', async () => {
      const category = {
        name: 'Food',
        type: 'EXPENSE',
      };

      await request(app.getHttpServer())
        .post('/api/v1/categories')
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .send(category)
        .expect(201);

      const response = await request(app.getHttpServer())
        .post('/api/v1/categories')
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .send(category)
        .expect(409);

      expect(response.body.message).toBe(
        'A category with this name and type already exists',
      );
    });

    it('should reject invalid category data', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/categories')
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .send({
          name: '',
          type: 'INVALID',
        })
        .expect(400);

      expect(response.body.message).toBe('Validation failed');
      expect(response.body.errors).toBeDefined();
    });

    it('should reject unauthenticated category creation with 401', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/categories')
        .send({ name: 'Food', type: 'EXPENSE' })
        .expect(401);

      await request(app.getHttpServer())
        .post('/api/v1/categories')
        .set('Authorization', 'Bearer invalid-token')
        .send({ name: 'Food', type: 'EXPENSE' })
        .expect(401);
    });
  });

  describe('GET /api/v1/categories', () => {
    it('should return paginated user categories', async () => {
      await createCategory(userA.accessToken, {
        name: 'Food',
        type: 'EXPENSE',
      });
      await createCategory(userA.accessToken, {
        name: 'Salary',
        type: 'INCOME',
      });

      const response = await request(app.getHttpServer())
        .get('/api/v1/categories')
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
            name: 'Food',
            type: 'EXPENSE',
          }),
          expect.objectContaining({
            name: 'Salary',
            type: 'INCOME',
          }),
        ]),
      );
    });

    it('should not return archived categories', async () => {
      const category = await createCategory(userA.accessToken, {
        name: 'Food',
        type: 'EXPENSE',
      });

      await request(app.getHttpServer())
        .delete(`/api/v1/categories/${category.id}`)
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .expect(204);

      const response = await request(app.getHttpServer())
        .get('/api/v1/categories')
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .expect(200);

      expect(response.body.data).toHaveLength(0);
      expect(response.body.meta).toMatchObject({
        total: 0,
        totalPages: 0,
      });
    });

    it('should filter categories by type', async () => {
      await createCategory(userA.accessToken, {
        name: 'Food',
        type: 'EXPENSE',
      });
      await createCategory(userA.accessToken, {
        name: 'Salary',
        type: 'INCOME',
      });

      const response = await request(app.getHttpServer())
        .get('/api/v1/categories')
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .query({ type: 'EXPENSE' })
        .expect(200);

      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0]).toMatchObject({
        name: 'Food',
        type: 'EXPENSE',
      });
      expect(response.body.meta).toMatchObject({ total: 1 });
    });

    it('should filter categories by search term (case-insensitive)', async () => {
      await createCategory(userA.accessToken, {
        name: 'Food',
        type: 'EXPENSE',
      });
      await createCategory(userA.accessToken, {
        name: 'Salary',
        type: 'INCOME',
      });

      const response = await request(app.getHttpServer())
        .get('/api/v1/categories')
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .query({ search: 'foo' })
        .expect(200);

      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0]).toMatchObject({ name: 'Food' });
      expect(response.body.meta).toMatchObject({ total: 1 });
    });

    it('should filter categories by type and search term', async () => {
      await createCategory(userA.accessToken, {
        name: 'Food',
        type: 'EXPENSE',
      });
      await createCategory(userA.accessToken, {
        name: 'Food Allowance',
        type: 'INCOME',
      });
      await createCategory(userA.accessToken, {
        name: 'Salary',
        type: 'INCOME',
      });

      const response = await request(app.getHttpServer())
        .get('/api/v1/categories')
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .query({ type: 'INCOME', search: 'food' })
        .expect(200);

      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0]).toMatchObject({
        name: 'Food Allowance',
        type: 'INCOME',
      });
      expect(response.body.meta).toMatchObject({ total: 1 });
    });

    it('should paginate categories', async () => {
      await createCategory(userA.accessToken, {
        name: 'Apricots',
        type: 'EXPENSE',
      });
      await createCategory(userA.accessToken, {
        name: 'Bananas',
        type: 'EXPENSE',
      });
      await createCategory(userA.accessToken, {
        name: 'Cherries',
        type: 'EXPENSE',
      });

      const response = await request(app.getHttpServer())
        .get('/api/v1/categories')
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
      expect(response.body.data[0]).toMatchObject({ name: 'Bananas' });
    });

    it('should sort categories', async () => {
      await createCategory(userA.accessToken, {
        name: 'Alpha',
        type: 'EXPENSE',
      });
      await createCategory(userA.accessToken, {
        name: 'Beta',
        type: 'EXPENSE',
      });

      const response = await request(app.getHttpServer())
        .get('/api/v1/categories')
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .query({ sortBy: 'name', sortOrder: 'desc' })
        .expect(200);

      expect(response.body.data).toHaveLength(2);
      expect(response.body.data[0].name).toBe('Beta');
      expect(response.body.data[1].name).toBe('Alpha');
    });

    it('should reject invalid query parameters', async () => {
      const pageResponse = await request(app.getHttpServer())
        .get('/api/v1/categories')
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .query({ page: 0 })
        .expect(400);

      expect(pageResponse.body.message).toBe('Validation failed');

      const typeResponse = await request(app.getHttpServer())
        .get('/api/v1/categories')
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .query({ type: 'INVALID' })
        .expect(400);

      expect(typeResponse.body.message).toBe('Validation failed');
    });

    it('should reject unauthenticated list requests with 401', async () => {
      await request(app.getHttpServer()).get('/api/v1/categories').expect(401);
    });

    it('should isolate categories between users', async () => {
      await createCategory(userA.accessToken, {
        name: 'Food',
        type: 'EXPENSE',
      });

      const responseB = await request(app.getHttpServer())
        .get('/api/v1/categories')
        .set('Authorization', `Bearer ${userB.accessToken}`)
        .expect(200);

      expect(responseB.body.data).toHaveLength(0);
      expect(responseB.body.meta).toMatchObject({ total: 0 });

      const responseA = await request(app.getHttpServer())
        .get('/api/v1/categories')
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .expect(200);

      expect(responseA.body.data).toHaveLength(1);
    });
  });

  describe('GET /api/v1/categories/:id', () => {
    it('should return a category', async () => {
      const category = await createCategory(userA.accessToken, {
        name: 'Transportation',
        type: 'EXPENSE',
      });

      const response = await request(app.getHttpServer())
        .get(`/api/v1/categories/${category.id}`)
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .expect(200);

      expect(response.body).toMatchObject({
        success: true,
        data: {
          id: category.id,
          name: 'Transportation',
          type: 'EXPENSE',
          userId: userA.id,
          isArchived: false,
        },
      });
    });

    it('should return 404 for a nonexistent category', async () => {
      const nonexistentId = '00000000-0000-0000-0000-000000000000';

      await request(app.getHttpServer())
        .get(`/api/v1/categories/${nonexistentId}`)
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .expect(404);
    });

    it('should return 400 for a malformed category id', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/categories/123')
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .expect(400);
    });

    it('should return 404 when accessing another user category', async () => {
      const category = await createCategory(userA.accessToken, {
        name: 'Transportation',
        type: 'EXPENSE',
      });

      await request(app.getHttpServer())
        .get(`/api/v1/categories/${category.id}`)
        .set('Authorization', `Bearer ${userB.accessToken}`)
        .expect(404);
    });

    it('should reject unauthenticated get-by-id requests with 401', async () => {
      const category = await createCategory(userA.accessToken, {
        name: 'Transportation',
        type: 'EXPENSE',
      });

      await request(app.getHttpServer())
        .get(`/api/v1/categories/${category.id}`)
        .expect(401);
    });
  });

  describe('PATCH /api/v1/categories/:id', () => {
    it('should update a category', async () => {
      const category = await createCategory(userA.accessToken, {
        name: 'Food',
        type: 'EXPENSE',
      });

      const response = await request(app.getHttpServer())
        .patch(`/api/v1/categories/${category.id}`)
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .send({
          name: 'Groceries',
          color: '#4CAF50',
        })
        .expect(200);

      expect(response.body).toMatchObject({
        success: true,
        data: {
          id: category.id,
          name: 'Groceries',
          type: 'EXPENSE',
          color: '#4CAF50',
          isArchived: false,
        },
      });
    });

    it('should reject an empty update', async () => {
      const category = await createCategory(userA.accessToken, {
        name: 'Food',
        type: 'EXPENSE',
      });

      const response = await request(app.getHttpServer())
        .patch(`/api/v1/categories/${category.id}`)
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .send({})
        .expect(400);

      expect(response.body.message).toBe('Validation failed');
    });

    it('should return 404 when updating a nonexistent category', async () => {
      const nonexistentId = '00000000-0000-0000-0000-000000000000';

      await request(app.getHttpServer())
        .patch(`/api/v1/categories/${nonexistentId}`)
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .send({
          name: 'Updated',
        })
        .expect(404);
    });

    it('should return 400 when updating with a malformed category id', async () => {
      await request(app.getHttpServer())
        .patch('/api/v1/categories/123')
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .send({
          name: 'Updated',
        })
        .expect(400);
    });

    it('should return 404 when updating another user category', async () => {
      const category = await createCategory(userA.accessToken, {
        name: 'Food',
        type: 'EXPENSE',
      });

      await request(app.getHttpServer())
        .patch(`/api/v1/categories/${category.id}`)
        .set('Authorization', `Bearer ${userB.accessToken}`)
        .send({ name: 'Hacked' })
        .expect(404);
    });

    it('should reject unauthenticated update requests with 401', async () => {
      const category = await createCategory(userA.accessToken, {
        name: 'Food',
        type: 'EXPENSE',
      });

      await request(app.getHttpServer())
        .patch(`/api/v1/categories/${category.id}`)
        .send({ name: 'Hacked' })
        .expect(401);
    });
  });

  describe('DELETE /api/v1/categories/:id', () => {
    it('should archive a category', async () => {
      const category = await createCategory(userA.accessToken, {
        name: 'Entertainment',
        type: 'EXPENSE',
      });

      await request(app.getHttpServer())
        .delete(`/api/v1/categories/${category.id}`)
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .expect(204);

      const archived = await prisma.category.findFirst({
        where: { id: category.id },
      });

      expect(archived).toMatchObject({
        id: category.id,
        isArchived: true,
      });
    });

    it('should return 404 when archiving a nonexistent category', async () => {
      const nonexistentId = '00000000-0000-0000-0000-000000000000';

      await request(app.getHttpServer())
        .delete(`/api/v1/categories/${nonexistentId}`)
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .expect(404);
    });

    it('should return 400 when archiving with a malformed category id', async () => {
      await request(app.getHttpServer())
        .delete('/api/v1/categories/123')
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .expect(400);
    });

    it('should not allow an archived category to be retrieved', async () => {
      const category = await createCategory(userA.accessToken, {
        name: 'Subscriptions',
        type: 'EXPENSE',
      });

      await request(app.getHttpServer())
        .delete(`/api/v1/categories/${category.id}`)
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .expect(204);

      await request(app.getHttpServer())
        .get(`/api/v1/categories/${category.id}`)
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .expect(404);
    });

    it('should return 404 when archiving another user category', async () => {
      const category = await createCategory(userA.accessToken, {
        name: 'Entertainment',
        type: 'EXPENSE',
      });

      await request(app.getHttpServer())
        .delete(`/api/v1/categories/${category.id}`)
        .set('Authorization', `Bearer ${userB.accessToken}`)
        .expect(404);
    });

    it('should reject unauthenticated archive requests with 401', async () => {
      const category = await createCategory(userA.accessToken, {
        name: 'Entertainment',
        type: 'EXPENSE',
      });

      await request(app.getHttpServer())
        .delete(`/api/v1/categories/${category.id}`)
        .expect(401);
    });
  });
});
