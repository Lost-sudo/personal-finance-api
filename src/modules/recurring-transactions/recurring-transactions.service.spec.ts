import {
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import { PrismaService } from '../../database/prisma.service.js';
import { RecurringTransactionsService } from './recurring-transactions.service.js';
import { CreateRecurringTransactionDto } from './dto/create-recurring-transaction.dto.js';
import { RecurringTransactionQueryDto } from './dto/recurring-transaction-query.dto.js';
import { updateRecurringTransactionSchema } from './dto/update-recurring-transaction.dto.js';

describe('RecurringTransactionsService', () => {
  let service: RecurringTransactionsService;

  const prismaMock = {
    recurringTransaction: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      count: vi.fn(),
    },
    account: {
      findFirst: vi.fn(),
    },
    category: {
      findFirst: vi.fn(),
    },
    transaction: {
      delete: vi.fn(),
      deleteMany: vi.fn(),
      updateMany: vi.fn(),
    },
  };

  const ownedAccount = {
    id: 'account-1',
    userId: 'user-1',
    name: 'BDO Savings',
    type: 'BANK',
    isArchived: false,
  };

  const destinationAccount = {
    ...ownedAccount,
    id: 'account-2',
    name: 'Cash Wallet',
    type: 'CASH',
  };

  const ownedCategory = {
    id: 'category-1',
    userId: 'user-1',
    name: 'Food',
    type: 'EXPENSE',
    isArchived: false,
  };

  const baseSchedule = {
    id: 'recurring-1',
    userId: 'user-1',
    type: 'EXPENSE',
    amount: 2500,
    description: 'Monthly rent',
    accountId: 'account-1',
    categoryId: 'category-1',
    fromAccountId: null,
    toAccountId: null,
    frequency: 'MONTHLY',
    nextRunAt: '2026-11-01T09:00:00.000Z',
    isActive: true,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RecurringTransactionsService,
        {
          provide: PrismaService,
          useValue: prismaMock,
        },
      ],
    }).compile();

    service = module.get<RecurringTransactionsService>(
      RecurringTransactionsService,
    );

    vi.clearAllMocks();
  });

  describe('create', () => {
    it('should create an expense schedule with owned account and category', async () => {
      const dto: CreateRecurringTransactionDto = {
        type: 'EXPENSE',
        amount: 2500,
        description: 'Monthly rent',
        accountId: 'account-1',
        categoryId: 'category-1',
        frequency: 'MONTHLY',
        nextRunAt: '2026-11-01T09:00:00.000Z',
      };

      prismaMock.account.findFirst.mockResolvedValue(ownedAccount);
      prismaMock.category.findFirst.mockResolvedValue(ownedCategory);
      prismaMock.recurringTransaction.create.mockResolvedValue(baseSchedule);

      const result = await service.create('user-1', dto);

      expect(result).toEqual(baseSchedule);
      expect(prismaMock.account.findFirst).toHaveBeenCalledWith({
        where: { id: 'account-1', userId: 'user-1', isArchived: false },
      });
      expect(prismaMock.category.findFirst).toHaveBeenCalledWith({
        where: { id: 'category-1', userId: 'user-1', isArchived: false },
      });
      expect(prismaMock.recurringTransaction.create).toHaveBeenCalledWith({
        data: {
          userId: 'user-1',
          type: 'EXPENSE',
          amount: 2500,
          description: 'Monthly rent',
          accountId: 'account-1',
          categoryId: 'category-1',
          fromAccountId: null,
          toAccountId: null,
          frequency: 'MONTHLY',
          nextRunAt: '2026-11-01T09:00:00.000Z',
        },
      });
    });

    it('should create an income schedule without a category', async () => {
      prismaMock.account.findFirst.mockResolvedValue(ownedAccount);
      prismaMock.recurringTransaction.create.mockResolvedValue({
        ...baseSchedule,
        type: 'INCOME',
        categoryId: null,
      });

      const result = await service.create('user-1', {
        type: 'INCOME',
        amount: 50000,
        accountId: 'account-1',
        frequency: 'MONTHLY',
        nextRunAt: '2026-11-01T09:00:00.000Z',
      });

      expect(result).toMatchObject({ type: 'INCOME', categoryId: null });
      expect(prismaMock.category.findFirst).not.toHaveBeenCalled();
    });

    it('should throw BadRequestException when accountId is missing for income/expense', async () => {
      await expect(
        service.create('user-1', {
          type: 'EXPENSE',
          amount: 100,
          frequency: 'MONTHLY',
          nextRunAt: '2026-11-01T09:00:00.000Z',
        }),
      ).rejects.toThrow(BadRequestException);

      expect(prismaMock.account.findFirst).not.toHaveBeenCalled();
      expect(prismaMock.recurringTransaction.create).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException for a foreign or archived account', async () => {
      prismaMock.account.findFirst.mockResolvedValue(null);

      await expect(
        service.create('user-1', {
          type: 'EXPENSE',
          amount: 100,
          accountId: 'foreign-account',
          frequency: 'MONTHLY',
          nextRunAt: '2026-11-01T09:00:00.000Z',
        }),
      ).rejects.toThrow(NotFoundException);

      expect(prismaMock.recurringTransaction.create).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException for a foreign category', async () => {
      prismaMock.account.findFirst.mockResolvedValue(ownedAccount);
      prismaMock.category.findFirst.mockResolvedValue(null);

      await expect(
        service.create('user-1', {
          type: 'EXPENSE',
          amount: 100,
          accountId: 'account-1',
          categoryId: 'foreign-category',
          frequency: 'MONTHLY',
          nextRunAt: '2026-11-01T09:00:00.000Z',
        }),
      ).rejects.toThrow(NotFoundException);

      expect(prismaMock.recurringTransaction.create).not.toHaveBeenCalled();
    });

    it('should create a transfer schedule between two owned accounts', async () => {
      const transferSchedule = {
        ...baseSchedule,
        type: 'TRANSFER',
        accountId: null,
        categoryId: null,
        fromAccountId: 'account-1',
        toAccountId: 'account-2',
      };

      prismaMock.account.findFirst
        .mockResolvedValueOnce(ownedAccount)
        .mockResolvedValueOnce(destinationAccount);
      prismaMock.recurringTransaction.create.mockResolvedValue(
        transferSchedule,
      );

      const result = await service.create('user-1', {
        type: 'TRANSFER',
        amount: 5000,
        description: 'Move to savings',
        fromAccountId: 'account-1',
        toAccountId: 'account-2',
        frequency: 'WEEKLY',
        nextRunAt: '2026-11-01T09:00:00.000Z',
      });

      expect(result).toEqual(transferSchedule);
      expect(prismaMock.recurringTransaction.create).toHaveBeenCalledWith({
        data: {
          userId: 'user-1',
          type: 'TRANSFER',
          amount: 5000,
          description: 'Move to savings',
          accountId: null,
          categoryId: null,
          fromAccountId: 'account-1',
          toAccountId: 'account-2',
          frequency: 'WEEKLY',
          nextRunAt: '2026-11-01T09:00:00.000Z',
        },
      });
    });

    it('should throw BadRequestException when transfer legs are missing', async () => {
      await expect(
        service.create('user-1', {
          type: 'TRANSFER',
          amount: 5000,
          fromAccountId: 'account-1',
          frequency: 'WEEKLY',
          nextRunAt: '2026-11-01T09:00:00.000Z',
        }),
      ).rejects.toThrow(BadRequestException);

      expect(prismaMock.account.findFirst).not.toHaveBeenCalled();
    });

    it('should throw BadRequestException when transfer legs are identical', async () => {
      await expect(
        service.create('user-1', {
          type: 'TRANSFER',
          amount: 5000,
          fromAccountId: 'account-1',
          toAccountId: 'account-1',
          frequency: 'WEEKLY',
          nextRunAt: '2026-11-01T09:00:00.000Z',
        }),
      ).rejects.toThrow(BadRequestException);

      expect(prismaMock.account.findFirst).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException when a transfer account is not owned', async () => {
      prismaMock.account.findFirst
        .mockResolvedValueOnce(ownedAccount)
        .mockResolvedValueOnce(null);

      await expect(
        service.create('user-1', {
          type: 'TRANSFER',
          amount: 5000,
          fromAccountId: 'account-1',
          toAccountId: 'foreign-account',
          frequency: 'WEEKLY',
          nextRunAt: '2026-11-01T09:00:00.000Z',
        }),
      ).rejects.toThrow(NotFoundException);

      expect(prismaMock.recurringTransaction.create).not.toHaveBeenCalled();
    });

    it('should reject an archived account with a user-scoped lookup', async () => {
      // validateAccount filters { userId, isArchived: false }, so an archived
      // account resolves to null and surfaces as NotFoundException.
      prismaMock.account.findFirst.mockResolvedValue(null);

      await expect(
        service.create('user-1', {
          type: 'EXPENSE',
          amount: 100,
          accountId: 'archived-account',
          frequency: 'MONTHLY',
          nextRunAt: '2026-11-01T09:00:00.000Z',
        }),
      ).rejects.toThrow(NotFoundException);

      // Ownership is enforced through the user-scoped archived filter.
      expect(prismaMock.account.findFirst).toHaveBeenCalledWith({
        where: { id: 'archived-account', userId: 'user-1', isArchived: false },
      });
      expect(prismaMock.recurringTransaction.create).not.toHaveBeenCalled();
    });

    it('should reject another user\'s account and category', async () => {
      prismaMock.account.findFirst.mockResolvedValue(null);

      await expect(
        service.create('user-1', {
          type: 'EXPENSE',
          amount: 100,
          accountId: 'other-user-account',
          categoryId: 'other-user-category',
          frequency: 'MONTHLY',
          nextRunAt: '2026-11-01T09:00:00.000Z',
        }),
      ).rejects.toThrow(NotFoundException);

      expect(prismaMock.account.findFirst).toHaveBeenCalledWith({
        where: { id: 'other-user-account', userId: 'user-1', isArchived: false },
      });
      expect(prismaMock.recurringTransaction.create).not.toHaveBeenCalled();
    });

    it('should throw BadRequestException when a transfer misses the source leg', async () => {
      await expect(
        service.create('user-1', {
          type: 'TRANSFER',
          amount: 5000,
          toAccountId: 'account-2',
          frequency: 'WEEKLY',
          nextRunAt: '2026-11-01T09:00:00.000Z',
        }),
      ).rejects.toThrow(BadRequestException);

      expect(prismaMock.account.findFirst).not.toHaveBeenCalled();
      expect(prismaMock.recurringTransaction.create).not.toHaveBeenCalled();
    });
  });

  describe('findAll', () => {
    it('should return paginated schedules belonging to the user', async () => {
      const query: RecurringTransactionQueryDto = {
        page: 1,
        limit: 20,
        sortBy: 'nextRunAt',
        sortOrder: 'asc',
      };

      const schedules = [baseSchedule, { ...baseSchedule, id: 'r2' }];

      prismaMock.recurringTransaction.findMany.mockResolvedValue(schedules);
      prismaMock.recurringTransaction.count.mockResolvedValue(
        schedules.length,
      );

      const result = await service.findAll('user-1', query);

      expect(result).toEqual({ recurringTransactions: schedules, total: 2 });

      const where = { userId: 'user-1' };

      expect(prismaMock.recurringTransaction.findMany).toHaveBeenCalledWith({
        where,
        skip: 0,
        take: 20,
        orderBy: [{ nextRunAt: 'asc' }, { id: 'asc' }],
      });
      expect(prismaMock.recurringTransaction.count).toHaveBeenCalledWith({
        where,
      });
    });

    it('should apply type, frequency, account, active, and search filters', async () => {
      const query: RecurringTransactionQueryDto = {
        page: 2,
        limit: 10,
        type: 'TRANSFER',
        frequency: 'WEEKLY',
        accountId: 'account-1',
        isActive: true,
        search: 'savings',
        sortBy: 'amount',
        sortOrder: 'desc',
      };

      prismaMock.recurringTransaction.findMany.mockResolvedValue([
        baseSchedule,
      ]);
      prismaMock.recurringTransaction.count.mockResolvedValue(1);

      const result = await service.findAll('user-1', query);

      expect(result).toEqual({
        recurringTransactions: [baseSchedule],
        total: 1,
      });

      const where = {
        userId: 'user-1',
        type: 'TRANSFER',
        frequency: 'WEEKLY',
        OR: [
          { accountId: 'account-1' },
          { fromAccountId: 'account-1' },
          { toAccountId: 'account-1' },
        ],
        isActive: true,
        description: { contains: 'savings', mode: 'insensitive' },
      };

      expect(prismaMock.recurringTransaction.findMany).toHaveBeenCalledWith({
        where,
        skip: 10,
        take: 10,
        orderBy: [{ amount: 'desc' }, { id: 'asc' }],
      });
      expect(prismaMock.recurringTransaction.count).toHaveBeenCalledWith({
        where,
      });
    });

    it.each([
      ['nextRunAt', 'asc'],
      ['nextRunAt', 'desc'],
      ['createdAt', 'asc'],
      ['amount', 'desc'],
    ] as const)(
      'should sort by %s %s with deterministic secondary id ordering',
      async (sortBy, sortOrder) => {
        prismaMock.recurringTransaction.findMany.mockResolvedValue([
          baseSchedule,
        ]);
        prismaMock.recurringTransaction.count.mockResolvedValue(1);

        await service.findAll('user-1', {
          page: 1,
          limit: 20,
          sortBy,
          sortOrder,
        });

        expect(prismaMock.recurringTransaction.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            orderBy: [{ [sortBy]: sortOrder }, { id: 'asc' }],
          }),
        );
      },
    );
  });

  describe('findOne', () => {
    it('should return a schedule belonging to the user', async () => {
      prismaMock.recurringTransaction.findFirst.mockResolvedValue(
        baseSchedule,
      );

      const result = await service.findOne('user-1', 'recurring-1');

      expect(result).toEqual(baseSchedule);
      expect(prismaMock.recurringTransaction.findFirst).toHaveBeenCalledWith({
        where: { id: 'recurring-1', userId: 'user-1' },
      });
    });

    it('should throw NotFoundException for a nonexistent schedule', async () => {
      prismaMock.recurringTransaction.findFirst.mockResolvedValue(null);

      await expect(service.findOne('user-1', 'missing')).rejects.toThrow(
        NotFoundException,
      );

      expect(prismaMock.recurringTransaction.findFirst).toHaveBeenCalledWith({
        where: { id: 'missing', userId: 'user-1' },
      });
    });

    it('should treat another user\'s schedule as not found', async () => {
      // The row exists under user-2, so the user-scoped lookup returns null.
      prismaMock.recurringTransaction.findFirst.mockResolvedValue(null);

      await expect(service.findOne('user-1', 'other-user-schedule')).rejects.toThrow(
        NotFoundException,
      );

      expect(prismaMock.recurringTransaction.findFirst).toHaveBeenCalledWith({
        where: { id: 'other-user-schedule', userId: 'user-1' },
      });
    });
  });

  describe('update', () => {
    it('should update amount, frequency, and active flag', async () => {
      const dto = {
        amount: 3000,
        frequency: 'WEEKLY',
        isActive: false,
      } as const;

      const updated = { ...baseSchedule, ...dto };

      prismaMock.recurringTransaction.findFirst.mockResolvedValue(
        baseSchedule,
      );
      prismaMock.recurringTransaction.update.mockResolvedValue(updated);

      const result = await service.update('user-1', 'recurring-1', dto);

      expect(result).toEqual(updated);
      expect(prismaMock.account.findFirst).not.toHaveBeenCalled();
      expect(prismaMock.category.findFirst).not.toHaveBeenCalled();
      expect(prismaMock.recurringTransaction.update).toHaveBeenCalledWith({
        where: { id: 'recurring-1' },
        data: dto,
      });
    });

    it('should revalidate changed financial references', async () => {
      prismaMock.recurringTransaction.findFirst.mockResolvedValue(
        baseSchedule,
      );
      prismaMock.account.findFirst.mockResolvedValue(destinationAccount);
      prismaMock.category.findFirst.mockResolvedValue({
        ...ownedCategory,
        id: 'category-2',
      });
      prismaMock.recurringTransaction.update.mockResolvedValue(baseSchedule);

      await service.update('user-1', 'recurring-1', {
        accountId: 'account-2',
        categoryId: 'category-2',
      });

      expect(prismaMock.account.findFirst).toHaveBeenCalledWith({
        where: { id: 'account-2', userId: 'user-1', isArchived: false },
      });
      expect(prismaMock.category.findFirst).toHaveBeenCalledWith({
        where: { id: 'category-2', userId: 'user-1', isArchived: false },
      });
    });

    it('should throw NotFoundException for foreign references on update', async () => {
      prismaMock.recurringTransaction.findFirst.mockResolvedValue(
        baseSchedule,
      );
      prismaMock.account.findFirst.mockResolvedValue(null);

      await expect(
        service.update('user-1', 'recurring-1', { accountId: 'foreign' }),
      ).rejects.toThrow(NotFoundException);

      expect(prismaMock.recurringTransaction.update).not.toHaveBeenCalled();
    });

    it('should throw BadRequestException when transfer legs would match', async () => {
      prismaMock.recurringTransaction.findFirst.mockResolvedValue({
        ...baseSchedule,
        type: 'TRANSFER',
        accountId: null,
        fromAccountId: 'account-1',
        toAccountId: 'account-2',
      });
      prismaMock.account.findFirst.mockResolvedValue(ownedAccount);

      await expect(
        service.update('user-1', 'recurring-1', {
          toAccountId: 'account-1',
        }),
      ).rejects.toThrow(BadRequestException);

      expect(prismaMock.recurringTransaction.update).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException when updating a nonexistent schedule', async () => {
      prismaMock.recurringTransaction.findFirst.mockResolvedValue(null);

      await expect(
        service.update('user-1', 'missing', { amount: 3000 }),
      ).rejects.toThrow(NotFoundException);

      expect(prismaMock.recurringTransaction.update).not.toHaveBeenCalled();
    });

    it('should reject a type change at the validation boundary', () => {
      // Both update schemas are strictObjects without a `type` field, so
      // immutability is enforced by validation before the service is reached.
      const rejected = updateRecurringTransactionSchema.safeParse({
        type: 'INCOME',
        amount: 3000,
      });

      expect(rejected.success).toBe(false);

      const accepted = updateRecurringTransactionSchema.safeParse({
        amount: 3000,
      });

      expect(accepted.success).toBe(true);
    });

    it('should not persist a type field when updating allowed fields', async () => {
      prismaMock.recurringTransaction.findFirst.mockResolvedValue(
        baseSchedule,
      );
      prismaMock.recurringTransaction.update.mockResolvedValue(baseSchedule);

      await service.update('user-1', 'recurring-1', {
        amount: 3000,
        description: 'Updated rent',
      });

      const updateData = prismaMock.recurringTransaction.update.mock.calls[0][0]
        .data as Record<string, unknown>;
      expect(updateData).not.toHaveProperty('type');
      expect(updateData).toMatchObject({
        amount: 3000,
        description: 'Updated rent',
      });
    });

    it('should resume a paused schedule', async () => {
      const paused = { ...baseSchedule, isActive: false };
      const resumed = { ...paused, isActive: true };

      prismaMock.recurringTransaction.findFirst.mockResolvedValue(paused);
      prismaMock.recurringTransaction.update.mockResolvedValue(resumed);

      const result = await service.update('user-1', 'recurring-1', {
        isActive: true,
      });

      expect(result).toEqual(resumed);
      expect(prismaMock.recurringTransaction.update).toHaveBeenCalledWith({
        where: { id: 'recurring-1' },
        data: { isActive: true },
      });
    });

    it('should reject an archived account changed on update', async () => {
      prismaMock.recurringTransaction.findFirst.mockResolvedValue(
        baseSchedule,
      );
      // Archived accounts resolve to null through the isArchived filter.
      prismaMock.account.findFirst.mockResolvedValue(null);

      await expect(
        service.update('user-1', 'recurring-1', {
          fromAccountId: 'archived-account',
        }),
      ).rejects.toThrow(NotFoundException);

      expect(prismaMock.account.findFirst).toHaveBeenCalledWith({
        where: {
          id: 'archived-account',
          userId: 'user-1',
          isArchived: false,
        },
      });
      expect(prismaMock.recurringTransaction.update).not.toHaveBeenCalled();
    });

    it('should enforce ownership when updating another user\'s schedule', async () => {
      // The row belongs to user-2, so the user-scoped lookup returns null.
      prismaMock.recurringTransaction.findFirst.mockResolvedValue(null);

      await expect(
        service.update('user-1', 'other-user-schedule', { amount: 3000 }),
      ).rejects.toThrow(NotFoundException);

      expect(prismaMock.recurringTransaction.findFirst).toHaveBeenCalledWith({
        where: { id: 'other-user-schedule', userId: 'user-1' },
      });
      expect(prismaMock.account.findFirst).not.toHaveBeenCalled();
      expect(prismaMock.category.findFirst).not.toHaveBeenCalled();
      expect(prismaMock.recurringTransaction.update).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('should delete a schedule belonging to the user', async () => {
      prismaMock.recurringTransaction.findFirst.mockResolvedValue(
        baseSchedule,
      );
      prismaMock.recurringTransaction.delete.mockResolvedValue(baseSchedule);

      const result = await service.remove('user-1', 'recurring-1');

      expect(result).toEqual(baseSchedule);
      expect(prismaMock.recurringTransaction.delete).toHaveBeenCalledWith({
        where: { id: 'recurring-1' },
      });
    });

    it('should throw NotFoundException for missing or foreign schedules', async () => {
      prismaMock.recurringTransaction.findFirst.mockResolvedValue(null);

      await expect(service.remove('user-1', 'missing')).rejects.toThrow(
        NotFoundException,
      );

      expect(prismaMock.recurringTransaction.delete).not.toHaveBeenCalled();
    });

    it('should delete only the schedule and leave generated transactions untouched', async () => {
      // Preservation itself is enforced by the database
      // (Transaction.recurringTransactionId is onDelete: SetNull), so the
      // unit test proves remove() only deletes the schedule row and never
      // touches the transaction delegate.
      prismaMock.recurringTransaction.findFirst.mockResolvedValue(
        baseSchedule,
      );
      prismaMock.recurringTransaction.delete.mockResolvedValue(baseSchedule);

      await service.remove('user-1', 'recurring-1');

      expect(prismaMock.recurringTransaction.delete).toHaveBeenCalledTimes(1);
      expect(prismaMock.recurringTransaction.delete).toHaveBeenCalledWith({
        where: { id: 'recurring-1' },
      });
      expect(prismaMock.transaction.delete).not.toHaveBeenCalled();
      expect(prismaMock.transaction.deleteMany).not.toHaveBeenCalled();
      expect(prismaMock.transaction.updateMany).not.toHaveBeenCalled();
    });
  });
});
