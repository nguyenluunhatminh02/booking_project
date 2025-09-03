-- AlterTable
ALTER TABLE "public"."user_mfa" ADD COLUMN     "lastVerifyAt" TIMESTAMP(3),
ADD COLUMN     "verifyAttempts" INTEGER NOT NULL DEFAULT 0;
