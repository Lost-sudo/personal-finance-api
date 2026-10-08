import { Prisma } from '../../generated/prisma/client.js';

export type BudgetProgressStatus = 'ON_TRACK' | 'NEAR_LIMIT' | 'EXCEEDED';

export interface BudgetProgressInput {
  amount: Prisma.Decimal;
}

export interface BudgetProgress {
  spentAmount: string;
  remainingAmount: string;
  percentageUsed: number;
  status: BudgetProgressStatus;
}

// Derives progress in Decimal; money as strings, percentage as a number.
// Status uses the unrounded percentage (79.999% is ON_TRACK).
export function buildBudgetProgress(
  budget: BudgetProgressInput,
  spent: Prisma.Decimal,
): BudgetProgress {
  const amount = new Prisma.Decimal(budget.amount);
  const spentAmount = new Prisma.Decimal(spent);

  // Amount is always positive (validated), so division is safe.
  const remaining = amount.minus(spentAmount);
  const percentage = spentAmount.div(amount).times(100);

  let status: BudgetProgressStatus = 'ON_TRACK';

  if (percentage.greaterThanOrEqualTo(100)) {
    status = 'EXCEEDED';
  } else if (percentage.greaterThanOrEqualTo(80)) {
    status = 'NEAR_LIMIT';
  }

  return {
    spentAmount: spentAmount.toFixed(2),
    remainingAmount: remaining.toFixed(2),
    percentageUsed: percentage.toDecimalPlaces(2).toNumber(),
    status,
  };
}
