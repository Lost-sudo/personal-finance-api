import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import { CreateAccountDto } from './dto/create-account.dto.js';
import { UpdateAccountDto } from './dto/update-account.dto.js';
import { AccountQueryDto } from './dto/account-query.dto.js';
import { AccountTransactionsQueryDto } from './dto/account-transactions-query.dto.js';

@Injectable()
export class AccountsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, dto: CreateAccountDto) {
    const existingAccount = await this.prisma.account.findUnique({
      where: {
        userId_name: {
          userId,
          name: dto.name,
        },
      },
    });

    if (existingAccount) {
      throw new ConflictException('An account with this name already exists');
    }

    return this.prisma.account.create({
      data: {
        userId,
        name: dto.name,
        type: dto.type,
        currency: dto.currency,
        initialBalance: dto.initialBalance,
      },
    });
  }

  async findAll(userId: string, query: AccountQueryDto) {
    const { page, limit, type, search, sortBy, sortOrder } = query;

    const where = {
      userId,
      isArchived: false,
      ...(type ? { type } : {}),
      ...(search
        ? {
            name: {
              contains: search,
              mode: 'insensitive' as const,
            },
          }
        : {}),
    };

    const skip = (page - 1) * limit;

    const [accounts, total] = await Promise.all([
      this.prisma.account.findMany({
        where,
        skip,
        take: limit,
        orderBy: {
          [sortBy]: sortOrder,
        },
      }),

      this.prisma.account.count({
        where,
      }),
    ]);

    return {
      accounts,
      total,
    };
  }

  async findOne(userId: string, id: string) {
    const account = await this.prisma.account.findFirst({
      where: {
        id,
        userId,
        isArchived: false,
      },
    });

    if (!account) {
      throw new NotFoundException('Account not found');
    }

    return account;
  }

  async update(userId: string, id: string, dto: UpdateAccountDto) {
    const account = await this.prisma.account.findFirst({
      where: {
        id,
        userId,
        isArchived: false,
      },
    });

    if (!account) {
      throw new NotFoundException('Account not found');
    }

    const name = dto.name ?? account.name;

    const duplicate = await this.prisma.account.findFirst({
      where: {
        userId,
        name,
        isArchived: false,
        NOT: {
          id,
        },
      },
    });

    if (duplicate) {
      throw new ConflictException('An account with this name already exists');
    }

    return this.prisma.account.update({
      where: {
        id,
      },
      data: {
        ...dto,
      },
    });
  }

  async archive(userId: string, id: string) {
    const account = await this.prisma.account.findFirst({
      where: {
        id,
        userId,
        isArchived: false,
      },
    });

    if (!account) {
      throw new NotFoundException('Account not found');
    }

    return this.prisma.account.update({
      where: {
        id,
      },
      data: {
        isArchived: true,
      },
    });
  }

  async getBalance(userId: string, accountId: string) {
    const account = await this.findOne(userId, accountId);

    const transactions = await this.prisma.transaction.findMany({
      where: {
        userId,
        deletedAt: null,
        OR: [
          { accountId },
          { fromAccountId: accountId },
          { toAccountId: accountId },
        ],
      },
    });

    let income = new Prisma.Decimal(0);
    let expenses = new Prisma.Decimal(0);
    let incomingTransfers = new Prisma.Decimal(0);
    let outgoingTransfers = new Prisma.Decimal(0);

    for (const transaction of transactions) {
      // Transfers are stored as paired rows sharing a transferGroupId, so
      // the OR query above also surfaces the counterparty leg. Only the row
      // owned by this account contributes to its balance.
      if (transaction.accountId !== accountId) {
        continue;
      }

      const amount = new Prisma.Decimal(transaction.amount);

      if (transaction.type === 'INCOME') {
        income = income.plus(amount);
      } else if (transaction.type === 'EXPENSE') {
        expenses = expenses.plus(amount);
      } else if (transaction.type === 'TRANSFER') {
        if (transaction.fromAccountId === accountId) {
          outgoingTransfers = outgoingTransfers.plus(amount);
        } else if (transaction.toAccountId === accountId) {
          incomingTransfers = incomingTransfers.plus(amount);
        }
        // Transfer rows predating the direction migration carry null
        // from/to account ids and are excluded from both buckets.
      }
    }

    const initialBalance = new Prisma.Decimal(account.initialBalance);
    const balance = initialBalance
      .plus(income)
      .minus(expenses)
      .plus(incomingTransfers)
      .minus(outgoingTransfers);

    return {
      accountId: account.id,
      initialBalance: initialBalance.toFixed(2),
      income: income.toFixed(2),
      expenses: expenses.toFixed(2),
      incomingTransfers: incomingTransfers.toFixed(2),
      outgoingTransfers: outgoingTransfers.toFixed(2),
      balance: balance.toFixed(2),
    };
  }

  async findTransactions(
    userId: string,
    accountId: string,
    query: AccountTransactionsQueryDto,
  ) {
    await this.findOne(userId, accountId);

    const { page, limit, type, dateFrom, dateTo } = query;

    // Transfers are stored as paired rows sharing a transferGroupId, each
    // carrying its own accountId. Filtering on accountId therefore returns
    // exactly this account's legs (the from/to branches of the involvement
    // OR would only add the counterparty legs belonging to other accounts).
    const where = {
      userId,
      accountId,
      deletedAt: null,
      ...(type ? { type } : {}),
      ...(dateFrom || dateTo
        ? {
            transactionDate: {
              ...(dateFrom ? { gte: dateFrom } : {}),
              ...(dateTo ? { lte: dateTo } : {}),
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
        orderBy: [{ transactionDate: 'desc' }, { createdAt: 'desc' }],
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
}
