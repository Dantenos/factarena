ALTER TABLE "Transaction" ADD COLUMN "referenceId" TEXT;

CREATE UNIQUE INDEX "Transaction_referenceId_key" ON "Transaction"("referenceId");
