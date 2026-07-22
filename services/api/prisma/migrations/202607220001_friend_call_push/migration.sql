-- Persist friend-call wake-up notifications so a process restart between the
-- authoritative call transition and FCM delivery cannot silently lose them.
CREATE TYPE "FriendCallPushKind" AS ENUM ('INCOMING', 'CANCEL');

ALTER TABLE "UserDevice"
ADD COLUMN "pushBindingId" TEXT,
ADD COLUMN "pushTokenUpdatedAt" TIMESTAMP(3);

-- The column existed before it was activated. Keep the most recently seen
-- owner if a legacy/manual write reused a token so the uniqueness migration
-- cannot fail and an old account cannot retain the same installation token.
WITH "RankedPushTokens" AS (
    SELECT
        "id",
        ROW_NUMBER() OVER (
            PARTITION BY "pushToken"
            ORDER BY "lastSeenAt" DESC, "createdAt" DESC, "id" DESC
        ) AS "position"
    FROM "UserDevice"
    WHERE "pushToken" IS NOT NULL
)
UPDATE "UserDevice"
SET "pushToken" = NULL,
    "pushBindingId" = NULL,
    "pushTokenUpdatedAt" = NULL
FROM "RankedPushTokens"
WHERE "UserDevice"."id" = "RankedPushTokens"."id"
  AND "RankedPushTokens"."position" > 1;

CREATE UNIQUE INDEX "UserDevice_pushToken_key" ON "UserDevice"("pushToken");
CREATE UNIQUE INDEX "UserDevice_pushBindingId_key" ON "UserDevice"("pushBindingId");

CREATE TABLE "FriendCallPushJob" (
    "id" TEXT NOT NULL,
    "callId" TEXT NOT NULL,
    "recipientUserId" TEXT NOT NULL,
    "kind" "FriendCallPushKind" NOT NULL,
    -- Only populated for a short-lived CANCEL job when the recipient account
    -- is being disabled/deleted and its UserDevice credentials must be erased
    -- in the same transaction. The worker deletes the whole row on delivery
    -- or expiry (the cancellation TTL is capped at 60 seconds).
    "targetSnapshot" JSONB,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FriendCallPushJob_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FriendCallPushJob_callId_recipientUserId_kind_key"
ON "FriendCallPushJob"("callId", "recipientUserId", "kind");

CREATE INDEX "FriendCallPushJob_nextAttemptAt_lockedAt_idx"
ON "FriendCallPushJob"("nextAttemptAt", "lockedAt");

CREATE INDEX "FriendCallPushJob_recipientUserId_createdAt_idx"
ON "FriendCallPushJob"("recipientUserId", "createdAt");

ALTER TABLE "FriendCallPushJob"
ADD CONSTRAINT "FriendCallPushJob_callId_fkey"
FOREIGN KEY ("callId") REFERENCES "FriendCall"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "FriendCallPushJob"
ADD CONSTRAINT "FriendCallPushJob_recipientUserId_fkey"
FOREIGN KEY ("recipientUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
