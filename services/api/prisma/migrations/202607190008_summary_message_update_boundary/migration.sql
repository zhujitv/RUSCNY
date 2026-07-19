-- A summary must become stale when an existing FINAL message is corrected.
-- Message count and max sequence alone cannot detect an in-place review.
ALTER TABLE "ConversationSummary"
ADD COLUMN "sourceLatestMessageUpdatedAt" TIMESTAMP(3);

CREATE INDEX "TranslationMessage_conversationId_status_updatedAt_idx"
ON "TranslationMessage"("conversationId", "status", "updatedAt");
