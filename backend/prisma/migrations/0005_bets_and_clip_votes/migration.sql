DROP TABLE "Prediction";
ALTER TABLE "Round" DROP COLUMN "trueFakeCount";
ALTER TABLE "Claim" ADD COLUMN "videoEndS" INTEGER;

CREATE TABLE "Bet" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "roundId" TEXT NOT NULL,
  "stake" INTEGER NOT NULL,
  "payout" INTEGER,
  "result" "PredictionResult",
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Bet_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Bet_userId_roundId_key" ON "Bet"("userId", "roundId");
CREATE INDEX "Bet_roundId_idx" ON "Bet"("roundId");
ALTER TABLE "Bet" ADD CONSTRAINT "Bet_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Bet" ADD CONSTRAINT "Bet_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "Round"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "ClipVote" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "roundId" TEXT NOT NULL,
  "claimId" TEXT NOT NULL,
  "isFake" BOOLEAN NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ClipVote_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ClipVote_userId_roundId_claimId_key" ON "ClipVote"("userId", "roundId", "claimId");
CREATE INDEX "ClipVote_roundId_idx" ON "ClipVote"("roundId");
CREATE INDEX "ClipVote_claimId_idx" ON "ClipVote"("claimId");
ALTER TABLE "ClipVote" ADD CONSTRAINT "ClipVote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ClipVote" ADD CONSTRAINT "ClipVote_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "Round"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ClipVote" ADD CONSTRAINT "ClipVote_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "Claim"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
