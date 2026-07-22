-- Roll back the withdrawn background friend-call notification feature.
-- The preceding application deployment no longer reads these objects, so the
-- destructive schema change is safe while the old business code is serving.

-- Tokens registered by the withdrawn feature were always paired with a
-- binding. Remove only those feature-owned credentials and preserve any
-- pre-existing unbound value in the legacy pushToken column.
UPDATE "UserDevice"
SET "pushToken" = NULL
WHERE "pushBindingId" IS NOT NULL;

DROP TABLE IF EXISTS "FriendCallPushJob";

DROP INDEX IF EXISTS "UserDevice_pushBindingId_key";
DROP INDEX IF EXISTS "UserDevice_pushToken_key";

ALTER TABLE "UserDevice"
DROP COLUMN IF EXISTS "pushBindingId",
DROP COLUMN IF EXISTS "pushTokenUpdatedAt";

DROP TYPE IF EXISTS "FriendCallPushKind";
