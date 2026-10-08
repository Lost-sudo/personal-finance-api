import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import { PrismaService } from '../../database/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import { BudgetsService } from './budgets.service.js';
import { buildBudgetProgress } from './budget-progress.util.js';
import { CreateBudgetDto } from './dto/create-budget.dto.js';
import { UpdateBudgetDto } from './dto/update-budget.dto.js';
import { BudgetQueryDto } from './dto/budget-query.dto.js';

describe('BudgetsService', () => {
  let service: BudgetsService;

  const prismaMock = {
    budget: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      count: vi.fn(),
    },
    category: {
      findFirst: vi.fn(),
    },
    transaction: {
      aggregate: vi.fn(),
    },
  };

  const userId = 'user-1';
  const categoryId = 'category-1';

  const expenseCategory = {
    id: categoryId,
    userId,
    name: 'Food',
    type: 'EXPENSE',
    isArchived: false,
  };

  const baseDto: CreateBudgetDto = {
    name: 'January groceries',
    categoryId,
    amount: 15000,
    period: 'MONTHLY',
    startDate: '2026-01-01T00:00:00.000Z',
    endDate: '2026-01-31T23:59:59.000Z',
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BudgetsService,
        {
          provide: PrismaService,
          useValue: prismaMock,
        },
      ],
    }).compile();

    service = module.get<BudgetsService>(BudgetsService);

    vi.clearAllMocks();
  });

  describe('create', () => {
    it('should create a budget', async () => {
      const createdBudget = {
        id: 'budget-1',
        userId,
        ...baseDto,
      };

      prismaMock.category.findFirst.mockResolvedValue(expenseCategory);
      prismaMock.budget.findFirst.mockResolvedValue(null);
      prismaMock.budget.create.mockResolvedValue(createdBudget);

      const result = await service.create(userId, baseDto);

      expect(result).toEqual(createdBudget);

      expect(prismaMock.category.findFirst).toHaveBeenCalledWith({
        where: {
          id: categoryId,
          userId,
          isArchived: false,
        },
      });

      expect(prismaMock.budget.create).toHaveBeenCalledWith({
        data: {
          userId,
          name: baseDto.name,
          categoryId: baseDto.categoryId,
          amount: baseDto.amount,
          period: baseDto.period,
          startDate: baseDto.startDate,
          endDate: baseDto.endDate,
        },
      });
    });

    it('should throw NotFoundException when the category does not belong to the user', async () => {
      prismaMock.category.findFirst.mockResolvedValue(null);

      await expect(service.create(userId, baseDto)).rejects.toThrow(
        NotFoundException,
      );

      expect(prismaMock.budget.create).not.toHaveBeenCalled();
    });

    it('should throw BadRequestException for an income category', async () => {
      prismaMock.category.findFirst.mockResolvedValue({
        ...expenseCategory,
        type: 'INCOME',
      });

      await expect(service.create(userId, baseDto)).rejects.toThrow(
        BadRequestException,
      );

      expect(prismaMock.budget.create).not.toHaveBeenCalled();
    });

    it('should throw ConflictException for an overlapping budget', async () => {
      prismaMock.category.findFirst.mockResolvedValue(expenseCategory);
      prismaMock.budget.findFirst.mockResolvedValue({ id: 'budget-existing' });

      await expect(service.create(userId, baseDto)).rejects.toThrow(
        ConflictException,
      );

      expect(prismaMock.budget.findFirst).toHaveBeenCalledWith({
        where: {
          userId,
          categoryId,
          startDate: { lte: baseDto.endDate },
          endDate: { gte: baseDto.startDate },
        },
      });
      expect(prismaMock.budget.create).not.toHaveBeenCalled();
    });
  });

  describe('findAll', () => {
    it('should scope the query to the authenticated user', async () => {
      const query: BudgetQueryDto = {
        page: 1,
        limit: 20,
        sortBy: 'startDate',
        sortOrder: 'desc',
      };

      prismaMock.budget.findMany.mockResolvedValue([]);
      prismaMock.budget.count.mockResolvedValue(0);

      const result = await service.findAll(userId, query);

      expect(result).toEqual({ budgets: [], total: 0 });

      const expectedWhere = { userId };

      expect(prismaMock.budget.findMany).toHaveBeenCalledWith({
        where: expectedWhere,
        skip: 0,
        take: 20,
        orderBy: [{ startDate: 'desc' }, { id: 'asc' }],
      });
      expect(prismaMock.budget.count).toHaveBeenCalledWith({
        where: expectedWhere,
      });
    });

    it('should apply category, period, and date filters', async () => {
      const query: BudgetQueryDto = {
        page: 2,
        limit: 10,
        categoryId,
        period: 'MONTHLY',
        startDate: '2026-01-01T00:00:00.000Z',
        endDate: '2026-01-31T23:59:59.000Z',
        sortBy: 'amount',
        sortOrder: 'asc',
      };

      prismaMock.budget.findMany.mockResolvedValue([]);
      prismaMock.budget.count.mockResolvedValue(0);

      await service.findAll(userId, query);

      expect(prismaMock.budget.findMany).toHaveBeenCalledWith({
        where: {
          userId,
          categoryId,
          period: 'MONTHLY',
          endDate: { gte: '2026-01-01T00:00:00.000Z' },
          startDate: { lte: '2026-01-31T23:59:59.000Z' },
        },
        skip: 10,
        take: 10,
        orderBy: [{ amount: 'asc' }, { id: 'asc' }],
      });
    });
  });

  describe('findOne', () => {
    it('should return a budget belonging to the user', async () => {
      const budget = { id: 'budget-1', userId };

      prismaMock.budget.findFirst.mockResolvedValue(budget);

      const result = await service.findOne(userId, 'budget-1');

      expect(result).toEqual(budget);
      expect(prismaMock.budget.findFirst).toHaveBeenCalledWith({
        where: { id: 'budget-1', userId },
      });
    });

    it('should throw NotFoundException for another user’s budget', async () => {
      prismaMock.budget.findFirst.mockResolvedValue(null);

      await expect(service.findOne(userId, 'budget-other')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('update', () => {
    const storedBudget = {
      id: 'budget-1',
      userId,
      name: 'January groceries',
      categoryId,
      amount: 15000,
      period: 'MONTHLY',
      startDate: new Date('2026-01-01T00:00:00.000Z'),
      endDate: new Date('2026-01-31T23:59:59.000Z'),
    };

    it('should update the budget name', async () => {
      const dto: UpdateBudgetDto = { name: 'Updated groceries' };
      const updated = { ...storedBudget, name: dto.name };

      prismaMock.budget.findFirst.mockResolvedValueOnce(storedBudget);
      prismaMock.budget.update.mockResolvedValue(updated);

      const result = await service.update(userId, 'budget-1', dto);

      expect(result).toEqual(updated);
      expect(prismaMock.budget.update).toHaveBeenCalledWith({
        where: { id: 'budget-1' },
        data: dto,
      });
    });

    it('should re-validate a changed category', async () => {
      const dto: UpdateBudgetDto = { categoryId: 'category-2' };

      prismaMock.budget.findFirst
        .mockResolvedValueOnce(storedBudget)
        .mockResolvedValueOnce(null);
      prismaMock.category.findFirst.mockResolvedValue({
        ...expenseCategory,
        id: 'category-2',
      });
      prismaMock.budget.update.mockResolvedValue({
        ...storedBudget,
        categoryId: 'category-2',
      });

      await service.update(userId, 'budget-1', dto);

      expect(prismaMock.category.findFirst).toHaveBeenCalledWith({
        where: { id: 'category-2', userId, isArchived: false },
      });
    });

    it('should reject a changed category that is not an expense category', async () => {
      const dto: UpdateBudgetDto = { categoryId: 'category-2' };

      prismaMock.budget.findFirst.mockResolvedValueOnce(storedBudget);
      prismaMock.category.findFirst.mockResolvedValue({
        ...expenseCategory,
        id: 'category-2',
        type: 'INCOME',
      });

      await expect(service.update(userId, 'budget-1', dto)).rejects.toThrow(
        BadRequestException,
      );

      expect(prismaMock.budget.update).not.toHaveBeenCalled();
    });

    it('should reject an invalid date range on partial update', async () => {
      const dto: UpdateBudgetDto = {
        startDate: '2026-02-01T00:00:00.000Z',
      };

      prismaMock.budget.findFirst.mockResolvedValueOnce(storedBudget);

      await expect(service.update(userId, 'budget-1', dto)).rejects.toThrow(
        BadRequestException,
      );

      expect(prismaMock.budget.update).not.toHaveBeenCalled();
    });

    it('should exclude itself from the overlap check', async () => {
      const dto: UpdateBudgetDto = {
        endDate: '2026-02-15T23:59:59.000Z',
      };

      prismaMock.budget.findFirst
        .mockResolvedValueOnce(storedBudget)
        .mockResolvedValueOnce(null);
      prismaMock.budget.update.mockResolvedValue(storedBudget);

      await service.update(userId, 'budget-1', dto);

      expect(prismaMock.budget.findFirst).toHaveBeenCalledWith({
        where: {
          userId,
          categoryId,
          startDate: { lte: dto.endDate },
          endDate: { gte: '2026-01-01T00:00:00.000Z' },
          NOT: { id: 'budget-1' },
        },
      });
    });

    it('should throw NotFoundException for another user’s budget', async () => {
      prismaMock.budget.findFirst.mockResolvedValue(null);

      await expect(
        service.update(userId, 'budget-other', { name: 'x' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('remove', () => {
    it('should delete the budget without touching transactions', async () => {
      const budget = { id: 'budget-1', userId };

      prismaMock.budget.findFirst.mockResolvedValue(budget);
      prismaMock.budget.delete.mockResolvedValue(budget);

      const result = await service.remove(userId, 'budget-1');

      expect(result).toEqual(budget);
      expect(prismaMock.budget.delete).toHaveBeenCalledWith({
        where: { id: 'budget-1' },
      });
    });

    it('should throw NotFoundException for another user’s budget', async () => {
      prismaMock.budget.findFirst.mockResolvedValue(null);

      await expect(service.remove(userId, 'budget-other')).rejects.toThrow(
        NotFoundException,
      );

      expect(prismaMock.budget.delete).not.toHaveBeenCalled();
    });
  });

  describe('calculateSpentAmount', () => {
    const budgetWindow = {
      categoryId,
      startDate: new Date('2026-01-01T00:00:00.000Z'),
      endDate: new Date('2026-01-31T23:59:59.000Z'),
    };

    it('should aggregate only the owner’s expense transactions in the category and date range', async () => {
      prismaMock.transaction.aggregate.mockResolvedValue({
        _sum: { amount: new Prisma.Decimal('19.99') },
      });

      const result = await service.calculateSpentAmount(userId, budgetWindow);

      expect(result).toEqual(new Prisma.Decimal('19.99'));
      expect(prismaMock.transaction.aggregate).toHaveBeenCalledWith({
        _sum: { amount: true },
        where: {
          userId,
          type: 'EXPENSE',
          categoryId,
          transactionDate: {
            gte: budgetWindow.startDate,
            lte: budgetWindow.endDate,
          },
          deletedAt: null,
        },
      });
    });

    it('should return zero when no transactions match', async () => {
      prismaMock.transaction.aggregate.mockResolvedValue({
        _sum: { amount: null },
      });

      const result = await service.calculateSpentAmount(userId, budgetWindow);

      expect(result).toEqual(new Prisma.Decimal(0));
    });
  });

  describe('buildBudgetProgress', () => {
    it('should derive remaining, percentage, and WITHIN status without float arithmetic', () => {
      const progress = buildBudgetProgress(
        { amount: new Prisma.Decimal('15000.00') },
        new Prisma.Decimal('3750.50'),
      );

      expect(progress).toEqual({
        spentAmount: '3750.50',
        remainingAmount: '11249.50',
        percentageUsed: '25.00',
        status: 'WITHIN',
      });
    });

    it('should report WITHIN at exactly 100% and OVER above it', () => {
      const exact = buildBudgetProgress(
        { amount: new Prisma.Decimal('100.00') },
        new Prisma.Decimal('100.00'),
      );

      expect(exact.status).toBe('WITHIN');
      expect(exact.remainingAmount).toBe('0.00');
      expect(exact.percentageUsed).toBe('100.00');

      const over = buildBudgetProgress(
        { amount: new Prisma.Decimal('100.00') },
        new Prisma.Decimal('120.75'),
      );

      expect(over).toEqual({
        spentAmount: '120.75',
        remainingAmount: '-20.75',
        percentageUsed: '120.75',
        status: 'OVER',
      });
    });

    it('should handle zero spend', () => {
      const progress = buildBudgetProgress(
        { amount: new Prisma.Decimal('500.00') },
        new Prisma.Decimal(0),
      );

      expect(progress).toEqual({
        spentAmount: '0.00',
        remainingAmount: '500.00',
        percentageUsed: '0.00',
        status: 'WITHIN',
      });
    });
  });
});
