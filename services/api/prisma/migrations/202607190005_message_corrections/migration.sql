CREATE TYPE "MessageReviewStatus" AS ENUM (
    'UNREVIEWED',
    'PENDING',
    'CONFIRMED',
    'REJECTED'
);

CREATE TYPE "MessageCorrectionKind" AS ENUM ('MANUAL', 'RETRANSLATE');

CREATE TYPE "MessageCorrectionStatus" AS ENUM (
    'PENDING',
    'CONFIRMED',
    'REJECTED'
);

CREATE TYPE "CorrectionActorType" AS ENUM ('USER', 'GUEST');

-- The provider result remains in sourceText/translatedText. These columns
-- materialize only the current review state so timeline reads do not have to
-- replay the append-only audit table.
ALTER TABLE "TranslationMessage"
ADD COLUMN "reviewStatus" "MessageReviewStatus" NOT NULL DEFAULT 'UNREVIEWED',
ADD COLUMN "reviewRevision" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "confirmedSourceText" TEXT,
ADD COLUMN "confirmedTranslatedText" TEXT,
ADD COLUMN "pendingSourceText" TEXT,
ADD COLUMN "pendingTranslatedText" TEXT,
ADD COLUMN "reviewedAt" TIMESTAMP(3);

CREATE TABLE "MessageCorrection" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "kind" "MessageCorrectionKind" NOT NULL,
    "status" "MessageCorrectionStatus" NOT NULL DEFAULT 'PENDING',
    "proposedSourceText" TEXT NOT NULL,
    "proposedTranslatedText" TEXT NOT NULL,
    "reason" TEXT,
    "actorType" "CorrectionActorType" NOT NULL,
    "actorSubjectId" TEXT NOT NULL,
    "actorParticipantId" TEXT NOT NULL,
    "actorDisplayName" TEXT NOT NULL,
    "actorCompany" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "decisionReason" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decidedBySubjectId" TEXT,
    "decidedByParticipantId" TEXT,
    "deciderDisplayName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessageCorrection_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MessageCorrection_messageId_revision_key"
ON "MessageCorrection"("messageId", "revision");

CREATE UNIQUE INDEX "MessageCorrection_messageId_idempotencyKey_key"
ON "MessageCorrection"("messageId", "idempotencyKey");

CREATE INDEX "MessageCorrection_conversationId_createdAt_idx"
ON "MessageCorrection"("conversationId", "createdAt");

CREATE INDEX "MessageCorrection_messageId_status_revision_idx"
ON "MessageCorrection"("messageId", "status", "revision");

ALTER TABLE "MessageCorrection"
ADD CONSTRAINT "MessageCorrection_messageId_fkey"
FOREIGN KEY ("messageId") REFERENCES "TranslationMessage"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
