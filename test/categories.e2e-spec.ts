import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { DEVELOPMENT_USER_ID } from '../src/common/constants/development-user.js';

describe('Categories E2E', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();

    configureApp(app);

    await app.init();

    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    await prisma.category.deleteMany({
      where: {
        userId: DEVELOPMENT_USER_ID,
      },
    });
  });

  afterAll(async () => {
    await prisma.category.deleteMany({
      where: {
        userId: DEVELOPMENT_USER_ID,
      },
    });

    await app.close();
  });

  async function createCategory(payload: Record<string, unknown>) {
    const response = await request(app.getHttpServer())
      .post('/api/v1/categories')
      .send(payload)
      .expect(201);

    return response.body.data;
  }

  describe('POST /api/v1/categories', () => {
    it('should create an expense category', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/categories')
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
          userId: DEVELOPMENT_USER_ID,
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
          userId: DEVELOPMENT_USER_ID,
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
        .send(category)
        .expect(201);

      const response = await request(app.getHttpServer())
        .post('/api/v1/categories')
        .send(category)
        .expect(409);

      expect(response.body.message).toBe(
        'A category with this name and type already exists',
      );
    });

    it('should reject invalid category data', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/categories')
        .send({
          name: '',
          type: 'INVALID',
        })
        .expect(400);

      expect(response.body.message).toBe('Validation failed');
      expect(response.body.errors).toBeDefined();
    });
  });

  describe('GET /api/v1/categories', () => {
    it('should return paginated user categories', async () => {
      await createCategory({ name: 'Food', type: 'EXPENSE' });
      await createCategory({ name: 'Salary', type: 'INCOME' });

      const response = await request(app.getHttpServer())
        .get('/api/v1/categories')
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
      const category = await createCategory({
        name: 'Food',
        type: 'EXPENSE',
      });

      await request(app.getHttpServer())
        .delete(`/api/v1/categories/${category.id}`)
        .expect(204);

      const response = await request(app.getHttpServer())
        .get('/api/v1/categories')
        .expect(200);

      expect(response.body.data).toHaveLength(0);
      expect(response.body.meta).toMatchObject({
        total: 0,
        totalPages: 0,
      });
    });

    it('should filter categories by type', async () => {
      await createCategory({ name: 'Food', type: 'EXPENSE' });
      await createCategory({ name: 'Salary', type: 'INCOME' });

      const response = await request(app.getHttpServer())
        .get('/api/v1/categories')
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
      await createCategory({ name: 'Food', type: 'EXPENSE' });
      await createCategory({ name: 'Salary', type: 'INCOME' });

      const response = await request(app.getHttpServer())
        .get('/api/v1/categories')
        .query({ search: 'foo' })
        .expect(200);

      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0]).toMatchObject({ name: 'Food' });
      expect(response.body.meta).toMatchObject({ total: 1 });
    });

    it('should filter categories by type and search term', async () => {
      await createCategory({ name: 'Food', type: 'EXPENSE' });
      await createCategory({ name: 'Food Allowance', type: 'INCOME' });
      await createCategory({ name: 'Salary', type: 'INCOME' });

      const response = await request(app.getHttpServer())
        .get('/api/v1/categories')
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
      await createCategory({ name: 'Apricots', type: 'EXPENSE' });
      await createCategory({ name: 'Bananas', type: 'EXPENSE' });
      await createCategory({ name: 'Cherries', type: 'EXPENSE' });

      const response = await request(app.getHttpServer())
        .get('/api/v1/categories')
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
      await createCategory({ name: 'Alpha', type: 'EXPENSE' });
      await createCategory({ name: 'Beta', type: 'EXPENSE' });

      const response = await request(app.getHttpServer())
        .get('/api/v1/categories')
        .query({ sortBy: 'name', sortOrder: 'desc' })
        .expect(200);

      expect(response.body.data).toHaveLength(2);
      expect(response.body.data[0].name).toBe('Beta');
      expect(response.body.data[1].name).toBe('Alpha');
    });

    it('should reject invalid query parameters', async () => {
      const pageResponse = await request(app.getHttpServer())
        .get('/api/v1/categories')
        .query({ page: 0 })
        .expect(400);

      expect(pageResponse.body.message).toBe('Validation failed');

      const typeResponse = await request(app.getHttpServer())
        .get('/api/v1/categories')
        .query({ type: 'INVALID' })
        .expect(400);

      expect(typeResponse.body.message).toBe('Validation failed');
    });
  });

  describe('GET /api/v1/categories/:id', () => {
    it('should return a category', async () => {
      const category = await createCategory({
        name: 'Transportation',
        type: 'EXPENSE',
      });

      const response = await request(app.getHttpServer())
        .get(`/api/v1/categories/${category.id}`)
        .expect(200);

      expect(response.body).toMatchObject({
        success: true,
        data: {
          id: category.id,
          name: 'Transportation',
          type: 'EXPENSE',
          userId: DEVELOPMENT_USER_ID,
          isArchived: false,
        },
      });
    });

    it('should return 404 for a nonexistent category', async () => {
      const nonexistentId = '00000000-0000-0000-0000-000000000000';

      await request(app.getHttpServer())
        .get(`/api/v1/categories/${nonexistentId}`)
        .expect(404);
    });
  });

  describe('PATCH /api/v1/categories/:id', () => {
    it('should update a category', async () => {
      const category = await createCategory({
        name: 'Food',
        type: 'EXPENSE',
      });

      const response = await request(app.getHttpServer())
        .patch(`/api/v1/categories/${category.id}`)
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
      const category = await createCategory({
        name: 'Food',
        type: 'EXPENSE',
      });

      const response = await request(app.getHttpServer())
        .patch(`/api/v1/categories/${category.id}`)
        .send({})
        .expect(400);

      expect(response.body.message).toBe('Validation failed');
    });

    it('should return 404 when updating a nonexistent category', async () => {
      const nonexistentId = '00000000-0000-0000-0000-000000000000';

      await request(app.getHttpServer())
        .patch(`/api/v1/categories/${nonexistentId}`)
        .send({
          name: 'Updated',
        })
        .expect(404);
    });
  });

  describe('DELETE /api/v1/categories/:id', () => {
    it('should archive a category', async () => {
      const category = await createCategory({
        name: 'Entertainment',
        type: 'EXPENSE',
      });

      await request(app.getHttpServer())
        .delete(`/api/v1/categories/${category.id}`)
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
        .expect(404);
    });

    it('should not allow an archived category to be retrieved', async () => {
      const category = await createCategory({
        name: 'Subscriptions',
        type: 'EXPENSE',
      });

      await request(app.getHttpServer())
        .delete(`/api/v1/categories/${category.id}`)
        .expect(204);

      await request(app.getHttpServer())
        .get(`/api/v1/categories/${category.id}`)
        .expect(404);
    });
  });
});
