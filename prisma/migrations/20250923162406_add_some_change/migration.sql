-- AlterTable
ALTER TABLE "public"."Property" ADD COLUMN     "ratingAvg" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "ratingCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "ratingUpdatedAt" TIMESTAMP(3),
ALTER COLUMN "amenities" SET DEFAULT '{}'::jsonb;

-- CreateIndex
CREATE INDEX "Booking_propertyId_customerId_checkOut_idx" ON "public"."Booking"("propertyId", "customerId", "checkOut");
