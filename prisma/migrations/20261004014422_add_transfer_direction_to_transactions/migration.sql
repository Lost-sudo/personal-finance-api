-- AlterTable
ALTER TABLE "transactions" ADD COLUMN     "fromAccountId" UUID,
ADD COLUMN     "toAccountId" UUID;

-- CreateIndex
CREATE INDEX "transactions_fromAccountId_idx" ON "transactions"("fromAccountId");

-- CreateIndex
CREATE INDEX "transactions_toAccountId_idx" ON "transactions"("toAccountId");
