/*
  Warnings:

  - You are about to drop the column `accessVersion` on the `user_sessions` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "public"."Property" ALTER COLUMN "amenities" SET DEFAULT '{}'::jsonb;

-- AlterTable
ALTER TABLE "public"."user_sessions" DROP COLUMN "accessVersion",
ADD COLUMN     "accessSv" INTEGER NOT NULL DEFAULT 1;
