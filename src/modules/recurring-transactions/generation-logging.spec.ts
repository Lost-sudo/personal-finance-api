import { Logger } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../database/prisma.service.js';
import { RecurringTransactionGenerationService } from './recurring-transaction-generation.service.js';

const SECRET_DESCRIPTION = 'SECRET-DESC-MARKER-XYZ';
const SECRET_AMOUNT = '424242.42';
const SCHEDULE_ID = 'recurring-log-1';

function distinctiveSchedule() {
  return {
    id: SCHEDULE_ID,
    userId: 'user-1',
    type: 'EXPENSE',
    amount: SECRET_AMOUNT,
    description: SECRET_DESCRIPTION,
    accountId: 'account-1',
    categoryId: 'category-1',
    fromAccountId: null,
    toAccountId: null,
    frequency: 'MONTHLY',
    nextRunAt: new Date('2026-11-01T09:00:00.000Z'),
    isActive: true,
  };
}

/**
 * Generation workers log schedule ids, dates, and counts — financial values
 * (descriptions, amounts) must never appear in log output.
 */
describe('RecurringTransactionGenerationService logging', () => {
  let service: RecurringTransactionGenerationService;

  const txMock = {
    transaction: { create: vi.fn() },
    recurringTransaction: { findFirst: vi.fn(), update: vi.fn() },
    account: { findFirst: vi.fn() },
    category: { findFirst: vi.fn() },
  };

  const prismaMock = {
    recurringTransaction: { findFirst: vi.fn() },
    transaction: { findMany: vi.fn() },
    $transaction: vi.fn(),
  };

  let logged: string[];

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RecurringTransactionGenerationService,
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();

    service = module.get<RecurringTransactionGenerationService>(
      RecurringTransactionGenerationService,
    );

    vi.clearAllMocks();
    logged = [];
    for (const level of ['log', 'debug', 'error'] as const) {
      vi.spyOn(Logger.prototype, level).mockImplementation(
        (...args: unknown[]) => {
          logged.push(args.map(String).join(' '));
        },
      );
    }

    prismaMock.$transaction.mockImplementation((callback: never) =>
      (callback as (tx: unknown) => unknown)(txMock),
    );
    txMock.recurringTransaction.findFirst.mockImplementation((args: unknown) =>
      prismaMock.recurringTransaction.findFirst(args),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function expectNoFinancialData() {
    expect(logged.length).toBeGreaterThan(0);
    const text = logged.join('\n');
    expect(text).not.toContain(SECRET_DESCRIPTION);
    expect(text).not.toContain(SECRET_AMOUNT);
  }

  it('logs successful generation without financial values', async () => {
    const schedule = distinctiveSchedule();
    prismaMock.recurringTransaction.findFirst.mockResolvedValue(schedule);
    txMock.account.findFirst.mockResolvedValue({ id: 'account-1' });
    txMock.category.findFirst.mockResolvedValue({ id: 'category-1' });
    txMock.transaction.create.mockResolvedValue({ id: 'tx-1' });
    txMock.recurringTransaction.update.mockResolvedValue(schedule);

    const result = await service.generateDueOccurrence(
      SCHEDULE_ID,
      new Date('2026-11-02T09:00:00.000Z'),
    );

    expect(result.status).toBe('generated');
    expect(logged.join('\n')).toContain(SCHEDULE_ID);
    expectNoFinancialData();
  });

  it('logs generation failures without financial values', async () => {
    const schedule = distinctiveSchedule();
    prismaMock.recurringTransaction.findFirst.mockResolvedValue(schedule);
    txMock.account.findFirst.mockResolvedValue({ id: 'account-1' });
    txMock.category.findFirst.mockResolvedValue({ id: 'category-1' });
    txMock.transaction.create.mockRejectedValue(new Error('insert failed'));

    await expect(
      service.generateDueOccurrence(
        SCHEDULE_ID,
        new Date('2026-11-02T09:00:00.000Z'),
      ),
    ).rejects.toThrow('insert failed');
    expect(logged.join('\n')).toContain(SCHEDULE_ID);
    expectNoFinancialData();
  });
});
