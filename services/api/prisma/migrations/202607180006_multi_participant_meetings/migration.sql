-- Additive multi-participant meeting upgrade. Existing conversations,
-- participants and messages keep their IDs and remain readable.
CREATE TYPE "ParticipantPresence" AS ENUM ('ONLINE', 'OFFLINE', 'LEFT', 'REMOVED');
CREATE TYPE "FriendRequestStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED');
CREATE TYPE "MeetingInvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'REVOKED', 'EXPIRED');

ALTER TABLE "User"
  ADD COLUMN "company" TEXT,
  ADD COLUMN "preferredLanguage" "Language" NOT NULL DEFAULT 'zh';

ALTER TABLE "GuestIdentity"
  ADD COLUMN "preferredLanguage" "Language" NOT NULL DEFAULT 'ru';

ALTER TABLE "Participant"
  ADD COLUMN "company" TEXT,
  ADD COLUMN "presence" "ParticipantPresence" NOT NULL DEFAULT 'OFFLINE';

UPDATE "Participant" p
SET "company" = g."company"
FROM "GuestIdentity" g
WHERE p."guestIdentityId" = g."id" AND p."company" IS NULL;

ALTER TABLE "TranslationMessage"
  ADD COLUMN "speakerDisplayName" TEXT,
  ADD COLUMN "speakerCompany" TEXT,
  ADD COLUMN "speakerLanguage" "Language";

UPDATE "TranslationMessage" m
SET
  "speakerDisplayName" = p."displayName",
  "speakerCompany" = p."company",
  "speakerLanguage" = p."preferredLanguage"
FROM "Participant" p
WHERE m."participantId" = p."id";

UPDATE "TranslationMessage"
SET
  "speakerDisplayName" = COALESCE("speakerDisplayName", '未知参会者'),
  "speakerLanguage" = COALESCE("speakerLanguage", "sourceLanguage");

ALTER TABLE "TranslationMessage"
  ALTER COLUMN "speakerDisplayName" SET NOT NULL,
  ALTER COLUMN "speakerLanguage" SET NOT NULL;

ALTER TABLE "ConversationSummary"
  ADD COLUMN "participantRoster" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN "coreDiscussion" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN "partyViews" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN "confirmedItems" JSONB NOT NULL DEFAULT '[]';

CREATE TABLE "FriendRequest" (
  "id" TEXT NOT NULL,
  "senderId" TEXT NOT NULL,
  "receiverId" TEXT NOT NULL,
  "status" "FriendRequestStatus" NOT NULL DEFAULT 'PENDING',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "respondedAt" TIMESTAMP(3),
  CONSTRAINT "FriendRequest_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Friendship" (
  "id" TEXT NOT NULL,
  "userAId" TEXT NOT NULL,
  "userBId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Friendship_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Friendship_distinct_users" CHECK ("userAId" <> "userBId")
);

CREATE TABLE "MeetingInvitation" (
  "id" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "inviterId" TEXT NOT NULL,
  "inviteeId" TEXT NOT NULL,
  "status" "MeetingInvitationStatus" NOT NULL DEFAULT 'PENDING',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "respondedAt" TIMESTAMP(3),
  CONSTRAINT "MeetingInvitation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FriendRequest_senderId_receiverId_key" ON "FriendRequest"("senderId", "receiverId");
CREATE INDEX "FriendRequest_receiverId_status_createdAt_idx" ON "FriendRequest"("receiverId", "status", "createdAt");
CREATE UNIQUE INDEX "Friendship_userAId_userBId_key" ON "Friendship"("userAId", "userBId");
CREATE INDEX "Friendship_userBId_idx" ON "Friendship"("userBId");
CREATE UNIQUE INDEX "MeetingInvitation_conversationId_inviteeId_key" ON "MeetingInvitation"("conversationId", "inviteeId");
CREATE INDEX "MeetingInvitation_inviteeId_status_createdAt_idx" ON "MeetingInvitation"("inviteeId", "status", "createdAt");

ALTER TABLE "FriendRequest" ADD CONSTRAINT "FriendRequest_senderId_fkey"
  FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FriendRequest" ADD CONSTRAINT "FriendRequest_receiverId_fkey"
  FOREIGN KEY ("receiverId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Friendship" ADD CONSTRAINT "Friendship_userAId_fkey"
  FOREIGN KEY ("userAId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Friendship" ADD CONSTRAINT "Friendship_userBId_fkey"
  FOREIGN KEY ("userBId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MeetingInvitation" ADD CONSTRAINT "MeetingInvitation_conversationId_fkey"
  FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MeetingInvitation" ADD CONSTRAINT "MeetingInvitation_inviterId_fkey"
  FOREIGN KEY ("inviterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MeetingInvitation" ADD CONSTRAINT "MeetingInvitation_inviteeId_fkey"
  FOREIGN KEY ("inviteeId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
