-- Keep shared meeting records intact when an account is anonymized or when a
-- privileged maintenance operation removes an identity row.
ALTER TYPE "UserStatus" ADD VALUE IF NOT EXISTS 'DELETED';

ALTER TABLE "User" ADD COLUMN "deletedAt" TIMESTAMP(3);

-- Password login/register establishes a recent-authentication window. Token
-- refresh deliberately does not advance this timestamp.
ALTER TABLE "UserDevice" ADD COLUMN "authenticatedAt" TIMESTAMP(3);
UPDATE "UserDevice" SET "authenticatedAt" = "createdAt" WHERE "authenticatedAt" IS NULL;
ALTER TABLE "UserDevice" ALTER COLUMN "authenticatedAt" SET NOT NULL;
ALTER TABLE "UserDevice" ALTER COLUMN "authenticatedAt" SET DEFAULT CURRENT_TIMESTAMP;

CREATE TABLE "GuestPrincipal" (
  "id" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revokedAt" TIMESTAMP(3),
  CONSTRAINT "GuestPrincipal_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GuestPrincipal_tokenHash_key" ON "GuestPrincipal"("tokenHash");

ALTER TABLE "GuestIdentity" ADD COLUMN "guestPrincipalId" TEXT;
CREATE UNIQUE INDEX "GuestIdentity_conversationId_guestPrincipalId_key"
  ON "GuestIdentity"("conversationId", "guestPrincipalId");
ALTER TABLE "GuestIdentity" ADD CONSTRAINT "GuestIdentity_guestPrincipalId_fkey"
  FOREIGN KEY ("guestPrincipalId") REFERENCES "GuestPrincipal"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Conversation" DROP CONSTRAINT "Conversation_ownerId_fkey";
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_ownerId_fkey"
  FOREIGN KEY ("ownerId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Participant" DROP CONSTRAINT "Participant_userId_fkey";
ALTER TABLE "Participant" ADD CONSTRAINT "Participant_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Participant" DROP CONSTRAINT "Participant_guestIdentityId_fkey";
ALTER TABLE "Participant" ADD CONSTRAINT "Participant_guestIdentityId_fkey"
  FOREIGN KEY ("guestIdentityId") REFERENCES "GuestIdentity"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
