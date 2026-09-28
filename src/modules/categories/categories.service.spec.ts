import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import { PrismaService } from '../../database/prisma.service.js';
import { CategoriesService } from './categories.service.js';
import { CreateCategoryDto } from './dto/create-category.dto.js';
import { UpdateCategoryDto } from './dto/update-category.dto.js';

describe('CategoriesService', () => {
  let service: CategoriesService;

  const prismaMock = {
    category: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CategoriesService,
        {
          provide: PrismaService,
          useValue: prismaMock,
        },
      ],
    }).compile();

    service = module.get<CategoriesService>(CategoriesService);

    vi.clearAllMocks();
  });

  describe('create', () => {
    it('should create a category', async () => {
      const userId = 'user-1';

      const dto: CreateCategoryDto = {
        name: 'Food',
        type: 'EXPENSE',
        color: '#FF9800',
      };

      const createdCategory = {
        id: 'category-1',
        userId,
        name: 'Food',
        type: 'EXPENSE',
        color: '#FF9800',
        isArchived: false,
      };

      prismaMock.category.findUnique.mockResolvedValue(null);
      prismaMock.category.create.mockResolvedValue(createdCategory);

      const result = await service.create(userId, dto);

      expect(result).toEqual(createdCategory);

      expect(prismaMock.category.findUnique).toHaveBeenCalledWith({
        where: {
          userId_name_type: {
            userId,
            name: dto.name,
            type: dto.type,
          },
        },
      });

      expect(prismaMock.category.create).toHaveBeenCalledWith({
        data: {
          userId,
          name: dto.name,
          type: dto.type,
          color: dto.color,
        },
      });
    });

    it('should throw ConflictException when the category already exists', async () => {
      const userId = 'user-1';

      const dto: CreateCategoryDto = {
        name: 'Food',
        type: 'EXPENSE',
        color: '#FF9800',
      };

      const existingCategory = {
        id: 'category-1',
        userId,
        name: 'Food',
        type: 'EXPENSE',
        color: '#FF9800',
        isArchived: false,
      };

      prismaMock.category.findUnique.mockResolvedValue(existingCategory);

      await expect(service.create(userId, dto)).rejects.toThrow(
        ConflictException,
      );

      expect(prismaMock.category.create).not.toHaveBeenCalled();
    });
  });

  describe('findAll', () => {
    it('should return active categories belonging to the user', async () => {
      const userId = 'user-1';

      const categories = [
        {
          id: 'category-1',
          userId,
          name: 'Food',
          type: 'EXPENSE',
          color: '#FF9800',
          isArchived: false,
        },
        {
          id: 'category-2',
          userId,
          name: 'Salary',
          type: 'INCOME',
          color: '#4CAF50',
          isArchived: false,
        },
      ];

      prismaMock.category.findMany.mockResolvedValue(categories);

      const result = await service.findAll(userId);

      expect(result).toEqual(categories);

      expect(prismaMock.category.findMany).toHaveBeenCalledWith({
        where: {
          userId,
          isArchived: false,
        },
        orderBy: {
          name: 'asc',
        },
      });
    });
  });

  describe('findOne', () => {
    it('should return a category belonging to the user', async () => {
      const userId = 'user-1';
      const categoryId = 'category-1';

      const category = {
        id: categoryId,
        userId,
        name: 'Food',
        type: 'EXPENSE',
        color: '#FF9800',
        isArchived: false,
      };

      prismaMock.category.findFirst.mockResolvedValue(category);

      const result = await service.findOne(userId, categoryId);

      expect(result).toEqual(category);

      expect(prismaMock.category.findFirst).toHaveBeenCalledWith({
        where: {
          id: categoryId,
          userId,
          isArchived: false,
        },
      });
    });

    it('should throw NotFoundException when the category does not exist', async () => {
      const userId = 'user-1';
      const categoryId = 'missing-category';

      prismaMock.category.findFirst.mockResolvedValue(null);

      await expect(service.findOne(userId, categoryId)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('update', () => {
    it('should update an existing category', async () => {
      const userId = 'user-1';
      const categoryId = 'category-1';

      const existingCategory = {
        id: categoryId,
        userId,
        name: 'Food',
        type: 'EXPENSE',
        color: '#FF9800',
        isArchived: false,
      };

      const dto: UpdateCategoryDto = {
        name: 'Groceries',
        color: '#4CAF50',
      };

      const updatedCategory = {
        ...existingCategory,
        name: 'Groceries',
        color: '#4CAF50',
      };

      prismaMock.category.findFirst
        .mockResolvedValueOnce(existingCategory)
        .mockResolvedValueOnce(null);

      prismaMock.category.update.mockResolvedValue(updatedCategory);

      const result = await service.update(userId, categoryId, dto);

      expect(result).toEqual(updatedCategory);

      expect(prismaMock.category.update).toHaveBeenCalledWith({
        where: {
          id: categoryId,
        },
        data: dto,
      });
    });

    it('should throw NotFoundException when updating a nonexistent category', async () => {
      const userId = 'user-1';
      const categoryId = 'missing-category';

      const dto: UpdateCategoryDto = {
        name: 'Groceries',
      };

      prismaMock.category.findFirst.mockResolvedValue(null);

      await expect(service.update(userId, categoryId, dto)).rejects.toThrow(
        NotFoundException,
      );

      expect(prismaMock.category.update).not.toHaveBeenCalled();
    });

    it('should throw ConflictException when updating to a duplicate category', async () => {
      const userId = 'user-1';
      const categoryId = 'category-1';

      const existingCategory = {
        id: categoryId,
        userId,
        name: 'Food',
        type: 'EXPENSE',
        color: '#FF9800',
        isArchived: false,
      };

      const duplicateCategory = {
        id: 'category-2',
        userId,
        name: 'Groceries',
        type: 'EXPENSE',
        color: '#4CAF50',
        isArchived: false,
      };

      const dto: UpdateCategoryDto = {
        name: 'Groceries',
      };

      prismaMock.category.findFirst
        .mockResolvedValueOnce(existingCategory)
        .mockResolvedValueOnce(duplicateCategory);

      await expect(service.update(userId, categoryId, dto)).rejects.toThrow(
        ConflictException,
      );

      expect(prismaMock.category.update).not.toHaveBeenCalled();
    });
  });

  describe('archive', () => {
    it('should archive an existing category', async () => {
      const userId = 'user-1';
      const categoryId = 'category-1';

      const existingCategory = {
        id: categoryId,
        userId,
        name: 'Food',
        type: 'EXPENSE',
        color: '#FF9800',
        isArchived: false,
      };

      const archivedCategory = {
        ...existingCategory,
        isArchived: true,
      };

      prismaMock.category.findFirst.mockResolvedValue(existingCategory);
      prismaMock.category.update.mockResolvedValue(archivedCategory);

      const result = await service.archive(userId, categoryId);

      expect(result).toEqual(archivedCategory);

      expect(prismaMock.category.update).toHaveBeenCalledWith({
        where: {
          id: categoryId,
        },
        data: {
          isArchived: true,
        },
      });
    });

    it('should throw NotFoundException when archiving a nonexistent category', async () => {
      const userId = 'user-1';
      const categoryId = 'missing-category';

      prismaMock.category.findFirst.mockResolvedValue(null);

      await expect(service.archive(userId, categoryId)).rejects.toThrow(
        NotFoundException,
      );

      expect(prismaMock.category.update).not.toHaveBeenCalled();
    });
  });
});
