-- CreateEnum
CREATE TYPE "public"."NotiChannel" AS ENUM ('INAPP', 'EMAIL', 'PUSH', 'WEBHOOK');

-- CreateEnum
CREATE TYPE "public"."NotiStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'CANCELLED', 'READ');

-- AlterTable
ALTER TABLE "public"."Property" ALTER COLUMN "amenities" SET DEFAULT '{}'::jsonb;

-- CreateTable
CREATE TABLE "public"."Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "channel" "public"."NotiChannel" NOT NULL,
    "title" TEXT,
    "body" TEXT,
    "data" JSONB,
    "dedupeKey" TEXT,
    "status" "public"."NotiStatus" NOT NULL DEFAULT 'PENDING',
    "deliverAfter" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "readAt" TIMESTAMP(3),
    "processingAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."NotiPreference" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "email" BOOLEAN NOT NULL DEFAULT true,
    "push" BOOLEAN NOT NULL DEFAULT true,
    "inapp" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotiPreference_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Notification_userId_createdAt_idx" ON "public"."Notification"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_status_deliverAfter_channel_processingAt_idx" ON "public"."Notification"("status", "deliverAfter", "channel", "processingAt");

-- CreateIndex
CREATE INDEX "Notification_userId_channel_readAt_createdAt_idx" ON "public"."Notification"("userId", "channel", "readAt", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_channel_userId_dedupeKey_key" ON "public"."Notification"("channel", "userId", "dedupeKey");

-- CreateIndex
CREATE UNIQUE INDEX "NotiPreference_userId_key_key" ON "public"."NotiPreference"("userId", "key");

-- AddForeignKey
ALTER TABLE "public"."Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."NotiPreference" ADD CONSTRAINT "NotiPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
