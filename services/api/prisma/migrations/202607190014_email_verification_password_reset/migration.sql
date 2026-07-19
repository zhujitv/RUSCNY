ALTER TABLE "User" ADD COLUMN "emailVerifiedAt" TIMESTAMP(3);

-- Existing accounts already proved possession through the previous operating
-- process. Backfill them so this rollout only gates newly registered users.
UPDATE "User"
SET "emailVerifiedAt" = COALESCE("createdAt", CURRENT_TIMESTAMP)
WHERE "email" IS NOT NULL;

CREATE TABLE "EmailVerificationToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EmailVerificationToken_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "UserPasswordResetToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UserPasswordResetToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EmailVerificationToken_tokenHash_key" ON "EmailVerificationToken"("tokenHash");
CREATE INDEX "EmailVerificationToken_userId_usedAt_expiresAt_idx" ON "EmailVerificationToken"("userId", "usedAt", "expiresAt");
CREATE INDEX "EmailVerificationToken_createdAt_idx" ON "EmailVerificationToken"("createdAt");
CREATE UNIQUE INDEX "UserPasswordResetToken_tokenHash_key" ON "UserPasswordResetToken"("tokenHash");
CREATE INDEX "UserPasswordResetToken_userId_usedAt_expiresAt_idx" ON "UserPasswordResetToken"("userId", "usedAt", "expiresAt");
CREATE INDEX "UserPasswordResetToken_createdAt_idx" ON "UserPasswordResetToken"("createdAt");

ALTER TABLE "EmailVerificationToken"
ADD CONSTRAINT "EmailVerificationToken_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "UserPasswordResetToken"
ADD CONSTRAINT "UserPasswordResetToken_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
