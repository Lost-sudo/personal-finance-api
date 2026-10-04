import { Test, TestingModule } from '@nestjs/testing';

import { PrismaService } from '../../database/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import { ReportsService } from './reports.service.js';
import { ReportQueryDto } from './dto/report-query.dto.js';

describe('ReportsService', () => {
  let service: ReportsService;

  const prismaMock = {
    transaction: {
      findMany: vi.fn(),
    },
  };

  const foodCategory = { id: 'category-1', name: 'Food' };
  const transportCategory = { id: 'category-2', name: 'Transportation' };

  function expense(
    overrides: Record<string, unknown> = {},
  ): Record<string, unknown> {
    return {
      id: 'tx-expense',
      userId: 'user-1',
      accountId: 'account-1',
      categoryId: 'category-1',
      type: 'EXPENSE',
      amount: new Prisma.Decimal('2500.00'),
      transactionDate: '2026-01-15T08:30:00.000Z',
      category: foodCategory,
      ...overrides,
    };
  }

  function income(
    overrides: Record<string, unknown> = {},
  ): Record<string, unknown> {
    return {
      id: 'tx-income',
      userId: 'user-1',
      accountId: 'account-1',
      categoryId: null,
      type: 'INCOME',
      amount: new Prisma.Decimal('5000.00'),
      transactionDate: '2026-01-15T08:30:00.000Z',
      category: null,
      ...overrides,
    };
  }

  function transfer(
    overrides: Record<string, unknown> = {},
  ): Record<string, unknown> {
    return {
      id: 'tx-transfer',
      userId: 'user-1',
      accountId: 'account-1',
      categoryId: null,
      type: 'TRANSFER',
      amount: new Prisma.Decimal('5000.00'),
      transactionDate: '2026-01-15T08:30:00.000Z',
      transferGroupId: 'group-1',
      fromAccountId: 'account-1',
      toAccountId: 'account-2',
      category: null,
      ...overrides,
    };
  }

  const emptyQuery: ReportQueryDto = {};

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReportsService,
        {
          provide: PrismaService,
          useValue: prismaMock,
        },
      ],
    }).compile();

    service = module.get<ReportsService>(ReportsService);

    vi.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should calculate income from INCOME transactions', async () => {
    prismaMock.transaction.findMany.mockResolvedValue([
      income(),
      income({ id: 'tx-income-2', amount: new Prisma.Decimal('1500.50') }),
    ]);

    const result = await service.getFinancialSummary('user-1', emptyQuery);

    expect(result).toMatchObject({
      income: '6500.50',
      expenses: '0.00',
      netCashFlow: '6500.50',
    });
  });

  it('should calculate expenses from EXPENSE transactions', async () => {
    prismaMock.transaction.findMany.mockResolvedValue([expense()]);

    const result = await service.getFinancialSummary('user-1', emptyQuery);

    expect(result).toMatchObject({
      income: '0.00',
      expenses: '2500.00',
      netCashFlow: '-2500.00',
    });
  });

  it('should exclude transfers from all financial totals', async () => {
    prismaMock.transaction.findMany.mockResolvedValue([
      transfer(),
      transfer({
        id: 'tx-transfer-2',
        accountId: 'account-2',
        fromAccountId: 'account-2',
        toAccountId: 'account-1',
      }),
    ]);

    const result = await service.getFinancialSummary('user-1', emptyQuery);

    expect(result).toMatchObject({
      income: '0.00',
      expenses: '0.00',
      netCashFlow: '0.00',
      spendingByCategory: [],
    });
  });

  it('should compute net cash flow as income minus expenses', async () => {
    prismaMock.transaction.findMany.mockResolvedValue([
      income(),
      expense(),
      transfer(),
    ]);

    const result = await service.getFinancialSummary('user-1', emptyQuery);

    expect(result).toMatchObject({
      income: '5000.00',
      expenses: '2500.00',
      netCashFlow: '2500.00',
    });
  });

  it('should group expenses by category', async () => {
    prismaMock.transaction.findMany.mockResolvedValue([
      expense(),
      expense({
        id: 'tx-expense-2',
        categoryId: 'category-2',
        amount: new Prisma.Decimal('200.00'),
        category: transportCategory,
      }),
    ]);

    const result = await service.getFinancialSummary('user-1', emptyQuery);

    expect(result.spendingByCategory).toEqual([
      { categoryId: 'category-1', categoryName: 'Food', amount: '2500.00' },
      {
        categoryId: 'category-2',
        categoryName: 'Transportation',
        amount: '200.00',
      },
    ]);
  });

  it('should accumulate repeated expenses in the same category', async () => {
    prismaMock.transaction.findMany.mockResolvedValue([
      expense({ amount: new Prisma.Decimal('500.00') }),
      expense({ id: 'tx-expense-2', amount: new Prisma.Decimal('300.00') }),
    ]);

    const result = await service.getFinancialSummary('user-1', emptyQuery);

    expect(result).toMatchObject({ expenses: '800.00' });
    expect(result.spendingByCategory).toEqual([
      { categoryId: 'category-1', categoryName: 'Food', amount: '800.00' },
    ]);
  });

  it('should count uncategorized expenses without listing them by category', async () => {
    prismaMock.transaction.findMany.mockResolvedValue([
      expense({ categoryId: null, category: null }),
    ]);

    const result = await service.getFinancialSummary('user-1', emptyQuery);

    expect(result).toMatchObject({
      expenses: '2500.00',
      spendingByCategory: [],
    });
  });

  it('should sort category spending by amount descending', async () => {
    prismaMock.transaction.findMany.mockResolvedValue([
      expense({
        amount: new Prisma.Decimal('200.00'),
        category: transportCategory,
        categoryId: 'category-2',
      }),
      expense({ amount: new Prisma.Decimal('800.00') }),
      expense({
        id: 'tx-expense-3',
        amount: new Prisma.Decimal('500.00'),
        categoryId: 'category-1',
      }),
    ]);

    const result = await service.getFinancialSummary('user-1', emptyQuery);

    expect(
      result.spendingByCategory.map((entry) => entry.categoryName),
    ).toEqual(['Food', 'Transportation']);
    expect(
      result.spendingByCategory.map((entry) => entry.amount),
    ).toEqual(['1300.00', '200.00']);
  });

  it('should apply date filtering to transactionDate', async () => {
    prismaMock.transaction.findMany.mockResolvedValue([]);

    await service.getFinancialSummary('user-1', {
      dateFrom: '2026-01-01T00:00:00.000Z',
      dateTo: '2026-01-31T23:59:59.000Z',
    });

    expect(prismaMock.transaction.findMany).toHaveBeenCalledWith({
      where: {
        userId: 'user-1',
        deletedAt: null,
        transactionDate: {
          gte: '2026-01-01T00:00:00.000Z',
          lte: '2026-01-31T23:59:59.000Z',
        },
      },
      include: {
        category: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });
  });

  it('should always scope the transaction query to the user', async () => {
    prismaMock.transaction.findMany.mockResolvedValue([]);

    await service.getFinancialSummary('user-1', emptyQuery);

    expect(prismaMock.transaction.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: 'user-1' }),
      }),
    );
  });

  it('should use Decimal-safe arithmetic for fractional amounts', async () => {
    prismaMock.transaction.findMany.mockResolvedValue([
      income({ amount: new Prisma.Decimal('0.10') }),
      income({
        id: 'tx-income-2',
        amount: new Prisma.Decimal('0.20'),
      }),
      expense({ amount: new Prisma.Decimal('0.30') }),
    ]);

    const result = await service.getFinancialSummary('user-1', emptyQuery);

    expect(result).toMatchObject({
      income: '0.30',
      expenses: '0.30',
      netCashFlow: '0.00',
    });
  });

  it('should echo the requested date range in the response', async () => {
    prismaMock.transaction.findMany.mockResolvedValue([]);

    const result = await service.getFinancialSummary('user-1', {
      dateFrom: '2026-01-01T00:00:00.000Z',
      dateTo: '2026-01-31T23:59:59.000Z',
    });

    expect(result).toMatchObject({
      fromDate: '2026-01-01T00:00:00.000Z',
      toDate: '2026-01-31T23:59:59.000Z',
    });

    const unfiltered = await service.getFinancialSummary('user-1', emptyQuery);

    expect(unfiltered).toMatchObject({ fromDate: null, toDate: null });
  });
});
