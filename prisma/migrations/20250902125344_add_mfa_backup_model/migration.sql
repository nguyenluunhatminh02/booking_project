-- AlterTable
ALTER TABLE "public"."user_sessions" ADD COLUMN     "approved" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "deviceFp" TEXT;

-- CreateTable
CREATE TABLE "public"."user_mfa" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "totpSecret" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_mfa_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."backup_codes" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "backup_codes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_mfa_userId_key" ON "public"."user_mfa"("userId");

-- CreateIndex
CREATE INDEX "backup_codes_userId_usedAt_idx" ON "public"."backup_codes"("userId", "usedAt");

-- AddForeignKey
ALTER TABLE "public"."user_mfa" ADD CONSTRAINT "user_mfa_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."backup_codes" ADD CONSTRAINT "backup_codes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
