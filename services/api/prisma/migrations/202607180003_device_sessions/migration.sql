-- Bind every access token to one concrete login session. Reusing the same
-- deviceId after a revocation creates a new session and cannot revive old
-- access tokens or Socket.IO handshakes.
ALTER TABLE "UserDevice" ADD COLUMN "sessionId" TEXT;

-- Existing sessions keep working across this migration. Their durable row id
-- is sufficient as a non-secret session generation because the JWT is signed.
UPDATE "UserDevice" SET "sessionId" = "id" WHERE "sessionId" IS NULL;

ALTER TABLE "UserDevice" ALTER COLUMN "sessionId" SET NOT NULL;
