import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import { PrismaService } from '../../database/prisma.service.js';
import { AccountsService } from './accounts.service.js';
import { CreateAccountDto } from './dto/create-account.dto.js';
import { UpdateAccountDto } from './dto/update-account.dto.js';
import { AccountQueryDto } from './dto/account-query.dto.js';
import { AccountTransactionsQueryDto } from './dto/account-transactions-query.dto.js';

describe('AccountsService', () => {
  let service: AccountsService;

  const prismaMock = {
    account: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
    },
    transaction: {
      findMany: vi.fn(),
      count: vi.fn(),
    },
  };

  const ownedAccount = {
    id: 'account-1',
    userId: 'user-1',
    name: 'BDO Savings',
    type: 'BANK',
    currency: 'PHP',
    initialBalance: '15000.00',
    isArchived: false,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AccountsService,
        {
          provide: PrismaService,
          useValue: prismaMock,
        },
      ],
    }).compile();

    service = module.get<AccountsService>(AccountsService);

    vi.clearAllMocks();
  });

  describe('create', () => {
    it('should create an account', async () => {
      const userId = 'user-1';

      const dto: CreateAccountDto = {
        name: 'BDO Savings',
        type: 'BANK',
        currency: 'PHP',
        initialBalance: 15000,
      };

      const createdAccount = {
        id: 'account-1',
        userId,
        name: 'BDO Savings',
        type: 'BANK',
        currency: 'PHP',
        initialBalance: 15000,
        isArchived: false,
      };

      prismaMock.account.findUnique.mockResolvedValue(null);
      prismaMock.account.create.mockResolvedValue(createdAccount);

      const result = await service.create(userId, dto);

      expect(result).toEqual(createdAccount);

      expect(prismaMock.account.findUnique).toHaveBeenCalledWith({
        where: {
          userId_name: {
            userId,
            name: dto.name,
          },
        },
      });

      expect(prismaMock.account.create).toHaveBeenCalledWith({
        data: {
          userId,
          name: dto.name,
          type: dto.type,
          currency: dto.currency,
          initialBalance: dto.initialBalance,
        },
      });
    });

    it('should throw ConflictException when the account already exists', async () => {
      const userId = 'user-1';

      const dto: CreateAccountDto = {
        name: 'BDO Savings',
        type: 'BANK',
        currency: 'PHP',
        initialBalance: 15000,
      };

      const existingAccount = {
        id: 'account-1',
        userId,
        name: 'BDO Savings',
        type: 'BANK',
        currency: 'PHP',
        initialBalance: 15000,
        isArchived: false,
      };

      prismaMock.account.findUnique.mockResolvedValue(existingAccount);

      await expect(service.create(userId, dto)).rejects.toThrow(
        ConflictException,
      );

      expect(prismaMock.account.create).not.toHaveBeenCalled();
    });
  });

  describe('findAll', () => {
    it('should return paginated accounts belonging to the user', async () => {
      const userId = 'user-1';

      const query: AccountQueryDto = {
        page: 1,
        limit: 20,
        sortBy: 'name',
        sortOrder: 'asc',
      };

      const accounts = [
        {
          id: 'account-1',
          userId,
          name: 'BDO Savings',
          type: 'BANK',
          currency: 'PHP',
          initialBalance: 15000,
          isArchived: false,
        },
        {
          id: 'account-2',
          userId,
          name: 'Cash Wallet',
          type: 'CASH',
          currency: 'PHP',
          initialBalance: 5000,
          isArchived: false,
        },
      ];

      prismaMock.account.findMany.mockResolvedValue(accounts);
      prismaMock.account.count.mockResolvedValue(accounts.length);

      const result = await service.findAll(userId, query);

      expect(result).toEqual({
        accounts,
        total: accounts.length,
      });

      const where = {
        userId,
        isArchived: false,
      };

      expect(prismaMock.account.findMany).toHaveBeenCalledWith({
        where,
        skip: 0,
        take: 20,
        orderBy: {
          name: 'asc',
        },
      });

      expect(prismaMock.account.count).toHaveBeenCalledWith({
        where,
      });
    });

    it('should apply pagination and custom sorting', async () => {
      const userId = 'user-1';

      const query: AccountQueryDto = {
        page: 2,
        limit: 10,
        sortBy: 'createdAt',
        sortOrder: 'desc',
      };

      const accounts = [
        {
          id: 'account-2',
          userId,
          name: 'Cash Wallet',
          type: 'CASH',
          currency: 'PHP',
          initialBalance: 5000,
          isArchived: false,
        },
      ];

      prismaMock.account.findMany.mockResolvedValue(accounts);
      prismaMock.account.count.mockResolvedValue(11);

      const result = await service.findAll(userId, query);

      expect(result).toEqual({
        accounts,
        total: 11,
      });

      const where = {
        userId,
        isArchived: false,
      };

      expect(prismaMock.account.findMany).toHaveBeenCalledWith({
        where,
        skip: 10,
        take: 10,
        orderBy: {
          createdAt: 'desc',
        },
      });

      expect(prismaMock.account.count).toHaveBeenCalledWith({
        where,
      });
    });

    it('should filter accounts by type', async () => {
      const userId = 'user-1';

      const query: AccountQueryDto = {
        page: 1,
        limit: 20,
        type: 'BANK',
        sortBy: 'name',
        sortOrder: 'asc',
      };

      const accounts = [
        {
          id: 'account-1',
          userId,
          name: 'BDO Savings',
          type: 'BANK',
          currency: 'PHP',
          initialBalance: 15000,
          isArchived: false,
        },
      ];

      prismaMock.account.findMany.mockResolvedValue(accounts);
      prismaMock.account.count.mockResolvedValue(accounts.length);

      const result = await service.findAll(userId, query);

      expect(result).toEqual({
        accounts,
        total: accounts.length,
      });

      const where = {
        userId,
        isArchived: false,
        type: 'BANK',
      };

      expect(prismaMock.account.findMany).toHaveBeenCalledWith({
        where,
        skip: 0,
        take: 20,
        orderBy: {
          name: 'asc',
        },
      });

      expect(prismaMock.account.count).toHaveBeenCalledWith({
        where,
      });
    });

    it('should filter accounts by search term', async () => {
      const userId = 'user-1';

      const query: AccountQueryDto = {
        page: 1,
        limit: 20,
        search: 'BDO',
        sortBy: 'name',
        sortOrder: 'asc',
      };

      const accounts = [
        {
          id: 'account-1',
          userId,
          name: 'BDO Savings',
          type: 'BANK',
          currency: 'PHP',
          initialBalance: 15000,
          isArchived: false,
        },
      ];

      prismaMock.account.findMany.mockResolvedValue(accounts);
      prismaMock.account.count.mockResolvedValue(accounts.length);

      const result = await service.findAll(userId, query);

      expect(result).toEqual({
        accounts,
        total: accounts.length,
      });

      const where = {
        userId,
        isArchived: false,
        name: {
          contains: 'BDO',
          mode: 'insensitive',
        },
      };

      expect(prismaMock.account.findMany).toHaveBeenCalledWith({
        where,
        skip: 0,
        take: 20,
        orderBy: {
          name: 'asc',
        },
      });

      expect(prismaMock.account.count).toHaveBeenCalledWith({
        where,
      });
    });

    it('should filter accounts by type and search term', async () => {
      const userId = 'user-1';

      const query: AccountQueryDto = {
        page: 1,
        limit: 20,
        type: 'BANK',
        search: 'BDO',
        sortBy: 'name',
        sortOrder: 'asc',
      };

      const accounts = [
        {
          id: 'account-1',
          userId,
          name: 'BDO Savings',
          type: 'BANK',
          currency: 'PHP',
          initialBalance: 15000,
          isArchived: false,
        },
      ];

      prismaMock.account.findMany.mockResolvedValue(accounts);
      prismaMock.account.count.mockResolvedValue(accounts.length);

      const result = await service.findAll(userId, query);

      expect(result).toEqual({
        accounts,
        total: accounts.length,
      });

      const where = {
        userId,
        isArchived: false,
        type: 'BANK',
        name: {
          contains: 'BDO',
          mode: 'insensitive',
        },
      };

      expect(prismaMock.account.findMany).toHaveBeenCalledWith({
        where,
        skip: 0,
        take: 20,
        orderBy: {
          name: 'asc',
        },
      });

      expect(prismaMock.account.count).toHaveBeenCalledWith({
        where,
      });
    });
  });

  describe('findOne', () => {
    it('should return an account belonging to the user', async () => {
      const userId = 'user-1';
      const accountId = 'account-1';

      const account = {
        id: accountId,
        userId,
        name: 'BDO Savings',
        type: 'BANK',
        currency: 'PHP',
        initialBalance: 15000,
        isArchived: false,
      };

      prismaMock.account.findFirst.mockResolvedValue(account);

      const result = await service.findOne(userId, accountId);

      expect(result).toEqual(account);

      expect(prismaMock.account.findFirst).toHaveBeenCalledWith({
        where: {
          id: accountId,
          userId,
          isArchived: false,
        },
      });
    });

    it('should throw NotFoundException when the account does not exist', async () => {
      const userId = 'user-1';
      const accountId = 'missing-account';

      prismaMock.account.findFirst.mockResolvedValue(null);

      await expect(service.findOne(userId, accountId)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('update', () => {
    it('should update an existing account', async () => {
      const userId = 'user-1';
      const accountId = 'account-1';

      const existingAccount = {
        id: accountId,
        userId,
        name: 'BDO Savings',
        type: 'BANK',
        currency: 'PHP',
        initialBalance: 15000,
        isArchived: false,
      };

      const dto: UpdateAccountDto = {
        name: 'BDO Checking',
        currency: 'USD',
      };

      const updatedAccount = {
        ...existingAccount,
        name: 'BDO Checking',
        currency: 'USD',
      };

      prismaMock.account.findFirst
        .mockResolvedValueOnce(existingAccount)
        .mockResolvedValueOnce(null);

      prismaMock.account.update.mockResolvedValue(updatedAccount);

      const result = await service.update(userId, accountId, dto);

      expect(result).toEqual(updatedAccount);

      expect(prismaMock.account.update).toHaveBeenCalledWith({
        where: {
          id: accountId,
        },
        data: dto,
      });
    });

    it('should throw NotFoundException when updating a nonexistent account', async () => {
      const userId = 'user-1';
      const accountId = 'missing-account';

      const dto: UpdateAccountDto = {
        name: 'BDO Checking',
      };

      prismaMock.account.findFirst.mockResolvedValue(null);

      await expect(service.update(userId, accountId, dto)).rejects.toThrow(
        NotFoundException,
      );

      expect(prismaMock.account.update).not.toHaveBeenCalled();
    });

    it('should throw ConflictException when updating to a duplicate account', async () => {
      const userId = 'user-1';
      const accountId = 'account-1';

      const existingAccount = {
        id: accountId,
        userId,
        name: 'BDO Savings',
        type: 'BANK',
        currency: 'PHP',
        initialBalance: 15000,
        isArchived: false,
      };

      const duplicateAccount = {
        id: 'account-2',
        userId,
        name: 'BDO Checking',
        type: 'BANK',
        currency: 'PHP',
        initialBalance: 5000,
        isArchived: false,
      };

      const dto: UpdateAccountDto = {
        name: 'BDO Checking',
      };

      prismaMock.account.findFirst
        .mockResolvedValueOnce(existingAccount)
        .mockResolvedValueOnce(duplicateAccount);

      await expect(service.update(userId, accountId, dto)).rejects.toThrow(
        ConflictException,
      );

      expect(prismaMock.account.update).not.toHaveBeenCalled();
    });
  });

  describe('archive', () => {
    it('should archive an existing account', async () => {
      const userId = 'user-1';
      const accountId = 'account-1';

      const existingAccount = {
        id: accountId,
        userId,
        name: 'BDO Savings',
        type: 'BANK',
        currency: 'PHP',
        initialBalance: 15000,
        isArchived: false,
      };

      const archivedAccount = {
        ...existingAccount,
        isArchived: true,
      };

      prismaMock.account.findFirst.mockResolvedValue(existingAccount);
      prismaMock.account.update.mockResolvedValue(archivedAccount);

      const result = await service.archive(userId, accountId);

      expect(result).toEqual(archivedAccount);

      expect(prismaMock.account.update).toHaveBeenCalledWith({
        where: {
          id: accountId,
        },
        data: {
          isArchived: true,
        },
      });
    });

    it('should throw NotFoundException when archiving a nonexistent account', async () => {
      const userId = 'user-1';
      const accountId = 'missing-account';

      prismaMock.account.findFirst.mockResolvedValue(null);

      await expect(service.archive(userId, accountId)).rejects.toThrow(
        NotFoundException,
      );

      expect(prismaMock.account.update).not.toHaveBeenCalled();
    });
  });

  describe('getBalance', () => {
    const baseQueryWhere = {
      userId: 'user-1',
      deletedAt: null,
      OR: [
        { accountId: 'account-1' },
        { fromAccountId: 'account-1' },
        { toAccountId: 'account-1' },
      ],
    };

    it('should return the initial balance when there are no transactions', async () => {
      prismaMock.account.findFirst.mockResolvedValue(ownedAccount);
      prismaMock.transaction.findMany.mockResolvedValue([]);

      const result = await service.getBalance('user-1', 'account-1');

      expect(result).toEqual({
        accountId: 'account-1',
        initialBalance: '15000.00',
        income: '0.00',
        expenses: '0.00',
        incomingTransfers: '0.00',
        outgoingTransfers: '0.00',
        balance: '15000.00',
      });
      expect(prismaMock.transaction.findMany).toHaveBeenCalledWith({
        where: baseQueryWhere,
      });
    });

    it('should add income transactions to the balance', async () => {
      prismaMock.account.findFirst.mockResolvedValue(ownedAccount);
      prismaMock.transaction.findMany.mockResolvedValue([
        {
          id: 'tx-1',
          accountId: 'account-1',
          type: 'INCOME',
          amount: '5000.00',
          fromAccountId: null,
          toAccountId: null,
        },
      ]);

      const result = await service.getBalance('user-1', 'account-1');

      expect(result).toMatchObject({
        income: '5000.00',
        expenses: '0.00',
        balance: '20000.00',
      });
    });

    it('should subtract expense transactions from the balance', async () => {
      prismaMock.account.findFirst.mockResolvedValue(ownedAccount);
      prismaMock.transaction.findMany.mockResolvedValue([
        {
          id: 'tx-1',
          accountId: 'account-1',
          type: 'EXPENSE',
          amount: '2500.00',
          fromAccountId: null,
          toAccountId: null,
        },
      ]);

      const result = await service.getBalance('user-1', 'account-1');

      expect(result).toMatchObject({
        expenses: '2500.00',
        balance: '12500.00',
      });
    });

    it('should add incoming transfers and subtract outgoing transfers', async () => {
      prismaMock.account.findFirst.mockResolvedValue(ownedAccount);
      prismaMock.transaction.findMany.mockResolvedValue([
        {
          id: 'tx-out',
          accountId: 'account-1',
          type: 'TRANSFER',
          amount: '1000.00',
          fromAccountId: 'account-1',
          toAccountId: 'account-2',
        },
        {
          id: 'tx-in',
          accountId: 'account-1',
          type: 'TRANSFER',
          amount: '500.00',
          fromAccountId: 'account-2',
          toAccountId: 'account-1',
        },
      ]);

      const result = await service.getBalance('user-1', 'account-1');

      expect(result).toMatchObject({
        incomingTransfers: '500.00',
        outgoingTransfers: '1000.00',
        balance: '14500.00',
      });
    });

    it('should combine all contributions using exact decimal arithmetic', async () => {
      prismaMock.account.findFirst.mockResolvedValue({
        ...ownedAccount,
        initialBalance: '100.00',
      });
      prismaMock.transaction.findMany.mockResolvedValue([
        {
          id: 'tx-1',
          accountId: 'account-1',
          type: 'INCOME',
          amount: '20.20',
          fromAccountId: null,
          toAccountId: null,
        },
        {
          id: 'tx-2',
          accountId: 'account-1',
          type: 'EXPENSE',
          amount: '0.30',
          fromAccountId: null,
          toAccountId: null,
        },
        {
          id: 'tx-3',
          accountId: 'account-1',
          type: 'TRANSFER',
          amount: '10.10',
          fromAccountId: 'account-2',
          toAccountId: 'account-1',
        },
        {
          id: 'tx-4',
          accountId: 'account-1',
          type: 'TRANSFER',
          amount: '5.05',
          fromAccountId: 'account-1',
          toAccountId: 'account-2',
        },
      ]);

      const result = await service.getBalance('user-1', 'account-1');

      expect(result).toEqual({
        accountId: 'account-1',
        initialBalance: '100.00',
        income: '20.20',
        expenses: '0.30',
        incomingTransfers: '10.10',
        outgoingTransfers: '5.05',
        balance: '124.95',
      });
    });

    it('should ignore the counterparty legs of transfers', async () => {
      prismaMock.account.findFirst.mockResolvedValue(ownedAccount);
      prismaMock.transaction.findMany.mockResolvedValue([
        {
          id: 'tx-own',
          accountId: 'account-1',
          type: 'TRANSFER',
          amount: '1000.00',
          fromAccountId: 'account-1',
          toAccountId: 'account-2',
        },
        {
          id: 'tx-counterparty',
          accountId: 'account-2',
          type: 'TRANSFER',
          amount: '1000.00',
          fromAccountId: 'account-1',
          toAccountId: 'account-2',
        },
      ]);

      const result = await service.getBalance('user-1', 'account-1');

      expect(result).toMatchObject({
        outgoingTransfers: '1000.00',
        incomingTransfers: '0.00',
        balance: '14000.00',
      });
    });

    it('should exclude legacy transfer rows without direction', async () => {
      prismaMock.account.findFirst.mockResolvedValue(ownedAccount);
      prismaMock.transaction.findMany.mockResolvedValue([
        {
          id: 'tx-legacy',
          accountId: 'account-1',
          type: 'TRANSFER',
          amount: '1000.00',
          fromAccountId: null,
          toAccountId: null,
        },
      ]);

      const result = await service.getBalance('user-1', 'account-1');

      expect(result).toMatchObject({
        incomingTransfers: '0.00',
        outgoingTransfers: '0.00',
        balance: '15000.00',
      });
    });

    it('should throw NotFoundException for a foreign account', async () => {
      prismaMock.account.findFirst.mockResolvedValue(null);

      await expect(service.getBalance('user-1', 'missing')).rejects.toThrow(
        NotFoundException,
      );

      expect(prismaMock.transaction.findMany).not.toHaveBeenCalled();
    });
  });

  describe('findTransactions', () => {
    const baseQuery: AccountTransactionsQueryDto = {
      page: 1,
      limit: 20,
    };

    const ownedTransaction = {
      id: 'tx-1',
      userId: 'user-1',
      accountId: 'account-1',
      type: 'EXPENSE',
      amount: '100.00',
    };

    it('should return paginated transactions for the account', async () => {
      prismaMock.account.findFirst.mockResolvedValue(ownedAccount);
      prismaMock.transaction.findMany.mockResolvedValue([ownedTransaction]);
      prismaMock.transaction.count.mockResolvedValue(1);

      const result = await service.findTransactions(
        'user-1',
        'account-1',
        baseQuery,
      );

      expect(result).toEqual({ transactions: [ownedTransaction], total: 1 });

      const where = {
        userId: 'user-1',
        accountId: 'account-1',
        deletedAt: null,
      };

      expect(prismaMock.transaction.findMany).toHaveBeenCalledWith({
        where,
        skip: 0,
        take: 20,
        orderBy: [{ transactionDate: 'desc' }, { createdAt: 'desc' }],
      });
      expect(prismaMock.transaction.count).toHaveBeenCalledWith({ where });
    });

    it('should apply pagination with skip and take', async () => {
      prismaMock.account.findFirst.mockResolvedValue(ownedAccount);
      prismaMock.transaction.findMany.mockResolvedValue([]);
      prismaMock.transaction.count.mockResolvedValue(25);

      await service.findTransactions('user-1', 'account-1', {
        page: 3,
        limit: 10,
      });

      expect(prismaMock.transaction.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 20, take: 10 }),
      );
    });

    it('should filter by transaction type', async () => {
      prismaMock.account.findFirst.mockResolvedValue(ownedAccount);
      prismaMock.transaction.findMany.mockResolvedValue([ownedTransaction]);
      prismaMock.transaction.count.mockResolvedValue(1);

      await service.findTransactions('user-1', 'account-1', {
        ...baseQuery,
        type: 'EXPENSE',
      });

      expect(prismaMock.transaction.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ type: 'EXPENSE' }),
        }),
      );
    });

    it('should filter by date range', async () => {
      prismaMock.account.findFirst.mockResolvedValue(ownedAccount);
      prismaMock.transaction.findMany.mockResolvedValue([ownedTransaction]);
      prismaMock.transaction.count.mockResolvedValue(1);

      await service.findTransactions('user-1', 'account-1', {
        ...baseQuery,
        dateFrom: '2026-01-01T00:00:00.000Z',
        dateTo: '2026-01-31T23:59:59.000Z',
      });

      expect(prismaMock.transaction.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            transactionDate: {
              gte: '2026-01-01T00:00:00.000Z',
              lte: '2026-01-31T23:59:59.000Z',
            },
          }),
        }),
      );
    });

    it('should throw NotFoundException for a foreign or archived account', async () => {
      prismaMock.account.findFirst.mockResolvedValue(null);

      await expect(
        service.findTransactions('user-1', 'missing', baseQuery),
      ).rejects.toThrow(NotFoundException);

      expect(prismaMock.transaction.findMany).not.toHaveBeenCalled();
      expect(prismaMock.transaction.count).not.toHaveBeenCalled();
    });
  });
});
