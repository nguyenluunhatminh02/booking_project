/*
  Warnings:

  - You are about to drop the column `externalId` on the `Payment` table. All the data in the column will be lost.
  - You are about to drop the column `refundAmount` on the `Payment` table. All the data in the column will be lost.
  - You are about to drop the column `refundExternalId` on the `Payment` table. All the data in the column will be lost.
  - Changed the type of `provider` on the `Payment` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.

*/
-- CreateEnum
CREATE TYPE "public"."MalwareScanStatus" AS ENUM ('PENDING', 'CLEAN', 'INFECTED', 'ERROR');

-- CreateEnum
CREATE TYPE "public"."PaymentProvider" AS ENUM ('MOCK', 'STRIPE', 'VNPAY');

-- CreateEnum
CREATE TYPE "public"."RefundStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED');

-- AlterEnum
ALTER TYPE "public"."PaymentStatus" ADD VALUE 'CANCELED';

-- DropIndex
DROP INDEX "public"."Payment_provider_externalId_key";

-- AlterTable
ALTER TABLE "public"."Payment" DROP COLUMN "externalId",
DROP COLUMN "refundAmount",
DROP COLUMN "refundExternalId",
ADD COLUMN     "chargeId" TEXT,
ADD COLUMN     "currency" TEXT NOT NULL DEFAULT 'VND',
ADD COLUMN     "intentId" TEXT,
ADD COLUMN     "metadata" JSONB,
DROP COLUMN "provider",
ADD COLUMN     "provider" "public"."PaymentProvider" NOT NULL;

-- AlterTable
ALTER TABLE "public"."Property" ALTER COLUMN "amenities" SET DEFAULT '{}'::jsonb;

-- CreateTable
CREATE TABLE "public"."Refund" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "status" "public"."RefundStatus" NOT NULL DEFAULT 'PENDING',
    "providerRefundId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Refund_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ProcessedWebhook" (
    "id" TEXT NOT NULL,
    "provider" "public"."PaymentProvider" NOT NULL,
    "raw" JSONB,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProcessedWebhook_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Refund_paymentId_idx" ON "public"."Refund"("paymentId");

-- CreateIndex
CREATE INDEX "ProcessedWebhook_provider_at_idx" ON "public"."ProcessedWebhook"("provider", "at");

-- CreateIndex
CREATE INDEX "Payment_provider_chargeId_idx" ON "public"."Payment"("provider", "chargeId");

-- AddForeignKey
ALTER TABLE "public"."Refund" ADD CONSTRAINT "Refund_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "public"."Payment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
