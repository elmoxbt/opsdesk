-- CreateEnum
CREATE TYPE "JobSource" AS ENUM ('DASHBOARD', 'BOOKING', 'API');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('EMAIL', 'SMS', 'WHATSAPP');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('QUEUED', 'SENT', 'FAILED');

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "phoneKey" TEXT;

-- AlterTable
ALTER TABLE "Job" ADD COLUMN     "bookingToken" TEXT,
ADD COLUMN     "source" "JobSource" NOT NULL DEFAULT 'DASHBOARD';

-- AlterTable
ALTER TABLE "InventoryItem" ADD COLUMN     "lowStockAlertedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "Notification" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "recipient" TEXT NOT NULL,
    "template" TEXT NOT NULL,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "status" "NotificationStatus" NOT NULL DEFAULT 'QUEUED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "entityType" TEXT,
    "entityId" UUID,
    "dedupeKey" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Notification_organizationId_entityType_entityId_idx" ON "Notification"("organizationId", "entityType", "entityId");

-- CreateIndex
CREATE INDEX "Notification_organizationId_createdAt_idx" ON "Notification"("organizationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_organizationId_dedupeKey_key" ON "Notification"("organizationId", "dedupeKey");

-- CreateIndex
CREATE INDEX "Customer_organizationId_phoneKey_idx" ON "Customer"("organizationId", "phoneKey");

-- CreateIndex
CREATE UNIQUE INDEX "Job_bookingToken_key" ON "Job"("bookingToken");

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Backfill phoneKey for existing customers (digits only, last 10).
UPDATE "Customer" SET "phoneKey" = right(regexp_replace("phone", '\D', '', 'g'), 10) WHERE "phoneKey" IS NULL;
