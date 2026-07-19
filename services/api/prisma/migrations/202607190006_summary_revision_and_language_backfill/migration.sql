-- Corrective, additive migration for legacy one-to-one data. Existing IDs,
-- participant rows, messages and summaries remain intact.

ALTER TABLE "ConversationSummary"
  ADD COLUMN "sourceMaxSequence" INTEGER,
  ADD COLUMN "sourceMessageCount" INTEGER,
  ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 1;

-- The multi-participant migration had to add broad zh/ru defaults because the
-- account rows did not previously store a language. Participant snapshots are
-- older and more precise. A guest identity belongs to one conversation, so its
-- participant snapshot is an unambiguous backfill source.
UPDATE "GuestIdentity" AS guest
SET "preferredLanguage" = participant."preferredLanguage"
FROM "Participant" AS participant
WHERE participant."guestIdentityId" = guest."id"
  AND guest."preferredLanguage" IS DISTINCT FROM participant."preferredLanguage";

-- A registered user may intentionally override their language per meeting.
-- Only backfill when all preserved participant snapshots agree, avoiding a
-- destructive guess for bilingual users with mixed historical choices.
WITH consistent_user_language AS (
  SELECT
    "userId",
    MIN("preferredLanguage"::text)::"Language" AS "preferredLanguage"
  FROM "Participant"
  WHERE "userId" IS NOT NULL
  GROUP BY "userId"
  HAVING COUNT(DISTINCT "preferredLanguage") = 1
)
UPDATE "User" AS app_user
SET "preferredLanguage" = inferred."preferredLanguage"
FROM consistent_user_language AS inferred
WHERE app_user."id" = inferred."userId"
  AND app_user."preferredLanguage" IS DISTINCT FROM inferred."preferredLanguage";

-- Null source boundaries intentionally mark summaries generated before source
-- revision tracking. Guessing a boundary could falsely label a stale legacy
-- summary as current. The next explicit post-meeting regeneration fills them.
