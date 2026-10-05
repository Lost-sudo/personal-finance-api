-- DropIndex
DROP INDEX "recurring_transactions_userId_isActive_nextOccurrence_idx";

-- AlterTable
ALTER TABLE "recurring_transactions" DROP COLUMN "endDate",
DROP COLUMN "nextOccurrence",
DROP COLUMN "startDate",
ADD COLUMN     "fromAccountId" UUID,
ADD COLUMN     "nextRunAt" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "toAccountId" UUID,
ALTER COLUMN "accountId" DROP NOT NULL,
ALTER COLUMN "description" SET DATA TYPE VARCHAR(255);

-- AlterTable
ALTER TABLE "transactions" ADD COLUMN     "recurringTransactionId" UUID,
ADD COLUMN     "scheduledFor" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "recurring_transactions_userId_isActive_idx" ON "recurring_transactions"("userId", "isActive");

-- CreateIndex
CREATE INDEX "recurring_transactions_userId_nextRunAt_idx" ON "recurring_transactions"("userId", "nextRunAt");

-- CreateIndex
CREATE INDEX "recurring_transactions_fromAccountId_idx" ON "recurring_transactions"("fromAccountId");

-- CreateIndex
CREATE INDEX "recurring_transactions_toAccountId_idx" ON "recurring_transactions"("toAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "transactions_recurringTransactionId_scheduledFor_key" ON "transactions"("recurringTransactionId", "scheduledFor");

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_recurringTransactionId_fkey" FOREIGN KEY ("recurringTransactionId") REFERENCES "recurring_transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_transactions" ADD CONSTRAINT "recurring_transactions_fromAccountId_fkey" FOREIGN KEY ("fromAccountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_transactions" ADD CONSTRAINT "recurring_transactions_toAccountId_fkey" FOREIGN KEY ("toAccountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

