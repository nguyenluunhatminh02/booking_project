-- AlterEnum
ALTER TYPE "public"."BookingStatus" ADD VALUE 'CONFIRMED';

-- AlterEnum
ALTER TYPE "public"."FraudDecision" ADD VALUE 'AUTO_DECLINED';

-- AlterTable
ALTER TABLE "public"."Booking" ADD COLUMN     "reviewDeadlineAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "public"."Payment" ADD COLUMN     "refundAmount" INTEGER,
ADD COLUMN     "refundExternalId" TEXT;

-- AlterTable
ALTER TABLE "public"."Property" ALTER COLUMN "amenities" SET DEFAULT '{}'::jsonb;

-- CreateIndex
CREATE INDEX "Booking_status_reviewDeadlineAt_idx" ON "public"."Booking"("status", "reviewDeadlineAt");
