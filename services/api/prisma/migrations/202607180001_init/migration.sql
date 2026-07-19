-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('HOST', 'CUSTOMER');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "DevicePlatform" AS ENUM ('ANDROID', 'IOS', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "ConversationStatus" AS ENUM ('WAITING', 'ACTIVE', 'ENDED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "GuestHistoryPolicy" AS ENUM ('NO_ACCESS_AFTER_END', 'ACCESS_FOR_24_HOURS', 'ACCESS_FOR_7_DAYS', 'PERMANENT');

-- CreateEnum
CREATE TYPE "ParticipantRole" AS ENUM ('HOST', 'GUEST', 'VIEWER');

-- CreateEnum
CREATE TYPE "Language" AS ENUM ('zh', 'ru', 'en');

-- CreateEnum
CREATE TYPE "MessageStatus" AS ENUM ('PROCESSING', 'FINAL', 'FAILED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "displayName" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "passwordHash" TEXT,
    "avatarUrl" TEXT,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserDevice" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "platform" "DevicePlatform" NOT NULL DEFAULT 'UNKNOWN',
    "pushToken" TEXT,
    "refreshTokenHash" TEXT,
    "refreshTokenJti" TEXT,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserDevice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GuestIdentity" (
    "id" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "company" TEXT,
    "deviceId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GuestIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Contact" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "linkedUserId" TEXT,
    "displayName" TEXT NOT NULL,
    "company" TEXT,
    "country" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Contact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Conversation" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "title" TEXT,
    "hostLanguage" "Language" NOT NULL DEFAULT 'zh',
    "guestLanguage" "Language" NOT NULL DEFAULT 'ru',
    "status" "ConversationStatus" NOT NULL DEFAULT 'WAITING',
    "roomTokenHash" TEXT NOT NULL,
    "roomCodeHash" TEXT NOT NULL,
    "guestHistoryPolicy" "GuestHistoryPolicy" NOT NULL DEFAULT 'ACCESS_FOR_24_HOURS',
    "guestAccessExpiresAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "maxSequence" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Participant" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "role" "ParticipantRole" NOT NULL,
    "userId" TEXT,
    "guestIdentityId" TEXT,
    "displayName" TEXT NOT NULL,
    "preferredLanguage" "Language" NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leftAt" TIMESTAMP(3),
    "lastSeenAt" TIMESTAMP(3),
    "removedAt" TIMESTAMP(3),

    CONSTRAINT "Participant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TranslationMessage" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "participantId" TEXT NOT NULL,
    "speakerRole" "ParticipantRole" NOT NULL,
    "sourceLanguage" "Language" NOT NULL,
    "targetLanguage" "Language" NOT NULL,
    "sourceText" TEXT NOT NULL DEFAULT '',
    "translatedText" TEXT NOT NULL DEFAULT '',
    "audioUrl" TEXT,
    "status" "MessageStatus" NOT NULL DEFAULT 'PROCESSING',
    "sequence" INTEGER NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "startedAtMs" INTEGER,
    "endedAtMs" INTEGER,
    "provider" TEXT,
    "providerRequestId" TEXT,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TranslationMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GlossaryTerm" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "sourceLanguage" "Language" NOT NULL,
    "targetLanguage" "Language" NOT NULL,
    "sourceTerm" TEXT NOT NULL,
    "targetTerm" TEXT NOT NULL,
    "category" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GlossaryTerm_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConversationSummary" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "customerRequirements" JSONB NOT NULL,
    "products" JSONB NOT NULL,
    "specifications" JSONB NOT NULL,
    "quantity" JSONB NOT NULL,
    "price" JSONB NOT NULL,
    "delivery" JSONB NOT NULL,
    "paymentTerms" JSONB NOT NULL,
    "actionItems" JSONB NOT NULL,
    "openQuestions" JSONB NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConversationSummary_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_phone_key" ON "User"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "UserDevice_refreshTokenJti_idx" ON "UserDevice"("refreshTokenJti");

-- CreateIndex
CREATE UNIQUE INDEX "UserDevice_userId_deviceId_key" ON "UserDevice"("userId", "deviceId");

-- CreateIndex
CREATE INDEX "GuestIdentity_conversationId_deviceId_idx" ON "GuestIdentity"("conversationId", "deviceId");

-- CreateIndex
CREATE INDEX "Contact_ownerId_displayName_idx" ON "Contact"("ownerId", "displayName");

-- CreateIndex
CREATE INDEX "Contact_linkedUserId_idx" ON "Contact"("linkedUserId");

-- CreateIndex
CREATE UNIQUE INDEX "Conversation_roomTokenHash_key" ON "Conversation"("roomTokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "Conversation_roomCodeHash_key" ON "Conversation"("roomCodeHash");

-- CreateIndex
CREATE INDEX "Conversation_ownerId_contactId_createdAt_idx" ON "Conversation"("ownerId", "contactId", "createdAt");

-- CreateIndex
CREATE INDEX "Conversation_status_expiresAt_idx" ON "Conversation"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "Participant_conversationId_role_idx" ON "Participant"("conversationId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "Participant_conversationId_userId_key" ON "Participant"("conversationId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "Participant_conversationId_guestIdentityId_key" ON "Participant"("conversationId", "guestIdentityId");

-- CreateIndex
CREATE INDEX "TranslationMessage_conversationId_createdAt_idx" ON "TranslationMessage"("conversationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "TranslationMessage_conversationId_sequence_key" ON "TranslationMessage"("conversationId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "TranslationMessage_conversationId_participantId_idempotency_key" ON "TranslationMessage"("conversationId", "participantId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "GlossaryTerm_ownerId_enabled_idx" ON "GlossaryTerm"("ownerId", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "GlossaryTerm_ownerId_sourceLanguage_targetLanguage_sourceTe_key" ON "GlossaryTerm"("ownerId", "sourceLanguage", "targetLanguage", "sourceTerm");

-- CreateIndex
CREATE UNIQUE INDEX "ConversationSummary_conversationId_key" ON "ConversationSummary"("conversationId");

-- AddForeignKey
ALTER TABLE "UserDevice" ADD CONSTRAINT "UserDevice_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuestIdentity" ADD CONSTRAINT "GuestIdentity_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_linkedUserId_fkey" FOREIGN KEY ("linkedUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Participant" ADD CONSTRAINT "Participant_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Participant" ADD CONSTRAINT "Participant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Participant" ADD CONSTRAINT "Participant_guestIdentityId_fkey" FOREIGN KEY ("guestIdentityId") REFERENCES "GuestIdentity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TranslationMessage" ADD CONSTRAINT "TranslationMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TranslationMessage" ADD CONSTRAINT "TranslationMessage_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "Participant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GlossaryTerm" ADD CONSTRAINT "GlossaryTerm_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationSummary" ADD CONSTRAINT "ConversationSummary_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
