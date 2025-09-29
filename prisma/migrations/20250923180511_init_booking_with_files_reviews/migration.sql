/*
  Warnings:

  - You are about to drop the `Photo` table. If the table is not empty, all the data it contains will be lost.

*/
-- CreateEnum
CREATE TYPE "public"."MediaType" AS ENUM ('IMAGE', 'VIDEO');

-- DropForeignKey
ALTER TABLE "public"."Photo" DROP CONSTRAINT "Photo_propertyId_fkey";

-- AlterTable
ALTER TABLE "public"."Property" ALTER COLUMN "amenities" SET DEFAULT '{}'::jsonb;

-- DropTable
DROP TABLE "public"."Photo";

-- CreateTable
CREATE TABLE "public"."File" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "bytes" INTEGER,
    "width" INTEGER,
    "height" INTEGER,
    "contentType" TEXT,
    "checksum" TEXT,
    "tags" TEXT[],
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "File_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."PropertyFile" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "type" "public"."MediaType" NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isCover" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PropertyFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."FileVariant" (
    "id" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "bytes" INTEGER,
    "contentType" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FileVariant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "File_key_key" ON "public"."File"("key");

-- CreateIndex
CREATE INDEX "File_createdById_createdAt_idx" ON "public"."File"("createdById", "createdAt");

-- CreateIndex
CREATE INDEX "PropertyFile_propertyId_sortOrder_idx" ON "public"."PropertyFile"("propertyId", "sortOrder");

-- CreateIndex
CREATE INDEX "PropertyFile_propertyId_isCover_idx" ON "public"."PropertyFile"("propertyId", "isCover");

-- CreateIndex
CREATE UNIQUE INDEX "PropertyFile_propertyId_fileId_key" ON "public"."PropertyFile"("propertyId", "fileId");

-- CreateIndex
CREATE INDEX "FileVariant_fileId_idx" ON "public"."FileVariant"("fileId");

-- CreateIndex
CREATE UNIQUE INDEX "FileVariant_fileId_kind_key" ON "public"."FileVariant"("fileId", "kind");

-- AddForeignKey
ALTER TABLE "public"."PropertyFile" ADD CONSTRAINT "PropertyFile_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "public"."Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PropertyFile" ADD CONSTRAINT "PropertyFile_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "public"."File"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."FileVariant" ADD CONSTRAINT "FileVariant_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "public"."File"("id") ON DELETE CASCADE ON UPDATE CASCADE;
