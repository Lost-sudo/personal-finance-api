import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import { CreateRecurringTransactionDto } from './dto/create-recurring-transaction.dto.js';
import { UpdateRecurringTransactionDto } from './dto/update-recurring-transaction.dto.js';
import { RecurringTransactionQueryDto } from './dto/recurring-transaction-query.dto.js';

// Client sort keys are whitelisted (also enforced by Zod), so arbitrary field
// names never reach Prisma.
const recurringTransactionSortFields = {
  nextRunAt: 'nextRunAt',
  amount: 'amount',
  createdAt: 'createdAt',
} as const satisfies Record<
  RecurringTransactionQueryDto['sortBy'],
  keyof Prisma.RecurringTransactionOrderByWithRelationInput
>;

@Injectable()
export class RecurringTransactionsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, dto: CreateRecurringTransactionDto) {
    if (dto.type === 'TRANSFER') {
      return this.createTransferSchedule(userId, dto);
    }

    return this.createSingleSchedule(userId, dto);
  }

  async findAll(userId: string, query: RecurringTransactionQueryDto) {
    const {
      page,
      limit,
      type,
      frequency,
      accountId,
      isActive,
      search,
      sortBy,
      sortOrder,
    } = query;

    const where = {
      userId,
      ...(type ? { type } : {}),
      ...(frequency ? { frequency } : {}),
      // Match normal schedules via accountId plus both sides of transfers.
      ...(accountId
        ? {
            OR: [
              { accountId },
              { fromAccountId: accountId },
              { toAccountId: accountId },
            ],
          }
        : {}),
      ...(isActive !== undefined ? { isActive } : {}),
      ...(search
        ? {
            description: {
              contains: search,
              mode: 'insensitive' as const,
            },
          }
        : {}),
    };

    const skip = (page - 1) * limit;

    // Secondary id ordering keeps pagination stable on tied sort values.
    const orderBy: Prisma.RecurringTransactionOrderByWithRelationInput[] = [
      { [recurringTransactionSortFields[sortBy]]: sortOrder },
      { id: 'asc' },
    ];

    const [recurringTransactions, total] = await Promise.all([
      this.prisma.recurringTransaction.findMany({
        where,
        skip,
        take: limit,
        orderBy,
      }),

      this.prisma.recurringTransaction.count({
        where,
      }),
    ]);

    return {
      recurringTransactions,
      total,
    };
  }

  async findOne(userId: string, id: string) {
    const schedule = await this.prisma.recurringTransaction.findFirst({
      where: {
        id,
        userId,
      },
    });

    if (!schedule) {
      throw new NotFoundException('Recurring transaction not found');
    }

    return schedule;
  }

  async update(
    userId: string,
    id: string,
    dto: UpdateRecurringTransactionDto,
  ) {
    const schedule = await this.prisma.recurringTransaction.findFirst({
      where: {
        id,
        userId,
      },
    });

    if (!schedule) {
      throw new NotFoundException('Recurring transaction not found');
    }

    if (dto.accountId) {
      await this.validateAccount(userId, dto.accountId);
    }

    if (dto.categoryId) {
      await this.validateCategory(userId, dto.categoryId);
    }

    if (dto.fromAccountId) {
      await this.validateAccount(userId, dto.fromAccountId);
    }

    if (dto.toAccountId) {
      await this.validateAccount(userId, dto.toAccountId);
    }

    if (schedule.type === 'TRANSFER') {
      const fromAccountId = dto.fromAccountId ?? schedule.fromAccountId;
      const toAccountId = dto.toAccountId ?? schedule.toAccountId;

      if (fromAccountId && toAccountId && fromAccountId === toAccountId) {
        throw new BadRequestException(
          'Transfer source and destination must be different',
        );
      }
    }

    return this.prisma.recurringTransaction.update({
      where: {
        id,
      },
      data: {
        ...dto,
      },
    });
  }

  async remove(userId: string, id: string) {
    const schedule = await this.prisma.recurringTransaction.findFirst({
      where: {
        id,
        userId,
      },
    });

    if (!schedule) {
      throw new NotFoundException('Recurring transaction not found');
    }

    // Generated rows survive via onDelete: SetNull; only the schedule row is removed.
    return this.prisma.recurringTransaction.delete({
      where: {
        id,
      },
    });
  }

  private async createSingleSchedule(
    userId: string,
    dto: CreateRecurringTransactionDto,
  ) {
    if (!dto.accountId) {
      throw new BadRequestException('accountId is required for schedules');
    }

    await this.validateAccount(userId, dto.accountId);

    if (dto.categoryId) {
      await this.validateCategory(userId, dto.categoryId);
    }

    return this.prisma.recurringTransaction.create({
      data: {
        userId,
        type: dto.type,
        amount: dto.amount,
        description: dto.description,
        accountId: dto.accountId,
        categoryId: dto.categoryId ?? null,
        fromAccountId: dto.fromAccountId ?? null,
        toAccountId: dto.toAccountId ?? null,
        frequency: dto.frequency,
        nextRunAt: dto.nextRunAt,
      },
    });
  }

  private async createTransferSchedule(
    userId: string,
    dto: CreateRecurringTransactionDto,
  ) {
    if (!dto.fromAccountId || !dto.toAccountId) {
      throw new BadRequestException(
        'fromAccountId and toAccountId are required for transfer schedules',
      );
    }

    if (dto.fromAccountId === dto.toAccountId) {
      throw new BadRequestException(
        'Transfer source and destination must be different',
      );
    }

    const [fromAccount, toAccount] = await Promise.all([
      this.validateAccount(userId, dto.fromAccountId),
      this.validateAccount(userId, dto.toAccountId),
    ]);

    if (dto.categoryId) {
      await this.validateCategory(userId, dto.categoryId);
    }

    return this.prisma.recurringTransaction.create({
      data: {
        userId,
        type: 'TRANSFER',
        amount: dto.amount,
        description: dto.description,
        accountId: dto.accountId ?? null,
        categoryId: dto.categoryId ?? null,
        fromAccountId: fromAccount.id,
        toAccountId: toAccount.id,
        frequency: dto.frequency,
        nextRunAt: dto.nextRunAt,
      },
    });
  }

  private async validateAccount(userId: string, accountId: string) {
    const account = await this.prisma.account.findFirst({
      where: {
        id: accountId,
        userId,
        isArchived: false,
      },
    });

    if (!account) {
      throw new NotFoundException('Account not found');
    }

    return account;
  }

  private async validateCategory(userId: string, categoryId: string) {
    const category = await this.prisma.category.findFirst({
      where: {
        id: categoryId,
        userId,
        isArchived: false,
      },
    });

    if (!category) {
      throw new NotFoundException('Category not found');
    }

    return category;
  }
}
