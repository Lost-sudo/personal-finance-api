import { Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { Test, TestingModule } from '@nestjs/testing';

import { PrismaService } from '../../database/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import { RecurringTransactionGenerationService } from './recurring-transaction-generation.service.js';
import { RecurringTransactionSchedulerService } from './recurring-transaction-scheduler.service.js';

// Reliability tests over a stateful in-memory Prisma double: journaled
// rollback per $transaction, genuine P2002 enforcement, and an insert gate
// forcing true read/read → write/write races. Same TestingModule strategy.

type Frequency = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';

interface FakeSchedule {
  id: string;
  userId: string;
  type: 'EXPENSE' | 'INCOME' | 'TRANSFER';
  amount: number;
  description: string | null;
  accountId: string | null;
  categoryId: string | null;
  fromAccountId: string | null;
  toAccountId: string | null;
  frequency: Frequency;
  nextRunAt: Date;
  isActive: boolean;
}

interface FakeTxn {
  id: string;
  userId: string;
  type: string;
  amount: unknown;
  description: unknown;
  accountId: string | null;
  categoryId: string | null;
  fromAccountId: string | null;
  toAccountId: string | null;
  transferGroupId: string | null;
  transactionDate: Date;
  recurringTransactionId: string | null;
  scheduledFor: Date | null;
}

interface FakeStore {
  schedules: Map<string, FakeSchedule>;
  transactions: FakeTxn[];
  accounts: Map<string, { userId: string; isArchived: boolean }>;
  categories: Map<string, { userId: string; isArchived: boolean }>;
  // Failure injection: the next N operations throw before running.
  failNextCreates: number;
  failNextUpdates: number;
  // Deletion injection: the next N in-transaction re-reads observe nothing.
  expireTxReads: number;
  // Concurrency gate: the first insert waits for a second insert, forcing
  // both workers past their re-reads first.
  gateInserts: boolean;
  insertCalls: number;
  resumeFirstInsert: (() => void) | null;
  calls: { create: number; update: number };
}

function uniqueViolation(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError(
    'Unique constraint failed on the fields: (`recurringTransactionId`,`scheduledFor`)',
    { code: 'P2002', clientVersion: '7.10.0' },
  );
}

function createStore(): FakeStore {
  return {
    schedules: new Map(),
    transactions: [],
    accounts: new Map([['account-1', { userId: 'user-1', isArchived: false }]]),
    categories: new Map([
      ['category-1', { userId: 'user-1', isArchived: false }],
    ]),
    failNextCreates: 0,
    failNextUpdates: 0,
    expireTxReads: 0,
    gateInserts: false,
    insertCalls: 0,
    resumeFirstInsert: null,
    calls: { create: 0, update: 0 },
  };
}

function seedSchedule(
  store: FakeStore,
  overrides: Partial<FakeSchedule> = {},
): FakeSchedule {
  const schedule: FakeSchedule = {
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
    nextRunAt: new Date('2026-01-01T09:00:00.000Z'),
    isActive: true,
    ...overrides,
  };
  store.schedules.set(schedule.id, schedule);
  return schedule;
}

function sameInstant(a: Date | null, b: Date): boolean {
  return a !== null && a.getTime() === b.getTime();
}

// One store shared by the outer client and every transaction client, like a
// real database; rollback only undoes the failing transaction's own journal.
function createPrismaDouble(store: FakeStore) {
  const findSchedule = async ({
    where,
  }: {
    where: { id: string };
  }): Promise<FakeSchedule | null> => {
    const row = store.schedules.get(where.id);
    return row ? { ...row, nextRunAt: new Date(row.nextRunAt) } : null;
  };

  const findTransactions = async ({
    where,
  }: {
    where: { recurringTransactionId?: string; scheduledFor?: Date };
  }): Promise<FakeTxn[]> =>
    store.transactions
      .filter(
        (row) =>
          (where.recurringTransactionId === undefined ||
            row.recurringTransactionId === where.recurringTransactionId) &&
          (where.scheduledFor === undefined ||
            sameInstant(row.scheduledFor, where.scheduledFor)),
      )
      .map((row) => ({ ...row }));

  function makeTxClient(journal: Array<() => void>) {
    return {
      recurringTransaction: {
        findFirst: async ({
          where,
        }: {
          where: { id: string };
        }): Promise<FakeSchedule | null> => {
          if (store.expireTxReads > 0) {
            store.expireTxReads -= 1;
            return null;
          }
          return findSchedule({ where });
        },
        update: async ({
          where,
          data,
        }: {
          where: { id: string };
          data: { nextRunAt?: Date };
        }): Promise<FakeSchedule> => {
          store.calls.update += 1;
          if (store.failNextUpdates > 0) {
            store.failNextUpdates -= 1;
            throw new Error('advancement failed');
          }
          const row = store.schedules.get(where.id);
          if (!row) {
            throw new Error('Record not found');
          }
          const previous = { ...row };
          journal.push(() => {
            store.schedules.set(where.id, previous);
          });
          if (data.nextRunAt !== undefined) {
            row.nextRunAt = new Date(data.nextRunAt);
          }
          return { ...row };
        },
      },
      transaction: {
        create: async ({
          data,
        }: {
          data: Record<string, unknown>;
        }): Promise<FakeTxn> => {
          store.calls.create += 1;
          store.insertCalls += 1;
          if (store.gateInserts && store.insertCalls === 1) {
            await new Promise<void>((resolve) => {
              store.resumeFirstInsert = resolve;
            });
          } else if (store.gateInserts && store.resumeFirstInsert) {
            const resume = store.resumeFirstInsert;
            store.resumeFirstInsert = null;
            resume();
          }
          if (store.failNextCreates > 0) {
            store.failNextCreates -= 1;
            throw new Error('insert failed');
          }
          const scheduledFor =
            data['scheduledFor'] === null || data['scheduledFor'] === undefined
              ? null
              : new Date(data['scheduledFor'] as string);
          if (
            scheduledFor !== null &&
            store.transactions.some(
              (row) =>
                row.recurringTransactionId ===
                  (data['recurringTransactionId'] as string) &&
                sameInstant(row.scheduledFor, scheduledFor),
            )
          ) {
            throw uniqueViolation();
          }
          const row: FakeTxn = {
            id: `txn-${store.transactions.length + 1}`,
            userId: data['userId'] as string,
            type: data['type'] as string,
            amount: data['amount'],
            description: data['description'] ?? null,
            accountId: (data['accountId'] as string | null) ?? null,
            categoryId: (data['categoryId'] as string | null) ?? null,
            fromAccountId: (data['fromAccountId'] as string | null) ?? null,
            toAccountId: (data['toAccountId'] as string | null) ?? null,
            transferGroupId:
              (data['transferGroupId'] as string | null) ?? null,
            transactionDate: new Date(data['transactionDate'] as string),
            recurringTransactionId:
              (data['recurringTransactionId'] as string | null) ?? null,
            scheduledFor,
          };
          store.transactions.push(row);
          journal.push(() => {
            const index = store.transactions.findIndex(
              (candidate) => candidate.id === row.id,
            );
            if (index >= 0) {
              store.transactions.splice(index, 1);
            }
          });
          return { ...row };
        },
        findMany: findTransactions,
      },
      account: {
        findFirst: async ({
          where,
        }: {
          where: { id: string; userId: string; isArchived: boolean };
        }) => {
          const account = store.accounts.get(where.id);
          if (
            !account ||
            account.userId !== where.userId ||
            account.isArchived !== where.isArchived
          ) {
            return null;
          }
          return { id: where.id, ...account };
        },
      },
      category: {
        findFirst: async ({
          where,
        }: {
          where: { id: string; userId: string; isArchived: boolean };
        }) => {
          const category = store.categories.get(where.id);
          if (
            !category ||
            category.userId !== where.userId ||
            category.isArchived !== where.isArchived
          ) {
            return null;
          }
          return { id: where.id, ...category };
        },
      },
    };
  }

  return {
    recurringTransaction: {
      findFirst: findSchedule,
      findMany: async ({
        where,
      }: {
        where: { isActive?: boolean; nextRunAt?: { lte?: Date } };
      }): Promise<Array<{ id: string }>> =>
        [...store.schedules.values()]
          .filter(
            (row) =>
              (where.isActive === undefined ||
                row.isActive === where.isActive) &&
              (where.nextRunAt?.lte === undefined ||
                row.nextRunAt <= where.nextRunAt.lte),
          )
          .map((row) => ({ id: row.id })),
    },
    transaction: { findMany: findTransactions },
    $transaction: async (
      callback: (tx: ReturnType<typeof makeTxClient>) => Promise<unknown>,
    ): Promise<unknown> => {
      const journal: Array<() => void> = [];
      try {
        return await callback(makeTxClient(journal));
      } catch (error) {
        for (const undo of journal.reverse()) {
          undo();
        }
        throw error;
      }
    },
  };
}

function statuses(outcomes: Array<{ status: string }>): string[] {
  return outcomes.map((outcome) => outcome.status);
}

describe('Recurring generation reliability', () => {
  async function createHarness() {
    const store = createStore();
    const prismaDouble = createPrismaDouble(store);
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RecurringTransactionGenerationService,
        { provide: PrismaService, useValue: prismaDouble },
      ],
    }).compile();

    return {
      store,
      service: module.get<RecurringTransactionGenerationService>(
        RecurringTransactionGenerationService,
      ),
    };
  }

  async function createSweepHarness(catchUpLimit: number) {
    const store = createStore();
    const prismaDouble = createPrismaDouble(store);
    const configMock = {
      get: (key: string, fallback: unknown) =>
        key === 'recurring.generationCatchUpLimit' ? catchUpLimit : fallback,
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RecurringTransactionSchedulerService,
        RecurringTransactionGenerationService,
        { provide: PrismaService, useValue: prismaDouble },
        { provide: ConfigService, useValue: configMock },
        {
          provide: SchedulerRegistry,
          useValue: { addCronJob: vi.fn(), deleteCronJob: vi.fn() },
        },
      ],
    }).compile();

    return {
      store,
      scheduler: module.get<RecurringTransactionSchedulerService>(
        RecurringTransactionSchedulerService,
      ),
    };
  }

  function silenceLogs() {
    const levels = (['debug', 'log', 'error'] as const).map((level) =>
      vi.spyOn(Logger.prototype, level).mockImplementation(() => undefined),
    );
    return {
      calls: () =>
        levels.flatMap((spy) =>
          spy.mock.calls.map((args) => JSON.stringify(args)),
        ),
      restore: () => {
        for (const spy of levels) {
          spy.mockRestore();
        }
      },
    };
  }

  it('should let exactly one concurrent worker win an occurrence', async () => {
    const { store, service } = await createHarness();
    seedSchedule(store);
    store.gateInserts = true;
    const now = new Date('2026-01-15T09:00:00.000Z');

    const [first, second] = await Promise.all([
      service.generateDueOccurrence('recurring-1', now),
      service.generateDueOccurrence('recurring-1', now),
    ]);

    // One winner, one benign loser — never two financial records.
    expect([first.status, second.status].sort()).toEqual([
      'already-generated',
      'generated',
    ]);
    expect(store.transactions).toHaveLength(1);
    expect(store.transactions[0]?.scheduledFor).toEqual(
      new Date('2026-01-01T09:00:00.000Z'),
    );
    // Advanced exactly once; the loser's rollback touched nothing.
    expect(store.schedules.get('recurring-1')?.nextRunAt).toEqual(
      new Date('2026-02-01T09:00:00.000Z'),
    );
  });

  it('should return the existing row on a sequential duplicate', async () => {
    const { store, service } = await createHarness();
    seedSchedule(store);
    const now = new Date('2026-01-15T09:00:00.000Z');

    const first = await service.generateDueOccurrence('recurring-1', now);
    // Second attempt observes the advanced schedule and stops early.
    const second = await service.generateDueOccurrence('recurring-1', now);

    expect(first.status).toBe('generated');
    expect(second).toEqual({ status: 'not-due' });
    expect(store.transactions).toHaveLength(1);
  });

  it('should roll back the created row when advancement fails', async () => {
    const { store, service } = await createHarness();
    seedSchedule(store);
    store.failNextUpdates = 1;

    await expect(
      service.generateDueOccurrence(
        'recurring-1',
        new Date('2026-01-15T09:00:00.000Z'),
      ),
    ).rejects.toThrow('advancement failed');

    expect(store.transactions).toHaveLength(0);
    expect(store.schedules.get('recurring-1')?.nextRunAt).toEqual(
      new Date('2026-01-01T09:00:00.000Z'),
    );
  });

  it('should retry cleanly after a transient insert failure', async () => {
    const { store, service } = await createHarness();
    seedSchedule(store);
    const now = new Date('2026-01-15T09:00:00.000Z');
    store.failNextCreates = 1;

    await expect(service.generateDueOccurrence('recurring-1', now)).rejects.toThrow(
      'insert failed',
    );
    expect(store.calls.update).toBe(0);
    expect(store.transactions).toHaveLength(0);

    const retry = await service.generateDueOccurrence('recurring-1', now);

    expect(retry.status).toBe('generated');
    expect(store.transactions).toHaveLength(1);
    expect(store.schedules.get('recurring-1')?.nextRunAt).toEqual(
      new Date('2026-02-01T09:00:00.000Z'),
    );
  });

  it('should drain a backlog across two sweeps without duplicates', async () => {
    const { store, scheduler } = await createSweepHarness(2);
    seedSchedule(store);
    const now = new Date('2026-03-15T09:00:00.000Z');

    const first = await scheduler.runDueSchedules(now);
    expect(first).toEqual({
      generated: 2,
      alreadyGenerated: 0,
      skipped: 0,
      failed: 0,
    });

    const second = await scheduler.runDueSchedules(now);
    expect(second).toEqual({
      generated: 1,
      alreadyGenerated: 0,
      skipped: 1,
      failed: 0,
    });

    expect(
      store.transactions.map((row) => row.scheduledFor?.toISOString()),
    ).toEqual([
      '2026-01-01T09:00:00.000Z',
      '2026-02-01T09:00:00.000Z',
      '2026-03-01T09:00:00.000Z',
    ]);
    expect(store.schedules.get('recurring-1')?.nextRunAt).toEqual(
      new Date('2026-04-01T09:00:00.000Z'),
    );
  });

  it('should resume catch-up after a mid-backlog failure without duplicates', async () => {
    const { store, service } = await createHarness();
    seedSchedule(store);
    const now = new Date('2026-03-15T09:00:00.000Z');
    store.failNextCreates = 1;

    await expect(
      service.generateDueOccurrences('recurring-1', now, 10),
    ).rejects.toThrow('insert failed');
    expect(store.transactions).toHaveLength(0);
    expect(store.schedules.get('recurring-1')?.nextRunAt).toEqual(
      new Date('2026-01-01T09:00:00.000Z'),
    );

    const retry = await service.generateDueOccurrences(
      'recurring-1',
      now,
      10,
    );

    expect(statuses(retry)).toEqual([
      'generated',
      'generated',
      'generated',
      'not-due',
    ]);
    expect(store.transactions).toHaveLength(3);
  });

  it('should not write anything for an inactive schedule', async () => {
    const { store, service } = await createHarness();
    seedSchedule(store, { isActive: false });

    await expect(
      service.generateDueOccurrences(
        'recurring-1',
        new Date('2026-06-01T09:00:00.000Z'),
        10,
      ),
    ).resolves.toEqual([{ status: 'inactive' }]);

    expect(store.transactions).toHaveLength(0);
    expect(store.calls).toEqual({ create: 0, update: 0 });
  });

  it('should throw without writing when the schedule is gone', async () => {
    const { service } = await createHarness();

    await expect(
      service.generateDueOccurrence(
        'recurring-1',
        new Date('2026-01-15T09:00:00.000Z'),
      ),
    ).rejects.toThrow(NotFoundException);
  });

  it('should throw without writing when the schedule vanishes mid-flight', async () => {
    const { store, service } = await createHarness();
    seedSchedule(store);
    // Pre-read observes the row; the in-transaction re-read does not.
    store.expireTxReads = 1;

    await expect(
      service.generateDueOccurrence(
        'recurring-1',
        new Date('2026-01-15T09:00:00.000Z'),
      ),
    ).rejects.toThrow(NotFoundException);

    expect(store.transactions).toHaveLength(0);
    expect(store.calls).toEqual({ create: 0, update: 0 });
  });

  it('should count a deleted schedule as failed and continue the sweep', async () => {
    const { store, scheduler } = await createSweepHarness(10);
    seedSchedule(store, { id: 'recurring-1' });
    seedSchedule(store, {
      id: 'recurring-2',
      nextRunAt: new Date('2026-01-01T09:00:00.000Z'),
    });
    // r1 disappears between enumeration and generation (re-reads run in
    // enumeration order); r2 still processes.
    store.expireTxReads = 1;
    const silence = silenceLogs();

    const summary = await scheduler.runDueSchedules(
      new Date('2026-01-15T09:00:00.000Z'),
    );

    expect(summary).toEqual({
      generated: 1,
      alreadyGenerated: 0,
      skipped: 1,
      failed: 1,
    });
    expect(store.transactions).toHaveLength(1);
    silence.restore();
  });

  it('should never mutate pre-existing rows during generation', async () => {
    const { store, service } = await createHarness();
    seedSchedule(store);
    const manual = {
      id: 'manual-1',
      userId: 'user-1',
      type: 'EXPENSE',
      amount: 99,
      description: 'Manual entry',
      accountId: 'account-1',
      categoryId: null,
      fromAccountId: null,
      toAccountId: null,
      transferGroupId: null,
      transactionDate: new Date('2025-12-20T09:00:00.000Z'),
      recurringTransactionId: null,
      scheduledFor: null,
    };
    store.transactions.push({ ...manual });

    await service.generateDueOccurrences(
      'recurring-1',
      new Date('2026-03-15T09:00:00.000Z'),
      10,
    );

    expect(store.transactions[0]).toEqual(manual);
    expect(store.transactions).toHaveLength(4);
  });

  it('should log lifecycle events for attempt, success, duplicate, and failure', async () => {
    const { store, service } = await createHarness();
    seedSchedule(store);
    const now = new Date('2026-01-15T09:00:00.000Z');
    const silence = silenceLogs();

    await service.generateDueOccurrence('recurring-1', now);
    // Rewind without removing the row, so the same occurrence collides.
    store.schedules.get('recurring-1')!.nextRunAt = new Date(
      '2026-01-01T09:00:00.000Z',
    );
    await service.generateDueOccurrence('recurring-1', now);
    store.failNextCreates = 1;
    await expect(
      service.generateDueOccurrence('recurring-1', now),
    ).rejects.toThrow();

    const lines = silence.calls();
    silence.restore();

    expect(lines.some((line) => line.includes('Generation attempt'))).toBe(
      true,
    );
    expect(lines.some((line) => line.includes('Generated occurrence'))).toBe(
      true,
    );
    expect(lines.some((line) => line.includes('already generated'))).toBe(
      true,
    );
    expect(lines.some((line) => line.includes('Generation failed'))).toBe(
      true,
    );
  });

  it('should never log financial values', async () => {
    const { store, service } = await createHarness();
    seedSchedule(store, {
      amount: 4242.42,
      description: 'Rent-SECRET-xyz',
    });
    const silence = silenceLogs();

    await service.generateDueOccurrences(
      'recurring-1',
      new Date('2026-03-15T09:00:00.000Z'),
      10,
    );

    const lines = silence.calls();
    silence.restore();

    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line).not.toContain('4242.42');
      expect(line).not.toContain('SECRET');
    }
  });
});
