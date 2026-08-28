-- CreateTable
CREATE TABLE "ClipReport" (
    "id" TEXT NOT NULL,
    "claimId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "roundId" TEXT,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClipReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ClipReport_claimId_idx" ON "ClipReport"("claimId");

-- CreateIndex
CREATE UNIQUE INDEX "ClipReport_userId_claimId_key" ON "ClipReport"("userId", "claimId");

-- AddForeignKey
ALTER TABLE "ClipReport" ADD CONSTRAINT "ClipReport_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "Claim"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClipReport" ADD CONSTRAINT "ClipReport_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
