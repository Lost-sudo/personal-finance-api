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
import { buildBudgetProgress } from './budget-progress.util.js';

// Client sort keys mapped to Prisma fields; unknown keys can't reach Prisma.
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

    // Tie-break on id for stable pagination.
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
    // Spending is derived via DB SUM over Decimal; bounds inclusive.
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

  async getProgress(userId: string, id: string) {
    // findOne enforces ownership (404 for other users' budgets).
    const budget = await this.findOne(userId, id);
    const spent = await this.calculateSpentAmount(userId, budget);
    const progress = buildBudgetProgress(budget, spent);

    return {
      id: budget.id,
      name: budget.name,
      categoryId: budget.categoryId,
      budgetAmount: new Prisma.Decimal(budget.amount).toFixed(2),
      spentAmount: progress.spentAmount,
      remainingAmount: progress.remainingAmount,
      percentageUsed: progress.percentageUsed,
      status: progress.status,
      period: {
        startDate: budget.startDate,
        endDate: budget.endDate,
      },
    };
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

    // No Transaction FK references Budget; delete is always safe.
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
