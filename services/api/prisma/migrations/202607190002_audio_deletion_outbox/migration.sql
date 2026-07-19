-- Persist TTS deletion work independently from TranslationMessage rows so a
-- conversation can be committed as deleted before any local/S3 side effect.
CREATE TABLE "AudioDeletionJob" (
    "id" TEXT NOT NULL,
    "storedValue" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AudioDeletionJob_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AudioDeletionJob_storedValue_key"
ON "AudioDeletionJob"("storedValue");

CREATE INDEX "AudioDeletionJob_nextAttemptAt_lockedAt_createdAt_idx"
ON "AudioDeletionJob"("nextAttemptAt", "lockedAt", "createdAt");
