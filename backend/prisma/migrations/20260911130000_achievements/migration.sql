CREATE TABLE "AchievementUnlock" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "achievementKey" TEXT NOT NULL,
    "unlockedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AchievementUnlock_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AchievementUnlock_userId_achievementKey_key"
ON "AchievementUnlock"("userId", "achievementKey");

CREATE INDEX "AchievementUnlock_userId_unlockedAt_idx"
ON "AchievementUnlock"("userId", "unlockedAt");

ALTER TABLE "AchievementUnlock"
ADD CONSTRAINT "AchievementUnlock_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
