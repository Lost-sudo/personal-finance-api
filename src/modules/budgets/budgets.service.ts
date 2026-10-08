import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import { CreateBudgetDto } from './dto/create-budget.dto.js';
import { UpdateBudgetDto } from './dto/update-budget.dto.js';
import { BudgetQueryDto } from './dto/budget-query.dto.js';

// Whitelist mapping client sort keys to Prisma fields. Client input can only
// ever select one of these keys (also enforced by the Zod query schema), so
// arbitrary field names never reach Prisma.
const budgetSortFields = {
  startDate: 'startDate',
  amount: 'amount',
  createdAt: 'createdAt',
} as const satisfies Record<
  BudgetQueryDto['sortBy'],
  keyof Prisma.BudgetOrderByWithRelationInput
>;

@Injectable()
export class BudgetsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, dto: CreateBudgetDto) {
    await this.validateCategory(userId, dto.categoryId);
    await this.assertNoOverlap(userId, dto.categoryId, dto.startDate, dto.endDate);

    return this.prisma.budget.create({
      data: {
        userId,
        name: dto.name,
        categoryId: dto.categoryId,
        amount: dto.amount,
        period: dto.period,
        startDate: dto.startDate,
        endDate: dto.endDate,
      },
    });
  }

  async findAll(userId: string, query: BudgetQueryDto) {
    const { page, limit, categoryId, period, startDate, endDate, sortBy, sortOrder } =
      query;

    const where = {
      userId,
      ...(categoryId ? { categoryId } : {}),
      ...(period ? { period } : {}),
      ...(startDate ? { endDate: { gte: startDate } } : {}),
      ...(endDate ? { startDate: { lte: endDate } } : {}),
    };

    const skip = (page - 1) * limit;

    // Secondary id ordering keeps pagination stable when rows share the
    // primary sort value.
    const orderBy: Prisma.BudgetOrderByWithRelationInput[] = [
      { [budgetSortFields[sortBy]]: sortOrder },
      { id: 'asc' },
    ];

    const [budgets, total] = await Promise.all([
      this.prisma.budget.findMany({
        where,
        skip,
        take: limit,
        orderBy,
      }),

      this.prisma.budget.count({
        where,
      }),
    ]);

    return {
      budgets,
      total,
    };
  }

  async findOne(userId: string, id: string) {
    const budget = await this.prisma.budget.findFirst({
      where: {
        id,
        userId,
      },
    });

    if (!budget) {
      throw new NotFoundException('Budget not found');
    }

    return budget;
  }

  async calculateSpentAmount(
    userId: string,
    budget: { categoryId: string; startDate: Date; endDate: Date },
  ): Promise<Prisma.Decimal> {
    // Spending is always derived from the Transaction ledger, never stored
    // on the Budget. PostgreSQL computes the SUM over DECIMAL(19,2) and
    // Prisma returns a Decimal, so no JavaScript floating-point arithmetic
    // is involved. Bounds are inclusive on both ends.
    const result = await this.prisma.transaction.aggregate({
      _sum: { amount: true },
      where: {
        userId,
        type: 'EXPENSE',
        categoryId: budget.categoryId,
        transactionDate: {
          gte: budget.startDate,
          lte: budget.endDate,
        },
        deletedAt: null,
      },
    });

    return result._sum.amount ?? new Prisma.Decimal(0);
  }

  async update(userId: string, id: string, dto: UpdateBudgetDto) {
    const budget = await this.prisma.budget.findFirst({
      where: {
        id,
        userId,
      },
    });

    if (!budget) {
      throw new NotFoundException('Budget not found');
    }

    const categoryId = dto.categoryId ?? budget.categoryId;
    const startDate =
      dto.startDate ?? budget.startDate.toISOString();
    const endDate = dto.endDate ?? budget.endDate.toISOString();

    if (new Date(startDate) >= new Date(endDate)) {
      throw new BadRequestException('startDate must be before endDate');
    }

    if (dto.categoryId && dto.categoryId !== budget.categoryId) {
      await this.validateCategory(userId, dto.categoryId);
    }

    if (
      categoryId !== budget.categoryId ||
      dto.startDate !== undefined ||
      dto.endDate !== undefined
    ) {
      await this.assertNoOverlap(userId, categoryId, startDate, endDate, id);
    }

    return this.prisma.budget.update({
      where: {
        id,
      },
      data: {
        ...dto,
      },
    });
  }

  async remove(userId: string, id: string) {
    const budget = await this.prisma.budget.findFirst({
      where: {
        id,
        userId,
      },
    });

    if (!budget) {
      throw new NotFoundException('Budget not found');
    }

    // Budgets hold no transactions: Transaction has no foreign key to
    // Budget, so deleting a budget can never delete transactions.
    return this.prisma.budget.delete({
      where: {
        id,
      },
    });
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

    // Budgets track spending, so only expense categories are eligible.
    if (category.type !== 'EXPENSE') {
      throw new BadRequestException(
        'Budget category must be an expense category',
      );
    }

    return category;
  }

  private async assertNoOverlap(
    userId: string,
    categoryId: string,
    startDate: string,
    endDate: string,
    excludeId?: string,
  ) {
    const overlapping = await this.prisma.budget.findFirst({
      where: {
        userId,
        categoryId,
        startDate: { lte: endDate },
        endDate: { gte: startDate },
        ...(excludeId ? { NOT: { id: excludeId } } : {}),
      },
    });

    if (overlapping) {
      throw new ConflictException(
        'A budget for this category already exists in the given date range',
      );
    }
  }
}
