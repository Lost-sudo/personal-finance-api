import {
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import { PrismaService } from '../../database/prisma.service.js';
import { TransactionsService } from './transactions.service.js';
import { CreateTransactionDto } from './dto/create-transaction.dto.js';
import { UpdateTransactionDto } from './dto/update-transaction.dto.js';
import { TransactionQueryDto } from './dto/transaction-query.dto.js';

describe('TransactionsService', () => {
  let service: TransactionsService;

  const prismaMock = {
    $transaction: vi.fn(),
    transaction: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      count: vi.fn(),
    },
    account: {
      findFirst: vi.fn(),
    },
    category: {
      findFirst: vi.fn(),
    },
  };

  const ownedAccount = {
    id: 'account-1',
    userId: 'user-1',
    name: 'BDO Savings',
    type: 'BANK',
    isArchived: false,
  };

  const ownedCategory = {
    id: 'category-1',
    userId: 'user-1',
    name: 'Food',
    type: 'EXPENSE',
    isArchived: false,
  };

  const baseTransaction = {
    id: 'transaction-1',
    userId: 'user-1',
    accountId: 'account-1',
    categoryId: 'category-1',
    type: 'EXPENSE',
    amount: 2500,
    description: 'Grocery run',
    transactionDate: '2026-01-15T08:30:00.000Z',
    transferGroupId: null,
    deletedAt: null,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TransactionsService,
        {
          provide: PrismaService,
          useValue: prismaMock,
        },
      ],
    }).compile();

    service = module.get<TransactionsService>(TransactionsService);

    vi.clearAllMocks();
  });

  describe('create', () => {
    it('should create an expense transaction with owned account and category', async () => {
      const userId = 'user-1';

      const dto: CreateTransactionDto = {
        type: 'EXPENSE',
        amount: 2500,
        transactionDate: '2026-01-15T08:30:00.000Z',
        description: 'Grocery run',
        accountId: 'account-1',
        categoryId: 'category-1',
      };

      prismaMock.account.findFirst.mockResolvedValue(ownedAccount);
      prismaMock.category.findFirst.mockResolvedValue(ownedCategory);
      prismaMock.transaction.create.mockResolvedValue(baseTransaction);

      const result = await service.create(userId, dto);

      expect(result).toEqual(baseTransaction);

      expect(prismaMock.account.findFirst).toHaveBeenCalledWith({
        where: { id: 'account-1', userId, isArchived: false },
      });
      expect(prismaMock.category.findFirst).toHaveBeenCalledWith({
        where: { id: 'category-1', userId, isArchived: false },
      });
      expect(prismaMock.transaction.create).toHaveBeenCalledWith({
        data: {
          userId,
          type: 'EXPENSE',
          amount: 2500,
          transactionDate: '2026-01-15T08:30:00.000Z',
          description: 'Grocery run',
          accountId: 'account-1',
          categoryId: 'category-1',
        },
      });
    });

    it('should create an income transaction without a category', async () => {
      const userId = 'user-1';

      const dto: CreateTransactionDto = {
        type: 'INCOME',
        amount: 50000,
        transactionDate: '2026-01-15T08:30:00.000Z',
        accountId: 'account-1',
      };

      prismaMock.account.findFirst.mockResolvedValue(ownedAccount);
      prismaMock.transaction.create.mockResolvedValue({
        ...baseTransaction,
        type: 'INCOME',
        categoryId: null,
      });

      const result = await service.create(userId, dto);

      expect(result).toMatchObject({ type: 'INCOME', categoryId: null });
      expect(prismaMock.category.findFirst).not.toHaveBeenCalled();
      expect(prismaMock.transaction.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ categoryId: null }),
      });
    });

    it('should throw NotFoundException for a foreign or archived account', async () => {
      prismaMock.account.findFirst.mockResolvedValue(null);

      await expect(
        service.create('user-1', {
          type: 'EXPENSE',
          amount: 100,
          transactionDate: '2026-01-15T08:30:00.000Z',
          accountId: 'foreign-account',
        }),
      ).rejects.toThrow(NotFoundException);

      expect(prismaMock.transaction.create).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException for a foreign category', async () => {
      prismaMock.account.findFirst.mockResolvedValue(ownedAccount);
      prismaMock.category.findFirst.mockResolvedValue(null);

      await expect(
        service.create('user-1', {
          type: 'EXPENSE',
          amount: 100,
          transactionDate: '2026-01-15T08:30:00.000Z',
          accountId: 'account-1',
          categoryId: 'foreign-category',
        }),
      ).rejects.toThrow(NotFoundException);

      expect(prismaMock.transaction.create).not.toHaveBeenCalled();
    });

    it('should create paired transfer rows sharing a group id', async () => {
      const destinationAccount = { ...ownedAccount, id: 'account-2' };

      prismaMock.account.findFirst
        .mockResolvedValueOnce(ownedAccount)
        .mockResolvedValueOnce(destinationAccount);

      const outgoing = { ...baseTransaction, type: 'TRANSFER', categoryId: null };
      const incoming = {
        ...baseTransaction,
        id: 'transaction-2',
        accountId: 'account-2',
        type: 'TRANSFER',
        categoryId: null,
      };
      prismaMock.$transaction.mockResolvedValue([outgoing, incoming]);

      const result = await service.create('user-1', {
        type: 'TRANSFER',
        amount: 5000,
        transactionDate: '2026-01-15T08:30:00.000Z',
        description: 'Move to savings',
        accountId: 'account-1',
        toAccountId: 'account-2',
      });

      expect(result).toEqual([outgoing, incoming]);
      expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);

      const creates = prismaMock.$transaction.mock.calls[0][0];
      expect(creates).toHaveLength(2);
    });

    it('should throw BadRequestException when toAccountId is missing for transfers', async () => {
      await expect(
        service.create('user-1', {
          type: 'TRANSFER',
          amount: 5000,
          transactionDate: '2026-01-15T08:30:00.000Z',
          accountId: 'account-1',
        }),
      ).rejects.toThrow(BadRequestException);

      expect(prismaMock.account.findFirst).not.toHaveBeenCalled();
    });

    it('should throw BadRequestException when transfer accounts are identical', async () => {
      await expect(
        service.create('user-1', {
          type: 'TRANSFER',
          amount: 5000,
          transactionDate: '2026-01-15T08:30:00.000Z',
          accountId: 'account-1',
          toAccountId: 'account-1',
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
          transactionDate: '2026-01-15T08:30:00.000Z',
          accountId: 'account-1',
          toAccountId: 'foreign-account',
        }),
      ).rejects.toThrow(NotFoundException);

      expect(prismaMock.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('findAll', () => {
    it('should return paginated transactions belonging to the user', async () => {
      const userId = 'user-1';

      const query: TransactionQueryDto = {
        page: 1,
        limit: 20,
        sortBy: 'transactionDate',
        sortOrder: 'desc',
      };

      const transactions = [baseTransaction, { ...baseTransaction, id: 't2' }];

      prismaMock.transaction.findMany.mockResolvedValue(transactions);
      prismaMock.transaction.count.mockResolvedValue(transactions.length);

      const result = await service.findAll(userId, query);

      expect(result).toEqual({ transactions, total: 2 });

      const where = { userId, deletedAt: null };

      expect(prismaMock.transaction.findMany).toHaveBeenCalledWith({
        where,
        skip: 0,
        take: 20,
        orderBy: { transactionDate: 'desc' },
      });
      expect(prismaMock.transaction.count).toHaveBeenCalledWith({ where });
    });

    it('should apply type, account, category, date-range, and search filters', async () => {
      const userId = 'user-1';

      const query: TransactionQueryDto = {
        page: 2,
        limit: 10,
        type: 'EXPENSE',
        accountId: 'account-1',
        categoryId: 'category-1',
        dateFrom: '2026-01-01T00:00:00.000Z',
        dateTo: '2026-01-31T23:59:59.000Z',
        search: 'grocery',
        sortBy: 'amount',
        sortOrder: 'asc',
      };

      prismaMock.transaction.findMany.mockResolvedValue([baseTransaction]);
      prismaMock.transaction.count.mockResolvedValue(1);

      const result = await service.findAll(userId, query);

      expect(result).toEqual({ transactions: [baseTransaction], total: 1 });

      const where = {
        userId,
        deletedAt: null,
        type: 'EXPENSE',
        accountId: 'account-1',
        categoryId: 'category-1',
        transactionDate: {
          gte: '2026-01-01T00:00:00.000Z',
          lte: '2026-01-31T23:59:59.000Z',
        },
        description: { contains: 'grocery', mode: 'insensitive' },
      };

      expect(prismaMock.transaction.findMany).toHaveBeenCalledWith({
        where,
        skip: 10,
        take: 10,
        orderBy: { amount: 'asc' },
      });
      expect(prismaMock.transaction.count).toHaveBeenCalledWith({ where });
    });
  });

  describe('findOne', () => {
    it('should return a transaction belonging to the user', async () => {
      prismaMock.transaction.findFirst.mockResolvedValue(baseTransaction);

      const result = await service.findOne('user-1', 'transaction-1');

      expect(result).toEqual(baseTransaction);
      expect(prismaMock.transaction.findFirst).toHaveBeenCalledWith({
        where: { id: 'transaction-1', userId: 'user-1', deletedAt: null },
      });
    });

    it('should throw NotFoundException for missing or foreign transactions', async () => {
      prismaMock.transaction.findFirst.mockResolvedValue(null);

      await expect(service.findOne('user-1', 'missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('update', () => {
    it('should update an existing transaction', async () => {
      const dto: UpdateTransactionDto = {
        amount: 3000,
        description: 'Updated run',
      };

      const updated = { ...baseTransaction, ...dto };

      prismaMock.transaction.findFirst.mockResolvedValue(baseTransaction);
      prismaMock.transaction.update.mockResolvedValue(updated);

      const result = await service.update('user-1', 'transaction-1', dto);

      expect(result).toEqual(updated);
      expect(prismaMock.transaction.update).toHaveBeenCalledWith({
        where: { id: 'transaction-1' },
        data: dto,
      });
    });

    it('should revalidate a changed account', async () => {
      prismaMock.transaction.findFirst.mockResolvedValue(baseTransaction);
      prismaMock.account.findFirst.mockResolvedValue({
        ...ownedAccount,
        id: 'account-2',
      });
      prismaMock.transaction.update.mockResolvedValue(baseTransaction);

      await service.update('user-1', 'transaction-1', {
        accountId: 'account-2',
      });

      expect(prismaMock.account.findFirst).toHaveBeenCalledWith({
        where: { id: 'account-2', userId: 'user-1', isArchived: false },
      });
    });

    it('should throw NotFoundException when updating a nonexistent transaction', async () => {
      prismaMock.transaction.findFirst.mockResolvedValue(null);

      await expect(
        service.update('user-1', 'missing', { amount: 3000 }),
      ).rejects.toThrow(NotFoundException);

      expect(prismaMock.transaction.update).not.toHaveBeenCalled();
    });

    it('should throw BadRequestException when updating a transfer', async () => {
      prismaMock.transaction.findFirst.mockResolvedValue({
        ...baseTransaction,
        type: 'TRANSFER',
      });

      await expect(
        service.update('user-1', 'transaction-1', { amount: 3000 }),
      ).rejects.toThrow(BadRequestException);

      expect(prismaMock.transaction.update).not.toHaveBeenCalled();
    });
  });

  describe('archive', () => {
    it('should soft-delete a single transaction', async () => {
      const archived = { ...baseTransaction, deletedAt: new Date() };

      prismaMock.transaction.findFirst.mockResolvedValue(baseTransaction);
      prismaMock.transaction.update.mockResolvedValue(archived);

      const result = await service.archive('user-1', 'transaction-1');

      expect(result).toEqual(archived);
      expect(prismaMock.transaction.update).toHaveBeenCalledWith({
        where: { id: 'transaction-1' },
        data: { deletedAt: expect.any(Date) },
      });
      expect(prismaMock.transaction.updateMany).not.toHaveBeenCalled();
    });

    it('should soft-delete both rows of a transfer pair', async () => {
      const transferRow = {
        ...baseTransaction,
        type: 'TRANSFER',
        transferGroupId: 'group-1',
      };

      prismaMock.transaction.findFirst.mockResolvedValue(transferRow);
      prismaMock.transaction.updateMany.mockResolvedValue({ count: 2 });
      prismaMock.transaction.findMany.mockResolvedValue([transferRow]);

      await service.archive('user-1', 'transaction-1');

      expect(prismaMock.transaction.updateMany).toHaveBeenCalledWith({
        where: {
          transferGroupId: 'group-1',
          userId: 'user-1',
          deletedAt: null,
        },
        data: { deletedAt: expect.any(Date) },
      });
      expect(prismaMock.transaction.update).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException when archiving a missing transaction', async () => {
      prismaMock.transaction.findFirst.mockResolvedValue(null);

      await expect(service.archive('user-1', 'missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
