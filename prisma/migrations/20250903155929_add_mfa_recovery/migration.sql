-- AlterTable
ALTER TABLE "public"."user_mfa" ADD COLUMN     "recoveryKeyHash" TEXT,
ADD COLUMN     "recoveryKeyUsedAt" TIMESTAMP(3);
