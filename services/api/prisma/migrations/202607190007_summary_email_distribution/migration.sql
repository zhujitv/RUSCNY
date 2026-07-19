-- Meeting-scoped email snapshots keep the recipient stable without exposing
-- account-owned email addresses through ordinary participant list responses.
ALTER TABLE "GuestIdentity" ADD COLUMN "email" TEXT;
ALTER TABLE "Participant" ADD COLUMN "email" TEXT;

-- Registered participants from older meetings can inherit the current
-- server-owned account email. Existing guests remain nullable and are shown as
-- ineligible until they provide an address through a new join.
UPDATE "Participant" AS participant
SET "email" = LOWER("User"."email")
FROM "User"
WHERE participant."userId" = "User"."id"
  AND "User"."email" IS NOT NULL;

CREATE TYPE "SummaryEmailDistributionStatus" AS ENUM (
  'PROCESSING',
  'COMPLETED',
  'PARTIAL_FAILURE',
  'FAILED'
);

CREATE TYPE "SummaryEmailRecipientStatus" AS ENUM (
  'PENDING',
  'SENDING',
  'SENT',
  'FAILED'
);

CREATE TABLE "SummaryEmailDistribution" (
  "id" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "summaryId" TEXT NOT NULL,
  "summaryRevision" INTEGER NOT NULL,
  "requestedByUserId" TEXT,
  "idempotencyKey" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  "status" "SummaryEmailDistributionStatus" NOT NULL DEFAULT 'PROCESSING',
  "recipientCount" INTEGER NOT NULL DEFAULT 0,
  "sentCount" INTEGER NOT NULL DEFAULT 0,
  "failedCount" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "SummaryEmailDistribution_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SummaryEmailRecipient" (
  "id" TEXT NOT NULL,
  "distributionId" TEXT NOT NULL,
  "participantId" TEXT NOT NULL,
  "recipientEmail" TEXT,
  "recipientDisplayName" TEXT NOT NULL,
  "recipientCompany" TEXT,
  "recipientLanguage" "Language" NOT NULL,
  "status" "SummaryEmailRecipientStatus" NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "claimedAt" TIMESTAMP(3),
  "providerMessageId" TEXT,
  "errorCode" TEXT,
  "errorMessage" TEXT,
  "sentAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SummaryEmailRecipient_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SummaryEmailDistribution_conversationId_idempotencyKey_key"
ON "SummaryEmailDistribution"("conversationId", "idempotencyKey");

CREATE INDEX "SummaryEmailDistribution_conversationId_createdAt_idx"
ON "SummaryEmailDistribution"("conversationId", "createdAt");

CREATE UNIQUE INDEX "SummaryEmailRecipient_distributionId_participantId_key"
ON "SummaryEmailRecipient"("distributionId", "participantId");

CREATE INDEX "SummaryEmailRecipient_distributionId_status_idx"
ON "SummaryEmailRecipient"("distributionId", "status");

CREATE INDEX "SummaryEmailRecipient_participantId_createdAt_idx"
ON "SummaryEmailRecipient"("participantId", "createdAt");

ALTER TABLE "SummaryEmailDistribution"
ADD CONSTRAINT "SummaryEmailDistribution_conversationId_fkey"
FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SummaryEmailDistribution"
ADD CONSTRAINT "SummaryEmailDistribution_requestedByUserId_fkey"
FOREIGN KEY ("requestedByUserId") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "SummaryEmailRecipient"
ADD CONSTRAINT "SummaryEmailRecipient_distributionId_fkey"
FOREIGN KEY ("distributionId") REFERENCES "SummaryEmailDistribution"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SummaryEmailRecipient"
ADD CONSTRAINT "SummaryEmailRecipient_participantId_fkey"
FOREIGN KEY ("participantId") REFERENCES "Participant"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
