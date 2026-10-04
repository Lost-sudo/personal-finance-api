import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import { ReportQueryDto } from './dto/report-query.dto.js';

interface CategoryBucket {
  categoryId: string;
  categoryName: string;
  amount: Prisma.Decimal;
}

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  async getFinancialSummary(userId: string, query: ReportQueryDto) {
    const { dateFrom, dateTo } = query;

    const transactions = await this.prisma.transaction.findMany({
      where: {
        userId,
        deletedAt: null,
        ...(dateFrom || dateTo
          ? {
              transactionDate: {
                ...(dateFrom ? { gte: dateFrom } : {}),
                ...(dateTo ? { lte: dateTo } : {}),
              },
            }
          : {}),
      },
      include: {
        category: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    let income = new Prisma.Decimal(0);
    let expenses = new Prisma.Decimal(0);
    const spendingByCategory = new Map<string, CategoryBucket>();

    for (const transaction of transactions) {
      // Transfers only move money between the user's own accounts and never
      // contribute to income, expenses, or net cash flow.
      if (transaction.type === 'INCOME') {
        income = income.plus(new Prisma.Decimal(transaction.amount));
      } else if (transaction.type === 'EXPENSE') {
        const amount = new Prisma.Decimal(transaction.amount);
        expenses = expenses.plus(amount);

        // Uncategorized expenses count toward the total but have no group.
        if (transaction.category) {
          const existing = spendingByCategory.get(transaction.category.id);

          if (existing) {
            existing.amount = existing.amount.plus(amount);
          } else {
            spendingByCategory.set(transaction.category.id, {
              categoryId: transaction.category.id,
              categoryName: transaction.category.name,
              amount,
            });
          }
        }
      }
    }

    const netCashFlow = income.minus(expenses);

    const categories = [...spendingByCategory.values()]
      .sort((a, b) => b.amount.comparedTo(a.amount))
      .map((bucket) => ({
        categoryId: bucket.categoryId,
        categoryName: bucket.categoryName,
        amount: bucket.amount.toFixed(2),
      }));

    return {
      fromDate: dateFrom ?? null,
      toDate: dateTo ?? null,
      income: income.toFixed(2),
      expenses: expenses.toFixed(2),
      netCashFlow: netCashFlow.toFixed(2),
      spendingByCategory: categories,
    };
  }
}
