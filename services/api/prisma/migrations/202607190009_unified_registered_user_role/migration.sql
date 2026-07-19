-- A registered account no longer has a permanent Host/Customer product role.
-- Meeting authority is derived from Conversation.ownerId and the matching
-- per-meeting Participant row instead.
ALTER TYPE "UserRole" RENAME TO "UserRole_legacy";

CREATE TYPE "UserRole" AS ENUM ('USER');

ALTER TABLE "User"
  ALTER COLUMN "role" TYPE "UserRole"
  USING ('USER'::"UserRole");

DROP TYPE "UserRole_legacy";
