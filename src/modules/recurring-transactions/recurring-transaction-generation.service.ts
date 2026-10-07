import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../database/prisma.service.js';
import {
  Prisma,
  type RecurringTransaction,
  type Transaction,
} from '../../generated/prisma/client.js';
import { advanceNextRunAt } from './advance-next-run-at.util.js';
import { DEFAULT_GENERATION_CATCH_UP_LIMIT } from './recurring-transaction-scheduler.constants.js';

// Eligibility is explicit: 'generated'/'already-generated' are normal outcomes;
// only genuine failures throw.
export type GenerationResult =
  | { status: 'generated'; transactions: Transaction[] }
  | { status: 'already-generated'; transactions: Transaction[] }
  | { status: 'not-due' }
  | { status: 'inactive' };

// Schedule = template; Transaction = financial record. Correctness boundary:
//   BEGIN → re-read + verify due → INSERT (scheduledFor) → UPDATE nextRunAt → COMMIT
// Races resolve via re-read or the uniqueness guard (loser returns winner's row).
// Absolute UTC instants throughout; no scheduling here.
@Injectable()
export class RecurringTransactionGenerationService {
  // scheduleId is the log join key (random UUID); amounts, descriptions, and
  // account/category ids are never logged.
  private readonly logger = new Logger(
    RecurringTransactionGenerationService.name,
  );

  constructor(private readonly prisma: PrismaService) {}

  // Injected `now` keeps generation deterministic in tests.
  async generateDueOccurrence(
    scheduleId: string,
    now: Date = new Date(),
  ): Promise<GenerationResult> {
    const schedule = await this.prisma.recurringTransaction.findFirst({
      where: { id: scheduleId },
    });

    if (!schedule) {
      throw new NotFoundException('Recurring transaction not found');
    }

    this.logger.debug(
      `Generation attempt for schedule ${schedule.id} ` +
        `(occurrence ${schedule.nextRunAt.toISOString()}, ` +
        `${schedule.frequency})`,
    );

    // Fast path; authoritative check runs again inside the transaction.
    if (!schedule.isActive) {
      this.logger.debug(`Schedule ${schedule.id} is inactive; skipping`);
      return { status: 'inactive' };
    }

    if (schedule.nextRunAt > now) {
      this.logger.debug(
        `Schedule ${schedule.id} is not due ` +
          `(nextRunAt ${schedule.nextRunAt.toISOString()}); skipping`,
      );
      return { status: 'not-due' };
    }

    // Prefer the in-transaction occurrence for duplicate lookup; fall back to
    // the pre-read value when the transaction rejected before the insert ran.
    let attempted: Date = schedule.nextRunAt;

    try {
      const outcome = await this.prisma.$transaction(async (tx) => {
        // Authoritative re-check: decide on fresh state, atomically with the writes.
        const fresh = await tx.recurringTransaction.findFirst({
          where: { id: scheduleId },
        });

        if (!fresh) {
          throw new NotFoundException('Recurring transaction not found');
        }

        if (!fresh.isActive) {
          this.logger.debug(
            `Schedule ${scheduleId} became inactive; skipping`,
          );
          return { status: 'inactive' } as const;
        }

        if (fresh.nextRunAt > now) {
          this.logger.debug(
            `Schedule ${scheduleId} is no longer due; skipping`,
          );
          return { status: 'not-due' } as const;
        }

        const occurrence = fresh.nextRunAt;
        attempted = occurrence;

        const transactions =
          fresh.type === 'TRANSFER'
            ? await this.generateTransferOccurrence(tx, fresh, occurrence)
            : [await this.generateSingleOccurrence(tx, fresh, occurrence)];

        return { status: 'generated', transactions } as const;
      });

      if (outcome.status === 'generated') {
        // Same pure function and inputs as the committed advancement.
        const advancedTo = advanceNextRunAt(
          attempted,
          schedule.frequency,
        ).toISOString();
        this.logger.log(
          `Generated occurrence for schedule ${schedule.id} ` +
            `(scheduledFor ${attempted.toISOString()}, ` +
            `nextRunAt advanced to ${advancedTo})`,
        );
      }

      return outcome;
    } catch (error) {
      // Lost race: return the winner's row; our transaction already rolled back.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const existing = await this.prisma.transaction.findMany({
          where: {
            recurringTransactionId: schedule.id,
            scheduledFor: attempted,
          },
        });

        if (existing.length > 0) {
          this.logger.debug(
            `Occurrence for schedule ${schedule.id} ` +
              `(scheduledFor ${attempted.toISOString()}) already generated; ` +
              'returning the existing record',
          );
          return { status: 'already-generated', transactions: existing };
        }
      }

      this.logger.error(
        `Generation failed for schedule ${schedule.id}: ` +
          `${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
  }

  // Generates every occurrence due at `now`, one atomic step each, up to `limit`.
  // Iterations consume a slot on generated/already-generated and stop on
  // not-due/inactive (terminal outcome included); `now` stays fixed.
  async generateDueOccurrences(
    scheduleId: string,
    now: Date = new Date(),
    limit: number = DEFAULT_GENERATION_CATCH_UP_LIMIT,
  ): Promise<GenerationResult[]> {
    const outcomes: GenerationResult[] = [];
    let consumed = 0;

    while (consumed < limit) {
      const result = await this.generateDueOccurrence(scheduleId, now);
      outcomes.push(result);

      if (result.status !== 'generated' && result.status !== 'already-generated') {
        break;
      }

      consumed += 1;
    }

    return outcomes;
  }

  private async generateSingleOccurrence(
    tx: Prisma.TransactionClient,
    schedule: RecurringTransaction,
    occurrence: Date,
  ): Promise<Transaction> {
    if (!schedule.accountId) {
      throw new BadRequestException('accountId is required for schedules');
    }

    await this.validateAccount(tx, schedule.userId, schedule.accountId);

    if (schedule.categoryId) {
      await this.validateCategory(tx, schedule.userId, schedule.categoryId);
    }

    const transaction = await tx.transaction.create({
      data: {
        userId: schedule.userId,
        type: schedule.type,
        amount: schedule.amount,
        description: schedule.description,
        accountId: schedule.accountId,
        categoryId: schedule.categoryId,
        transactionDate: occurrence,
        recurringTransactionId: schedule.id,
        scheduledFor: occurrence,
      },
    });

    await this.advanceSchedule(tx, schedule, occurrence);

    return transaction;
  }

  private async generateTransferOccurrence(
    tx: Prisma.TransactionClient,
    schedule: RecurringTransaction,
    occurrence: Date,
  ): Promise<Transaction[]> {
    if (!schedule.fromAccountId || !schedule.toAccountId) {
      throw new BadRequestException(
        'fromAccountId and toAccountId are required for transfer schedules',
      );
    }

    const [fromAccount, toAccount] = await Promise.all([
      this.validateAccount(tx, schedule.userId, schedule.fromAccountId),
      this.validateAccount(tx, schedule.userId, schedule.toAccountId),
    ]);

    if (schedule.categoryId) {
      await this.validateCategory(tx, schedule.userId, schedule.categoryId);
    }

    // Transfer pair shares transferGroupId. Only the outgoing leg carries
    // (recurringTransactionId, scheduledFor) — NULL scheduledFors stay distinct.
    // A schedule-level categoryId is copied faithfully onto both legs.
    const transferGroupId = randomUUID();
    const base = {
      userId: schedule.userId,
      type: 'TRANSFER' as const,
      amount: schedule.amount,
      description: schedule.description,
      categoryId: schedule.categoryId,
      transactionDate: occurrence,
      transferGroupId,
      fromAccountId: fromAccount.id,
      toAccountId: toAccount.id,
      recurringTransactionId: schedule.id,
    };

    const outgoing = await tx.transaction.create({
      data: { ...base, accountId: fromAccount.id, scheduledFor: occurrence },
    });
    const incoming = await tx.transaction.create({
      data: { ...base, accountId: toAccount.id, scheduledFor: null },
    });

    await this.advanceSchedule(tx, schedule, occurrence);

    return [outgoing, incoming];
  }

  private async advanceSchedule(
    tx: Prisma.TransactionClient,
    schedule: RecurringTransaction,
    occurrence: Date,
  ): Promise<void> {
    await tx.recurringTransaction.update({
      where: { id: schedule.id },
      data: {
        nextRunAt: advanceNextRunAt(occurrence, schedule.frequency),
      },
    });
  }

  private async validateAccount(
    tx: Prisma.TransactionClient,
    userId: string,
    accountId: string,
  ) {
    const account = await tx.account.findFirst({
      where: { id: accountId, userId, isArchived: false },
    });

    if (!account) {
      throw new NotFoundException('Account not found');
    }

    return account;
  }

  private async validateCategory(
    tx: Prisma.TransactionClient,
    userId: string,
    categoryId: string,
  ) {
    const category = await tx.category.findFirst({
      where: { id: categoryId, userId, isArchived: false },
    });

    if (!category) {
      throw new NotFoundException('Category not found');
    }

    return category;
  }
}
