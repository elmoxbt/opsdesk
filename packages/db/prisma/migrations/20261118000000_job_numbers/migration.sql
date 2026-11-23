-- Per-tenant job numbers (JOB-0042).
-- Hand-edited from `prisma migrate diff` output so it is safe on databases that
-- already contain jobs: add nullable, backfill per tenant, then enforce NOT NULL.

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN "jobSeq" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Job" ADD COLUMN "number" INTEGER;

-- Backfill: number existing jobs per organization in creation order.
UPDATE "Job" j
SET "number" = numbered.rn
FROM (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY "organizationId" ORDER BY "createdAt", id) AS rn
  FROM "Job"
) AS numbered
WHERE j.id = numbered.id;

-- Continue each organization's sequence after its highest existing number.
UPDATE "Organization" o
SET "jobSeq" = COALESCE((SELECT MAX("number") FROM "Job" WHERE "organizationId" = o.id), 0);

ALTER TABLE "Job" ALTER COLUMN "number" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Job_organizationId_number_key" ON "Job"("organizationId", "number");
