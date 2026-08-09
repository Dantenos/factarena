ALTER TABLE "Claim" ADD COLUMN "createdBy" TEXT;
CREATE INDEX "Claim_createdBy_idx" ON "Claim"("createdBy");
ALTER TABLE "Claim" ADD CONSTRAINT "Claim_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "RoomPresence" (
  "socketId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "roomId" TEXT NOT NULL,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RoomPresence_pkey" PRIMARY KEY ("socketId")
);
CREATE INDEX "RoomPresence_roomId_lastSeenAt_idx" ON "RoomPresence"("roomId", "lastSeenAt");
CREATE INDEX "RoomPresence_userId_lastSeenAt_idx" ON "RoomPresence"("userId", "lastSeenAt");
