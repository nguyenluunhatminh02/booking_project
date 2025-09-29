/*
  Warnings:

  - You are about to drop the column `chargeId` on the `Payment` table. All the data in the column will be lost.
  - You are about to drop the column `currency` on the `Payment` table. All the data in the column will be lost.
  - You are about to drop the column `intentId` on the `Payment` table. All the data in the column will be lost.
  - You are about to drop the column `metadata` on the `Payment` table. All the data in the column will be lost.
  - You are about to drop the column `createdAt` on the `ProcessedEvent` table. All the data in the column will be lost.
  - You are about to drop the column `topic` on the `ProcessedEvent` table. All the data in the column will be lost.
  - You are about to drop the column `ratingAvg` on the `Property` table. All the data in the column will be lost.
  - You are about to drop the column `ratingCount` on the `Property` table. All the data in the column will be lost.
  - You are about to drop the column `ratingUpdatedAt` on the `Property` table. All the data in the column will be lost.
  - You are about to drop the column `authorId` on the `Review` table. All the data in the column will be lost.
  - You are about to drop the column `body` on the `Review` table. All the data in the column will be lost.
  - You are about to drop the column `bookingId` on the `Review` table. All the data in the column will be lost.
  - You are about to drop the column `status` on the `Review` table. All the data in the column will be lost.
  - You are about to drop the column `updatedAt` on the `Review` table. All the data in the column will be lost.
  - You are about to drop the `File` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `FileVariant` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Notification` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `ProcessedWebhook` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `PropertyFile` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Refund` table. If the table is not empty, all the data it contains will be lost.
  - A unique constraint covering the columns `[bookingId]` on the table `Payment` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[provider,externalId]` on the table `Payment` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `externalId` to the `Payment` table without a default value. This is not possible if the table is not empty.
  - Changed the type of `provider` on the `Payment` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Added the required column `userId` to the `Review` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "public"."FileVariant" DROP CONSTRAINT "FileVariant_fileId_fkey";

-- DropForeignKey
ALTER TABLE "public"."Notification" DROP CONSTRAINT "Notification_userId_fkey";

-- DropForeignKey
ALTER TABLE "public"."PropertyFile" DROP CONSTRAINT "PropertyFile_fileId_fkey";

-- DropForeignKey
ALTER TABLE "public"."PropertyFile" DROP CONSTRAINT "PropertyFile_propertyId_fkey";

-- DropForeignKey
ALTER TABLE "public"."Refund" DROP CONSTRAINT "Refund_paymentId_fkey";

-- DropForeignKey
ALTER TABLE "public"."Review" DROP CONSTRAINT "Review_authorId_fkey";

-- DropForeignKey
ALTER TABLE "public"."Review" DROP CONSTRAINT "Review_bookingId_fkey";

-- DropIndex
DROP INDEX "public"."Payment_bookingId_idx";

-- DropIndex
DROP INDEX "public"."Payment_provider_chargeId_idx";

-- DropIndex
DROP INDEX "public"."Payment_provider_intentId_key";

-- DropIndex
DROP INDEX "public"."ProcessedEvent_topic_createdAt_idx";

-- DropIndex
DROP INDEX "public"."Review_authorId_createdAt_idx";

-- DropIndex
DROP INDEX "public"."Review_bookingId_key";

-- DropIndex
DROP INDEX "public"."Review_propertyId_createdAt_idx";

-- DropIndex
DROP INDEX "public"."Review_propertyId_status_id_idx";

-- AlterTable
ALTER TABLE "public"."Payment" DROP COLUMN "chargeId",
DROP COLUMN "currency",
DROP COLUMN "intentId",
DROP COLUMN "metadata",
ADD COLUMN     "externalId" TEXT NOT NULL,
ADD COLUMN     "refundAmount" INTEGER,
ADD COLUMN     "refundExternalId" TEXT,
DROP COLUMN "provider",
ADD COLUMN     "provider" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "public"."ProcessedEvent" DROP COLUMN "createdAt",
DROP COLUMN "topic",
ADD COLUMN     "handledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "public"."Property" DROP COLUMN "ratingAvg",
DROP COLUMN "ratingCount",
DROP COLUMN "ratingUpdatedAt",
ALTER COLUMN "amenities" SET DEFAULT '{}'::jsonb;

-- AlterTable
ALTER TABLE "public"."Review" DROP COLUMN "authorId",
DROP COLUMN "body",
DROP COLUMN "bookingId",
DROP COLUMN "status",
DROP COLUMN "updatedAt",
ADD COLUMN     "comment" TEXT,
ADD COLUMN     "userId" TEXT NOT NULL;

-- DropTable
DROP TABLE "public"."File";

-- DropTable
DROP TABLE "public"."FileVariant";

-- DropTable
DROP TABLE "public"."Notification";

-- DropTable
DROP TABLE "public"."ProcessedWebhook";

-- DropTable
DROP TABLE "public"."PropertyFile";

-- DropTable
DROP TABLE "public"."Refund";

-- DropEnum
DROP TYPE "public"."CommentEntityType";

-- DropEnum
DROP TYPE "public"."CommentStatus";

-- DropEnum
DROP TYPE "public"."CommentVisibility";

-- DropEnum
DROP TYPE "public"."MediaType";

-- DropEnum
DROP TYPE "public"."NotificationChannel";

-- DropEnum
DROP TYPE "public"."NotificationType";

-- DropEnum
DROP TYPE "public"."PaymentProvider";

-- DropEnum
DROP TYPE "public"."RefundStatus";

-- DropEnum
DROP TYPE "public"."ReviewStatus";

-- CreateIndex
CREATE UNIQUE INDEX "Payment_bookingId_key" ON "public"."Payment"("bookingId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_provider_externalId_key" ON "public"."Payment"("provider", "externalId");

-- CreateIndex
CREATE INDEX "Review_propertyId_idx" ON "public"."Review"("propertyId");

-- AddForeignKey
ALTER TABLE "public"."Review" ADD CONSTRAINT "Review_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
