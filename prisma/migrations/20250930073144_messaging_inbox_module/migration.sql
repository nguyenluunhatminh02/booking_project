-- CreateEnum
CREATE TYPE "public"."ConversationType" AS ENUM ('DIRECT', 'PROPERTY');

-- AlterTable
ALTER TABLE "public"."Property" ALTER COLUMN "amenities" SET DEFAULT '{}'::jsonb;

-- CreateTable
CREATE TABLE "public"."conversations" (
    "id" TEXT NOT NULL,
    "type" "public"."ConversationType" NOT NULL,
    "key" TEXT,
    "propertyId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."conversation_participants" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT,
    "archivedAt" TIMESTAMP(3),
    "mutedUntil" TIMESTAMP(3),
    "pinnedAt" TIMESTAMP(3),
    "lastReadAt" TIMESTAMP(3),
    "profileSnapshot" JSONB,

    CONSTRAINT "conversation_participants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."messages" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "body" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."message_attachments" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "mediaType" "public"."MediaType" NOT NULL,
    "url" TEXT,
    "bytes" INTEGER,
    "width" INTEGER,
    "height" INTEGER,
    "contentType" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "message_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."user_blocks" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "blockedUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_blocks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "conversations_key_key" ON "public"."conversations"("key");

-- CreateIndex
CREATE INDEX "conversations_propertyId_idx" ON "public"."conversations"("propertyId");

-- CreateIndex
CREATE INDEX "conversation_participants_userId_pinnedAt_idx" ON "public"."conversation_participants"("userId", "pinnedAt");

-- CreateIndex
CREATE INDEX "conversation_participants_userId_archivedAt_idx" ON "public"."conversation_participants"("userId", "archivedAt");

-- CreateIndex
CREATE INDEX "conversation_participants_conversationId_userId_lastReadAt_idx" ON "public"."conversation_participants"("conversationId", "userId", "lastReadAt");

-- CreateIndex
CREATE UNIQUE INDEX "conversation_participants_conversationId_userId_key" ON "public"."conversation_participants"("conversationId", "userId");

-- CreateIndex
CREATE INDEX "messages_conversationId_createdAt_idx" ON "public"."messages"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "messages_senderId_createdAt_idx" ON "public"."messages"("senderId", "createdAt");

-- CreateIndex
CREATE INDEX "messages_conversationId_createdAt_senderId_idx" ON "public"."messages"("conversationId", "createdAt", "senderId");

-- CreateIndex
CREATE INDEX "message_attachments_messageId_idx" ON "public"."message_attachments"("messageId");

-- CreateIndex
CREATE INDEX "message_attachments_fileId_idx" ON "public"."message_attachments"("fileId");

-- CreateIndex
CREATE INDEX "user_blocks_blockedUserId_idx" ON "public"."user_blocks"("blockedUserId");

-- CreateIndex
CREATE UNIQUE INDEX "user_blocks_userId_blockedUserId_key" ON "public"."user_blocks"("userId", "blockedUserId");

-- AddForeignKey
ALTER TABLE "public"."conversations" ADD CONSTRAINT "conversations_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "public"."Property"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."conversation_participants" ADD CONSTRAINT "conversation_participants_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "public"."conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."conversation_participants" ADD CONSTRAINT "conversation_participants_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."messages" ADD CONSTRAINT "messages_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "public"."conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."messages" ADD CONSTRAINT "messages_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."message_attachments" ADD CONSTRAINT "message_attachments_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "public"."messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."message_attachments" ADD CONSTRAINT "message_attachments_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "public"."File"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."user_blocks" ADD CONSTRAINT "user_blocks_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."user_blocks" ADD CONSTRAINT "user_blocks_blockedUserId_fkey" FOREIGN KEY ("blockedUserId") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
