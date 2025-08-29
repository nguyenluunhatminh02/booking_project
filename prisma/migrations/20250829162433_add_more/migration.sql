/*
  Warnings:

  - You are about to drop the column `actorRole` on the `audit_logs` table. All the data in the column will be lost.
  - You are about to drop the column `diff` on the `audit_logs` table. All the data in the column will be lost.
  - You are about to drop the column `hash` on the `audit_logs` table. All the data in the column will be lost.
  - You are about to drop the column `prevHash` on the `audit_logs` table. All the data in the column will be lost.
  - You are about to drop the column `scopeId` on the `user_roles` table. All the data in the column will be lost.
  - You are about to drop the column `scopeType` on the `user_roles` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[userId,roleId]` on the table `user_roles` will be added. If there are existing duplicate values, this will fail.

*/
CREATE EXTENSION IF NOT EXISTS citext WITH SCHEMA public;

-- CreateEnum
CREATE TYPE "public"."SessionRevokeReason" AS ENUM ('USER_LOGOUT', 'ADMIN_FORCE', 'SECURITY_REUSE', 'EXPIRED', 'OTHER');

-- CreateEnum
CREATE TYPE "public"."SecurityEventType" AS ENUM ('LOGIN_SUCCESS', 'LOGIN_FAILED', 'TOKEN_REVOKE', 'REFRESH_REUSE');

-- CreateEnum
CREATE TYPE "public"."BookingStatus" AS ENUM ('PENDING', 'CONFIRMED', 'CANCELED');

-- CreateEnum
CREATE TYPE "public"."UserTokenType" AS ENUM ('EMAIL_VERIFY', 'PASSWORD_RESET', 'DEVICE_APPROVAL');

-- DropIndex
DROP INDEX "public"."audit_logs_hash_key";

-- DropIndex
DROP INDEX "public"."user_roles_scopeType_scopeId_idx";

-- DropIndex
DROP INDEX "public"."user_roles_userId_roleId_idx";

-- DropIndex
DROP INDEX "public"."user_sessions_userId_deviceId_key";

-- AlterTable
ALTER TABLE "public"."audit_logs" DROP COLUMN "actorRole",
DROP COLUMN "diff",
DROP COLUMN "hash",
DROP COLUMN "prevHash",
ALTER COLUMN "entityId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "public"."permissions" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "public"."resource_acl" ALTER COLUMN "effect" SET DEFAULT 'ALLOW';

-- AlterTable
ALTER TABLE "public"."user_roles" DROP COLUMN "scopeId",
DROP COLUMN "scopeType";

-- AlterTable
ALTER TABLE "public"."user_sessions" ADD COLUMN     "ip" TEXT,
ADD COLUMN     "lastUsedAt" TIMESTAMP(3),
ADD COLUMN     "prevExpiresAt" TIMESTAMP(3),
ADD COLUMN     "prevRefreshHash" TEXT,
ADD COLUMN     "reusedAt" TIMESTAMP(3),
ADD COLUMN     "revokedReason" "public"."SessionRevokeReason",
ADD COLUMN     "rotatedAt" TIMESTAMP(3),
ADD COLUMN     "userAgent" TEXT;

-- AlterTable
ALTER TABLE "public"."users" ADD COLUMN     "accessVersion" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "lockedUntil" TIMESTAMP(3),
ALTER COLUMN "email" SET DATA TYPE CITEXT;

-- DropEnum
DROP TYPE "public"."ScopeType";

-- CreateTable
CREATE TABLE "public"."security_events" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "sessionId" TEXT,
    "type" "public"."SecurityEventType" NOT NULL,
    "ip" TEXT,
    "userAgent" TEXT,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "security_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."properties" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "ownerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "properties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."bookings" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "public"."BookingStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bookings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."user_tokens" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "type" "public"."UserTokenType" NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "usedByIp" TEXT,

    CONSTRAINT "user_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "security_events_userId_createdAt_idx" ON "public"."security_events"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "security_events_userId_type_createdAt_idx" ON "public"."security_events"("userId", "type", "createdAt");

-- CreateIndex
CREATE INDEX "security_events_sessionId_idx" ON "public"."security_events"("sessionId");

-- CreateIndex
CREATE INDEX "properties_ownerId_idx" ON "public"."properties"("ownerId");

-- CreateIndex
CREATE INDEX "bookings_propertyId_idx" ON "public"."bookings"("propertyId");

-- CreateIndex
CREATE INDEX "bookings_userId_idx" ON "public"."bookings"("userId");

-- CreateIndex
CREATE INDEX "user_tokens_type_expiresAt_idx" ON "public"."user_tokens"("type", "expiresAt");

-- CreateIndex
CREATE INDEX "user_tokens_userId_type_createdAt_idx" ON "public"."user_tokens"("userId", "type", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "user_roles_userId_roleId_key" ON "public"."user_roles"("userId", "roleId");

-- CreateIndex
CREATE INDEX "user_sessions_userId_revokedAt_idx" ON "public"."user_sessions"("userId", "revokedAt");

-- AddForeignKey
ALTER TABLE "public"."security_events" ADD CONSTRAINT "security_events_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."security_events" ADD CONSTRAINT "security_events_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "public"."user_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."properties" ADD CONSTRAINT "properties_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."bookings" ADD CONSTRAINT "bookings_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "public"."properties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."bookings" ADD CONSTRAINT "bookings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."user_tokens" ADD CONSTRAINT "user_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
