import { Prisma } from '../../generated/prisma/client.js';

export type BudgetProgressStatus = 'WITHIN' | 'OVER';

export interface BudgetProgressInput {
  amount: Prisma.Decimal;
}

export interface BudgetProgress {
  spentAmount: string;
  remainingAmount: string;
  percentageUsed: string;
  status: BudgetProgressStatus;
}

// Pure derivation of budget progress from the persisted budget amount and
// the aggregated spend. All arithmetic stays in Prisma.Decimal and only the
// formatted strings leave this function, matching the ReportsService
// convention of serializing money as fixed-point strings.
export function buildBudgetProgress(
  budget: BudgetProgressInput,
  spent: Prisma.Decimal,
): BudgetProgress {
  const amount = new Prisma.Decimal(budget.amount);
  const spentAmount = new Prisma.Decimal(spent);

  // Budget amounts are validated positive at create/update time, so the
  // divisor here can never be zero.
  const remaining = amount.minus(spentAmount);
  const percentage = spentAmount.div(amount).times(100);

  return {
    spentAmount: spentAmount.toFixed(2),
    remainingAmount: remaining.toFixed(2),
    percentageUsed: percentage.toFixed(2),
    status: spentAmount.comparedTo(amount) > 0 ? 'OVER' : 'WITHIN',
  };
}
