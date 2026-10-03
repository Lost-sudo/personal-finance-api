import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import { CreateAccountDto } from './dto/create-account.dto.js';
import { UpdateAccountDto } from './dto/update-account.dto.js';
import { AccountQueryDto } from './dto/account-query.dto.js';

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
}
