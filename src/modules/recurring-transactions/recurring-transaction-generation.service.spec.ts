import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import { PrismaService } from '../../database/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import { advanceNextRunAt } from './advance-next-run-at.util.js';
import { RecurringTransactionGenerationService } from './recurring-transaction-generation.service.js';

describe('RecurringTransactionGenerationService', () => {
  let service: RecurringTransactionGenerationService;

  const txMock = {
    transaction: {
      create: vi.fn(),
    },
    recurringTransaction: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    account: {
      findFirst: vi.fn(),
    },
    category: {
      findFirst: vi.fn(),
    },
  };

  const prismaMock = {
    recurringTransaction: {
      findFirst: vi.fn(),
    },
    transaction: {
      findMany: vi.fn(),
    },
    $transaction: vi.fn(),
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

  const occurrence = new Date('2026-11-01T09:00:00.000Z');
  const now = new Date('2026-11-02T09:00:00.000Z');

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
    nextRunAt: occurrence,
    isActive: true,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RecurringTransactionGenerationService,
        {
          provide: PrismaService,
          useValue: prismaMock,
        },
      ],
    }).compile();

    service = module.get<RecurringTransactionGenerationService>(
      RecurringTransactionGenerationService,
    );

    vi.clearAllMocks();
    // Default: run the transaction callback against txMock.
    prismaMock.$transaction.mockImplementation((callback: never) =>
      (callback as (tx: unknown) => unknown)(txMock),
    );
    // Default: the in-transaction re-read mirrors the initial read; override
    // per case to simulate a concurrent change.
    txMock.recurringTransaction.findFirst.mockImplementation((args: unknown) =>
      prismaMock.recurringTransaction.findFirst(args),
    );
  });

  describe('advanceNextRunAt', () => {
    it.each([
      ['DAILY', '2026-11-01T09:00:00.000Z', '2026-11-02T09:00:00.000Z'],
      ['WEEKLY', '2026-11-01T09:00:00.000Z', '2026-11-08T09:00:00.000Z'],
      ['MONTHLY', '2026-11-01T09:00:00.000Z', '2026-12-01T09:00:00.000Z'],
      ['YEARLY', '2026-11-01T09:00:00.000Z', '2027-11-01T09:00:00.000Z'],
    ] as const)('should advance %s by one step', (frequency, from, to) => {
      expect(advanceNextRunAt(new Date(from), frequency)).toEqual(
        new Date(to),
      );
    });

    it('should clamp month-end overflow instead of spilling into March', () => {
      expect(
        advanceNextRunAt(new Date('2026-01-31T09:00:00.000Z'), 'MONTHLY'),
      ).toEqual(new Date('2026-02-28T09:00:00.000Z'));
    });

    it('should clamp Feb 29 to Feb 28 in a non-leap year', () => {
      expect(
        advanceNextRunAt(new Date('2024-02-29T09:00:00.000Z'), 'YEARLY'),
      ).toEqual(new Date('2025-02-28T09:00:00.000Z'));
    });

    it.each([
      ['DAILY', '2026-12-31T09:00:00.000Z', '2027-01-01T09:00:00.000Z'],
      ['MONTHLY', '2026-12-15T09:00:00.000Z', '2027-01-15T09:00:00.000Z'],
      ['YEARLY', '2026-12-31T09:00:00.000Z', '2027-12-31T09:00:00.000Z'],
    ] as const)(
      'should roll over the year boundary for %s',
      (frequency, from, to) => {
        expect(advanceNextRunAt(new Date(from), frequency)).toEqual(
          new Date(to),
        );
      },
    );
  });

  describe('generateDueOccurrence', () => {
    it('should generate an EXPENSE occurrence and advance nextRunAt', async () => {
      const stored = { id: 'txn-1', recurringTransactionId: 'recurring-1' };

      prismaMock.recurringTransaction.findFirst.mockResolvedValue(
        baseSchedule,
      );
      txMock.account.findFirst.mockResolvedValue(ownedAccount);
      txMock.category.findFirst.mockResolvedValue(ownedCategory);
      txMock.transaction.create.mockResolvedValue(stored);

      const result = await service.generateDueOccurrence('recurring-1', now);

      expect(result).toEqual({ status: 'generated', transactions: [stored] });
      expect(txMock.transaction.create).toHaveBeenCalledWith({
        data: {
          userId: 'user-1',
          type: 'EXPENSE',
          amount: 2500,
          description: 'Monthly rent',
          accountId: 'account-1',
          categoryId: 'category-1',
          transactionDate: occurrence,
          recurringTransactionId: 'recurring-1',
          scheduledFor: occurrence,
        },
      });
      expect(txMock.recurringTransaction.update).toHaveBeenCalledWith({
        where: { id: 'recurring-1' },
        data: { nextRunAt: new Date('2026-12-01T09:00:00.000Z') },
      });
    });

    it('should generate an INCOME occurrence without a category', async () => {
      prismaMock.recurringTransaction.findFirst.mockResolvedValue({
        ...baseSchedule,
        type: 'INCOME',
        categoryId: null,
      });
      txMock.account.findFirst.mockResolvedValue(ownedAccount);
      txMock.transaction.create.mockResolvedValue({ id: 'txn-1' });

      const result = await service.generateDueOccurrence('recurring-1', now);

      expect(result.status).toBe('generated');
      expect(txMock.category.findFirst).not.toHaveBeenCalled();
      expect(txMock.transaction.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ type: 'INCOME', categoryId: null }),
      });
    });

    it('should generate a TRANSFER pair sharing a group id', async () => {
      prismaMock.recurringTransaction.findFirst.mockResolvedValue({
        ...baseSchedule,
        type: 'TRANSFER',
        accountId: null,
        categoryId: null,
        fromAccountId: 'account-1',
        toAccountId: 'account-2',
      });
      txMock.account.findFirst
        .mockResolvedValueOnce(ownedAccount)
        .mockResolvedValueOnce(destinationAccount);
      txMock.transaction.create
        .mockResolvedValueOnce({ id: 'txn-out' })
        .mockResolvedValueOnce({ id: 'txn-in' });

      const result = await service.generateDueOccurrence('recurring-1', now);

      expect(result).toEqual({
        status: 'generated',
        transactions: [{ id: 'txn-out' }, { id: 'txn-in' }],
      });

      const outgoing = txMock.transaction.create.mock.calls[0][0].data;
      const incoming = txMock.transaction.create.mock.calls[1][0].data;
      // Identity lives on the outgoing leg; the incoming leg links back with
      // NULL scheduledFor (NULLs stay distinct under the unique constraint).
      expect(outgoing).toMatchObject({
        accountId: 'account-1',
        recurringTransactionId: 'recurring-1',
        scheduledFor: occurrence,
      });
      expect(incoming).toMatchObject({
        accountId: 'account-2',
        recurringTransactionId: 'recurring-1',
        scheduledFor: null,
      });
      expect(outgoing.transferGroupId).toEqual(incoming.transferGroupId);
      expect(txMock.recurringTransaction.update).toHaveBeenCalledTimes(1);
    });

    it('should throw NotFoundException for a missing schedule', async () => {
      prismaMock.recurringTransaction.findFirst.mockResolvedValue(null);

      await expect(
        service.generateDueOccurrence('missing', now),
      ).rejects.toThrow(NotFoundException);

      expect(prismaMock.$transaction).not.toHaveBeenCalled();
    });

    it('should report inactive instead of throwing for a paused schedule', async () => {
      prismaMock.recurringTransaction.findFirst.mockResolvedValue({
        ...baseSchedule,
        isActive: false,
      });

      await expect(
        service.generateDueOccurrence('recurring-1', now),
      ).resolves.toEqual({ status: 'inactive' });

      expect(prismaMock.$transaction).not.toHaveBeenCalled();
    });

    it('should report not-due instead of throwing for a future schedule', async () => {
      prismaMock.recurringTransaction.findFirst.mockResolvedValue({
        ...baseSchedule,
        nextRunAt: new Date('2026-12-01T09:00:00.000Z'),
      });

      await expect(
        service.generateDueOccurrence('recurring-1', now),
      ).resolves.toEqual({ status: 'not-due' });

      expect(prismaMock.$transaction).not.toHaveBeenCalled();
    });

    it('should observe a pause made after the initial read', async () => {
      prismaMock.recurringTransaction.findFirst.mockResolvedValue(
        baseSchedule,
      );
      txMock.recurringTransaction.findFirst.mockResolvedValue({
        ...baseSchedule,
        isActive: false,
      });

      await expect(
        service.generateDueOccurrence('recurring-1', now),
      ).resolves.toEqual({ status: 'inactive' });

      expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
      expect(txMock.transaction.create).not.toHaveBeenCalled();
      expect(txMock.recurringTransaction.update).not.toHaveBeenCalled();
    });

    it('should observe an advancement made after the initial read', async () => {
      prismaMock.recurringTransaction.findFirst.mockResolvedValue(
        baseSchedule,
      );
      txMock.recurringTransaction.findFirst.mockResolvedValue({
        ...baseSchedule,
        nextRunAt: new Date('2026-12-01T09:00:00.000Z'),
      });

      await expect(
        service.generateDueOccurrence('recurring-1', now),
      ).resolves.toEqual({ status: 'not-due' });

      expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
      expect(txMock.transaction.create).not.toHaveBeenCalled();
      expect(txMock.recurringTransaction.update).not.toHaveBeenCalled();
    });

    it('should fail the occurrence when the account was archived', async () => {
      prismaMock.recurringTransaction.findFirst.mockResolvedValue(
        baseSchedule,
      );
      txMock.account.findFirst.mockResolvedValue(null);

      await expect(
        service.generateDueOccurrence('recurring-1', now),
      ).rejects.toThrow(NotFoundException);

      expect(txMock.account.findFirst).toHaveBeenCalledWith({
        where: { id: 'account-1', userId: 'user-1', isArchived: false },
      });
      // Rolled back: nothing created, nextRunAt never advanced.
      expect(txMock.transaction.create).not.toHaveBeenCalled();
      expect(txMock.recurringTransaction.update).not.toHaveBeenCalled();
    });

    it('should not advance the schedule when the occurrence write fails mid-transaction', async () => {
      prismaMock.recurringTransaction.findFirst.mockResolvedValue(
        baseSchedule,
      );
      txMock.account.findFirst.mockResolvedValue(ownedAccount);
      txMock.category.findFirst.mockResolvedValue(ownedCategory);
      txMock.transaction.create.mockRejectedValueOnce(new Error('db down'));

      await expect(
        service.generateDueOccurrence('recurring-1', now),
      ).rejects.toThrow('db down');

      // Mid-transaction failure: rolled back, never advanced, no duplicate lookup.
      expect(txMock.recurringTransaction.update).not.toHaveBeenCalled();
      expect(prismaMock.transaction.findMany).not.toHaveBeenCalled();
    });

    it('should return the existing occurrence when losing a generation race', async () => {
      const winner = {
        id: 'txn-winner',
        recurringTransactionId: 'recurring-1',
        scheduledFor: occurrence,
      };

      prismaMock.recurringTransaction.findFirst.mockResolvedValue(
        baseSchedule,
      );
      prismaMock.$transaction.mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError(
          'Unique constraint failed on the fields: (`recurringTransactionId`,`scheduledFor`)',
          { code: 'P2002', clientVersion: '7.10.0' },
        ),
      );
      prismaMock.transaction.findMany.mockResolvedValue([winner]);

      const result = await service.generateDueOccurrence('recurring-1', now);

      expect(result).toEqual({
        status: 'already-generated',
        transactions: [winner],
      });
      expect(prismaMock.transaction.findMany).toHaveBeenCalledWith({
        where: { recurringTransactionId: 'recurring-1', scheduledFor: occurrence },
      });
    });

    it('should rethrow non-unique transaction failures', async () => {
      prismaMock.recurringTransaction.findFirst.mockResolvedValue(
        baseSchedule,
      );
      prismaMock.$transaction.mockRejectedValueOnce(new Error('db down'));

      await expect(
        service.generateDueOccurrence('recurring-1', now),
      ).rejects.toThrow('db down');

      expect(prismaMock.transaction.findMany).not.toHaveBeenCalled();
    });
  });

  describe('generateDueOccurrences', () => {
    let currentNextRunAt: Date;
    let createdScheduledFors: Date[];

    // Simulates real chaining: re-reads observe currentNextRunAt, creates record
    // scheduledFor, advancements persist. The pre-read stub stays fixed to prove
    // the loop tolerates staleness (the in-transaction re-read is authoritative).
    function chainSchedule(start: Date): void {
      currentNextRunAt = new Date(start);
      createdScheduledFors = [];
      prismaMock.recurringTransaction.findFirst.mockResolvedValue({
        ...baseSchedule,
        nextRunAt: new Date(start),
      });
      txMock.recurringTransaction.findFirst.mockImplementation(async () => ({
        ...baseSchedule,
        nextRunAt: currentNextRunAt,
      }));
      txMock.account.findFirst.mockResolvedValue(ownedAccount);
      txMock.category.findFirst.mockResolvedValue(ownedCategory);
      txMock.transaction.create.mockImplementation(
        async ({ data }: { data: { scheduledFor: Date } }) => {
          createdScheduledFors.push(new Date(data.scheduledFor));
          return { id: `txn-${createdScheduledFors.length}` };
        },
      );
      txMock.recurringTransaction.update.mockImplementation(
        async ({ data }: { data: { nextRunAt: Date } }) => {
          currentNextRunAt = new Date(data.nextRunAt);
          return { ...baseSchedule, nextRunAt: currentNextRunAt };
        },
      );
    }

    function statuses(
      outcomes: Array<{ status: string }>,
    ): string[] {
      return outcomes.map((outcome) => outcome.status);
    }

    it('should generate one missed occurrence', async () => {
      chainSchedule(new Date('2026-01-01T09:00:00.000Z'));

      // Inclusive due-ness: January generates, February stays future.
      const outcomes = await service.generateDueOccurrences(
        'recurring-1',
        new Date('2026-01-15T09:00:00.000Z'),
        10,
      );

      expect(statuses(outcomes)).toEqual(['generated', 'not-due']);
      expect(createdScheduledFors).toEqual([
        new Date('2026-01-01T09:00:00.000Z'),
      ]);
      expect(currentNextRunAt).toEqual(new Date('2026-02-01T09:00:00.000Z'));
    });

    it('should generate multiple missed occurrences', async () => {
      chainSchedule(new Date('2026-01-01T09:00:00.000Z'));

      const outcomes = await service.generateDueOccurrences(
        'recurring-1',
        new Date('2026-04-10T09:00:00.000Z'),
        10,
      );

      expect(statuses(outcomes)).toEqual([
        'generated',
        'generated',
        'generated',
        'generated',
        'not-due',
      ]);
      expect(createdScheduledFors).toEqual([
        new Date('2026-01-01T09:00:00.000Z'),
        new Date('2026-02-01T09:00:00.000Z'),
        new Date('2026-03-01T09:00:00.000Z'),
        new Date('2026-04-01T09:00:00.000Z'),
      ]);
      expect(currentNextRunAt).toEqual(new Date('2026-05-01T09:00:00.000Z'));
    });

    it('should generate an exactly-on-time occurrence', async () => {
      chainSchedule(new Date('2026-11-01T09:00:00.000Z'));

      const outcomes = await service.generateDueOccurrences(
        'recurring-1',
        new Date('2026-11-01T09:00:00.000Z'),
        10,
      );

      // Inclusive: nextRunAt <= now generates.
      expect(statuses(outcomes)).toEqual(['generated', 'not-due']);
      expect(createdScheduledFors).toHaveLength(1);
    });

    it('should not generate for a future schedule', async () => {
      chainSchedule(new Date('2026-12-01T09:00:00.000Z'));

      const outcomes = await service.generateDueOccurrences(
        'recurring-1',
        new Date('2026-11-01T09:00:00.000Z'),
        10,
      );

      expect(outcomes).toEqual([{ status: 'not-due' }]);
      expect(txMock.transaction.create).not.toHaveBeenCalled();
      expect(txMock.recurringTransaction.update).not.toHaveBeenCalled();
    });

    it('should stop at the catch-up limit and continue on a later run', async () => {
      chainSchedule(new Date('2026-01-01T09:00:00.000Z'));
      const sweepTime = new Date('2026-06-01T09:00:00.000Z');

      const first = await service.generateDueOccurrences(
        'recurring-1',
        sweepTime,
        2,
      );

      // Capped with no terminal element; a later sweep continues from here.
      expect(statuses(first)).toEqual(['generated', 'generated']);
      expect(createdScheduledFors).toEqual([
        new Date('2026-01-01T09:00:00.000Z'),
        new Date('2026-02-01T09:00:00.000Z'),
      ]);
      expect(currentNextRunAt).toEqual(new Date('2026-03-01T09:00:00.000Z'));

      const second = await service.generateDueOccurrences(
        'recurring-1',
        sweepTime,
        10,
      );

      // June 1 equals sweep time, so it generates too; next run is July 1.
      expect(statuses(second)).toEqual([
        'generated',
        'generated',
        'generated',
        'generated',
        'not-due',
      ]);
      expect(createdScheduledFors).toEqual([
        new Date('2026-01-01T09:00:00.000Z'),
        new Date('2026-02-01T09:00:00.000Z'),
        new Date('2026-03-01T09:00:00.000Z'),
        new Date('2026-04-01T09:00:00.000Z'),
        new Date('2026-05-01T09:00:00.000Z'),
        new Date('2026-06-01T09:00:00.000Z'),
      ]);
      expect(currentNextRunAt).toEqual(new Date('2026-07-01T09:00:00.000Z'));
    });

    it('should record a duplicate retry without duplicating the record', async () => {
      chainSchedule(new Date('2026-01-01T09:00:00.000Z'));
      const february = new Date('2026-02-01T09:00:00.000Z');
      const winner = { id: 'txn-feb', scheduledFor: february };

      // Only February collides; the winner's commit (and advancement) is what
      // the next in-transaction re-read observes.
      txMock.transaction.create.mockImplementation(
        async ({ data }: { data: { scheduledFor: Date } }) => {
          if (new Date(data.scheduledFor).getTime() === february.getTime()) {
            currentNextRunAt = new Date('2026-03-01T09:00:00.000Z');
            throw new Prisma.PrismaClientKnownRequestError(
              'Unique constraint failed on the fields: (`recurringTransactionId`,`scheduledFor`)',
              { code: 'P2002', clientVersion: '7.10.0' },
            );
          }
          createdScheduledFors.push(new Date(data.scheduledFor));
          return { id: `txn-${createdScheduledFors.length}` };
        },
      );
      prismaMock.transaction.findMany.mockResolvedValue([winner]);

      const outcomes = await service.generateDueOccurrences(
        'recurring-1',
        new Date('2026-03-15T09:00:00.000Z'),
        10,
      );

      // February's row is returned as-is; the loop still generates March.
      expect(statuses(outcomes)).toEqual([
        'generated',
        'already-generated',
        'generated',
        'not-due',
      ]);
      expect(outcomes[1]).toEqual({
        status: 'already-generated',
        transactions: [winner],
      });
      expect(prismaMock.transaction.findMany).toHaveBeenCalledWith({
        where: { recurringTransactionId: 'recurring-1', scheduledFor: february },
      });
      expect(createdScheduledFors).toEqual([
        new Date('2026-01-01T09:00:00.000Z'),
        new Date('2026-03-01T09:00:00.000Z'),
      ]);
      expect(currentNextRunAt).toEqual(new Date('2026-04-01T09:00:00.000Z'));
    });

    it('should keep one occurrence per month across month-end boundaries', async () => {
      chainSchedule(new Date('2026-01-31T09:00:00.000Z'));

      const outcomes = await service.generateDueOccurrences(
        'recurring-1',
        new Date('2026-04-15T09:00:00.000Z'),
        10,
      );

      // Iterative clamping drifts by design (Jan 31 → Feb 28 → Mar 28), but each
      // month still yields exactly one occurrence.
      expect(statuses(outcomes)).toEqual([
        'generated',
        'generated',
        'generated',
        'not-due',
      ]);
      expect(createdScheduledFors).toEqual([
        new Date('2026-01-31T09:00:00.000Z'),
        new Date('2026-02-28T09:00:00.000Z'),
        new Date('2026-03-28T09:00:00.000Z'),
      ]);
      expect(currentNextRunAt).toEqual(new Date('2026-04-28T09:00:00.000Z'));
    });

    it('should step yearly across leap boundaries', async () => {
      chainSchedule(new Date('2024-02-29T09:00:00.000Z'));
      prismaMock.recurringTransaction.findFirst.mockResolvedValue({
        ...baseSchedule,
        frequency: 'YEARLY',
        nextRunAt: new Date('2024-02-29T09:00:00.000Z'),
      });
      txMock.recurringTransaction.findFirst.mockImplementation(async () => ({
        ...baseSchedule,
        frequency: 'YEARLY',
        nextRunAt: currentNextRunAt,
      }));

      const outcomes = await service.generateDueOccurrences(
        'recurring-1',
        new Date('2026-03-01T09:00:00.000Z'),
        10,
      );

      expect(statuses(outcomes)).toEqual([
        'generated',
        'generated',
        'generated',
        'not-due',
      ]);
      expect(createdScheduledFors).toEqual([
        new Date('2024-02-29T09:00:00.000Z'),
        new Date('2025-02-28T09:00:00.000Z'),
        new Date('2026-02-28T09:00:00.000Z'),
      ]);
      expect(currentNextRunAt).toEqual(new Date('2027-02-28T09:00:00.000Z'));
    });
  });
});
