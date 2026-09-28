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
        name: 'Food',
        type: 'EXPENSE',
        color: '#FF9800',
        userId: DEVELOPMENT_USER_ID,
        isArchived: false,
      });

      expect(response.body.id).toBeDefined();
      expect(response.body.createdAt).toBeDefined();
      expect(response.body.updatedAt).toBeDefined();
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
        name: 'Salary',
        type: 'INCOME',
        userId: DEVELOPMENT_USER_ID,
        isArchived: false,
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
    it('should return the user categories', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/categories')
        .send({
          name: 'Food',
          type: 'EXPENSE',
        })
        .expect(201);

      await request(app.getHttpServer())
        .post('/api/v1/categories')
        .send({
          name: 'Salary',
          type: 'INCOME',
        })
        .expect(201);

      const response = await request(app.getHttpServer())
        .get('/api/v1/categories')
        .expect(200);

      expect(response.body).toHaveLength(2);

      expect(response.body).toEqual(
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
      const createResponse = await request(app.getHttpServer())
        .post('/api/v1/categories')
        .send({
          name: 'Food',
          type: 'EXPENSE',
        })
        .expect(201);

      const categoryId = createResponse.body.id;

      await request(app.getHttpServer())
        .delete(`/api/v1/categories/${categoryId}`)
        .expect(200);

      const response = await request(app.getHttpServer())
        .get('/api/v1/categories')
        .expect(200);

      expect(response.body).toHaveLength(0);
    });
  });

  describe('GET /api/v1/categories/:id', () => {
    it('should return a category', async () => {
      const createResponse = await request(app.getHttpServer())
        .post('/api/v1/categories')
        .send({
          name: 'Transportation',
          type: 'EXPENSE',
        })
        .expect(201);

      const categoryId = createResponse.body.id;

      const response = await request(app.getHttpServer())
        .get(`/api/v1/categories/${categoryId}`)
        .expect(200);

      expect(response.body).toMatchObject({
        id: categoryId,
        name: 'Transportation',
        type: 'EXPENSE',
        userId: DEVELOPMENT_USER_ID,
        isArchived: false,
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
      const createResponse = await request(app.getHttpServer())
        .post('/api/v1/categories')
        .send({
          name: 'Food',
          type: 'EXPENSE',
        })
        .expect(201);

      const categoryId = createResponse.body.id;

      const response = await request(app.getHttpServer())
        .patch(`/api/v1/categories/${categoryId}`)
        .send({
          name: 'Groceries',
          color: '#4CAF50',
        })
        .expect(200);

      expect(response.body).toMatchObject({
        id: categoryId,
        name: 'Groceries',
        type: 'EXPENSE',
        color: '#4CAF50',
        isArchived: false,
      });
    });

    it('should reject an empty update', async () => {
      const createResponse = await request(app.getHttpServer())
        .post('/api/v1/categories')
        .send({
          name: 'Food',
          type: 'EXPENSE',
        })
        .expect(201);

      const categoryId = createResponse.body.id;

      const response = await request(app.getHttpServer())
        .patch(`/api/v1/categories/${categoryId}`)
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
      const createResponse = await request(app.getHttpServer())
        .post('/api/v1/categories')
        .send({
          name: 'Entertainment',
          type: 'EXPENSE',
        })
        .expect(201);

      const categoryId = createResponse.body.id;

      const response = await request(app.getHttpServer())
        .delete(`/api/v1/categories/${categoryId}`)
        .expect(200);

      expect(response.body).toMatchObject({
        id: categoryId,
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
      const createResponse = await request(app.getHttpServer())
        .post('/api/v1/categories')
        .send({
          name: 'Subscriptions',
          type: 'EXPENSE',
        })
        .expect(201);

      const categoryId = createResponse.body.id;

      await request(app.getHttpServer())
        .delete(`/api/v1/categories/${categoryId}`)
        .expect(200);

      await request(app.getHttpServer())
        .get(`/api/v1/categories/${categoryId}`)
        .expect(404);
    });
  });
});
