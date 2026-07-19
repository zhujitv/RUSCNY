CREATE TYPE "SummaryGenerationStatus" AS ENUM ('PROCESSING', 'COMPLETED', 'FAILED');

ALTER TABLE "User"
ADD COLUMN "legalPolicyVersion" TEXT,
ADD COLUMN "legalPolicyAcceptedAt" TIMESTAMP(3);

ALTER TABLE "GuestIdentity"
ADD COLUMN "legalPolicyVersion" TEXT,
ADD COLUMN "legalPolicyAcceptedAt" TIMESTAMP(3);

ALTER TABLE "ConversationSummary"
ADD COLUMN "summarySources" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN "generationMode" TEXT NOT NULL DEFAULT 'MANUAL',
ADD COLUMN "provider" TEXT,
ADD COLUMN "model" TEXT,
ADD COLUMN "promptVersion" TEXT,
ADD COLUMN "providerRequestId" TEXT,
ADD COLUMN "inputTokens" INTEGER,
ADD COLUMN "outputTokens" INTEGER,
ADD COLUMN "sourceHash" TEXT,
ADD COLUMN "generatedByUserId" TEXT,
ADD COLUMN "approvedRevision" INTEGER,
ADD COLUMN "approvedAt" TIMESTAMP(3),
ADD COLUMN "approvedByUserId" TEXT;

CREATE TABLE "SummaryGeneration" (
  "id" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "requestedByUserId" TEXT,
  "idempotencyKey" TEXT NOT NULL,
  "sourceHash" TEXT NOT NULL,
  "activeKey" TEXT,
  "status" "SummaryGenerationStatus" NOT NULL DEFAULT 'PROCESSING',
  "summaryRevision" INTEGER,
  "provider" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "promptVersion" TEXT NOT NULL,
  "providerRequestId" TEXT,
  "inputTokens" INTEGER,
  "outputTokens" INTEGER,
  "errorCode" TEXT,
  "attempts" INTEGER NOT NULL DEFAULT 1,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SummaryGeneration_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SummaryGeneration_activeKey_key" ON "SummaryGeneration"("activeKey");
CREATE UNIQUE INDEX "SummaryGeneration_conversationId_idempotencyKey_key" ON "SummaryGeneration"("conversationId", "idempotencyKey");
CREATE INDEX "SummaryGeneration_conversationId_sourceHash_status_idx" ON "SummaryGeneration"("conversationId", "sourceHash", "status");
CREATE INDEX "SummaryGeneration_status_startedAt_idx" ON "SummaryGeneration"("status", "startedAt");

ALTER TABLE "ConversationSummary" ADD CONSTRAINT "ConversationSummary_generatedByUserId_fkey" FOREIGN KEY ("generatedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ConversationSummary" ADD CONSTRAINT "ConversationSummary_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SummaryGeneration" ADD CONSTRAINT "SummaryGeneration_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SummaryGeneration" ADD CONSTRAINT "SummaryGeneration_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
