-- CreateEnum
CREATE TYPE "public"."IdemStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED', 'FAILED');

-- AlterTable
ALTER TABLE "public"."Property" ALTER COLUMN "amenities" SET DEFAULT '{}'::jsonb;

-- CreateTable
CREATE TABLE "public"."Idempotency" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "endpoint" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "status" "public"."IdemStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "resourceId" TEXT,
    "response" JSONB,
    "error" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Idempotency_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Idempotency_endpoint_createdAt_idx" ON "public"."Idempotency"("endpoint", "createdAt");

-- CreateIndex
CREATE INDEX "Idempotency_expiresAt_idx" ON "public"."Idempotency"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Idempotency_userId_endpoint_key_key" ON "public"."Idempotency"("userId", "endpoint", "key");
