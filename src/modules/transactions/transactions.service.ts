import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../database/prisma.service.js';
import { CreateTransactionDto } from './dto/create-transaction.dto.js';
import { UpdateTransactionDto } from './dto/update-transaction.dto.js';
import { TransactionQueryDto } from './dto/transaction-query.dto.js';

@Injectable()
export class TransactionsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, dto: CreateTransactionDto) {
    if (dto.type === 'TRANSFER') {
      return this.createTransfer(userId, dto);
    }

    return this.createSingle(userId, dto);
  }

  async findAll(userId: string, query: TransactionQueryDto) {
    const {
      page,
      limit,
      type,
      accountId,
      categoryId,
      dateFrom,
      dateTo,
      search,
      sortBy,
      sortOrder,
    } = query;

    const where = {
      userId,
      deletedAt: null,
      ...(type ? { type } : {}),
      ...(accountId ? { accountId } : {}),
      ...(categoryId ? { categoryId } : {}),
      ...(dateFrom || dateTo
        ? {
            transactionDate: {
              ...(dateFrom ? { gte: dateFrom } : {}),
              ...(dateTo ? { lte: dateTo } : {}),
            },
          }
        : {}),
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

    const [transactions, total] = await Promise.all([
      this.prisma.transaction.findMany({
        where,
        skip,
        take: limit,
        orderBy: {
          [sortBy]: sortOrder,
        },
      }),

      this.prisma.transaction.count({
        where,
      }),
    ]);

    return {
      transactions,
      total,
    };
  }

  async findOne(userId: string, id: string) {
    const transaction = await this.prisma.transaction.findFirst({
      where: {
        id,
        userId,
        deletedAt: null,
      },
    });

    if (!transaction) {
      throw new NotFoundException('Transaction not found');
    }

    return transaction;
  }

  async update(userId: string, id: string, dto: UpdateTransactionDto) {
    const transaction = await this.prisma.transaction.findFirst({
      where: {
        id,
        userId,
        deletedAt: null,
      },
    });

    if (!transaction) {
      throw new NotFoundException('Transaction not found');
    }

    if (transaction.type === 'TRANSFER') {
      throw new BadRequestException('Transfer transactions cannot be updated');
    }

    if (dto.accountId) {
      await this.validateAccount(userId, dto.accountId);
    }

    if (dto.categoryId) {
      await this.validateCategory(userId, dto.categoryId);
    }

    return this.prisma.transaction.update({
      where: {
        id,
      },
      data: {
        ...dto,
      },
    });
  }

  async archive(userId: string, id: string) {
    const transaction = await this.prisma.transaction.findFirst({
      where: {
        id,
        userId,
        deletedAt: null,
      },
    });

    if (!transaction) {
      throw new NotFoundException('Transaction not found');
    }

    const deletedAt = new Date();

    if (transaction.transferGroupId) {
      await this.prisma.transaction.updateMany({
        where: {
          transferGroupId: transaction.transferGroupId,
          userId,
          deletedAt: null,
        },
        data: {
          deletedAt,
        },
      });

      return this.prisma.transaction.findMany({
        where: {
          transferGroupId: transaction.transferGroupId,
          userId,
        },
      });
    }

    return this.prisma.transaction.update({
      where: {
        id,
      },
      data: {
        deletedAt,
      },
    });
  }

  private async createSingle(userId: string, dto: CreateTransactionDto) {
    await this.validateNormalTransaction(userId, dto);

    return this.prisma.transaction.create({
      data: {
        userId,
        type: dto.type,
        amount: dto.amount,
        transactionDate: dto.transactionDate,
        description: dto.description,
        accountId: dto.accountId,
        categoryId: dto.categoryId ?? null,
      },
    });
  }

  private async createTransfer(
    userId: string,
    dto: CreateTransactionDto,
  ) {
    const { fromAccount, toAccount } = await this.validateTransferAccounts(
      userId,
      dto.accountId,
      dto.toAccountId,
    );

    const transferGroupId = randomUUID();

    const base = {
      userId,
      type: 'TRANSFER' as const,
      amount: dto.amount,
      transactionDate: dto.transactionDate,
      description: dto.description,
      categoryId: null,
      transferGroupId,
      fromAccountId: fromAccount.id,
      toAccountId: toAccount.id,
    };

    const [outgoing, incoming] = await this.prisma.$transaction([
      this.prisma.transaction.create({
        data: { ...base, accountId: fromAccount.id },
      }),
      this.prisma.transaction.create({
        data: { ...base, accountId: toAccount.id },
      }),
    ]);

    return [outgoing, incoming];
  }

  private async validateNormalTransaction(
    userId: string,
    dto: CreateTransactionDto,
  ) {
    await this.validateAccount(userId, dto.accountId);

    if (dto.categoryId) {
      await this.validateCategory(userId, dto.categoryId);
    }
  }

  private async validateTransferAccounts(
    userId: string,
    accountId: string,
    toAccountId: string | undefined,
  ) {
    if (!toAccountId) {
      throw new BadRequestException(
        'toAccountId is required for transfers',
      );
    }

    if (accountId === toAccountId) {
      throw new BadRequestException(
        'Transfer source and destination must be different',
      );
    }

    const [fromAccount, toAccount] = await Promise.all([
      this.validateAccount(userId, accountId),
      this.validateAccount(userId, toAccountId),
    ]);

    return { fromAccount, toAccount };
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
