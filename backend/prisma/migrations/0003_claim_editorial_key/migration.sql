ALTER TABLE "Claim" ADD COLUMN "sourceKey" TEXT;

UPDATE "Claim" SET "sourceKey" = 'britannica:photography:first-permanent-photo'
WHERE "id" = 'caaaaaaaaaaaaaaaaaaaaaaaa';
UPDATE "Claim" SET "sourceKey" = 'nasa:great-wall:visible-from-moon'
WHERE "id" = 'cbbbbbbbbbbbbbbbbbbbbbbbb';
UPDATE "Claim" SET "sourceKey" = 'usgs:water:boiling-point:sea-level'
WHERE "id" = 'ccccccccccccccccccccccccc';
UPDATE "Claim" SET "sourceKey" = 'britannica:biology:four-human-lungs'
WHERE "id" = 'cdddddddddddddddddddddddd';

CREATE UNIQUE INDEX "Claim_sourceKey_key" ON "Claim"("sourceKey");
