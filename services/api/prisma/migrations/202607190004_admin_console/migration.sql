-- Add an explicit, server-verified system administrator capability without
-- changing the existing HOST/CUSTOMER product roles.
ALTER TABLE "User"
ADD COLUMN "isSystemAdmin" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "AdminAuditLog" (
    "id" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "requestId" TEXT,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminAuditLog_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AdminPasswordResetToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminPasswordResetToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AdminPasswordResetToken_tokenHash_key"
ON "AdminPasswordResetToken"("tokenHash");

CREATE INDEX "AdminAuditLog_createdAt_idx"
ON "AdminAuditLog"("createdAt");

CREATE INDEX "AdminAuditLog_actorUserId_createdAt_idx"
ON "AdminAuditLog"("actorUserId", "createdAt");

CREATE INDEX "AdminAuditLog_targetType_targetId_createdAt_idx"
ON "AdminAuditLog"("targetType", "targetId", "createdAt");

CREATE INDEX "AdminAuditLog_action_createdAt_idx"
ON "AdminAuditLog"("action", "createdAt");

CREATE INDEX "AdminPasswordResetToken_userId_usedAt_expiresAt_idx"
ON "AdminPasswordResetToken"("userId", "usedAt", "expiresAt");

CREATE INDEX "AdminPasswordResetToken_createdById_createdAt_idx"
ON "AdminPasswordResetToken"("createdById", "createdAt");

ALTER TABLE "AdminAuditLog"
ADD CONSTRAINT "AdminAuditLog_actorUserId_fkey"
FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AdminPasswordResetToken"
ADD CONSTRAINT "AdminPasswordResetToken_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AdminPasswordResetToken"
ADD CONSTRAINT "AdminPasswordResetToken_createdById_fkey"
FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
